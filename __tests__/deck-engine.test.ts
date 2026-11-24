import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint, StrategyBlueprint } from '@/types/gundam';
import { compileCardEffect, type CompiledCardEffect, type EffectShardFile } from '@/lib/effect-parser';
import { doesPilotLinkUnit } from '@/lib/gundam-keywords';
import {
  analyzeDeck,
  computeTurnWinChances,
  createBlankCustomDeck,
  DEFAULT_BLUEPRINT,
  DEFAULT_CONSTRAINTS,
  detectEffectStyles,
  evaluateConstraintFeasibility,
  exportDeckToText,
  filterPoolByConstraints,
  generateStrategyDeck,
  getRecommendedCardsForStrategy,
  META_ARCHETYPES,
  normalizeTraitFocus,
  parseDeckFromText,
  resolveCardMap,
  scoreSingleCardSignals,
  validateDeck,
} from '@/lib/deck-engine';

function makeCard(overrides: Partial<GundamCardPrint>): GundamCardPrint {
  const card: GundamCardPrint = {
    printId: overrides.printId ?? 'GD01-001',
    cardNo: overrides.cardNo ?? 'GD01-001',
    name: overrides.name ?? 'Test Unit',
    rarity: overrides.rarity ?? 'C',
    blockIcon: '1',
    lv: 2,
    cost: 2,
    color: 'Blue',
    type: 'UNIT',
    effect: '',
    zones: ['Space'],
    traits: ['Earth Federation'],
    link: '',
    apRaw: '3',
    hpRaw: '3',
    ap: 3,
    hp: 3,
    sourceTitle: 'Mobile Suit Gundam',
    whereToGet: 'GD01',
    imagePath: 'jp/images/cards/card/GD01-001.webp',
    isParallel: false,
    faqs: [],
    packageIds: ['619001'],
    packageNames: ['Booster Pack 1 [GD01]'],
    packageCodes: ['GD01'],
    ...overrides,
  };
  return {
    ...card,
    compiledEffect: overrides.compiledEffect ?? compileCardEffect(card),
  };
}

function buildSyntheticCatalog(): GundamCardPrint[] {
  const cards: GundamCardPrint[] = [];
  for (let i = 1; i <= 18; i++) {
    const no = `GD01-${String(i).padStart(3, '0')}`;
    cards.push(
      makeCard({
        printId: no,
        cardNo: no,
        name: `Federation Unit ${i}`,
        color: i <= 9 ? 'Blue' : 'White',
        type: 'UNIT',
        lv: i <= 8 ? 1 : i <= 15 ? 3 : 5,
        cost: i <= 8 ? 1 : i <= 15 ? 3 : 5,
        ap: i <= 8 ? 2 : 5,
        hp: i <= 8 ? 3 : 5,
        traits: ['White Base Team'],
        link: i <= 15 ? '[Amuro Ray]' : '',
        rarity: i >= 17 ? 'LR' : 'C',
        effect:
          i % 3 === 0
            ? '<Repair 1> <Blocker>'
            : i % 2 === 0
            ? '【Deploy】Draw 1 card.'
            : '<Breach 1>',
      })
    );
  }
  cards.push(
    makeCard({
      printId: 'GD01-088',
      cardNo: 'GD01-088',
      name: 'Amuro Ray',
      color: 'Blue',
      type: 'PILOT',
      lv: 2,
      cost: 1,
      ap: 2,
      hp: 1,
      traits: ['White Base Team'],
      link: '',
      effect: '【When Linked】Rest 1 enemy Unit.',
    }),
    makeCard({
      printId: 'GD01-089',
      cardNo: 'GD01-089',
      name: 'Sayla Mass',
      color: 'White',
      type: 'PILOT',
      lv: 2,
      cost: 1,
      ap: 1,
      hp: 2,
      traits: ['White Base Team'],
      link: '',
      effect: '【When Paired】Reduce the next damage by 2.',
    }),
    makeCard({
      printId: 'GD01-095',
      cardNo: 'GD01-095',
      name: 'Beam Suppression',
      color: 'Blue',
      type: 'COMMAND',
      lv: 2,
      cost: 2,
      ap: null,
      hp: null,
      apRaw: '-',
      hpRaw: '-',
      traits: [],
      effect: 'Choose 1 enemy Unit. It gets AP-3 until end of turn. Destroy it if AP is 0.',
    }),
    makeCard({
      printId: 'GD01-096',
      cardNo: 'GD01-096',
      name: 'Emergency Evacuation',
      color: 'White',
      type: 'COMMAND',
      lv: 3,
      cost: 2,
      ap: null,
      hp: null,
      apRaw: '-',
      hpRaw: '-',
      traits: [],
      effect: 'Return 1 enemy Unit to its owner hand.',
    }),
    makeCard({
      printId: 'GD01-100',
      cardNo: 'GD01-100',
      name: 'White Base',
      color: 'White',
      type: 'BASE',
      lv: 2,
      cost: 2,
      ap: null,
      hp: 6,
      apRaw: '-',
      hpRaw: '6',
      traits: ['White Base Team'],
      effect: '【Deploy】Deploy 1 Unit token.',
    }),
    makeCard({
      printId: 'R-001',
      cardNo: 'R-001',
      name: 'Resource',
      color: 'Colorless',
      type: 'RESOURCE',
      lv: null,
      cost: null,
      ap: null,
      hp: null,
      apRaw: '-',
      hpRaw: '-',
      traits: [],
      effect: '',
    })
  );
  return cards;
}

