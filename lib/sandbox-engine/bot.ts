import type { SandboxMatchState, SandboxMoveSuggestion, SandboxSide, SandboxUnitInstance } from '@/types/gundam';
import { doesPilotLinkUnit, isCommandPilot } from '@/lib/gundam-keywords';
import { scoreSingleCardSignals } from '@/lib/deck-engine';
import { applySandboxMove, canActivateBaseMain, canActivateUnitMain, canPayCard, canUnitAttack } from './moves';
import { getLegalTargetOptions } from './targeting';
import { effectiveAp, effectiveRemainingHp, unitHasKeyword, unitHasProhibition } from './unit-stats';

export function estimateBoardWinScore(state: SandboxMatchState, perspective: SandboxSide): number {
  const me = state.players[perspective];
  const oppSide: SandboxSide = perspective === 'A' ? 'B' : 'A';
  const opp = state.players[oppSide];

  const unitScore = (u: SandboxUnitInstance, s: SandboxSide) =>
    effectiveAp(u) * 2.2 +
    effectiveRemainingHp(u) * 1.8 +
    (u.isLinked ? 3 : 0) +
    (unitHasKeyword(u, 'Blocker', state, s) ? 2.5 : 0);

  const myBoard = me.battleArea.reduce((s, u) => s + unitScore(u, perspective), 0);
  const oppBoard = opp.battleArea.reduce((s, u) => s + unitScore(u, oppSide), 0);
  const shieldDiff = (me.shields - opp.shields) * 7.5;
  const handDiff = (me.hand.length - opp.hand.length) * 3.2;
  const baseDiff = (me.base ? 4 : 0) - (opp.base ? 4 : 0);

  return Math.max(8, Math.min(94, Math.round(50 + shieldDiff + (myBoard - oppBoard) * 0.9 + handDiff + baseDiff)));
}

