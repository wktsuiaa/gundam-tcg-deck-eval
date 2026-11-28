import type { GundamCardPrint, SandboxMatchState, SandboxPlayerState, SandboxSide, SandboxUnitInstance } from '@/types/gundam';
import { doesPilotLinkUnit } from '@/lib/gundam-keywords';
import type { ActivationCost, EffectStep, EffectTiming, TargetSelector } from '@/lib/effect-parser';
import type { AbilityAst, EffectClauseAst } from '@/lib/cfg-parser';
import { checkCondition, evaluateScaleMetric } from './conditions';
import { destroyUnit } from './match-state';
import { findBattleAreaTargets, matchesCardSelector, matchesUnitSelector } from './targeting';
import { EMPTY_PARSED_EFFECTS, effectiveAp, effectiveRemainingHp } from './unit-stats';

export function canPayActivationCost(
  player: SandboxPlayerState,
  cost: ActivationCost | undefined,
  selfUnit?: SandboxUnitInstance
): boolean {
  if (!cost) return true;
  if (cost.resourceCost && player.resourcesActive < cost.resourceCost) return false;
  if (cost.restSelf && selfUnit?.rested) return false;
  if (cost.discardCount && player.hand.length < cost.discardCount) return false;
  if (cost.exileFromTrashCount && player.trash.length < cost.exileFromTrashCount) return false;
  return true;
}

export function payActivationCost(
  state: SandboxMatchState,
  side: SandboxSide,
  cost: ActivationCost | undefined,
  selfUnit?: SandboxUnitInstance
) {
  if (!cost) return;
  const player = state.players[side];
  if (cost.resourceCost) player.resourcesActive = Math.max(0, player.resourcesActive - cost.resourceCost);
  if (cost.restSelf && selfUnit) selfUnit.rested = true;
  if (cost.discardCount) {
    for (let i = 0; i < cost.discardCount && player.hand.length > 0; i++) {
      const d = player.hand.pop();
      if (d) player.trash.push(d);
    }
  }
  if (cost.exileFromTrashCount && player.trash.length >= cost.exileFromTrashCount) {
    player.trash.splice(0, cost.exileFromTrashCount);
  }
  if (cost.destroySelf && selfUnit) {
    destroyUnit(state, side, selfUnit.instanceId);
  }
  if (cost.returnSelfToDeckBottom && selfUnit) {
    const idx = player.battleArea.findIndex((u) => u.instanceId === selfUnit.instanceId);
    if (idx !== -1) {
      const [removed] = player.battleArea.splice(idx, 1);
      if (removed.pairedPilot) player.trash.push(removed.pairedPilot);
      player.library.push(removed.card);
    }
  }
}

function selectorCacheKey(sel: TargetSelector): string {
  return JSON.stringify([
    sel.owner,
    sel.cardType,
    sel.zone,
    sel.lvMin,
    sel.lvMax,
    sel.lvMaxRef,
    sel.apMin,
    sel.apMax,
    sel.apMaxRef,
    sel.hpMin,
    sel.hpMax,
    sel.state,
    sel.trait,
    sel.traits,
    sel.color,
    sel.notColor,
    sel.paired,
    sel.linked,
    sel.other,
    sel.token,
    sel.excludeToken,
    sel.count,
    sel.maxCount,
  ]);
}