describe('Strict Import / Export (<qty> <cardNo>)', () => {
  const catalog = buildSyntheticCatalog();
  const { byPrintId, byCardNo } = resolveCardMap(catalog);

  it('rejects 4x syntax, comments, and trailing names while accepting strict "<qty> <cardNo>"', () => {
    const raw = [
      '// Main Deck',
      '4x GD01-001',
      '4 GD01-002 Federation Unit 2',
      '4 GD01-001',
      '4 GD01-088',
      '10 R-001',
    ].join('\n');

    const parsed = parseDeckFromText(raw, byPrintId, byCardNo);
    expect(parsed.unmatched).toHaveLength(3);
    expect(parsed.mainDeck.map((e) => `${e.qty} ${e.cardNo}`)).toEqual([
      '4 GD01-001',
      '4 GD01-088',
    ]);
    expect(parsed.resourceDeck.map((e) => `${e.qty} ${e.cardNo}`)).toEqual(['10 R-001']);
  });

  it('exports strictly "<qty> <cardNo>" with zero trailing names or headers', () => {
    const deck = createBlankCustomDeck(1);
    deck.mainDeck = [{ cardNo: 'GD01-001', printId: 'GD01-001', qty: 4 }];
    deck.resourceDeck = [{ cardNo: 'R-001', printId: 'R-001', qty: 10 }];

    const txt = exportDeckToText(deck, byPrintId, byCardNo);
    expect(txt).toBe('4 GD01-001\n10 R-001');
  });
});