export function evaluateSandboxBestMoves(
  state: SandboxMatchState,
  side: SandboxSide
): SandboxMoveSuggestion[] {
  if (state.winner) return [];
  const player = state.players[side];
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const opponent = state.players[oppSide];
  const baseWin = estimateBoardWinScore(state, side);
  const candidates: Omit<SandboxMoveSuggestion, 'rank'>[] = [];

  // 1. Evaluate deploying Units, pairing Pilots, Commands, Bases from hand
  const seenCardNos = new Set<string>();
  for (const card of player.hand) {
    if (seenCardNos.has(card.cardNo)) continue;
    seenCardNos.add(card.cardNo);
    if (!canPayCard(player, card, state, side)) continue;

    if (card.type === 'UNIT' && player.battleArea.length < 6) {
      const sig = scoreSingleCardSignals(card);
      const matchingPilotInHand = player.hand.some(
        (p) => p.type === 'PILOT' && doesPilotLinkUnit(p, card)
      );
      const statScore = (card.ap ?? 2) * 3 + (card.hp ?? 2) * 2.5;
      let score = 55 + statScore + (card.cost ?? 1) * 4;
      const reasonParts: string[] = [];

      if (player.battleArea.length === 0) {
        score += 18;
        reasonParts.push('Establishes board presence with Lv./Cost curve on time');
      }
      if (sig.hasBlocker && opponent.battleArea.length > 0) {
        score += 16;
        reasonParts.push('<Blocker> walls opposing attackers');
      }
      if (matchingPilotInHand) {
        score += 15;
        reasonParts.push('Prepares immediate [Link] Pilot pairing');
      }
      if (opponent.battleArea.some((u) => !u.rested) && sig.hasRest) {
        score += 12;
        reasonParts.push('Creates Rest disruption');
      }
      candidates.push({
        id: `deploy-${card.printId}`,
        actionType: 'DEPLOY_UNIT',
        title: `Deploy ${card.name} (C${card.cost ?? 0})`,
        reason:
          reasonParts.join('; ') ||
          `Adds ${card.apRaw}/${card.hpRaw} Unit pressure (${state.lastOpponentAction.slice(0, 48)})`,
        winDeltaPct: Math.min(18, Math.max(2, Math.round((score - 50) * 0.25))),
        priorityScore: score,
        card,
      });
    }

    if (card.type === 'PILOT' || isCommandPilot(card)) {
      for (const unit of player.battleArea) {
        if (unit.pairedPilot) continue;
        const links = doesPilotLinkUnit(card, unit.card);
        let score = links ? 86 : 52;
        if (links && unit.summonedTurn === state.turn) {
          score += 14;
        }
        const newAp = effectiveAp(unit) + (card.ap ?? 0);
        candidates.push({
          id: `pair-${card.printId}-${unit.instanceId}`,
          actionType: 'PAIR_PILOT',
          title: `${links ? 'Link' : 'Pair'} ${card.name} → ${unit.card.name}`,
          reason: links
            ? `Activates [Link] (${unit.card.link}) for ${newAp} AP immediate attack & 【When Linked】 value.`
            : `Buffs ${unit.card.name} to ${newAp} AP for stronger favorable trades.`,
          winDeltaPct: links ? 11 : 4,
          priorityScore: score,
          card,
          unitInstanceId: unit.instanceId,
        });
      }
    }

    if (card.type === 'COMMAND') {
      const hasMainClause = (card.compiledEffect?.abilities ?? []).some(
        (ab) => ab.kind === 'EFFECT_CLAUSE' && ab.timings.includes('MAIN')
      );
      if (hasMainClause) {
        const legalTargets = getLegalTargetOptions(state, side, card, 'MAIN');
        const bestTarget = [...legalTargets].sort((a, b) => effectiveAp(b) - effectiveAp(a))[0];
        const sig = scoreSingleCardSignals(card);
        let score = 48;
        let reason = `Applies ${sig.effectStyles.join(' / ') || 'tactical'} effect.`;
        if (bestTarget) {
          score += 32 + effectiveAp(bestTarget) * 3;
          reason = `Answers opponent's ${bestTarget.card.name} (${effectiveAp(bestTarget)}/${effectiveRemainingHp(bestTarget)}).`;
        } else if (sig.hasDraw || sig.hasSearch || sig.hasRamp) {
          score += 24;
          reason = `Builds hand liquidity or Resource curve advantage without risking board tempo.`;
        }
        candidates.push({
          id: `cmd-${card.printId}`,
          actionType: 'PLAY_COMMAND',
          title: `Play ${card.name} (C${card.cost ?? 0})`,
          reason,
          winDeltaPct: Math.max(2, Math.round((score - 45) * 0.22)),
          priorityScore: score,
          card,
          targetInstanceId: bestTarget?.instanceId,
        });
      }
    }

    if (card.type === 'BASE' && !player.base) {
      const incomingThreat = opponent.battleArea.reduce((s, u) => s + effectiveAp(u), 0);
      const score = 58 + (opponent.shields <= 3 || incomingThreat >= 5 ? 18 : 6);
      candidates.push({
        id: `base-${card.printId}`,
        actionType: 'DEPLOY_BASE',
        title: `Deploy Base ${card.name}`,
        reason: `Shields your remaining ${player.shields} Shield(s) behind ${card.hp ?? 5} Base HP.`,
        winDeltaPct: 5,
        priorityScore: score,
        card,
      });
    }
  }

  // 2. Evaluate Battle Area 【Activate･Main】 abilities (e.g. ST09-001 -> ST09-006 from trash)
  for (const unit of player.battleArea) {
    if (!canActivateUnitMain(state, side, unit)) continue;

    candidates.push({
      id: `act-${unit.instanceId}`,
      actionType: 'ACTIVATE_MAIN',
      title: `Activate ${unit.card.name}`,
      reason: `Triggers 【Activate･Main】 on ${unit.card.name} for board tempo/recursion.`,
      winDeltaPct: 9,
      priorityScore: 84,
      card: unit.card,
      unitInstanceId: unit.instanceId,
    });
  }

  if (player.base && canActivateBaseMain(state, side)) {
    candidates.push({
      id: `act-base-${player.base.printId}`,
      actionType: 'ACTIVATE_MAIN',
      title: `Activate Base ${player.base.name}`,
      reason: `Triggers 【Activate･Main】 on Base ${player.base.name}.`,
      winDeltaPct: 8,
      priorityScore: 80,
      card: player.base,
      unitInstanceId: 'BASE',
    });
  }

  // 3. Evaluate Attacks (Shields vs Rested Enemy Units)
  for (const unit of player.battleArea) {
    if (!canUnitAttack(unit, state.turn, state, side)) continue;
    if (unitHasProhibition(unit, 'CANT_CHOOSE_ENEMY_PLAYER', state, side)) continue;
    const myAp = effectiveAp(unit, state, side);
    const myHp = effectiveRemainingHp(unit, state, side);
    const highManeuver = unitHasKeyword(unit, 'High-Maneuver', state, side);
    const oppBlocker = !highManeuver
      ? opponent.battleArea.find(
          (u) =>
            !u.rested &&
            unitHasKeyword(u, 'Blocker', state, oppSide) &&
            !unitHasProhibition(u, 'CANT_ACTIVATE_BLOCKER', state, oppSide)
        )
      : undefined;

    const isLethal = opponent.shields === 0 && !opponent.base && !oppBlocker;
    const shieldScore = isLethal
      ? 120
      : oppBlocker && effectiveAp(oppBlocker) >= myHp && !unitHasKeyword(unit, 'First Strike', state, side)
      ? 42
      : 74 + (unit.isLinked ? 6 : 0) + (highManeuver ? 8 : 0);

    candidates.push({
      id: `atk-shield-${unit.instanceId}`,
      actionType: 'ATTACK_SHIELD',
      title: isLethal
        ? `Lethal Attack with ${unit.card.name}!`
        : `Attack ${opponent.base ? 'Base' : 'Shield'} with ${unit.card.name} (${myAp} AP)`,
      reason: isLethal
        ? `0 Shields and no active <Blocker> — wins the game immediately.`
        : oppBlocker
        ? `Forces trade or burn past <Blocker> ${oppBlocker.card.name}.`
        : `Pressures opponent down to ${Math.max(0, opponent.shields - 1)} Shield(s).`,
      winDeltaPct: isLethal ? Math.max(10, 99 - baseWin) : 7,
      priorityScore: shieldScore,
      unitInstanceId: unit.instanceId,
    });

    for (const enemy of opponent.battleArea) {
      if (!enemy.rested) continue;
      const eAp = effectiveAp(enemy);
      const eHp = effectiveRemainingHp(enemy);
      if (myAp < eHp) continue;
      const survives = unitHasKeyword(unit, 'First Strike', state, side) || myHp > eAp;
      const hasBreach = unitHasKeyword(unit, 'Breach', state, side);
      const tradeScore = (survives ? 82 : 60) + (enemy.isLinked ? 10 : 0) + (hasBreach ? 10 : 0);

      candidates.push({
        id: `atk-unit-${unit.instanceId}-${enemy.instanceId}`,
        actionType: 'ATTACK_UNIT',
        title: `${unit.card.name} attacks rested ${enemy.card.name}`,
        reason: `${survives ? 'Clean value trade' : '1-for-1 trade'} removing ${eAp} AP threat${
          hasBreach ? ' + <Breach> Shield damage' : ''
        }.`,
        winDeltaPct: survives ? 9 : 4,
        priorityScore: tradeScore,
        unitInstanceId: unit.instanceId,
        targetInstanceId: enemy.instanceId,
      });
    }
  }

  candidates.push({
    id: `pass-${side}-${state.turn}`,
    actionType: 'PASS_TURN',
    title: `End Turn ${state.turn}`,
    reason: `Hold remaining ${player.resourcesActive} active Resource(s) and pass to Side ${oppSide}.`,
    winDeltaPct: 0,
    priorityScore: 25,
  });

  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  return candidates.slice(0, 3).map((c, idx) => ({
    ...c,
    rank: (idx + 1) as 1 | 2 | 3,
  }));
}

export function stepSandboxBot(state: SandboxMatchState): SandboxMatchState {
  if (state.winner) return state;
  const suggestions = evaluateSandboxBestMoves(state, state.activeSide);
  const best = suggestions[0];
  if (!best) return state;
  return applySandboxMove(state, best);
}
