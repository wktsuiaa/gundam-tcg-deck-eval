import type { GundamCardPrint, SandboxMatchState, SandboxMoveSuggestion, SandboxPlayerState, SandboxSide, SandboxUnitInstance } from '@/types/gundam';
import { doesPilotLinkUnit } from '@/lib/gundam-keywords';
import type { EffectClauseAst } from '@/lib/cfg-parser';
import { checkCondition } from './conditions';
import { canPayActivationCost, payActivationCost, resolveClause, resolveClausesForTiming, resolveStartOfTurn } from './effects';
import { cloneState, destroyUnit } from './match-state';
import { matchesCardSelector } from './targeting';
import { EMPTY_PARSED_EFFECTS, effectiveAp, effectiveRemainingHp, unitHasKeyword, unitKeywordValue } from './unit-stats';

export function canPayCard(player: SandboxPlayerState, card: GundamCardPrint): boolean {
  const lvReq = card.lv ?? 1;
  const costReq = card.cost ?? 0;
  return player.resourcesTotal >= lvReq && player.resourcesActive >= costReq;
}

export function canUnitAttack(unit: SandboxUnitInstance, currentTurn: number): boolean {
  if (unit.rested || effectiveAp(unit) <= 0) return false;
  if (unit.summonedTurn === currentTurn && !unit.isLinked) return false;
  return true;
}

export function canActivateUnitMain(state: SandboxMatchState, side: SandboxSide, unit: SandboxUnitInstance): boolean {
  const player = state.players[side];
  const parsed = unit.card.compiledEffect ?? EMPTY_PARSED_EFFECTS;
  const clause = parsed.abilities.find(
    (ab): ab is EffectClauseAst => ab.kind === 'EFFECT_CLAUSE' && ab.timings.includes('ACTIVATE_MAIN')
  );
  if (!clause) return false;
  if (clause.oncePerTurn && unit.activatedMainTurn === state.turn) return false;
  if (!canPayActivationCost(player, clause.cost, unit)) return false;
  if (!checkCondition(clause.condition, state, side, unit)) return false;

  const freesSlot = Boolean(clause.cost?.returnSelfToDeckBottom || clause.cost?.destroySelf);
  for (const step of clause.steps) {
    if (step.action === 'DEPLOY_FROM_TRASH') {
      if (player.battleArea.length - (freesSlot ? 1 : 0) >= 6) return false;
      const resAfterCost = player.resourcesActive - (clause.cost?.resourceCost ?? 0);
      const hasValid = player.trash.some(
        (c) => matchesCardSelector(c, step.target) && (step.free || resAfterCost >= (c.cost ?? 0))
      );
      if (!hasValid) return false;
    } else if (step.action === 'ADD_FROM_TRASH_TO_HAND') {
      if (!player.trash.some((c) => matchesCardSelector(c, step.target))) return false;
    }
  }
  return true;
}