function resolveSteps(
  state: SandboxMatchState,
  side: SandboxSide,
  steps: EffectStep[],
  raw: string,
  sourceCard: GundamCardPrint,
  selfUnit?: SandboxUnitInstance,
  targetInstanceId?: string,
  destroyedByBattle = false
): string[] {
  const notes: string[] = [];
  if (steps.length === 0) {
    notes.push(`Manual resolution required: ${raw}`);
    return notes;
  }

  const actor = state.players[side];
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const opp = state.players[oppSide];
  const chosenCache = new Map<string, { side: SandboxSide; unit: SandboxUnitInstance }[]>();

  const executeList = (stepList: EffectStep[]) => {
    for (const step of stepList) {
      switch (step.action) {
      case 'DRAW': {
        const factor = evaluateScaleMetric(step.scaleBy, state, side, selfUnit);
        if (factor === null) {
          notes.push(`Manual resolution required: ${raw}`);
          break;
        }
        const total = step.count * factor;
        for (let i = 0; i < total && actor.library.length > 0; i++) {
          const drawn = actor.library.shift();
          if (drawn) {
            actor.hand.push(drawn);
            notes.push(`drew ${drawn.name}`);
          }
        }
        break;
      }
      case 'DISCARD': {
        for (let i = 0; i < step.count && actor.hand.length > 0; i++) {
          const discarded = actor.hand.pop();
          if (discarded) {
            actor.trash.push(discarded);
            notes.push(`discarded ${discarded.name}`);
          }
        }
        break;
      }
      case 'ADD_SHIELD_TO_HAND': {
        if (actor.shields > 0) {
          actor.shields -= 1;
          const cardFromLib = actor.library.shift();
          if (cardFromLib) actor.hand.push(cardFromLib);
          notes.push('added 1 Shield to hand');
        }
        break;
      }
      case 'ADD_RESOURCE': {
        for (let i = 0; i < step.count && actor.resourcesTotal < 10; i++) {
          actor.resourcesTotal += 1;
          if (!step.rested) actor.resourcesActive += 1;
          notes.push(step.ex ? '+1 EX Resource' : '+1 Resource');
        }
        break;
      }
      case 'DEPLOY_TOKEN': {
        for (let i = 0; i < step.count && actor.battleArea.length < 6; i++) {
          const tokenCard: GundamCardPrint = {
            ...sourceCard,
            printId: `TOKEN-${sourceCard.printId}-${Date.now()}-${i}`,
            cardNo: 'TOKEN',
            name: step.name ?? `${sourceCard.traits[0] ?? 'Mobile Suit'} Token`,
            type: 'UNIT',
            traits: step.traits ?? sourceCard.traits,
            lv: 1,
            cost: 1,
            ap: step.ap ?? 2,
            hp: step.hp ?? 2,
            apRaw: String(step.ap ?? 2),
            hpRaw: String(step.hp ?? 2),
            effect: '',
            link: '',
          };
          actor.battleArea.push({
            instanceId: `unit-tok-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            card: tokenCard,
            pairedPilot: null,
            isLinked: false,
            rested: false,
            damage: 0,
            apBuff: 0,
            summonedTurn: state.turn,
            deployedFromZone: 'hand',
          });
          notes.push(`deployed ${tokenCard.apRaw}/${tokenCard.hpRaw} Token`);
        }
        break;
      }
      case 'DEPLOY_FROM_TRASH': {
        if (actor.battleArea.length >= 6) break;
        const idx = actor.trash.findIndex((c) => matchesCardSelector(c, step.target));
        if (idx === -1) break;
        const candidate = actor.trash[idx];
        const payCost = step.free ? 0 : candidate.cost ?? 0;
        if (!step.free && actor.resourcesActive < payCost) break;
        actor.resourcesActive -= payCost;
        actor.trash.splice(idx, 1);
        const deployed: SandboxUnitInstance = {
          instanceId: `unit-${side}-${state.turn}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          card: candidate,
          pairedPilot: null,
          isLinked: false,
          rested: Boolean(step.rested),
          damage: 0,
          apBuff: 0,
          summonedTurn: state.turn,
          deployedFromZone: 'trash',
        };
        actor.battleArea.push(deployed);
        notes.push(`deployed ${candidate.name} from trash`);
        // shortcut: chained DEPLOY targets auto-pick highest-AP enemy instead of opening a second prompt
        notes.push(...resolveClausesForTiming(state, side, candidate, 'DEPLOY', deployed, targetInstanceId));
        break;
      }
      case 'ADD_FROM_TRASH_TO_HAND': {
        const idx = actor.trash.findIndex((c) => matchesCardSelector(c, step.target));
        if (idx !== -1) {
          const [card] = actor.trash.splice(idx, 1);
          actor.hand.push(card);
          notes.push(`recovered ${card.name} from trash`);
        }
        break;
      }
      case 'PAIR_SELF_FROM_TRASH': {
        const trashIdx = actor.trash.findIndex((c) => c.printId === sourceCard.printId);
        if (trashIdx === -1) break;
        const unit = actor.battleArea.find((u) => !u.pairedPilot && matchesUnitSelector(u, step.target, selfUnit, state, side));
        if (!unit) break;
        const [pairedCard] = actor.trash.splice(trashIdx, 1);
        unit.pairedPilot = pairedCard;
        unit.isLinked = doesPilotLinkUnit(pairedCard, unit.card);
        notes.push(`paired ${pairedCard.name} from trash onto ${unit.card.name}`);
        break;
      }
      case 'DESTROY':
      case 'DEAL_DAMAGE':
      case 'MODIFY_AP':
      case 'REST':
      case 'SET_ACTIVE':
      case 'BOUNCE':
      case 'RECOVER_HP': {
        if (step.action === 'SET_ACTIVE' && step.target.cardType === 'RESOURCE') {
          const count = step.target.countRef === 'ENEMY_PLAYERS' ? 1 : typeof step.target.count === 'number' ? step.target.count : 1;
          const resOwner = step.target.owner === 'ENEMY' ? opp : actor;
          const added = Math.min(count, Math.max(0, resOwner.resourcesTotal - resOwner.resourcesActive));
          resOwner.resourcesActive += added;
          if (added > 0) notes.push(`set ${added} Resource active`);
          break;
        }
        const cacheKey = selectorCacheKey(step.target);
        const cached =
          !step.target.self && step.target.count !== 'ALL'
            ? chosenCache.get(cacheKey)?.filter((entry) =>
                state.players[entry.side].battleArea.some((u) => u.instanceId === entry.unit.instanceId)
              )
            : undefined;
        let chosen: { side: SandboxSide; unit: SandboxUnitInstance }[];
        if (cached && cached.length > 0) {
          chosen = cached;
        } else {
          const legal = findBattleAreaTargets(state, side, step.target, selfUnit);
          if (legal.length === 0) break;

          chosen =
            step.target.count === 'ALL'
              ? legal
              : [
                  (targetInstanceId ? legal.find((x) => x.unit.instanceId === targetInstanceId) : undefined) ??
                    [...legal].sort((a, b) => effectiveAp(b.unit, state, b.side) - effectiveAp(a.unit, state, a.side))[0],
                ];
          if (!step.target.self && step.target.count !== 'ALL') {
            chosenCache.set(cacheKey, chosen);
          }
        }

        for (const entry of chosen) {
          if (step.action === 'DESTROY') {
            destroyUnit(state, entry.side, entry.unit.instanceId);
            notes.push(`destroyed ${entry.unit.card.name}`);
          } else if (step.action === 'DEAL_DAMAGE') {
            const factor = evaluateScaleMetric(step.scaleBy, state, side, selfUnit);
            if (factor === null) {
              notes.push(`Manual resolution required: ${raw}`);
              break;
            }
            const dmg = step.amount * factor;
            entry.unit.damage += dmg;
            notes.push(`dealt ${dmg} damage to ${entry.unit.card.name}`);
            if (effectiveRemainingHp(entry.unit, state, entry.side) <= 0) {
              destroyUnit(state, entry.side, entry.unit.instanceId);
              notes.push(`${entry.unit.card.name} destroyed`);
            }
          } else if (step.action === 'MODIFY_AP') {
            const factor = evaluateScaleMetric(step.scaleBy, state, side, selfUnit);
            if (factor === null) {
              notes.push(`Manual resolution required: ${raw}`);
              break;
            }
            const delta = step.delta * factor;
            entry.unit.apBuff += delta;
            notes.push(`${delta >= 0 ? '+' : ''}${delta} AP to ${entry.unit.card.name}`);
          } else if (step.action === 'REST' && !entry.unit.rested) {
            entry.unit.rested = true;
            notes.push(`rested ${entry.unit.card.name}`);
          } else if (step.action === 'SET_ACTIVE' && entry.unit.rested) {
            entry.unit.rested = false;
            notes.push(`set ${entry.unit.card.name} active`);
          } else if (step.action === 'BOUNCE') {
            const owner = state.players[entry.side];
            const idx = owner.battleArea.findIndex((u) => u.instanceId === entry.unit.instanceId);
            if (idx !== -1) {
              const [bounced] = owner.battleArea.splice(idx, 1);
              owner.hand.push(bounced.card);
              if (bounced.pairedPilot) owner.hand.push(bounced.pairedPilot);
              notes.push(`bounced ${bounced.card.name} to hand`);
            }
          } else if (step.action === 'RECOVER_HP' && entry.unit.damage > 0) {
            entry.unit.damage = Math.max(0, entry.unit.damage - step.amount);
            notes.push(`repaired ${entry.unit.card.name} +${step.amount} HP`);
          }
        }
        break;
      }
      case 'EXILE': {
        if (step.target.zone === 'TRASH') {
          const ownerPlayer = step.target.owner === 'ENEMY' ? opp : actor;
          const matchingIndices: number[] = [];
          for (let i = 0; i < ownerPlayer.trash.length; i += 1) {
            if (matchesCardSelector(ownerPlayer.trash[i], step.target)) {
              matchingIndices.push(i);
            }
          }
          const reqCount =
            step.target.count === 'ALL'
              ? matchingIndices.length
              : step.target.count === 'UP_TO'
              ? Math.min(step.target.maxCount ?? 1, matchingIndices.length)
              : typeof step.target.count === 'number'
              ? step.target.count
              : 1;
          if (reqCount <= 0 || matchingIndices.length < reqCount) {
            break;
          }
          const toExile = matchingIndices.slice(0, reqCount).sort((a, b) => b - a);
          for (const idx of toExile) {
            const [exiled] = ownerPlayer.trash.splice(idx, 1);
            if (exiled) notes.push(`exiled ${exiled.name} from trash`);
          }
        }
        break;
      }
      case 'IF_CONDITION': {
        const unsimulatedSub = { hit: false };
        if (checkCondition(step.condition, state, side, selfUnit, destroyedByBattle, unsimulatedSub)) {
          executeList(step.thenSteps);
        } else if (unsimulatedSub.hit) {
          notes.push(`Manual resolution required: ${raw}`);
        } else if (step.elseSteps) {
          executeList(step.elseSteps);
        }
        break;
      }
      case 'LOOK_TOP': {
        if (actor.library.length > 0 && step.revealSearch) {
          const idx = step.trait
            ? actor.library.slice(0, step.count).findIndex((c) => c.traits.some((t) => t.toLowerCase() === step.trait!.toLowerCase()))
            : 0;
          if (idx >= 0) {
            const [picked] = actor.library.splice(idx, 1);
            actor.hand.push(picked);
            notes.push(`added ${picked.name} from top`);
          }
        }
        break;
      }
      case 'GRANT_KEYWORD':
      case 'ADD_SELF_TO_HAND':
      case 'DEPLOY_SELF':
      case 'FREEZE':
      case 'CANT_ATTACK':
      case 'ALLOW_ATTACK_ACTIVE':
      case 'DAMAGE_PROOF':
      case 'COST_REDUCTION':
      case 'REVEAL_TOP':
      case 'RETURN_TO_DECK':
      case 'GRANT_PILOT_MODE':
      case 'NAME_ALIAS':
        break;
      default:
        notes.push(`Manual resolution required: ${raw}`);
      }
    }
  };

  executeList(steps);
  return notes;
}

export function resolveClause(
  state: SandboxMatchState,
  side: SandboxSide,
  clause: EffectClauseAst,
  sourceCard: GundamCardPrint,
  selfUnit?: SandboxUnitInstance,
  targetInstanceId?: string,
  destroyedByBattle = false
): string[] {
  const notes: string[] = [];
  if (clause.oncePerTurn && selfUnit && !clause.timings.includes('ACTIVATE_MAIN')) {
    if (selfUnit.triggeredClauseTurns?.[clause.raw] === state.turn) {
      return notes;
    }
  }
  const unsimulatedCond = { hit: false };
  if (!checkCondition(clause.condition, state, side, selfUnit, destroyedByBattle, unsimulatedCond)) {
    if (unsimulatedCond.hit) {
      notes.push(`Manual resolution required: ${clause.raw}`);
    }
    return notes;
  }

  if (clause.oncePerTurn && selfUnit && !clause.timings.includes('ACTIVATE_MAIN')) {
    selfUnit.triggeredClauseTurns = {
      ...(selfUnit.triggeredClauseTurns ?? {}),
      [clause.raw]: state.turn,
    };
  }

  return resolveSteps(state, side, clause.steps, clause.raw, sourceCard, selfUnit, targetInstanceId, destroyedByBattle);
}

export function resolveAbility(
  state: SandboxMatchState,
  side: SandboxSide,
  ability: AbilityAst,
  sourceCard: GundamCardPrint,
  selfUnit?: SandboxUnitInstance,
  targetInstanceId?: string,
  destroyedByBattle = false
): string[] {
  if (ability.kind === 'EFFECT_CLAUSE') {
    return resolveClause(state, side, ability, sourceCard, selfUnit, targetInstanceId, destroyedByBattle);
  }
  if (ability.kind === 'CUSTOM_HOOK') {
    return resolveSteps(state, side, ability.steps, ability.raw, sourceCard, selfUnit, targetInstanceId, destroyedByBattle);
  }
  return [];
}

export function resolveClausesForTiming(
  state: SandboxMatchState,
  side: SandboxSide,
  card: GundamCardPrint,
  timing: EffectTiming,
  selfUnit?: SandboxUnitInstance,
  targetInstanceId?: string,
  destroyedByBattle = false,
  destroyTargetKind?: 'UNIT' | 'BASE' | 'SHIELD'
): string[] {
  const parsed = card.compiledEffect ?? EMPTY_PARSED_EFFECTS;
  const notes: string[] = [];
  for (const ab of parsed.abilities) {
    if (ab.kind !== 'EFFECT_CLAUSE') continue;
    if (!ab.timings.includes(timing)) continue;
    if (timing === 'WHEN_DESTROY_BY_BATTLE' && ab.triggerEvent) {
      if (ab.triggerEvent.damageType === 'EFFECT') continue;
      if (
        destroyTargetKind &&
        ab.triggerEvent.targetKind &&
        ab.triggerEvent.targetKind !== 'ANY_ENEMY_CARD' &&
        ab.triggerEvent.targetKind !== destroyTargetKind
      ) {
        continue;
      }
    }
    notes.push(...resolveClause(state, side, ab, card, selfUnit, targetInstanceId, destroyedByBattle));
  }
  return notes;
}

export function resolveStartOfTurn(next: SandboxMatchState, side: SandboxSide) {
  const player = next.players[side];
  if (side === next.firstSide) {
    next.turn += 1;
  }
  if (player.resourcesTotal < 10) {
    player.resourcesTotal += 1;
  }
  player.resourcesActive = player.resourcesTotal;
  for (const u of player.battleArea) {
    u.rested = false;
    u.apBuff = 0;
  }
  if (player.library.length > 0) {
    const drawn = player.library.shift();
    if (drawn) player.hand.push(drawn);
  } else {
    next.winner = side === 'A' ? 'B' : 'A';
  }
}
