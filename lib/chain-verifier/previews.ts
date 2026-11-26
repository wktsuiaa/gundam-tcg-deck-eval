import type { GundamCardPrint, SandboxMatchState, SandboxMoveSuggestion, SandboxPlayerState } from '../../types/gundam.ts';
import { doesPilotLinkUnit, isCommandPilot } from '../gundam-keywords.ts';
import { buildMinimalFeasibilityState, verifyPlayLine } from './play-line';
import { getCardAbilities } from './state-helpers';
import { ChainMatchState, ChainPlayerState, ChainShieldCard, ChainSide, ChainVerificationResult, ChainWitness, PlayerAction } from './types';

export interface DeckChainPreview {
  id: string;
  title: string;
  category: 'Link Pair' | 'Command-Pilot Link' | 'Mechanic Chain';
  cards: GundamCardPrint[];
  minTurn: number;
  firstPlayerResult: ChainVerificationResult;
  secondPlayerResult: ChainVerificationResult;
}

export interface SandboxMoveChainPreview {
  moveTitle: string;
  actionType: SandboxMoveSuggestion['actionType'];
  lvRequired: number;
  costRequired: number;
  activeResources: number;
  result: ChainVerificationResult;
}

export function makeChainFeasibilitySeed(
  cards: GundamCardPrint[],
  turn: number,
  exResources: number
): ChainMatchState {
  const base = buildMinimalFeasibilityState({
    kind: 'MINIMAL_FEASIBILITY',
    turn,
    activeHand: cards,
    opponentDummyBoard: {
      units: [
        { cardNo: 'OPP-DUMMY-1', name: 'Target Unit (Rested)', lv: 3, ap: 3, hp: 3, rested: true },
        { cardNo: 'OPP-DUMMY-2', name: 'Enemy Defender', lv: 2, ap: 2, hp: 2, rested: false },
      ],
      shields: 6,
    },
  });
  base.players.A.exResources = exResources;
  return base;
}

