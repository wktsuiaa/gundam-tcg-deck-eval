import { describe, expect, it } from 'vitest';
import type { GundamCardPrint, StrategyBlueprint } from '@/types/gundam';
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
  validateDeck,
} from '@/lib/deck-engine';

function makeCard(overrides: Partial<GundamCardPrint>): GundamCardPrint {
  return {
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