export function applySandboxMove(
  state: SandboxMatchState,
  move: SandboxMoveSuggestion
): SandboxMatchState {
  if (state.winner) return state;

  const next = cloneState(state);
  const side = next.activeSide;
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const player = next.players[side];
  const opponent = next.players[oppSide];
  let summary = move.title;

  if (move.actionType === 'DEPLOY_UNIT' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card) && player.battleArea.length < 6) {
      const [card] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= card.cost ?? 0;
      const instance: SandboxUnitInstance = {
        instanceId: `unit-${side}-${next.turn}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        card,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: next.turn,
        deployedFromZone: 'hand',
      };
      player.battleArea.push(instance);
      const effNotes = resolveClausesForTiming(next, side, card, 'DEPLOY', instance, move.targetInstanceId);
      summary = `Deployed ${card.name} (${card.apRaw}/${card.hpRaw}, C${card.cost ?? 0})${
        effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''
      }.`;
    }
  } else if (move.actionType === 'PAIR_PILOT' && move.card && move.unitInstanceId) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    const unit = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (handIdx !== -1 && unit && !unit.pairedPilot && canPayCard(player, move.card)) {
      const [pilot] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= pilot.cost ?? 0;
      unit.pairedPilot = pilot;
      unit.isLinked = doesPilotLinkUnit(pilot, unit.card);
      const effNotes = [
        ...resolveClausesForTiming(next, side, pilot, 'WHEN_PAIRED', unit, move.targetInstanceId),
        ...resolveClausesForTiming(next, side, unit.card, 'WHEN_PAIRED', unit, move.targetInstanceId),
        ...(unit.isLinked
          ? [
              ...resolveClausesForTiming(next, side, pilot, 'WHEN_LINKED', unit, move.targetInstanceId),
              ...resolveClausesForTiming(next, side, unit.card, 'WHEN_LINKED', unit, move.targetInstanceId),
            ]
          : []),
      ];
      summary = `${unit.isLinked ? 'Linked' : 'Paired'} ${pilot.name} onto ${unit.card.name} (${effectiveAp(
        unit
      )}/${effectiveRemainingHp(unit)})${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
    }
  } else if (move.actionType === 'DEPLOY_BASE' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card)) {
      const [baseCard] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= baseCard.cost ?? 0;
      if (player.base) player.trash.push(player.base);
      player.base = baseCard;
      player.baseDamage = 0;
      const effNotes = resolveClausesForTiming(next, side, baseCard, 'DEPLOY', undefined, move.targetInstanceId);
      summary = `Deployed Base ${baseCard.name} (HP ${baseCard.hp ?? 5})${
        effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''
      }.`;
    }
  } else if (move.actionType === 'PLAY_COMMAND' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card)) {
      const [cmd] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= cmd.cost ?? 0;
      player.trash.push(cmd);
      const effNotes = resolveClausesForTiming(next, side, cmd, 'MAIN', undefined, move.targetInstanceId);
      summary = `Played Command ${cmd.name}${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
    }
  } else if (move.actionType === 'ACTIVATE_MAIN' && move.unitInstanceId) {
    const unit = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (unit && canActivateUnitMain(next, side, unit)) {
      const parsed = unit.card.compiledEffect ?? EMPTY_PARSED_EFFECTS;
      const clause = parsed.abilities.find(
        (ab): ab is EffectClauseAst => ab.kind === 'EFFECT_CLAUSE' && ab.timings.includes('ACTIVATE_MAIN')
      );
      if (clause) {
        unit.activatedMainTurn = next.turn;
        payActivationCost(next, side, clause.cost, unit);
        const effNotes = resolveClause(next, side, clause, unit.card, unit, move.targetInstanceId);
        summary = `Activated ${unit.card.name}${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
      }
    }
  } else if (move.actionType === 'ATTACK_SHIELD' && move.unitInstanceId) {
    const attacker = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (attacker && canUnitAttack(attacker, next.turn)) {
      attacker.rested = true;
      const combatNotes: string[] = [];
      combatNotes.push(...resolveClausesForTiming(next, side, attacker.card, 'ATTACK', attacker, move.targetInstanceId));
      if (attacker.pairedPilot) {
        combatNotes.push(...resolveClausesForTiming(next, side, attacker.pairedPilot, 'ATTACK', attacker, move.targetInstanceId));
      }

      const highManeuver = unitHasKeyword(attacker, 'High-Maneuver', next, side);
      const blocker = !highManeuver
        ? opponent.battleArea.find((u) => !u.rested && unitHasKeyword(u, 'Blocker', next, oppSide))
        : undefined;

      if (blocker) {
        blocker.rested = true;
        combatNotes.push(...resolveClausesForTiming(next, oppSide, blocker.card, 'WHEN_ATTACKED', blocker));
        if (blocker.pairedPilot) {
          combatNotes.push(...resolveClausesForTiming(next, oppSide, blocker.pairedPilot, 'WHEN_ATTACKED', blocker));
        }

        const atkAp = effectiveAp(attacker, next, side);
        const blkAp = effectiveAp(blocker, next, oppSide);
        const firstStrike = unitHasKeyword(attacker, 'First Strike', next, side);

        blocker.damage += atkAp;
        const blkDied = effectiveRemainingHp(blocker) <= 0;
        if (blkDied) {
          destroyUnit(next, oppSide, blocker.instanceId, true);
          combatNotes.push(
            ...resolveClausesForTiming(next, side, attacker.card, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'UNIT')
          );
          if (attacker.pairedPilot) {
            combatNotes.push(
              ...resolveClausesForTiming(next, side, attacker.pairedPilot, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'UNIT')
            );
          }
          if (unitHasKeyword(attacker, 'Breach', next, side) && opponent.shields > 0) {
            opponent.shields = Math.max(0, opponent.shields - 1);
          }
        }
        if (!(firstStrike && blkDied)) {
          attacker.damage += blkAp;
          if (effectiveRemainingHp(attacker) <= 0) {
            destroyUnit(next, side, attacker.instanceId, true);
            combatNotes.push(
              ...resolveClausesForTiming(next, oppSide, blocker.card, 'WHEN_DESTROY_BY_BATTLE', blocker, undefined, true, 'UNIT')
            );
          }
        }
        summary = `${attacker.card.name} attacked Shields, intercepted by <Blocker> ${blocker.card.name}${
          combatNotes.length > 0 ? ` — ${combatNotes.join(', ')}` : ''
        }.`;
      } else if (opponent.base) {
        const atkAp = effectiveAp(attacker, next, side);
        const baseMax = opponent.base.hp ?? 5;
        opponent.baseDamage += atkAp;
        if (opponent.baseDamage >= baseMax) {
          const destroyedName = opponent.base.name;
          opponent.trash.push(opponent.base);
          opponent.base = null;
          opponent.baseDamage = 0;
          combatNotes.push(
            ...resolveClausesForTiming(next, side, attacker.card, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'BASE')
          );
          if (attacker.pairedPilot) {
            combatNotes.push(
              ...resolveClausesForTiming(next, side, attacker.pairedPilot, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'BASE')
            );
          }
          summary = `${attacker.card.name} destroyed Base ${destroyedName}!${
            combatNotes.length > 0 ? ` — ${combatNotes.join(', ')}` : ''
          }`;
        } else {
          summary = `${attacker.card.name} dealt ${atkAp} damage to Base ${opponent.base.name}${
            combatNotes.length > 0 ? ` — ${combatNotes.join(', ')}` : ''
          }.`;
        }
      } else if (opponent.shields > 0) {
        const shieldHit = unitHasKeyword(attacker, 'Suppression', next, side) ? 2 : 1;
        opponent.shields = Math.max(0, opponent.shields - shieldHit);
        combatNotes.push(
          ...resolveClausesForTiming(next, side, attacker.card, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'SHIELD')
        );
        if (attacker.pairedPilot) {
          combatNotes.push(
            ...resolveClausesForTiming(next, side, attacker.pairedPilot, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'SHIELD')
          );
        }
        summary = `${attacker.card.name} (${effectiveAp(attacker, next, side)} AP) broke ${shieldHit} Shield(s) (${opponent.shields} left)${
          combatNotes.length > 0 ? ` — ${combatNotes.join(', ')}` : ''
        }.`;
      } else {
        next.winner = side;
        summary = `${attacker.card.name} landed a direct lethal hit with 0 Shields remaining — Side ${side} wins!`;
      }
    }
  } else if (move.actionType === 'ATTACK_UNIT' && move.unitInstanceId && move.targetInstanceId) {
    const attacker = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    const defender = opponent.battleArea.find((u) => u.instanceId === move.targetInstanceId);
    if (attacker && defender && canUnitAttack(attacker, next.turn) && defender.rested) {
      attacker.rested = true;
      const combatNotes: string[] = [];
      combatNotes.push(...resolveClausesForTiming(next, side, attacker.card, 'ATTACK', attacker, defender.instanceId));
      if (attacker.pairedPilot) {
        combatNotes.push(...resolveClausesForTiming(next, side, attacker.pairedPilot, 'ATTACK', attacker, defender.instanceId));
      }
      combatNotes.push(...resolveClausesForTiming(next, oppSide, defender.card, 'WHEN_ATTACKED', defender));
      if (defender.pairedPilot) {
        combatNotes.push(...resolveClausesForTiming(next, oppSide, defender.pairedPilot, 'WHEN_ATTACKED', defender));
      }

      const atkAp = effectiveAp(attacker, next, side);
      const defAp = effectiveAp(defender, next, oppSide);
      const firstStrike = unitHasKeyword(attacker, 'First Strike', next, side);

      defender.damage += atkAp;
      const defDied = effectiveRemainingHp(defender) <= 0;
      if (defDied) {
        destroyUnit(next, oppSide, defender.instanceId, true);
        combatNotes.push(
          ...resolveClausesForTiming(next, side, attacker.card, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'UNIT')
        );
        if (attacker.pairedPilot) {
          combatNotes.push(
            ...resolveClausesForTiming(next, side, attacker.pairedPilot, 'WHEN_DESTROY_BY_BATTLE', attacker, move.targetInstanceId, true, 'UNIT')
          );
        }
        if (unitHasKeyword(attacker, 'Breach', next, side) && opponent.shields > 0) {
          opponent.shields = Math.max(0, opponent.shields - 1);
        }
      }
      if (!(firstStrike && defDied)) {
        attacker.damage += defAp;
        if (effectiveRemainingHp(attacker) <= 0) {
          destroyUnit(next, side, attacker.instanceId, true);
          combatNotes.push(
            ...resolveClausesForTiming(next, oppSide, defender.card, 'WHEN_DESTROY_BY_BATTLE', defender, undefined, true, 'UNIT')
          );
        }
      }
      summary = `${attacker.card.name} battled ${defender.card.name} (${
        defDied ? 'defender destroyed' : 'damaged'
      })${combatNotes.length > 0 ? ` — ${combatNotes.join(', ')}` : ''}.`;
    }
  } else if (move.actionType === 'PASS_TURN') {
    const repaired: string[] = [];
    for (const u of player.battleArea) {
      const repairAmt = unitKeywordValue(u, 'Repair', next, side);
      if (u.damage > 0 && repairAmt !== null) {
        u.damage = Math.max(0, u.damage - repairAmt);
        repaired.push(`${u.card.name} +${repairAmt} HP`);
      }
    }
    summary = `Ended Turn ${next.turn}${repaired.length > 0 ? ` (<Repair>: ${repaired.join(', ')})` : ''}.`;
    next.lastOpponentAction = `Side ${side} ${summary}`;
    next.activeSide = oppSide;
    resolveStartOfTurn(next, oppSide);
  }

  if (move.actionType !== 'PASS_TURN') {
    next.lastOpponentAction = `Side ${side}: ${summary}`;
  }

  next.log = [
    {
      id: `log-${next.turn}-${next.log.length}-${Date.now()}`,
      turn: state.turn,
      side,
      summary,
    },
    ...next.log.slice(0, 39),
  ];

  return next;
}