describe('Effect Styles, Coherence (No Series) & Generation Constraints', () => {
  const catalog = buildSyntheticCatalog();
  const { byPrintId, byCardNo } = resolveCardMap(catalog);

  it('detects Effect Styles cleanly from card text', () => {
    const cmd = byCardNo.get('GD01-095')!;
    const styles = detectEffectStyles(cmd);
    expect(styles).toContain('AP Deduction');
    expect(styles).toContain('Destroy');

    const pilot = byCardNo.get('GD01-089')!;
    expect(detectEffectStyles(pilot)).toContain('Damage Proof');
  });

  it('excludes Series (sourceTitle) from recommendation coherence & scoring', () => {
    const cardA = makeCard({
      printId: 'GD02-001',
      cardNo: 'GD02-001',
      name: 'Alpha Suit',
      sourceTitle: 'Series Alpha',
      traits: ['Zeon'],
    });
    const cardB = makeCard({
      printId: 'GD02-002',
      cardNo: 'GD02-002',
      name: 'Beta Suit',
      sourceTitle: 'Completely Different Series',
      traits: ['Zeon'],
    });

    const bp: StrategyBlueprint = {
      ...DEFAULT_BLUEPRINT,
      colors: ['Blue'],
      traitFocus: ['Zeon'],
    };

    const recs = getRecommendedCardsForStrategy([cardA, cardB], bp, [], 10);
    expect(recs).toHaveLength(2);
    expect(recs[0].fitScore).toBe(recs[1].fitScore);
    expect(recs[0].coherenceScore).toBe(recs[1].coherenceScore);
  });

  it('matches multi-select Trait Focus using OR logic and normalizes legacy strings', () => {
    expect(normalizeTraitFocus('Zeon')).toEqual(['Zeon']);
    expect(normalizeTraitFocus('')).toEqual([]);
    expect(normalizeTraitFocus(['Zeon', 'zeon', ' Neo Zeon '])).toEqual(['Zeon', 'Neo Zeon']);

    const zeonCard = makeCard({
      printId: 'GD02-010',
      cardNo: 'GD02-010',
      name: 'Zeon Scout',
      traits: ['Zeon'],
    });
    const fedCard = makeCard({
      printId: 'GD02-011',
      cardNo: 'GD02-011',
      name: 'Fed Guard',
      traits: ['Earth Federation'],
    });
    const otherCard = makeCard({
      printId: 'GD02-012',
      cardNo: 'GD02-012',
      name: 'Civ Shuttle',
      traits: ['Civilian'],
    });

    const bp: StrategyBlueprint = {
      ...DEFAULT_BLUEPRINT,
      colors: ['Blue'],
      traitFocus: ['Zeon', 'Earth Federation'],
      constraints: {
        ...DEFAULT_CONSTRAINTS,
        strictTraitLinkLock: true,
      },
    };

    const pool = filterPoolByConstraints([zeonCard, fedCard, otherCard], bp);
    expect(pool.map((c) => c.cardNo)).toEqual(['GD02-010', 'GD02-011']);
  });

  it('generates a legal 50+10 deck obeying maxCopiesPerCard, maxCost, and rarityCap constraints', () => {
    const bp: StrategyBlueprint = {
      ...DEFAULT_BLUEPRINT,
      colors: [], // Test Any (Auto Best 2)
      styles: ['Link-Strike'],
      effectStyles: ['AP Deduction', 'Destroy'],
      constraints: {
        ...DEFAULT_CONSTRAINTS,
        maxCopiesPerCard: 3,
        maxCost: 4,
        rarityCap: 'NO_LR',
      },
    };

    const generated = generateStrategyDeck(catalog, bp);
    expect(generated.feasibility.feasible).toBe(true);
    expect(generated.resolvedColors.length).toBeGreaterThan(0);

    const deck = createBlankCustomDeck(1);
    deck.mainDeck = generated.mainDeck;
    deck.resourceDeck = generated.resourceDeck;

    const validation = validateDeck(deck, byPrintId, byCardNo);
    expect(validation.isLegal).toBe(true);
    expect(validation.mainCount).toBe(50);
    expect(validation.resourceCount).toBe(10);

    for (const entry of deck.mainDeck) {
      expect(entry.qty).toBeLessThanOrEqual(3);
      const card = byCardNo.get(entry.cardNo)!;
      expect(card.cost ?? 0).toBeLessThanOrEqual(4);
      expect(card.rarity).not.toBe('LR');
    }
  });

  it('flags infeasible constraints when card pool cannot reach 50 cards', () => {
    const tinyPool = catalog.slice(0, 5);
    const feasibility = evaluateConstraintFeasibility(tinyPool, DEFAULT_BLUEPRINT);
    expect(feasibility.feasible).toBe(false);
  });
});

describe('Playbook Turn 1-6+ Best/Worst Actions & Turn Win-Chance Settings', () => {
  const catalog = buildSyntheticCatalog();
  const { byPrintId, byCardNo } = resolveCardMap(catalog);

  it('produces Turn 1-6+ insights and varies win chance across Turn Order & Hand settings', () => {
    const generated = generateStrategyDeck(catalog, {
      ...DEFAULT_BLUEPRINT,
      colors: ['Blue', 'White'],
    });
    const deck = createBlankCustomDeck(1);
    deck.mainDeck = generated.mainDeck;
    deck.resourceDeck = generated.resourceDeck;

    const analysis = analyzeDeck(deck, byPrintId, byCardNo);
    expect(analysis.playbook.turnInsights).toHaveLength(6);
    expect(analysis.playbook.turnInsights[0].turnLabel).toBe('Turn 1');
    expect(analysis.playbook.turnInsights[5].turnLabel).toBe('Turn 6+');
    expect(analysis.playbook.turnInsights[0].bestAction.length).toBeGreaterThan(10);
    expect(analysis.playbook.turnInsights[0].worstAction.length).toBeGreaterThan(10);

    const expandedPool = deck.mainDeck.flatMap((e) =>
      Array.from({ length: e.qty }, () => byCardNo.get(e.cardNo)!)
    );

    const optimalFirst = computeTurnWinChances(
      analysis,
      expandedPool,
      'first',
      META_ARCHETYPES[0],
      'optimal'
    );
    const mulliganedFirst = computeTurnWinChances(
      analysis,
      expandedPool,
      'first',
      META_ARCHETYPES[0],
      'mulliganed'
    );

    expect(optimalFirst).toHaveLength(6);
    expect(optimalFirst[0].winChancePct).toBeGreaterThan(mulliganedFirst[0].winChancePct);
  });
});

