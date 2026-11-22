import { describe, expect, it } from 'vitest';
import type { GundamCardPrint, SavedDeck } from '@/types/gundam';
import { resolveCardMap } from '@/lib/deck-engine';
import {
  applySandboxMove,
  createInitialSandboxMatch,
  evaluateSandboxBestMoves,
  stepSandboxBot,
} from '@/lib/sandbox-engine';

function makeTestDeck(name: string, cards: GundamCardPrint[]): SavedDeck {
  return {
    id: `test-${name}`,
    name,
    updatedAt: new Date().toISOString(),
    mainDeck: cards.slice(0, 12).map((c) => ({
      cardNo: c.cardNo,
      printId: c.printId,
      qty: 4,
    })),
    resourceDeck: [],
  };
}

function buildSandboxCards(): GundamCardPrint[] {
  const unitLow: GundamCardPrint = {
    printId: 'TST-001',
    cardNo: 'TST-001',
    name: 'Strike Dagger',
    rarity: 'C',
    blockIcon: '1',
    lv: 1,
    cost: 1,
    color: 'Blue',
    type: 'UNIT',
    effect: '',
    zones: ['Space'],
    traits: ['Earth Alliance'],
    link: '[Kira Yamato]',
    apRaw: '3',
    hpRaw: '3',
    ap: 3,
    hp: 3,
    sourceTitle: '',
    whereToGet: '',
    imagePath: '',
    isParallel: false,
    faqs: [],
    packageIds: [],
    packageNames: [],
    packageCodes: [],
  };

  const pilotLink: GundamCardPrint = {
    ...unitLow,
    printId: 'TST-002',
    cardNo: 'TST-002',
    name: 'Kira Yamato',
    type: 'PILOT',
    lv: 1,
    cost: 1,
    ap: 2,
    hp: 1,
    apRaw: '+2',
    hpRaw: '+1',
    link: '',
    effect: '【When Linked】Draw 1 card.',
  };

  const cmdRemove: GundamCardPrint = {
    ...unitLow,
    printId: 'TST-003',
    cardNo: 'TST-003',
    name: 'Precision Strike',
    type: 'COMMAND',
    lv: 1,
    cost: 1,
    ap: null,
    hp: null,
    apRaw: '-',
    hpRaw: '-',
    link: '',
    effect: 'Destroy 1 enemy Unit with 3 HP or less.',
  };

  return Array.from({ length: 13 }, (_, idx) => {
    const template = idx % 3 === 0 ? unitLow : idx % 3 === 1 ? pilotLink : cmdRemove;
    const no = `TST-${String(idx + 1).padStart(3, '0')}`;
    return { ...template, printId: no, cardNo: no };
  });
}

describe('2-Deck Match Sandbox & Reactive Best-Move Advisor', () => {
  const pool = buildSandboxCards();
  const { byPrintId, byCardNo } = resolveCardMap(pool);
  const deckA = makeTestDeck('Alpha', pool);
  const deckB = makeTestDeck('Beta', pool);

  it('initializes 5-card hands, 6 shields, and produces Top 3 ranked Best Moves', () => {
    const match = createInitialSandboxMatch(deckA, deckB, 'A', byPrintId, byCardNo);
    expect(match.players.A.hand).toHaveLength(5);
    expect(match.players.B.hand).toHaveLength(5);
    expect(match.players.A.shields).toBe(6);
    expect(match.players.B.shields).toBe(6);
    expect(match.activeSide).toBe('A');

    const suggestions = evaluateSandboxBestMoves(match, 'A');
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions[0].rank).toBe(1);
  });

  it('executes moves, switches turns on PASS_TURN, and steps bot cleanly', () => {
    let match = createInitialSandboxMatch(deckA, deckB, 'A', byPrintId, byCardNo);
    match = stepSandboxBot(match);
    expect(match.log.length).toBeGreaterThanOrEqual(2);

    // Force pass turn to Side B and ensure turn hands over + resources increment
    match = applySandboxMove(match, {
      id: 'pass-a',
      rank: 1,
      actionType: 'PASS_TURN',
      title: 'End Turn 1',
      reason: 'Pass',
      winDeltaPct: 0,
      priorityScore: 25,
    });
    expect(match.activeSide).toBe('B');
    expect(match.players.B.hand).toHaveLength(6);
    expect(match.players.B.resourcesTotal).toBe(2);
  });
});