export function verifyCustomDeckChain(
  cardA: GundamCardPrint,
  cardB: GundamCardPrint | null,
  goingSecond: boolean
): { turn: number; result: ChainVerificationResult } {
  const ex = goingSecond ? 1 : 0;
  const cards = cardB ? [cardA, cardB] : [cardA];
  const maxLv = Math.max(...cards.map((c) => c.lv ?? 1), 1);
  const totalCost = cards.reduce((s, c) => s + (c.cost ?? 0), 0);
  const minTurn = Math.max(1, maxLv, Math.max(0, totalCost - ex));

  // If cardA is a Unit and cardB is Pilot or Command-Pilot, simulate deploy -> pair (and immediate attack if linked)
  if (cardA.type === 'UNIT' && cardB && (cardB.type === 'PILOT' || isCommandPilot(cardB))) {
    const state = makeChainFeasibilitySeed([cardA, cardB], minTurn, ex);
    const linked = doesPilotLinkUnit(cardB, cardA);
    const playLine: PlayerAction[] = [
      { type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 },
      { type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-unit#1' },
      ...(linked ? [{ type: 'ATTACK_SHIELD' as const, side: 'A' as const, attackerId: 'A-U-unit#1' }] : []),
    ];
    return {
      turn: minTurn,
      result: verifyPlayLine({
        mode: { kind: 'CONCRETE_SNAPSHOT', state },
        playLine,
        witness: { targets: [['B-DUMMY-0'], ['B-DUMMY-1']] },
      }),
    };
  }

  // Otherwise play cardA then cardB in order according to their card types
  const state = makeChainFeasibilitySeed(cards, minTurn, ex);
  const playLine: PlayerAction[] = [];
  let hasDeployedUnit = false;
  for (let i = 0; i < cards.length; i += 1) {
    const c = cards[i];
    if (c.type === 'UNIT') {
      playLine.push({ type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 });
      hasDeployedUnit = true;
    } else if (c.type === 'BASE') {
      playLine.push({ type: 'DEPLOY_BASE', side: 'A', handIndex: 0 });
    } else if (c.type === 'PILOT') {
      if (hasDeployedUnit) {
        playLine.push({ type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-unit#1' });
      } else {
        // Seed a friendly Unit so a Pilot can be verified cleanly
        state.players.A.battleArea.push({
          instanceId: 'A-U-HOST',
          card: { ...c, cardNo: 'ALLY-HOST', printId: 'ALLY-HOST', name: 'Friendly Unit', type: 'UNIT', ap: 3, hp: 3 },
          rested: false,
          damage: 0,
          deployedTurn: 1,
          temporaryModifiers: [],
          triggeredOnceThisTurn: [],
        });
        playLine.push({ type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-HOST' });
      }
    } else if (c.type === 'COMMAND') {
      const hasMain = getCardAbilities(c).abilities.some(
        (ab) => ab.kind === 'EFFECT_CLAUSE' && ab.timings.includes('MAIN')
      );
      if (hasMain) {
        playLine.push({ type: 'PLAY_COMMAND', side: 'A', handIndex: 0 });
      } else if (isCommandPilot(c)) {
        if (!hasDeployedUnit) {
          state.players.A.battleArea.push({
            instanceId: 'A-U-HOST',
            card: { ...c, cardNo: 'ALLY-HOST', printId: 'ALLY-HOST', name: 'Friendly Unit', type: 'UNIT', ap: 3, hp: 3 },
            rested: false,
            damage: 0,
            deployedTurn: 1,
            temporaryModifiers: [],
            triggeredOnceThisTurn: [],
          });
        }
        playLine.push({
          type: 'PAIR_PILOT',
          side: 'A',
          handIndex: 0,
          targetUnitId: hasDeployedUnit ? 'A-U-unit#1' : 'A-U-HOST',
        });
      }
    }
  }

  return {
    turn: minTurn,
    result: verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine,
      witness: { targets: [['B-DUMMY-0'], ['B-DUMMY-1']] },
    }),
  };
}

export function buildDeckChainPreviews(cards: GundamCardPrint[], maxItems = 6): DeckChainPreview[] {
  const uniqueMap = new Map<string, GundamCardPrint>();
  for (const c of cards) {
    if (!uniqueMap.has(c.cardNo)) uniqueMap.set(c.cardNo, c);
  }
  const unique = [...uniqueMap.values()];
  const units = unique.filter((c) => c.type === 'UNIT');
  const pilots = unique.filter((c) => c.type === 'PILOT' || isCommandPilot(c));

  const previews: DeckChainPreview[] = [];
  const seen = new Set<string>();

  for (const u of units) {
    if (!u.link) continue;
    for (const p of pilots) {
      if (!doesPilotLinkUnit(p, u)) continue;
      const key = `${u.cardNo}+${p.cardNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isCmd = isCommandPilot(p);
      const p1 = verifyCustomDeckChain(u, p, false);
      const p2 = verifyCustomDeckChain(u, p, true);
      previews.push({
        id: key,
        title: `${u.name} + ${p.name}`,
        category: isCmd ? 'Command-Pilot Link' : 'Link Pair',
        cards: [u, p],
        minTurn: p1.turn,
        firstPlayerResult: p1.result,
        secondPlayerResult: p2.result,
      });
      if (previews.length >= maxItems) return previews;
    }
  }

  // Enabler -> Payoff Mechanic Chains from compiledEffect.synergy
  for (const payoff of unique) {
    const reqs = payoff.compiledEffect?.synergy.requires ?? [];
    if (reqs.length === 0) continue;
    for (const req of reqs) {
      const enabler = unique.find(
        (e) => e.cardNo !== payoff.cardNo && e.compiledEffect?.synergy.enables.includes(req)
      );
      if (!enabler) continue;
      const key = `${enabler.cardNo}->${payoff.cardNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p1 = verifyCustomDeckChain(enabler, payoff, false);
      const p2 = verifyCustomDeckChain(enabler, payoff, true);
      previews.push({
        id: key,
        title: `${enabler.name} → ${payoff.name}`,
        category: 'Mechanic Chain',
        cards: [enabler, payoff],
        minTurn: p1.turn,
        firstPlayerResult: p1.result,
        secondPlayerResult: p2.result,
      });
      if (previews.length >= maxItems) return previews;
    }
  }

  return previews;
}

export function sandboxStateToChainState(state: SandboxMatchState): ChainMatchState {
  const mkDummyShield = (side: ChainSide, idx: number): ChainShieldCard => ({
    id: `${side}-SH-${idx}`,
    card: {
      printId: `SH-${side}-${idx}`,
      cardNo: `SH-${side}-${idx}`,
      name: 'Shield',
      rarity: 'C',
      blockIcon: '1',
      lv: 1,
      cost: 0,
      color: 'Colorless',
      type: 'UNIT',
      effect: '',
      zones: [],
      traits: [],
      link: '',
      apRaw: '0',
      hpRaw: '0',
      ap: 0,
      hp: 0,
      sourceTitle: '',
      whereToGet: '',
      imagePath: '',
      isParallel: false,
      faqs: [],
      packageIds: [],
      packageNames: [],
      packageCodes: [],
    },
  });

  const mapPlayer = (side: ChainSide, p: SandboxPlayerState): ChainPlayerState => ({
    hand: [...p.hand],
    deck: [...p.library],
    trash: [...p.trash],
    battleArea: p.battleArea.map((u) => ({
      instanceId: u.instanceId,
      card: u.card,
      ...(u.pairedPilot ? { pairedPilot: u.pairedPilot } : {}),
      rested: u.rested,
      damage: u.damage,
      deployedTurn: u.summonedTurn,
      ...(u.deployedFromZone ? { deployedFromZone: u.deployedFromZone } : {}),
      temporaryModifiers: u.apBuff !== 0
        ? [
            {
              id: `sandbox-ap-${u.instanceId}`,
              layer: 3,
              duration: 'THIS_TURN',
              stat: 'AP',
              delta: u.apBuff,
            },
          ]
        : [],
      triggeredOnceThisTurn: [],
    })),
    base: p.base
      ? {
          instanceId: `${side}-BASE`,
          card: p.base,
          damage: p.baseDamage,
          temporaryModifiers: [],
        }
      : null,
    shields: Array.from({ length: p.shields }, (_, i) => mkDummyShield(side, i)),
    activeResources: p.resourcesActive,
    restedResources: Math.max(0, p.resourcesTotal - p.resourcesActive),
    exResources: 0,
  });

  return {
    turn: state.turn,
    phase: 'MAIN',
    activeSide: state.activeSide,
    pendingActionStep: null,
    players: {
      A: mapPlayer('A', state.players.A),
      B: mapPlayer('B', state.players.B),
    },
  };
}

export function previewSandboxMoveChain(
  state: SandboxMatchState,
  move: SandboxMoveSuggestion
): SandboxMoveChainPreview {
  const side = state.activeSide;
  const player = state.players[side];
  const chainState = sandboxStateToChainState(state);

  const playLine: PlayerAction[] = [];
  if (move.actionType === 'DEPLOY_UNIT' && move.card) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) playLine.push({ type: 'DEPLOY_UNIT', side, handIndex });
  } else if (move.actionType === 'DEPLOY_BASE' && move.card) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) playLine.push({ type: 'DEPLOY_BASE', side, handIndex });
  } else if (move.actionType === 'PAIR_PILOT' && move.card && move.unitInstanceId) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) {
      playLine.push({ type: 'PAIR_PILOT', side, handIndex, targetUnitId: move.unitInstanceId });
    }
  } else if (move.actionType === 'PLAY_COMMAND' && move.card) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) playLine.push({ type: 'PLAY_COMMAND', side, handIndex });
  } else if (move.actionType === 'ACTIVATE_MAIN' && move.unitInstanceId) {
    const unit = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    const clauseIdx = unit
      ? getCardAbilities(unit.card).abilities.findIndex(
          (a) => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('ACTIVATE_MAIN')
        )
      : 0;
    playLine.push({
      type: 'ACTIVATE_ABILITY',
      side,
      sourceId: move.unitInstanceId,
      clauseIndex: Math.max(0, clauseIdx),
    });
  } else if (move.actionType === 'ATTACK_SHIELD' && move.unitInstanceId) {
    playLine.push({ type: 'ATTACK_SHIELD', side, attackerId: move.unitInstanceId });
  } else if (move.actionType === 'ATTACK_UNIT' && move.unitInstanceId && move.targetInstanceId) {
    playLine.push({
      type: 'ATTACK_UNIT',
      side,
      attackerId: move.unitInstanceId,
      targetId: move.targetInstanceId,
    });
  } else if (move.actionType === 'PASS_TURN') {
    playLine.push({ type: 'PASS_TURN', side });
  }

  const witness: ChainWitness = move.targetInstanceId
    ? { targets: [[move.targetInstanceId]] }
    : {};

  const result: ChainVerificationResult =
    playLine.length > 0
      ? verifyPlayLine({ mode: { kind: 'CONCRETE_SNAPSHOT', state: chainState }, playLine, witness })
      : {
          legal: false,
          reason: 'INVALID_ACTION',
          detail: 'Card or unit for this move is not currently in hand/play.',
          trace: [],
        };

  return {
    moveTitle: move.title,
    actionType: move.actionType,
    lvRequired: move.card?.lv ?? 1,
    costRequired: move.card?.cost ?? 0,
    activeResources: player.resourcesActive,
    result,
  };
}