describe('Seam 2: Parsed Effect Styles, False-Positive Fixes & Knowledge Map Synergy', () => {
  const st09006 = makeCard({
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

  const st09001 = makeCard({
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

  const kiraBurst = makeCard({
    printId: 'ST04-010',
    cardNo: 'ST04-010',
    name: 'Kira Yamato',
    color: 'White',
    type: 'PILOT',
    lv: 4,
    cost: 1,
    ap: 2,
    hp: 1,
    traits: ['Earth Alliance', 'Coordinator'],
    link: '',
    effect:
      '【Burst】Add this card to your hand.\n【Attack】Choose 1 enemy Unit. It gets AP-2 during this battle.',
  });

  const blastBlocker = makeCard({
    printId: 'ST09-007',
    cardNo: 'ST09-007',
    name: 'Blast Impulse Gundam',
    color: 'Purple',
    type: 'UNIT',
    lv: 5,
    cost: 3,
    ap: 5,
    hp: 3,
    traits: ['ZAFT', 'Minerva Squad'],
    link: '[Shinn Asuka]',
    effect: '<Blocker> (Rest this Unit to change the attack target to it.)',
  });

  it('eliminates Trash Recursion/Search false positives on ST09-006 and applies conditional discount', () => {
    expect(detectEffectStyles(st09006)).toEqual(['Destroy']);
    const sig = scoreSingleCardSignals(st09006);
    expect(sig.hasSearch).toBe(false);
    expect(sig.hasRemoval).toBe(true);
    expect(sig.liquidity).toBe(0);

    // Unconditional destroy Command should outscore conditional ST09-006 on Control axis
    const unconditionalDestroy = makeCard({
      printId: 'TST-DEST',
      cardNo: 'TST-DEST',
      name: 'Direct Destroy',
      color: 'Purple',
      type: 'COMMAND',
      effect: '【Main】Choose 1 enemy Unit that is Lv.3 or lower. Destroy it.',
    });
    expect(scoreSingleCardSignals(unconditionalDestroy).control).toBeGreaterThan(sig.control);
  });

  it('prevents 【Burst】Add to hand and <Blocker> reminder text from inflating Draw/Rest signals', () => {
    expect(detectEffectStyles(kiraBurst)).toEqual(['AP Deduction']);
    const kiraSig = scoreSingleCardSignals(kiraBurst);
    expect(kiraSig.hasDraw).toBe(false);
    expect(kiraSig.hasSearch).toBe(false);
    expect(kiraSig.liquidity).toBe(0);

    expect(detectEffectStyles(blastBlocker)).toEqual(['Combat Keywords']);
    expect(scoreSingleCardSignals(blastBlocker).hasRest).toBe(false);
  });

  it('surfaces Knowledge Map Enabler-Payoff combo and recommendation boost for Impulse -> Sword Impulse', () => {
    const filler = Array.from({ length: 12 }, (_, i) =>
      makeCard({
        printId: `ST09-F${i}`,
        cardNo: `ST09-F${i}`,
        name: `ZAFT Trooper ${i}`,
        color: 'Purple',
        type: 'UNIT',
        traits: ['ZAFT'],
        effect: '-',
      })
    );
    const pool = [st09001, st09006, ...filler];
    const { byPrintId, byCardNo } = resolveCardMap(pool);

    const deck = createBlankCustomDeck(1);
    deck.mainDeck = [
      { cardNo: 'ST09-001', printId: 'ST09-001', qty: 4 },
      { cardNo: 'ST09-006', printId: 'ST09-006', qty: 4 },
      ...filler.slice(0, 10).map((f) => ({ cardNo: f.cardNo, printId: f.printId, qty: 4 })),
    ];
    const analysis = analyzeDeck(deck, byPrintId, byCardNo);
    expect(
      analysis.playbook.combos.some(
        (c) => c.description.includes('Impulse Gundam') && c.description.includes('Sword Impulse Gundam')
      )
    ).toBe(true);

    const bp: StrategyBlueprint = { ...DEFAULT_BLUEPRINT, colors: ['Purple'] };
    const withEnabler = getRecommendedCardsForStrategy(
      pool,
      bp,
      [{ cardNo: 'ST09-001', printId: 'ST09-001', qty: 4 }],
      15
    );
    const withoutEnabler = getRecommendedCardsForStrategy(
      [st09006, ...filler],
      bp,
      [],
      15
    );
    const recWith = withEnabler.find((r) => r.card.cardNo === 'ST09-006')!;
    const recWithout = withoutEnabler.find((r) => r.card.cardNo === 'ST09-006')!;
    expect(recWith.fitScore).toBeGreaterThan(recWithout.fitScore);
  });
});

describe('Seam 3: Effect Prerequisite Enforcement, Trait Cohesion & Multi-Pass Deck Builder', () => {
  function loadRealCatalog(): GundamCardPrint[] {
    const effectsDir = path.join(process.cwd(), 'data', 'effects');
    const effectsByCardNo = new Map<string, CompiledCardEffect>();
    for (const file of fs.readdirSync(effectsDir).filter((f) => f.endsWith('.json')).sort()) {
      const shard = JSON.parse(fs.readFileSync(path.join(effectsDir, file), 'utf8')) as EffectShardFile;
      for (const [cardNo, eff] of Object.entries(shard.effects ?? {})) {
        effectsByCardNo.set(cardNo, eff);
      }
    }

    const dir = path.join(process.cwd(), 'data', 'collections');
    const out: GundamCardPrint[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const card of (raw.cards ?? []) as GundamCardPrint[]) {
        const compiledEffect = effectsByCardNo.get(card.cardNo);
        out.push(compiledEffect ? { ...card, compiledEffect } : card);
      }
    }
    return out;
  }

  const realCatalog = loadRealCatalog();
  const { byPrintId, byCardNo } = resolveCardMap(realCatalog);

  const zaftMidrangeBp: StrategyBlueprint = {
    ...DEFAULT_BLUEPRINT,
    colors: ['Purple', 'Red'],
    pacing: 'Midrange Tempo',
    styles: ['Balanced Midrange'],
    traitFocus: ['ZAFT'],
    effectStyles: ['Destroy', 'Trash Recursion'],
  };

  it('stops tagging GD05-112 and GD05-113 as Trash Recursion or Search', () => {
    for (const cardNo of ['GD05-112', 'GD05-113']) {
      const card = byCardNo.get(cardNo)!;
      expect(detectEffectStyles(card)).not.toContain('Trash Recursion');
      expect(scoreSingleCardSignals(card).hasSearch).toBe(false);
    }
  });

  it('penalizes unmet Effect Prerequisites (MF/Zeon/Neo Zeon) while rewarding generic removal and self-mill ZAFT enablers', () => {
    const recsEmpty = getRecommendedCardsForStrategy(realCatalog, zaftMidrangeBp, [], 400);
    const byNoEmpty = new Map(recsEmpty.map((r) => [r.card.cardNo, r]));

    expect(byNoEmpty.get('ST09-009')!.fitScore).toBeGreaterThan(byNoEmpty.get('GD05-112')!.fitScore);
    expect(byNoEmpty.get('ST05-014')!.fitScore).toBeGreaterThan(byNoEmpty.get('GD05-113')!.fitScore);
    expect(byNoEmpty.get('GD05-112')!.reason).toMatch(/Requires \(MF\)/i);

    // With Trash-recursion & Minerva Squad Units in deck, GD04-116 Reliable Big Brother gets full self-mill synergy
    const withMinervaUnits = [
      { cardNo: 'ST09-001', printId: byCardNo.get('ST09-001')!.printId, qty: 4 },
      { cardNo: 'ST09-006', printId: byCardNo.get('ST09-006')!.printId, qty: 4 },
      { cardNo: 'ST09-002', printId: byCardNo.get('ST09-002')!.printId, qty: 4 },
    ];
    const recsWithUnits = getRecommendedCardsForStrategy(realCatalog, zaftMidrangeBp, withMinervaUnits, 400);
    const rec4116 = recsWithUnits.find((r) => r.card.cardNo === 'GD04-116')!;
    expect(rec4116.fitScore).toBeGreaterThan(recsWithUnits.find((r) => r.card.cardNo === 'GD05-112')!.fitScore);
  });

  it('builds a legal 50+10 Purple/Red ZAFT Midrange deck with zero dead-brick (MF)/(Zeon) Commands', () => {
    const generated = generateStrategyDeck(realCatalog, zaftMidrangeBp);
    expect(generated.feasibility.feasible).toBe(true);

    const deck = createBlankCustomDeck(1);
    deck.mainDeck = generated.mainDeck;
    deck.resourceDeck = generated.resourceDeck;
    const validation = validateDeck(deck, byPrintId, byCardNo);
    expect(validation.isLegal).toBe(true);
    expect(validation.mainCount).toBe(50);

    const cardNos = new Set(generated.mainDeck.map((e) => e.cardNo));
    expect(cardNos.has('GD05-112')).toBe(false);
    expect(cardNos.has('GD05-113')).toBe(false);
    expect(cardNos.has('GD06-116')).toBe(false);
    expect(cardNos.has('GD05-115')).toBe(false);

    // Count ZAFT copies and verify every primaryClause Effect Prerequisite has >= minCopies matching enablers
    let zaftCopies = 0;
    const expanded = generated.mainDeck.map((e) => ({ card: byCardNo.get(e.cardNo)!, qty: e.qty }));
    for (const { card, qty } of expanded) {
      if (card.traits.includes('ZAFT')) zaftCopies += qty;
      for (const prereq of card.compiledEffect?.prerequisites ?? []) {
        if (!prereq.primaryClause) continue;
        const matchingCopies = expanded.reduce((sum, item) => {
          if (item.card.cardNo === card.cardNo) return sum;
          if (prereq.cardType && item.card.type !== prereq.cardType) return sum;
          if (prereq.color && item.card.color !== prereq.color) return sum;
          if (prereq.trait && !item.card.traits.some((t) => t.toLowerCase() === prereq.trait!.toLowerCase())) return sum;
          if (prereq.nameContains && !item.card.name.toLowerCase().includes(prereq.nameContains.toLowerCase())) return sum;
          return sum + item.qty;
        }, 0);
        expect(matchingCopies).toBeGreaterThanOrEqual(prereq.minCopies);
      }
    }
    expect(zaftCopies).toBeGreaterThanOrEqual(24);
  });

  it('recognizes Command-Pilots and Name-Aliased Pilots in doesPilotLinkUnit and LINK prerequisites', () => {
    const eb01076 = byCardNo.get('EB01-076')!;
    const gd02098 = byCardNo.get('GD02-098')!;
    const loweUnit = makeCard({
      cardNo: 'TST-LOWE',
      printId: 'TST-LOWE',
      type: 'UNIT',
      name: 'Gundam Astray Red Frame',
      link: '[Lowe Guele]',
    });
    const charUnit = makeCard({
      cardNo: 'TST-CHAR',
      printId: 'TST-CHAR',
      type: 'UNIT',
      name: 'Char Zaku II',
      link: '[Char Aznable]',
    });

    expect(doesPilotLinkUnit(eb01076, loweUnit)).toBe(true);
    expect(doesPilotLinkUnit(gd02098, charUnit)).toBe(true);
    expect(eb01076.compiledEffect?.clauses.some((c) => c.steps.some((s) => s.action === 'GRANT_PILOT_MODE'))).toBe(true);

    const st09003 = byCardNo.get('ST09-003')!;
    expect(st09003.compiledEffect?.prerequisites.some((p) => p.kind === 'LINK' && p.anyNames?.includes('Athrun Zala'))).toBe(true);
  });
});


