import { describe, expect, it } from 'vitest';
import type { GundamCardPrint, SavedDeck } from '@/types/gundam';
import { compileCardEffect } from '@/lib/effect-parser';
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
    const card = { ...template, printId: no, cardNo: no };
    return { ...card, compiledEffect: compileCardEffect(card) };
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

describe('Seam 3: Fail-Closed Clause Execution & FAQ Conformance in Sandbox', () => {
  const baseTemplate = buildSandboxCards()[0];
  const makeRealCard = (over: Partial<GundamCardPrint>): GundamCardPrint => {
    const card: GundamCardPrint = {
      ...baseTemplate,
      ...over,
    };
    return {
      ...card,
      compiledEffect: over.compiledEffect ?? compileCardEffect(card),
    };
  };

  const st09001 = makeRealCard({
    printId: 'ST09-001',
    cardNo: 'ST09-001',
    name: 'Impulse Gundam',
    color: 'Purple',
    type: 'UNIT',
    lv: 3,
    cost: 2,
    ap: 3,
    hp: 3,
    traits: ['ZAFT', 'Minerva Squad'],
    link: '[Shinn Asuka]',
    effect:
      '【Activate･Main】②, return this Unit to the bottom of its owner\'s deck：Choose 1 Unit card with "Impulse Gundam" in its card name that is Lv.4 or higher from your trash. Deploy it.',
  });

  const st09006 = makeRealCard({
    printId: 'ST09-006',
    cardNo: 'ST09-006',
    name: 'Sword Impulse Gundam',
    color: 'Purple',
    type: 'UNIT',
    lv: 4,
    cost: 2,
    ap: 4,
    hp: 2,
    traits: ['ZAFT', 'Minerva Squad'],
    link: '(Coordinator) Trait / (Minerva Squad) Trait',
    effect:
      '【Deploy】If you deploy this Unit from your trash, choose 1 enemy Unit that is Lv.3 or lower. Destroy it.',
  });

  const st09003 = makeRealCard({
    printId: 'ST09-003',
    cardNo: 'ST09-003',
    name: 'Saviour Gundam',
    color: 'Red',
    type: 'UNIT',
    lv: 6,
    cost: 5,
    ap: 5,
    hp: 4,
    traits: ['ZAFT', 'Minerva Squad'],
    link: '[Athrun Zala]',
    effect:
      '<Breach 3>\n【When Linked】If there are 5 or more purple cards in your trash, deal 2 damage to all Units with 5 or less AP.',
  });

  const athrun = makeRealCard({
    printId: 'ST04-011',
    cardNo: 'ST04-011',
    name: 'Athrun Zala',
    color: 'Red',
    type: 'PILOT',
    lv: 4,
    cost: 1,
    ap: 1,
    hp: 2,
    traits: ['ZAFT', 'Coordinator'],
    link: '',
    effect: '【Burst】Add this card to your hand.',
  });

  const st09004 = makeRealCard({
    printId: 'ST09-004',
    cardNo: 'ST09-004',
    name: 'Freedom Gundam',
    color: 'White',
    type: 'UNIT',
    lv: 6,
    cost: 5,
    ap: 4,
    hp: 5,
    traits: ['Orb'],
    link: '[Kira Yamato]',
    effect:
      '<Blocker>\nWhile a friendly Base in play, this Unit gains <Suppression>.\n(Damage to Shields by an attack is dealt to the first 2 cards simultaneously.)',
  });

  const st09009 = makeRealCard({
    printId: 'ST09-009',
    cardNo: 'ST09-009',
    name: 'Giant Killing',
    color: 'Purple',
    type: 'COMMAND',
    lv: 4,
    cost: 3,
    ap: null,
    hp: null,
    apRaw: '-',
    hpRaw: '-',
    link: '',
    effect: '【Main】/【Action】Choose 1 active enemy Unit with 4 or less AP. Destroy it.',
  });

  const enemyLv2 = makeRealCard({
    printId: 'TST-LV2',
    cardNo: 'TST-LV2',
    name: 'Zaku Grunt',
    color: 'Green',
    type: 'UNIT',
    lv: 2,
    cost: 1,
    ap: 2,
    hp: 2,
  });

  const enemyLv4 = makeRealCard({
    printId: 'TST-LV4',
    cardNo: 'TST-LV4',
    name: 'Heavy Gelgoog',
    color: 'Green',
    type: 'UNIT',
    lv: 4,
    cost: 3,
    ap: 5,
    hp: 4,
  });

  const baseCard = makeRealCard({
    printId: 'EXB-002',
    cardNo: 'EXB-002',
    name: 'EX Base',
    color: 'Colorless',
    type: 'BASE',
    lv: 1,
    cost: 0,
    ap: null,
    hp: 3,
    effect: '',
  });

  const cards = [st09001, st09006, st09003, athrun, st09004, st09009, enemyLv2, enemyLv4, baseCard];
  const { byPrintId, byCardNo } = resolveCardMap(cards);
  const deck = makeTestDeck('PurpleTest', [...cards, ...cards]);

  it('does NOT destroy an enemy Unit when ST09-006 is deployed from hand', () => {
    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.players.A.resourcesTotal = 4;
    state.players.A.resourcesActive = 4;
    state.players.A.hand = [st09006];
    state.players.B.battleArea = [
      {
        instanceId: 'opp-lv2',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    const next = applySandboxMove(state, {
      id: 'play-st09006-hand',
      rank: 1,
      actionType: 'DEPLOY_UNIT',
      title: 'Deploy Sword Impulse Gundam',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: st09006,
    });

    expect(next.players.A.battleArea).toHaveLength(1);
    expect(next.players.A.battleArea[0].deployedFromZone).toBe('hand');
    expect(next.players.B.battleArea).toHaveLength(1);
  });

  it('chains ST09-001 Activate-Main -> deploys ST09-006 from trash -> destroys Lv<=3 enemy (and ignores Lv4+)', () => {
    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.players.A.resourcesTotal = 4;
    state.players.A.resourcesActive = 4;
    state.players.A.battleArea = [
      {
        instanceId: 'imp-1',
        card: st09001,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    state.players.A.trash = [st09006];
    state.players.B.battleArea = [
      {
        instanceId: 'opp-lv4',
        card: enemyLv4,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
      {
        instanceId: 'opp-lv2',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    const suggestions = evaluateSandboxBestMoves(state, 'A');
    const activateMove = suggestions.find((m) => m.actionType === 'ACTIVATE_MAIN');
    expect(activateMove).toBeDefined();

    const next = applySandboxMove(state, activateMove!);
    expect(next.players.A.resourcesActive).toBe(2);
    expect(next.players.A.battleArea.map((u) => u.card.cardNo)).toEqual(['ST09-006']);
    expect(next.players.A.battleArea[0].deployedFromZone).toBe('trash');
    expect(next.players.A.library[next.players.A.library.length - 1].cardNo).toBe('ST09-001');
    // Lv.2 destroyed, Lv.4 spared!
    expect(next.players.B.battleArea.map((u) => u.card.cardNo)).toEqual(['TST-LV4']);

    // Empty trash should disallow activating ST09-001 so cost isn't wasted
    state.players.A.trash = [];
    const blocked = applySandboxMove(state, activateMove!);
    expect(blocked.players.A.resourcesActive).toBe(4);
    expect(blocked.players.A.battleArea.map((u) => u.card.cardNo)).toEqual(['ST09-001']);
  });

  it('enforces ST09-003 symmetrical AoE (hits friendly Units <=5 AP) when 5+ Purple cards in trash', () => {
    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.players.A.resourcesTotal = 6;
    state.players.A.resourcesActive = 6;
    state.players.A.hand = [athrun];
    state.players.A.trash = [st09001, st09001, st09001, st09001, st09006];
    state.players.A.battleArea = [
      {
        instanceId: 'sav-1',
        card: st09003,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
      {
        instanceId: 'ally-small',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    state.players.B.battleArea = [
      {
        instanceId: 'opp-small',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    const next = applySandboxMove(state, {
      id: 'link-sav',
      rank: 1,
      actionType: 'PAIR_PILOT',
      title: 'Link Athrun -> Saviour',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: athrun,
      unitInstanceId: 'sav-1',
    });

    // Both 2-HP Units (friendly & enemy) destroyed by 2 AoE damage; Saviour (6 AP after Athrun +1) untouched!
    expect(next.players.A.battleArea.map((u) => u.card.cardNo)).toEqual(['ST09-003']);
    expect(next.players.B.battleArea).toHaveLength(0);
  });

  it('activates <Suppression> on ST09-004 when a friendly Base is in play and enforces ST09-009 active/AP<=4 target filter', () => {
    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.turn = 2;
    state.players.A.resourcesTotal = 6;
    state.players.A.resourcesActive = 6;
    state.players.A.base = baseCard;
    state.players.A.battleArea = [
      {
        instanceId: 'free-1',
        card: st09004,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    state.players.A.hand = [st09009];
    state.players.B.shields = 6;
    state.players.B.battleArea = [
      {
        instanceId: 'opp-rested',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: true,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    // ST09-009 requires active enemy <= 4 AP; opponent only has rested Unit -> fizzles cleanly
    let next = applySandboxMove(state, {
      id: 'cmd-gk',
      rank: 1,
      actionType: 'PLAY_COMMAND',
      title: 'Play Giant Killing',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: st09009,
    });
    expect(next.players.B.battleArea).toHaveLength(1);

    // ST09-004 with friendly Base gains <Suppression> and breaks 2 Shields at once
    next = applySandboxMove(next, {
      id: 'atk-free',
      rank: 1,
      actionType: 'ATTACK_SHIELD',
      title: 'Attack Shield',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'free-1',
    });
    expect(next.players.B.shields).toBe(4);
  });

  it('fails closed and logs Manual resolution required for unparsed bespoke clauses', () => {
    const bespoke = makeRealCard({
      printId: 'TST-BESP',
      cardNo: 'TST-BESP',
      name: 'Bespoke Prototype',
      type: 'COMMAND',
      lv: 1,
      cost: 1,
      effect: '【Main】Swap the AP and HP of all cards in both players\' shield areas.',
    });
    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.players.A.hand = [bespoke];
    state.players.B.battleArea = [
      {
        instanceId: 'opp-1',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    const next = applySandboxMove(state, {
      id: 'play-bespoke',
      rank: 1,
      actionType: 'PLAY_COMMAND',
      title: 'Play Bespoke Prototype',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: bespoke,
    });

    expect(next.players.B.battleArea).toHaveLength(1);
    expect(next.log[0].summary).toContain('Manual resolution required');
  });

  it('executes PAIR_SELF_FROM_TRASH on GD05-112 only onto an unpaired (MF) Unit and ignores (ZAFT) Units', () => {
    const mfUnit = makeRealCard({
      printId: 'GD05-034',
      cardNo: 'GD05-034',
      name: 'Shining Gundam',
      color: 'Red',
      type: 'UNIT',
      lv: 4,
      cost: 3,
      ap: 4,
      hp: 4,
      traits: ['MF', 'Shuffle Alliance'],
      link: '[Domon Kasshu]',
      effect: '',
    });
    const gd05112 = makeRealCard({
      printId: 'GD05-112',
      cardNo: 'GD05-112',
      name: 'Hoka Kyoten Juzetsujin',
      color: 'Red',
      type: 'COMMAND',
      lv: 4,
      cost: 1,
      ap: null,
      hp: null,
      apRaw: '-',
      hpRaw: '-',
      traits: ['Gundam Fighter', 'Shuffle Alliance', 'Special Move'],
      link: '',
      effect:
        "【Main】Choose 1 of your (MF) Units without <Breach>. It gains <Breach 3> during this turn. After activating this card's 【Main】, you may pair this card from your trash with one of your (MF) Units.\n【Pilot】[Sai Saici]",
    });

    // Only a ZAFT Unit in play -> GD05-112 stays in trash and does NOT pair
    const stateZaft = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    stateZaft.players.A.resourcesTotal = 5;
    stateZaft.players.A.resourcesActive = 5;
    stateZaft.players.A.hand = [gd05112];
    stateZaft.players.A.battleArea = [
      {
        instanceId: 'zaft-1',
        card: st09001,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const afterZaft = applySandboxMove(stateZaft, {
      id: 'play-112-zaft',
      rank: 1,
      actionType: 'PLAY_COMMAND',
      title: 'Play GD05-112',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: gd05112,
    });
    expect(afterZaft.players.A.battleArea[0].pairedPilot).toBeNull();
    expect(afterZaft.players.A.trash.some((c) => c.cardNo === 'GD05-112')).toBe(true);

    // Friendly (MF) Unit in play -> GD05-112 pairs itself from trash onto the (MF) Unit
    const stateMf = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    stateMf.players.A.resourcesTotal = 5;
    stateMf.players.A.resourcesActive = 5;
    stateMf.players.A.hand = [gd05112];
    stateMf.players.A.battleArea = [
      {
        instanceId: 'mf-1',
        card: mfUnit,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const afterMf = applySandboxMove(stateMf, {
      id: 'play-112-mf',
      rank: 1,
      actionType: 'PLAY_COMMAND',
      title: 'Play GD05-112',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: gd05112,
    });
    expect(afterMf.players.A.battleArea[0].pairedPilot?.cardNo).toBe('GD05-112');
    expect(afterMf.players.A.trash.some((c) => c.cardNo === 'GD05-112')).toBe(false);
  });

  it('triggers GD06-001 WHEN_ATTACKED max once per turn when attacked', () => {
    const gd06001 = makeRealCard({
      printId: 'GD06-001',
      cardNo: 'GD06-001',
      name: 'Gundam GP01Fb',
      color: 'Blue',
      type: 'UNIT',
      lv: 4,
      cost: 3,
      ap: 3,
      hp: 6,
      effect: '【Once per Turn】When this Unit is attacked, draw 1.\n【During Pair】This Unit gains<High-Maneuver>.',
    });
    const smallAttacker = makeRealCard({
      printId: 'TST-ATK',
      cardNo: 'TST-ATK',
      name: 'Small Attacker',
      type: 'UNIT',
      lv: 2,
      cost: 1,
      ap: 1,
      hp: 5,
      effect: '',
    });

    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.turn = 2;
    state.players.B.hand = [];
    state.players.B.battleArea = [
      {
        instanceId: 'gp01-def',
        card: gd06001,
        pairedPilot: null,
        isLinked: false,
        rested: true,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    state.players.A.battleArea = [
      {
        instanceId: 'atk-1',
        card: smallAttacker,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
      {
        instanceId: 'atk-2',
        card: smallAttacker,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    let next = applySandboxMove(state, {
      id: 'atk-gp-1',
      rank: 1,
      actionType: 'ATTACK_UNIT',
      title: 'Attack GP01Fb 1',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'atk-1',
      targetInstanceId: 'gp01-def',
    });
    expect(next.players.B.hand).toHaveLength(1);

    // Second attack in same turn must NOT draw a second card (【Once per Turn】)
    next = applySandboxMove(next, {
      id: 'atk-gp-2',
      rank: 1,
      actionType: 'ATTACK_UNIT',
      title: 'Attack GP01Fb 2',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'atk-2',
      targetInstanceId: 'gp01-def',
    });
    expect(next.players.B.hand).toHaveLength(1);
  });

  it('triggers GD06-002 WHEN_DESTROY_BY_BATTLE on enemy Unit or Shield during your turn only (and fails closed on Clause 2 EXILE)', () => {
    const gd06002 = makeRealCard({
      printId: 'GD06-002',
      cardNo: 'GD06-002',
      name: 'Infinite Justice Gundam',
      color: 'Blue',
      type: 'UNIT',
      lv: 6,
      cost: 5,
      ap: 5,
      hp: 6,
      traits: ['Orb'],
      effect:
        "【Once per Turn】During your turn, when this Unit destroys an enemy card with battle damage, choose 1 of your (Orb) Units. It recovers 3 HP.\n【Deploy】You may choose 3 Unit cards from your trash. Exile them from the game. If you do, choose 1 active enemy Unit. Return it to its owner's hand.",
    });

    // 1. Destroying enemy Shield during Side A turn recovers 3 HP on damaged (Orb) Unit
    const stateShield = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    stateShield.turn = 2;
    stateShield.players.B.shields = 5;
    stateShield.players.A.battleArea = [
      {
        instanceId: 'ij-1',
        card: gd06002,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 4,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const afterShield = applySandboxMove(stateShield, {
      id: 'ij-shield',
      rank: 1,
      actionType: 'ATTACK_SHIELD',
      title: 'IJ Attack Shield',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'ij-1',
    });
    expect(afterShield.players.B.shields).toBe(4);
    expect(afterShield.players.A.battleArea[0].damage).toBe(1);

    // 2. Destroying enemy Unit recovers 3 HP once; opponent attacking into rested GD06-002 does NOT trigger IS_YOUR_TURN
    const stateUnit = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    stateUnit.turn = 2;
    stateUnit.players.A.battleArea = [
      {
        instanceId: 'ij-1',
        card: gd06002,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 3,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    stateUnit.players.B.battleArea = [
      {
        instanceId: 'opp-weak',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: true,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const afterUnit = applySandboxMove(stateUnit, {
      id: 'ij-unit',
      rank: 1,
      actionType: 'ATTACK_UNIT',
      title: 'IJ Attack Unit',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'ij-1',
      targetInstanceId: 'opp-weak',
    });
    expect(afterUnit.players.A.battleArea[0].damage).toBe(2); // 3 -> 0 HP healed, then +2 counter-damage from enemyLv2

    // Opponent's turn: Side B attacks rested GD06-002 and suicides; Side A's IS_YOUR_TURN must NOT fire
    const oppTurn = createInitialSandboxMatch(deck, deck, 'B', byPrintId, byCardNo);
    oppTurn.turn = 2;
    oppTurn.players.A.battleArea = [
      {
        instanceId: 'ij-a',
        card: gd06002,
        pairedPilot: null,
        isLinked: false,
        rested: true,
        damage: 3,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    oppTurn.players.B.battleArea = [
      {
        instanceId: 'b-atk',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const afterOppSuicide = applySandboxMove(oppTurn, {
      id: 'b-suicide',
      rank: 1,
      actionType: 'ATTACK_UNIT',
      title: 'Opp Attack IJ',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'b-atk',
      targetInstanceId: 'ij-a',
    });
    expect(afterOppSuicide.players.B.battleArea).toHaveLength(0);
    expect(afterOppSuicide.players.A.battleArea[0].damage).toBe(5); // 3 + 2, NOT healed

    // Deploying GD06-002 fails closed on unsimulated EXILE + IF_PREVIOUS_SUCCEEDED Clause 2
    const depState = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    depState.players.A.resourcesTotal = 6;
    depState.players.A.resourcesActive = 6;
    depState.players.A.hand = [gd06002];
    const afterDep = applySandboxMove(depState, {
      id: 'dep-ij',
      rank: 1,
      actionType: 'DEPLOY_UNIT',
      title: 'Deploy IJ',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: gd06002,
    });
    expect(afterDep.log[0].summary).toContain('Manual resolution required');
  });

  it('scales GD06-003 AP by hand count and gates 【Attack】 draw on (Alphacide) ally + <=5 cards in hand', () => {
    const gd06003 = makeRealCard({
      printId: 'GD06-003',
      cardNo: 'GD06-003',
      name: 'GQuuuuuuX (Omega Psycommu Released)',
      color: 'Blue',
      type: 'UNIT',
      lv: 5,
      cost: 4,
      ap: 3,
      hp: 5,
      traits: ['Alphacide'],
      effect:
        "Increase this Unit's AP by an amount equal to the number of cards in your hand.\n【Attack】If another friendly (Alphacide) Unit is in play and you have 5 or less cards in your hand, draw 1.",
    });
    const alphacideAlly = makeRealCard({
      printId: 'TST-ALP',
      cardNo: 'TST-ALP',
      name: 'Red Gundam',
      type: 'UNIT',
      traits: ['Alphacide'],
      ap: 2,
      hp: 3,
    });
    const tank6Hp = makeRealCard({
      printId: 'TST-TNK',
      cardNo: 'TST-TNK',
      name: '6HP Defender',
      type: 'UNIT',
      ap: 2,
      hp: 6,
    });

    const state = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    state.turn = 2;
    // 3 cards in hand -> 3 base + 3 hand = 6 AP (enough to destroy 6 HP rested defender!) + draw 1 on attack
    state.players.A.hand = [enemyLv2, enemyLv2, enemyLv2];
    state.players.A.battleArea = [
      {
        instanceId: 'gq-1',
        card: gd06003,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
      {
        instanceId: 'alp-1',
        card: alphacideAlly,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    state.players.B.battleArea = [
      {
        instanceId: 'tnk-1',
        card: tank6Hp,
        pairedPilot: null,
        isLinked: false,
        rested: true,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];

    const next = applySandboxMove(state, {
      id: 'gq-atk',
      rank: 1,
      actionType: 'ATTACK_UNIT',
      title: 'GQuuuuuuX Attack',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      unitInstanceId: 'gq-1',
      targetInstanceId: 'tnk-1',
    });
    expect(next.players.A.hand).toHaveLength(4);
    expect(next.players.B.battleArea).toHaveLength(0);
  });

  it('enforces exact 1 HP targeting on GD06-009 (bounces 1 HP enemy, ignores 2+ HP enemies)', () => {
    const gd06009 = makeRealCard({
      printId: 'GD06-009',
      cardNo: 'GD06-009',
      name: 'GM Custom',
      color: 'Blue',
      type: 'UNIT',
      lv: 3,
      cost: 2,
      ap: 2,
      hp: 3,
      effect: "【Deploy】You may choose 1 enemy Unit with 1 HP. Return it to its owner's hand.",
    });
    const enemy1Hp = makeRealCard({
      printId: 'TST-1HP',
      cardNo: 'TST-1HP',
      name: '1HP Drone',
      type: 'UNIT',
      ap: 1,
      hp: 1,
    });

    // Only a 2 HP enemy in play -> ignored
    const s2 = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    s2.players.A.resourcesTotal = 3;
    s2.players.A.resourcesActive = 3;
    s2.players.A.hand = [gd06009];
    s2.players.B.battleArea = [
      {
        instanceId: 'e-2hp',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const after2 = applySandboxMove(s2, {
      id: 'dep-009-miss',
      rank: 1,
      actionType: 'DEPLOY_UNIT',
      title: 'Deploy GM Custom',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: gd06009,
    });
    expect(after2.players.B.battleArea).toHaveLength(1);

    // 1 HP enemy in play -> bounced to hand while 2 HP enemy remains
    const s1 = createInitialSandboxMatch(deck, deck, 'A', byPrintId, byCardNo);
    s1.players.A.resourcesTotal = 3;
    s1.players.A.resourcesActive = 3;
    s1.players.A.hand = [gd06009];
    s1.players.B.hand = [];
    s1.players.B.battleArea = [
      {
        instanceId: 'e-2hp',
        card: enemyLv2,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
      {
        instanceId: 'e-1hp',
        card: enemy1Hp,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: 1,
      },
    ];
    const after1 = applySandboxMove(s1, {
      id: 'dep-009-hit',
      rank: 1,
      actionType: 'DEPLOY_UNIT',
      title: 'Deploy GM Custom',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: gd06009,
    });
    expect(after1.players.B.battleArea.map((u) => u.card.cardNo)).toEqual(['TST-LV2']);
    expect(after1.players.B.hand.map((c) => c.cardNo)).toEqual(['TST-1HP']);
  });
});


