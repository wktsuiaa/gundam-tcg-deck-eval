import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint } from '@/types/gundam';
import { compileCardEffect } from '@/lib/effect-parser';
import {
  buildDeckChainPreviews,
  evaluateUnitEffectiveState,
  previewSandboxMoveChain,
  verifyPlayLine,
  type ChainMatchState,
  type ChainUnitInstance,
} from '@/lib/chain-verifier';
import { createInitialSandboxMatch, evaluateSandboxBestMoves } from '@/lib/sandbox-engine';

function loadCompiledCorpus(): Map<string, GundamCardPrint> {
  const colDir = path.join(process.cwd(), 'data', 'collections');
  const effDir = path.join(process.cwd(), 'data', 'effects');
  const effects = new Map<string, ReturnType<typeof compileCardEffect>>();

  for (const f of fs.readdirSync(effDir).filter((x) => x.endsWith('.json'))) {
    const shard = JSON.parse(fs.readFileSync(path.join(effDir, f), 'utf8'));
    for (const [k, v] of Object.entries(shard.effects ?? {})) {
      effects.set(k, v as ReturnType<typeof compileCardEffect>);
    }
  }

  const byCardNo = new Map<string, GundamCardPrint>();
  for (const f of fs.readdirSync(colDir).filter((x) => x.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf8'));
    for (const c of (raw.cards ?? []) as GundamCardPrint[]) {
      const prev = byCardNo.get(c.cardNo);
      if (!prev || (prev.isParallel && !c.isParallel)) {
        byCardNo.set(c.cardNo, { ...c, compiledEffect: effects.get(c.cardNo) });
      }
    }
  }
  return byCardNo;
}

function makeCard(overrides: Partial<GundamCardPrint>): GundamCardPrint {
  const base: GundamCardPrint = {
    printId: 'TST-001',
    cardNo: 'TST-001',
    name: 'Test Unit',
    rarity: 'C',
    blockIcon: '1',
    lv: 1,
    cost: 1,
    color: 'Blue',
    type: 'UNIT',
    effect: '',
    zones: ['Space'],
    traits: ['Earth Alliance'],
    link: '',
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
    ...overrides,
  };
  return { ...base, compiledEffect: compileCardEffect(base) };
}

function makeUnit(id: string, card: GundamCardPrint, opts: Partial<ChainUnitInstance> = {}): ChainUnitInstance {
  return {
    instanceId: id,
    card,
    rested: false,
    damage: 0,
    deployedTurn: 1,
    temporaryModifiers: [],
    triggeredOnceThisTurn: [],
    ...opts,
  };
}

function makeBaseState(overrides: Partial<ChainMatchState> = {}): ChainMatchState {
  return {
    turn: 3,
    phase: 'MAIN',
    activeSide: 'A',
    players: {
      A: {
        hand: [],
        deck: [],
        trash: [],
        battleArea: [],
        base: null,
        shields: [{ id: 'A-S1', card: makeCard({ cardNo: 'SH-A1', name: 'Shield' }) }],
        activeResources: 3,
        restedResources: 0,
        exResources: 0,
      },
      B: {
        hand: [],
        deck: [],
        trash: [],
        battleArea: [],
        base: null,
        shields: [{ id: 'B-S1', card: makeCard({ cardNo: 'SH-B1', name: 'Shield' }) }],
        activeResources: 3,
        restedResources: 0,
        exResources: 0,
      },
    },
    pendingActionStep: null,
    ...overrides,
  };
}

describe('Seam 3: Rules-Accurate Chain Verifier (Core Gates & 4-Layer Modifiers)', () => {
  const corpus = loadCompiledCorpus();

  it('enforces Lv threshold separately from active Resource + EX Resource spending (exiling spent EX Resources)', () => {
    const unitLv3Cost2 = makeCard({ cardNo: 'TST-LV3', name: 'Lv3 Frame', lv: 3, cost: 2 });
    const state = makeBaseState();
    state.players.A.hand = [unitLv3Cost2];
    state.players.A.activeResources = 1;
    state.players.A.restedResources = 0;
    state.players.A.exResources = 2; // Lv = 1 + 2 = 3 >= 3

    const ok = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine: [{ type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 }],
      witness: {
        resourceSpends: [{ regular: 1, ex: 1 }],
      },
    });

    expect(ok.legal).toBe(true);
    if (ok.legal) {
      expect(ok.finalState.players.A.restedResources).toBe(1);
      expect(ok.finalState.players.A.activeResources).toBe(0);
      expect(ok.finalState.players.A.exResources).toBe(1);
      expect(ok.finalState.players.A.battleArea).toHaveLength(1);
    }

    // Fail closed when activeResources + exResources meets Cost (2) but total Lv (2) < card.lv (3)
    const lowLvState = makeBaseState();
    lowLvState.players.A.hand = [unitLv3Cost2];
    lowLvState.players.A.activeResources = 2;
    lowLvState.players.A.exResources = 0;

    const failLv = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: lowLvState },
      playLine: [{ type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 }],
      witness: {},
    });

    expect(failLv).toMatchObject({ legal: false, reason: 'INSUFFICIENT_LV' });
  });

  it('displaces an existing Unit on a full 6-Unit Battle Area without triggering 【Destroyed】', () => {
    const destroyedWatcher = makeCard({
      cardNo: 'TST-DIE',
      name: 'Bomb Unit',
      lv: 1,
      cost: 1,
      effect: '【Destroyed】Draw 1.',
    });
    const incoming = makeCard({ cardNo: 'TST-NEW', name: 'Newcomer', lv: 1, cost: 1 });
    const state = makeBaseState();
    state.players.A.deck = [makeCard({ cardNo: 'DK-1', name: 'Deck Card' })];
    state.players.A.hand = [incoming];
    state.players.A.battleArea = Array.from({ length: 6 }, (_, i) =>
      makeUnit(`A-U${i}`, i === 0 ? destroyedWatcher : makeCard({ cardNo: `U-${i}` }))
    );

    const res = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine: [{ type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 }],
      witness: {
        zoneReplacements: ['A-U0'],
      },
    });

    expect(res.legal).toBe(true);
    if (res.legal) {
      expect(res.finalState.players.A.battleArea).toHaveLength(6);
      expect(res.finalState.players.A.trash.map((c) => c.cardNo)).toContain('TST-DIE');
      // Crucially: displacement to Trash is NOT destruction, so 【Destroyed】Draw 1 did NOT fire!
      expect(res.finalState.players.A.hand).toHaveLength(0);
    }
  });

  it('enforces Layer-4 "cant" overrides over active/granted state (GD02-018, GD01-097)', () => {
    // GD02-018: "This Unit can't choose the enemy player as its attack target."
    // Per official FAQ, it also cannot attack enemy Base or Shields.
    const gd02018 = corpus.get('GD02-018')!;
    const restedTarget = makeCard({ cardNo: 'TST-DEF', name: 'Target Unit', ap: 1, hp: 2 });
    const state = makeBaseState({ turn: 4 });
    state.players.A.battleArea = [makeUnit('A-1', gd02018, { deployedTurn: 1 })];
    state.players.B.battleArea = [makeUnit('B-1', restedTarget, { rested: true })];

    const attackShield = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine: [{ type: 'ATTACK_SHIELD', side: 'A', attackerId: 'A-1' }],
      witness: {},
    });
    expect(attackShield).toMatchObject({ legal: false, reason: 'PROHIBITED_BY_CANT' });

    const attackUnit = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-1', targetId: 'B-1' }],
      witness: {},
    });
    expect(attackUnit.legal).toBe(true);

    // GD01-097 paired onto a rested Unit: Activate-Main readies it, then Layer-4 CANT_ATTACK forbids attacking
    const gd01097 = corpus.get('GD01-097')!;
    const readyState = makeBaseState({ turn: 4 });
    readyState.players.B.hand = Array.from({ length: 8 }, (_, i) => makeCard({ cardNo: `H-${i}` }));
    readyState.players.A.battleArea = [
      makeUnit('A-U1', makeCard({ cardNo: 'TST-BASE', ap: 4, hp: 4 }), {
        rested: true,
        pairedPilot: gd01097,
        deployedTurn: 1,
      }),
    ];

    const activateThenAttack = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: readyState },
      playLine: [
        { type: 'ACTIVATE_ABILITY', side: 'A', sourceId: 'A-U1', clauseIndex: 1 },
        { type: 'ATTACK_SHIELD', side: 'A', attackerId: 'A-U1' },
      ],
      witness: {},
    });
    expect(activateThenAttack).toMatchObject({ legal: false, reason: 'PROHIBITED_BY_CANT' });
  });

  it('computes 4-layer effective stats/keywords and blocks mandatory-target plays with 0 legal targets', () => {
    const st09004 = corpus.get('ST09-004')!; // Freedom Gundam: <Blocker>, Friendly Base -> gains <Suppression>
    const pilot = makeCard({ cardNo: 'TST-P', type: 'PILOT', ap: 2, hp: 1, traits: ['ZAFT'] });
    const state = makeBaseState();
    state.players.A.base = { instanceId: 'A-BASE', card: makeCard({ cardNo: 'B-1', type: 'BASE', hp: 5 }), damage: 0 };
    const unit = makeUnit('A-F', st09004, {
      pairedPilot: pilot,
      temporaryModifiers: [
        {
          id: 'tmp-1',
          layer: 3,
          stat: 'AP',
          delta: 1,
          duration: 'THIS_TURN',
        },
        {
          id: 'tmp-2',
          layer: 4,
          rule: 'CANT_ACTIVATE_BLOCKER',
          duration: 'THIS_TURN',
        },
      ],
    });
    state.players.A.battleArea = [unit];

    const eff = evaluateUnitEffectiveState(unit, state, 'A');
    expect(eff.ap).toBe((st09004.ap ?? 0) + 2 + 1);
    expect(eff.maxHp).toBe((st09004.hp ?? 0) + 1);
    expect(eff.keywords.has('Suppression')).toBe(true);
    expect(eff.prohibitions.has('CANT_ACTIVATE_BLOCKER')).toBe(true);
    expect(eff.canBlock).toBe(false); // Layer 4 overrides <Blocker>

    // Mandatory-target Command fails when no enemy Unit meets selector
    const destroyCmd = makeCard({
      cardNo: 'TST-CMD',
      type: 'COMMAND',
      lv: 1,
      cost: 1,
      effect: '【Main】Choose 1 enemy Unit that is Lv.2 or lower. Destroy it.',
    });
    const noTargetState = makeBaseState();
    noTargetState.players.A.hand = [destroyCmd];
    noTargetState.players.B.battleArea = [];

    const illegalNoTarget = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: noTargetState },
      playLine: [{ type: 'PLAY_COMMAND', side: 'A', handIndex: 0 }],
      witness: {},
    });
    expect(illegalNoTarget).toMatchObject({ legal: false, reason: 'NO_LEGAL_TARGET' });
  });

  it('resolves Turn-Player <Breach> before enemy 【Destroyed】 and resolves nested triggers depth-first', () => {
    const breachUnit = makeCard({
      cardNo: 'TST-BR',
      name: 'Breach Attacker',
      ap: 4,
      hp: 5,
      effect: '<Breach 1>',
    });
    const enemyDestroyed = makeCard({
      cardNo: 'TST-ED',
      name: 'Death Draw',
      ap: 2,
      hp: 2,
      effect: '【Destroyed】Draw 1.',
    });
    const state = makeBaseState({ turn: 3 });
    state.players.A.battleArea = [makeUnit('A-BR', breachUnit, { deployedTurn: 1 })];
    state.players.B.battleArea = [makeUnit('B-ED', enemyDestroyed, { rested: true, deployedTurn: 1 })];
    state.players.B.deck = [makeCard({ cardNo: 'B-DK1' })];

    const res = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-BR', targetId: 'B-ED' }],
      witness: {},
    });

    expect(res.legal).toBe(true);
    if (res.legal) {
      const trigTrace = res.trace.filter((t) => t.kind === 'TRIGGER').map((t) => t.detail);
      const breachIdx = trigTrace.findIndex((d) => d.includes('TST-BR'));
      const enemyIdx = trigTrace.findIndex((d) => d.includes('TST-ED'));
      expect(breachIdx).toBeGreaterThanOrEqual(0);
      expect(enemyIdx).toBeGreaterThan(breachIdx);
      expect(res.finalState.players.B.shields).toHaveLength(0);
      expect(res.finalState.players.B.hand).toHaveLength(1);
    }

    // Depth-first interrupt: Trigger 1 (DEPLOY_FROM_TRASH) spawns child 【Deploy】Draw 1 BEFORE sibling Trigger 2
    const spawner = makeCard({
      cardNo: 'TST-SP',
      name: 'Spawner',
      lv: 1,
      cost: 1,
      effect: '【Deploy】Choose 1 Lv.1 Unit card from your trash. Deploy it.\n【Deploy】Draw 1.',
    });
    const childUnit = makeCard({
      cardNo: 'TST-CH',
      name: 'Child Unit',
      lv: 1,
      cost: 1,
      effect: '【Deploy】Draw 1.',
    });
    const dfState = makeBaseState({ turn: 3 });
    dfState.players.A.hand = [spawner];
    dfState.players.A.trash = [childUnit];
    dfState.players.A.deck = [makeCard({ cardNo: 'DK-1' }), makeCard({ cardNo: 'DK-2' })];

    const dfRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: dfState },
      playLine: [{ type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 }],
      witness: { triggerOrders: [[0, 1]] },
    });

    expect(dfRes.legal).toBe(true);
    if (dfRes.legal) {
      const order = dfRes.trace.filter((t) => t.kind === 'TRIGGER').map((t) => t.detail);
      expect(order[0]).toContain('TST-SP');
      expect(order[1]).toContain('TST-CH');
      expect(order[2]).toContain('TST-SP');
      expect(dfRes.finalState.players.A.hand).toHaveLength(2);
    }
  });

  it('distinguishes SBA <= 0 HP (EFFECT) destruction from WHEN_DESTROY_BY_BATTLE (GD06-002)', () => {
    const gd06002 = corpus.get('GD06-002')!;
    const orbAlly = makeCard({ cardNo: 'TST-ORB', traits: ['Orb'], hp: 4 });
    const enemy = makeCard({ cardNo: 'TST-EN', ap: 2, hp: 2 });
    const hpDownCmd = makeCard({
      cardNo: 'TST-HPD',
      type: 'COMMAND',
      lv: 1,
      cost: 1,
      effect: '【Main】Choose 1 enemy Unit. It gets HP-2 during this turn.',
    });

    // Case 1: HP-2 kills enemy via SBA -> GD06-002 battle-destroy trigger MUST NOT heal Orb ally
    const sbaState = makeBaseState({ turn: 4 });
    sbaState.players.A.hand = [hpDownCmd];
    sbaState.players.A.battleArea = [
      makeUnit('A-IJ', gd06002, { deployedTurn: 1 }),
      makeUnit('A-ORB', orbAlly, { damage: 3, deployedTurn: 1 }),
    ];
    sbaState.players.B.battleArea = [makeUnit('B-EN', enemy, { rested: true, deployedTurn: 1 })];

    const sbaRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: sbaState },
      playLine: [{ type: 'PLAY_COMMAND', side: 'A', handIndex: 0 }],
      witness: { targets: [['B-EN']] },
    });
    expect(sbaRes.legal).toBe(true);
    if (sbaRes.legal) {
      expect(sbaRes.finalState.players.B.battleArea).toHaveLength(0);
      expect(sbaRes.finalState.players.A.battleArea[1].damage).toBe(3); // NOT healed!
    }

    // Case 2: GD06-002 attacks and kills enemy via battle damage on your turn -> heals Orb ally 3 HP
    const battleState = makeBaseState({ turn: 4 });
    battleState.players.A.battleArea = [
      makeUnit('A-IJ', gd06002, { deployedTurn: 1 }),
      makeUnit('A-ORB', orbAlly, { damage: 3, deployedTurn: 1 }),
    ];
    battleState.players.B.battleArea = [makeUnit('B-EN', enemy, { rested: true, deployedTurn: 1 })];

    const battleRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: battleState },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-IJ', targetId: 'B-EN' }],
      witness: { targets: [['A-ORB']] },
    });
    expect(battleRes.legal).toBe(true);
    if (battleRes.legal) {
      expect(battleRes.finalState.players.A.battleArea[1].damage).toBe(0); // Healed 3 HP!
    }
  });

  it('handles <First Strike>, <Suppression> simultaneous Burst Base Shield boundary, and ST14-006 ReplacementEffect', () => {
    // <First Strike>: kills defender with 0 reciprocal damage
    const fsUnit = makeCard({ cardNo: 'TST-FS', ap: 4, hp: 3, effect: '<First Strike>' });
    const defUnit = makeCard({ cardNo: 'TST-DEF', ap: 4, hp: 3 });
    const fsState = makeBaseState({ turn: 3 });
    fsState.players.A.battleArea = [makeUnit('A-FS', fsUnit, { deployedTurn: 1 })];
    fsState.players.B.battleArea = [makeUnit('B-DEF', defUnit, { rested: true, deployedTurn: 1 })];

    const fsRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: fsState },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-FS', targetId: 'B-DEF' }],
      witness: {},
    });
    expect(fsRes.legal).toBe(true);
    if (fsRes.legal) {
      expect(fsRes.finalState.players.B.battleArea).toHaveLength(0);
      expect(fsRes.finalState.players.A.battleArea[0].damage).toBe(0);
    }

    // <Suppression> destroys Shield 1 (Base with Burst + Deploy add Shield to hand) and Shield 2 simultaneously.
    // Per Bandai FAQ, deployed Base adds Shield 3 (first non-destroyed Shield), NOT Shield 2!
    const supUnit = makeCard({ cardNo: 'TST-SUP', ap: 3, hp: 4, effect: '<Suppression>' });
    const burstBase = makeCard({
      cardNo: 'TST-BB',
      type: 'BASE',
      hp: 5,
      effect: '【Burst】Deploy this card.\n【Deploy】Add 1 of your Shields to your hand.',
    });
    const sh2 = makeCard({ cardNo: 'SH-2', name: 'Destroyed Shield 2' });
    const sh3 = makeCard({ cardNo: 'SH-3', name: 'Surviving Shield 3' });

    const supState = makeBaseState({ turn: 3 });
    supState.players.A.battleArea = [makeUnit('A-SUP', supUnit, { deployedTurn: 1 })];
    supState.players.B.shields = [
      { id: 'S1', card: burstBase },
      { id: 'S2', card: sh2 },
      { id: 'S3', card: sh3 },
    ];

    const supRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: supState },
      playLine: [{ type: 'ATTACK_SHIELD', side: 'A', attackerId: 'A-SUP' }],
      witness: { burstOrder: [0, 1], burstAccepts: [true] },
    });
    expect(supRes.legal).toBe(true);
    if (supRes.legal) {
      expect(supRes.finalState.players.B.base?.card.cardNo).toBe('TST-BB');
      expect(supRes.finalState.players.B.hand.map((c) => c.cardNo)).toEqual(['SH-3']);
      expect(supRes.finalState.players.B.trash.map((c) => c.cardNo)).toContain('SH-2');
      expect(supRes.finalState.players.B.shields).toHaveLength(0);
    }

    // ST14-006 paired prevents battle damage via ReplacementEffect
    const st14006 = corpus.get('ST14-006')!;
    const pilot = makeCard({ cardNo: 'TST-P', type: 'PILOT', ap: 2, hp: 1 });
    const repState = makeBaseState({ turn: 4 });
    repState.players.A.battleArea = [makeUnit('A-ATK', makeCard({ cardNo: 'ATK', ap: 4, hp: 5 }), { deployedTurn: 1 })];
    repState.players.B.battleArea = [
      makeUnit('B-14', st14006, { pairedPilot: pilot, rested: true, deployedTurn: 1 }),
    ];

    const repRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: repState },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-ATK', targetId: 'B-14' }],
      witness: {},
    });
    expect(repRes.legal).toBe(true);
    if (repRes.legal) {
      expect(repRes.finalState.players.B.battleArea[0]?.damage).toBe(0);
      expect(repRes.trace.some((t) => t.kind === 'REPLACEMENT')).toBe(true);
    }
  });

  it('verifies a multi-card ST09-001 -> ST09-006 combo line in MINIMAL_FEASIBILITY mode', () => {
    const st09001 = corpus.get('ST09-001')!;
    const st09006 = corpus.get('ST09-006')!;
    const res = verifyPlayLine({
      mode: {
        kind: 'MINIMAL_FEASIBILITY',
        turn: 6,
        activeHand: [],
        activeBattleArea: [makeUnit('A-IMP', st09001, { deployedTurn: 5 })],
        activeTrash: [st09006],
        opponentDummyBoard: {
          units: [{ cardNo: 'OPP-LV3', lv: 3, ap: 3, hp: 3, rested: true }],
        },
      },
      playLine: [{ type: 'ACTIVATE_ABILITY', side: 'A', sourceId: 'A-IMP', clauseIndex: 0 }],
      witness: { targets: [['B-DUMMY-0']] },
    });

    expect(res.legal).toBe(true);
    if (res.legal) {
      expect(res.finalState.players.A.battleArea[0]?.card.cardNo).toBe('ST09-006');
      expect(res.finalState.players.B.battleArea).toHaveLength(0);
    }
  });

  it('recognizes [Link] on paired Pilots & Command-Pilots (isUnitLinked), fires WHEN_LINKED, and executes PAIR_SELF_FROM_TRASH', () => {
    const astraysUnit = makeCard({
      cardNo: 'TST-ASTRAY',
      printId: 'TST-ASTRAY',
      name: 'Gundam Astray Red Frame',
      type: 'UNIT',
      lv: 3,
      cost: 2,
      ap: 3,
      hp: 3,
      traits: ['G Generation'],
      link: '[Lowe Guele]',
      effect: '【When Linked】Draw 1.',
    });
    const eb01076 = corpus.get('EB01-076')!; // Command-Pilot 【Pilot】[Lowe Guele]
    const state = makeBaseState({ turn: 4 });
    state.players.A.activeResources = 4;
    state.players.A.hand = [astraysUnit, eb01076];
    state.players.A.deck = [makeCard({ cardNo: 'DRW-1', name: 'Drawn Card' })];

    const linkRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine: [
        { type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 },
        { type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-unit#1' },
        { type: 'ATTACK_SHIELD', side: 'A', attackerId: 'A-U-unit#1' },
      ],
      witness: {},
    });
    expect(linkRes.legal).toBe(true);
    if (linkRes.legal) {
      expect(linkRes.trace.some((t) => t.detail.includes('linked=true'))).toBe(true);
      expect(linkRes.trace.some((t) => t.detail.includes('WHEN_LINKED'))).toBe(true);
      expect(linkRes.finalState.players.A.hand.map((c) => c.cardNo)).toContain('DRW-1');
    }

    // PAIR_SELF_FROM_TRASH (GD05-112 played from hand pairs itself onto unpaired (MF) Unit)
    const mfUnit = makeCard({
      cardNo: 'TST-MF',
      printId: 'TST-MF',
      name: 'Shining Gundam',
      traits: ['MF'],
      ap: 4,
      hp: 4,
    });
    const gd05112 = corpus.get('GD05-112')!;
    const trashPairState = makeBaseState({ turn: 5 });
    trashPairState.players.A.activeResources = 5;
    trashPairState.players.A.battleArea = [makeUnit('A-MF', mfUnit, { deployedTurn: 1 })];
    trashPairState.players.A.hand = [gd05112];

    const pairSelfRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: trashPairState },
      playLine: [{ type: 'PLAY_COMMAND', side: 'A', handIndex: 0 }],
      witness: {},
    });
    expect(pairSelfRes.legal).toBe(true);
    if (pairSelfRes.legal) {
      expect(pairSelfRes.finalState.players.A.battleArea[0].pairedPilot?.cardNo).toBe('GD05-112');
      expect(pairSelfRes.finalState.players.A.trash.some((c) => c.cardNo === 'GD05-112')).toBe(false);
    }

    // Deck & Sandbox Chain Preview helpers
    const previews = buildDeckChainPreviews([astraysUnit, eb01076]);
    expect(previews.some((p) => p.category === 'Command-Pilot Link' && p.firstPlayerResult.legal)).toBe(true);
  });

  it('previews legal and blocked moves accurately via previewSandboxMoveChain', () => {
    const unit = makeCard({ cardNo: 'TST-U', printId: 'TST-U', name: 'Sample Unit', lv: 2, cost: 1, ap: 3, hp: 3 });
    const dummyDeck = {
      id: 'd1',
      name: 'Test',
      updatedAt: '2026-01-01',
      mainDeck: [{ cardNo: 'TST-U', printId: 'TST-U', qty: 10 }],
      resourceDeck: [],
    };
    const byPrint = new Map([[unit.printId, unit]]);
    const byNo = new Map([[unit.cardNo, unit]]);
    const sandbox = createInitialSandboxMatch(dummyDeck, dummyDeck, 'A', byPrint, byNo);
    sandbox.players.A.hand = [unit];
    sandbox.players.A.resourcesTotal = 2;
    sandbox.players.A.resourcesActive = 2;

    const moves = evaluateSandboxBestMoves(sandbox, 'A');
    const legalPreview = previewSandboxMoveChain(sandbox, moves[0]);
    expect(legalPreview.result.legal).toBe(true);

    // Exhaust active resources to verify fail-closed INSUFFICIENT_RESOURCES
    sandbox.players.A.resourcesActive = 0;
    const blockedPreview = previewSandboxMoveChain(sandbox, {
      id: 'deploy-fail',
      rank: 1,
      actionType: 'DEPLOY_UNIT',
      title: 'Deploy Sample Unit',
      reason: 'test',
      winDeltaPct: 0,
      priorityScore: 50,
      card: unit,
    });
    expect(blockedPreview.result.legal).toBe(false);
    if (!blockedPreview.result.legal) {
      expect(blockedPreview.result.reason).toBe('INSUFFICIENT_RESOURCES');
    }
  });

  it('enforces structured sourceFilter immunities (GD01-091), shield DAMAGE_PROOF (ST02-013), and ST14-006 apMaxRef', () => {
    // GD01-091 (Chang Wufei, Pilot): During your turn, if this Unit has <Breach>, it can't receive battle damage from enemy Units with 3 or less AP
    const gd01091 = corpus.get('GD01-091')!;
    const breachUnit = makeCard({ cardNo: 'TST-BR', name: 'Shenlong Frame', ap: 4, hp: 5, effect: '<Breach 3>' });
    const immState = makeBaseState({ turn: 4 });
    immState.players.A.battleArea = [
      makeUnit('A-91', breachUnit, { pairedPilot: gd01091, deployedTurn: 1 }),
    ];
    immState.players.B.battleArea = [
      makeUnit('B-3AP', makeCard({ cardNo: 'B3', ap: 3, hp: 5 }), { rested: true, deployedTurn: 1 }),
    ];
    const immRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: immState },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-91', targetId: 'B-3AP' }],
      witness: {},
    });
    expect(immRes.legal).toBe(true);
    if (immRes.legal) {
      expect(immRes.finalState.players.A.battleArea[0]?.damage).toBe(0);
    }

    // ST02-013: 【Action】During this battle, your shield area cards can't receive damage from enemy Units Lv.4 or lower
    const st02013 = corpus.get('ST02-013')!;
    const shieldState = makeBaseState({ turn: 4 });
    shieldState.players.B.activeResources = 4;
    shieldState.players.B.hand = [st02013];
    shieldState.players.A.battleArea = [
      makeUnit('A-LV4', makeCard({ cardNo: 'ALV4', lv: 4, ap: 4, hp: 4 }), { deployedTurn: 1 }),
    ];
    const shieldGuard = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: shieldState },
      playLine: [{ type: 'ATTACK_SHIELD', side: 'A', attackerId: 'A-LV4' }],
      witness: { actionSteps: [{ kind: 'PLAY_ACTION', side: 'B', handIndex: 0 }] },
    });
    expect(shieldGuard.legal).toBe(true);
    if (shieldGuard.legal) {
      expect(shieldGuard.finalState.players.B.shields).toHaveLength(1);
    }

    // ST14-006 with 5+ AP enemy ignores replacement, <= self AP prevents damage
    const st14006 = corpus.get('ST14-006')!;
    const pilot = makeCard({ cardNo: 'P14', type: 'PILOT', ap: 1, hp: 1 });
    const bigAtkState = makeBaseState({ turn: 4 });
    bigAtkState.players.A.battleArea = [makeUnit('A-BIG', makeCard({ cardNo: 'BIG', ap: 8, hp: 8 }), { deployedTurn: 1 })];
    bigAtkState.players.B.battleArea = [
      makeUnit('B-14', st14006, { pairedPilot: pilot, rested: true, deployedTurn: 1 }),
    ];
    const bigRes = verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state: bigAtkState },
      playLine: [{ type: 'ATTACK_UNIT', side: 'A', attackerId: 'A-BIG', targetId: 'B-14' }],
      witness: {},
    });
    expect(bigRes.legal).toBe(true);
    if (bigRes.legal) {
      expect(bigRes.finalState.players.B.battleArea).toHaveLength(0);
    }
  });
});

