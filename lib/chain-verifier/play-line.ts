import type { GundamCardPrint } from '../../types/gundam.ts';
import { compileCardEffect } from '../effect-parser.ts';
import { ChainFailError } from './runner-support';
import { ChainMatchState, ChainUnitInstance, ChainVerificationRequest, ChainVerificationResult } from './types';
import { VerifierRunner } from './verifier-runner';

export function buildMinimalFeasibilityState(
  req: Extract<ChainVerificationRequest['mode'], { kind: 'MINIMAL_FEASIBILITY' }>
): ChainMatchState {
  const mkDummy = (name: string, overrides: Partial<GundamCardPrint> = {}): GundamCardPrint => {
    const base: GundamCardPrint = {
      printId: name,
      cardNo: name,
      name,
      rarity: 'C',
      blockIcon: '1',
      lv: 1,
      cost: 1,
      color: 'Blue',
      type: 'UNIT',
      effect: '',
      zones: ['Space'],
      traits: [],
      link: '',
      apRaw: '2',
      hpRaw: '2',
      ap: 2,
      hp: 2,
      sourceTitle: '',
      whereToGet: '',
      imagePath: '',
      isParallel: false,
      faqs: [],
      packageIds: [],
      packageNames: [],
      packageCodes: [],
      ...overrides,
    };
    return { ...base, compiledEffect: compileCardEffect(base) };
  };

  const oppUnits: ChainUnitInstance[] = (req.opponentDummyBoard?.units ?? []).map((u, idx) => ({
    instanceId: `B-DUMMY-${idx}`,
    card: mkDummy(u.cardNo ?? `DUMMY-${idx}`, {
      name: u.name ?? `Dummy Unit ${idx}`,
      lv: u.lv ?? 1,
      ap: u.ap ?? 2,
      hp: u.hp ?? 2,
      traits: u.traits ?? [],
      effect: u.effect ?? '',
    }),
    rested: Boolean(u.rested),
    damage: 0,
    deployedTurn: 1,
    temporaryModifiers: [],
    triggeredOnceThisTurn: [],
  }));

  const oppShields = Array.from({ length: req.opponentDummyBoard?.shields ?? 6 }, (_, i) => ({
    id: `B-SH-${i}`,
    card: mkDummy(`SH-${i}`),
  }));

  return {
    turn: req.turn,
    phase: 'MAIN',
    activeSide: 'A',
    pendingActionStep: null,
    players: {
      A: {
        hand: [...req.activeHand],
        deck: [...(req.activeDeck ?? [])],
        trash: [...(req.activeTrash ?? [])],
        battleArea: [...(req.activeBattleArea ?? [])],
        base: null,
        shields: [{ id: 'A-SH-0', card: mkDummy('SH-A0') }],
        activeResources: req.turn,
        restedResources: 0,
        exResources: 0,
      },
      B: {
        hand: [],
        deck: [],
        trash: [],
        battleArea: oppUnits,
        base: req.opponentDummyBoard?.hasBase
          ? { instanceId: 'B-BASE', card: mkDummy('B-BASE', { type: 'BASE', hp: 5 }), damage: 0 }
          : null,
        shields: oppShields,
        activeResources: req.turn,
        restedResources: 0,
        exResources: 0,
      },
    },
  };
}

export function verifyPlayLine(req: ChainVerificationRequest): ChainVerificationResult {
  const initialState =
    req.mode.kind === 'CONCRETE_SNAPSHOT'
      ? req.mode.state
      : buildMinimalFeasibilityState(req.mode);

  const runner = new VerifierRunner(initialState, req.witness);
  try {
    for (const action of req.playLine) {
      runner.executeAction(action);
    }
    return {
      legal: true,
      finalState: runner.state,
      trace: runner.trace,
    };
  } catch (err) {
    if (err instanceof ChainFailError) {
      return {
        legal: false,
        reason: err.reason,
        detail: err.message,
        trace: runner.trace,
      };
    }
    return {
      legal: false,
      reason: 'INVALID_ACTION',
      detail: err instanceof Error ? err.message : String(err),
      trace: runner.trace,
    };
  }
}

// ---------------------------------------------------------------------------
// 5. Chain Preview Builders for Deck Builder & Match Sandbox UI
// ---------------------------------------------------------------------------
