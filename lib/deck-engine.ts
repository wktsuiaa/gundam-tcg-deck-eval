import type {
  AxisBreakdown,
  CardColor,
  CriticalTurnPoint,
  DeckAnalysis,
  DeckEntry,
  DeckPlaybook,
  DeckValidationResult,
  DetectedCombo,
  GundamCardPrint,
  HandVerdict,
  HexagonAxes,
  MatchupAssessment,
  PacingTier,
  SavedDeck,
  StrategyBlueprint,
  TacticalStyleTag,
} from '@/types/gundam';
import { doesPilotLinkUnit } from '@/lib/gundam-keywords';

const MAIN_DECK_TYPES = new Set(['UNIT', 'PILOT', 'COMMAND', 'BASE']);

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/** Hypergeometric probability of drawing >= minSuccesses in drawCount draws */
export function hypergeometricAtLeast(
  populationSize: number,
  successStates: number,
  drawCount: number,
  minSuccesses = 1
): number {
  if (populationSize <= 0 || successStates <= 0 || drawCount <= 0) return 0;
  if (minSuccesses <= 0) return 1;
  if (successStates < minSuccesses) return 0;

  const comb = (n: number, k: number): number => {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let kk = Math.min(k, n - k);
    let res = 1;
    for (let i = 1; i <= kk; i++) {
      res = (res * (n - kk + i)) / i;
    }
    return res;
  };

  const totalWays = comb(populationSize, drawCount);
  if (totalWays === 0) return 0;

  let probLess = 0;
  for (let k = 0; k < minSuccesses; k++) {
    probLess +=
      (comb(successStates, k) * comb(populationSize - successStates, drawCount - k)) / totalWays;
  }
  return Math.max(0, Math.min(1, 1 - probLess));
}

export function resolveCardMap(cards: GundamCardPrint[]): {
  byPrintId: Map<string, GundamCardPrint>;
  byCardNo: Map<string, GundamCardPrint>;
} {
  const byPrintId = new Map<string, GundamCardPrint>();
  const byCardNo = new Map<string, GundamCardPrint>();
  for (const c of cards) {
    byPrintId.set(c.printId, c);
    const existing = byCardNo.get(c.cardNo);
    if (!existing || (existing.isParallel && !c.isParallel)) {
      byCardNo.set(c.cardNo, c);
    }
  }
  return { byPrintId, byCardNo };
}

export function expandEntries(
  entries: DeckEntry[],
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): { card: GundamCardPrint; qty: number }[] {
  const out: { card: GundamCardPrint; qty: number }[] = [];
  for (const entry of entries) {
    const card = byPrintId.get(entry.printId) ?? byCardNo.get(entry.cardNo);
    if (card && entry.qty > 0) {
      out.push({ card, qty: entry.qty });
    }
  }
  return out;
}

export function validateDeck(
  deck: SavedDeck,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): DeckValidationResult {
  const mainExpanded = expandEntries(deck.mainDeck, byPrintId, byCardNo);
  const resExpanded = expandEntries(deck.resourceDeck, byPrintId, byCardNo);

  const mainCount = mainExpanded.reduce((s, x) => s + x.qty, 0);
  const resourceCount = resExpanded.reduce((s, x) => s + x.qty, 0);

  const colorSet = new Set<CardColor>();
  const copyCounts = new Map<string, number>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { card, qty } of mainExpanded) {
    if (!MAIN_DECK_TYPES.has(card.type)) {
      errors.push(`${card.cardNo} (${card.name}) is a ${card.type} card and cannot go in the Main Deck.`);
    }
    if (card.color !== 'Colorless') {
      colorSet.add(card.color);
    }
    copyCounts.set(card.cardNo, (copyCounts.get(card.cardNo) ?? 0) + qty);
  }

  for (const [cardNo, total] of copyCounts.entries()) {
    if (total > 4) {
      errors.push(`${cardNo} exceeds the 4-copy limit (${total}/4 copies across variants).`);
    }
  }

  for (const { card } of resExpanded) {
    if (card.type !== 'RESOURCE') {
      errors.push(`${card.cardNo} (${card.name}) is not a RESOURCE card.`);
    }
  }

  if (mainCount !== 50) {
    errors.push(`Main Deck requires exactly 50 cards (currently ${mainCount}/50).`);
  }
  if (resourceCount !== 10) {
    errors.push(`Resource Deck requires exactly 10 cards (currently ${resourceCount}/10).`);
  }

  const colors = [...colorSet];
  if (colors.length === 0 && mainCount > 0) {
    warnings.push('No colored cards detected.');
  } else if (colors.length > 2) {
    errors.push(`Deck uses ${colors.length} colors (${colors.join(', ')}); official rules allow at most 2 colors.`);
  }

  const unitCount = mainExpanded
    .filter((x) => x.card.type === 'UNIT')
    .reduce((s, x) => s + x.qty, 0);
  const pilotCount = mainExpanded
    .filter((x) => x.card.type === 'PILOT')
    .reduce((s, x) => s + x.qty, 0);

  if (mainCount >= 20 && unitCount < 18) {
    warnings.push(`Low Unit count (${unitCount}); most balanced GCG decks run 22–30 Units.`);
  }
  if (mainCount >= 20 && pilotCount === 0) {
    warnings.push('No Pilots in deck — Link abilities and Pair stat boosts will remain inactive.');
  }

  return {
    isLegal: errors.length === 0,
    mainCount,
    resourceCount,
    colors,
    errors,
    warnings,
  };
}

export interface CardSignalScores {
  aggro: number;
  defense: number;
  tempo: number;
  liquidity: number;
  synergy: number;
  control: number;
  hasDraw: boolean;
  hasSearch: boolean;
  hasRamp: boolean;
  hasRest: boolean;
  hasRemoval: boolean;
  hasRepair: boolean;
  hasBlocker: boolean;
  hasBreach: boolean;
  hasFirstStrike: boolean;
  hasSupport: boolean;
  hasPairTrigger: boolean;
}

export function scoreSingleCardSignals(card: GundamCardPrint): CardSignalScores {
  const eff = (card.effect || '').toLowerCase();
  const cost = card.cost ?? 2;
  const lv = card.lv ?? 2;
  const ap = card.ap ?? 0;
  const hp = card.hp ?? 0;

  const hasDraw =
    /\bdraw\s+\d+/i.test(eff) ||
    eff.includes('add this card to your hand') ||
    eff.includes('add it to your hand');
  const hasSearch =
    eff.includes('look at the top') ||
    eff.includes('reveal') ||
    eff.includes('search') ||
    eff.includes('from your trash');
  const hasRamp =
    eff.includes('resource area') ||
    eff.includes('ex resource') ||
    eff.includes('reduce the cost') ||
    eff.includes('cost -');
  const hasRest = eff.includes('rest it') || eff.includes('rest them') || eff.includes('rest 1');
  const hasRemoval =
    eff.includes('deal ') ||
    eff.includes('destroy') ||
    eff.includes('return it to') ||
    eff.includes('ap-') ||
    eff.includes('hp-');
  const hasRepair = eff.includes('<repair');
  const hasBlocker = eff.includes('<blocker');
  const hasBreach = eff.includes('<breach');
  const hasFirstStrike = eff.includes('<first strike');
  const hasHighManeuver = eff.includes('<high-maneuver');
  const hasSupport = eff.includes('<support');
  const hasPairTrigger =
    eff.includes('【when paired】') ||
    eff.includes('【when linked】') ||
    eff.includes('【during pair】') ||
    eff.includes('【during link】');

  let aggro = 0;
  let defense = 0;
  let tempo = 0;
  let liquidity = 0;
  let synergy = 0;
  let control = 0;

  // Aggro / Pressure
  if (card.type === 'UNIT') {
    if (cost <= 2) aggro += 28;
    else if (cost === 3) aggro += 18;
    const apEff = cost > 0 ? ap / cost : ap;
    if (apEff >= 1.5) aggro += 26;
    else if (apEff >= 1.0) aggro += 14;
    if (ap >= 4) aggro += 12;
  } else if (card.type === 'PILOT' && ap >= 2) {
    aggro += 22;
  }
  if (hasBreach) aggro += 28;
  if (hasFirstStrike) aggro += 22;
  if (hasHighManeuver) aggro += 22;
  if (eff.includes('【attack】')) aggro += 16;
  if (eff.includes('ap+')) aggro += 12;

  // Defense / Durability
  if (card.type === 'UNIT') {
    const hpEff = cost > 0 ? hp / cost : hp;
    if (hpEff >= 1.5) defense += 25;
    else if (hpEff >= 1.1) defense += 14;
    if (hp >= 5) defense += 15;
  }
  if (card.type === 'BASE') defense += 42;
  if (card.type === 'PILOT' && hp >= 2) defense += 22;
  if (hasBlocker) defense += 34;
  if (hasRepair) defense += 32;
  if (eff.includes('shield') || eff.includes('recover')) defense += 16;

  // Tempo / Resource
  if (lv <= 3 && cost <= 2) tempo += 34;
  else if (lv <= 4 && cost <= 3) tempo += 20;
  if (hasRamp) tempo += 42;
  if (eff.includes('deploy 1') || eff.includes('play 1')) tempo += 25;
  if (eff.includes('set 1 of your') && eff.includes('active')) tempo += 24;

  // Card Liquidity
  if (hasDraw) liquidity += 48;
  if (hasSearch) liquidity += 34;
  if (eff.includes('【burst】') && (hasDraw || eff.includes('hand'))) liquidity += 18;
  if (eff.includes('trash') && eff.includes('hand')) liquidity += 16;

  // Synergy / Link
  if (card.link) synergy += 26;
  if (card.type === 'PILOT') synergy += 32;
  if (hasPairTrigger) synergy += 28;
  if (hasSupport) synergy += 24;
  if (card.traits.length > 0 && /\([a-z0-9 ]+\)\s*unit/i.test(card.effect)) synergy += 22;

  // Control / Disruption
  if (card.type === 'COMMAND') control += 30;
  if (hasRest) control += 30;
  if (hasRemoval) control += 34;
  if (eff.includes('【burst】') && (hasRest || hasRemoval)) control += 16;
  if (eff.includes('cannot attack') || eff.includes('choose 1 enemy')) control += 18;

  return {
    aggro: clamp(aggro),
    defense: clamp(defense),
    tempo: clamp(tempo),
    liquidity: clamp(liquidity),
    synergy: clamp(synergy),
    control: clamp(control),
    hasDraw,
    hasSearch,
    hasRamp,
    hasRest,
    hasRemoval,
    hasRepair,
    hasBlocker,
    hasBreach,
    hasFirstStrike,
    hasSupport,
    hasPairTrigger,
  };
}

export function computeHexagonAndBreakdowns(
  mainExpanded: { card: GundamCardPrint; qty: number }[]
): {
  hexagon: HexagonAxes;
  breakdowns: AxisBreakdown[];
  linkCoveragePct: number;
  avgCost: number;
  avgLv: number;
} {
  const totalQty = mainExpanded.reduce((s, x) => s + x.qty, 0);
  if (totalQty === 0) {
    const empty: HexagonAxes = {
      aggro: 0,
      defense: 0,
      tempo: 0,
      liquidity: 0,
      synergy: 0,
      control: 0,
    };
    return {
      hexagon: empty,
      breakdowns: [
        { key: 'aggro', label: 'Aggro / Pressure', score: 0, summary: 'Add cards to measure attack pressure.', drivers: [] },
        { key: 'defense', label: 'Defense / Durability', score: 0, summary: 'Add cards to measure board survival.', drivers: [] },
        { key: 'tempo', label: 'Tempo / Resource', score: 0, summary: 'Add cards to measure curve & ramp.', drivers: [] },
        { key: 'liquidity', label: 'Card Liquidity', score: 0, summary: 'Add cards to measure draw & filtering.', drivers: [] },
        { key: 'synergy', label: 'Synergy / Link', score: 0, summary: 'Add cards to measure Link & trait synergy.', drivers: [] },
        { key: 'control', label: 'Control / Disruption', score: 0, summary: 'Add cards to measure removal & Commands.', drivers: [] },
      ],
      linkCoveragePct: 0,
      avgCost: 0,
      avgLv: 0,
    };
  }

  let aggroSum = 0;
  let defenseSum = 0;
  let tempoSum = 0;
  let liquidityCount = 0;
  let searchCount = 0;
  let rampCount = 0;
  let breachCount = 0;
  let firstStrikeCount = 0;
  let blockerCount = 0;
  let repairCount = 0;
  let baseCount = 0;
  let commandCount = 0;
  let disruptionCount = 0;
  let supportCount = 0;
  let earlyDropCount = 0;
  let costSum = 0;
  let lvSum = 0;
  let costWeight = 0;

  const units = mainExpanded.filter((x) => x.card.type === 'UNIT');
  const pilots = mainExpanded.filter((x) => x.card.type === 'PILOT');
  const traitCounts = new Map<string, number>();

  for (const { card, qty } of mainExpanded) {
    const sig = scoreSingleCardSignals(card);
    aggroSum += sig.aggro * qty;
    defenseSum += sig.defense * qty;
    tempoSum += sig.tempo * qty;

    if (sig.hasDraw) liquidityCount += qty;
    if (sig.hasSearch) searchCount += qty;
    if (sig.hasRamp) rampCount += qty;
    if (sig.hasBreach) breachCount += qty;
    if (sig.hasFirstStrike) firstStrikeCount += qty;
    if (sig.hasBlocker) blockerCount += qty;
    if (sig.hasRepair) repairCount += qty;
    if (sig.hasSupport) supportCount += qty;
    if (sig.hasRest || sig.hasRemoval) disruptionCount += qty;
    if (card.type === 'BASE') baseCount += qty;
    if (card.type === 'COMMAND') commandCount += qty;
    if ((card.cost ?? 99) <= 2 && card.type === 'UNIT') earlyDropCount += qty;

    if (card.cost !== null) {
      costSum += card.cost * qty;
      costWeight += qty;
    }
    if (card.lv !== null) {
      lvSum += card.lv * qty;
    }
    for (const tr of card.traits) {
      traitCounts.set(tr, (traitCounts.get(tr) ?? 0) + qty);
    }
  }

  // Link coverage: % of Link-capable Units that have at least one matching Pilot in the deck
  let linkUnitsQty = 0;
  let linkedUnitsQty = 0;
  for (const { card: u, qty } of units) {
    if (u.link) {
      linkUnitsQty += qty;
      const hasMatch = pilots.some(({ card: p }) => doesPilotLinkUnit(p, u));
      if (hasMatch) linkedUnitsQty += qty;
    }
  }
  const linkCoveragePct = linkUnitsQty > 0 ? Math.round((linkedUnitsQty / linkUnitsQty) * 100) : 0;

  const topTraitCount = Math.max(0, ...traitCounts.values());
  const avgCost = costWeight > 0 ? Number((costSum / costWeight).toFixed(2)) : 0;
  const avgLv = costWeight > 0 ? Number((lvSum / costWeight).toFixed(2)) : 0;

  // Normalize each axis to 0-100 calibrated around 50-card tournament decks
  const norm = totalQty;
  const aggro = clamp(
    (aggroSum / norm) * 1.45 + (earlyDropCount / norm) * 35 + ((breachCount + firstStrikeCount) / norm) * 40
  );
  const defense = clamp(
    (defenseSum / norm) * 1.45 + ((blockerCount + repairCount) / norm) * 45 + (baseCount / norm) * 35
  );
  const tempo = clamp(
    (tempoSum / norm) * 1.3 +
      (earlyDropCount / norm) * 45 +
      (rampCount / norm) * 55 +
      Math.max(0, 32 - Math.abs(avgCost - 2.3) * 16)
  );
  const liquidity = clamp(
    (liquidityCount / norm) * 160 + (searchCount / norm) * 120 + (supportCount / norm) * 20
  );
  const synergy = clamp(
    (linkCoveragePct * 0.45) +
      (pilots.reduce((s, p) => s + p.qty, 0) / norm) * 90 +
      (topTraitCount / norm) * 48 +
      (supportCount / norm) * 40
  );
  const control = clamp(
    (disruptionCount / norm) * 155 + (commandCount / norm) * 70
  );

  const hexagon: HexagonAxes = { aggro, defense, tempo, liquidity, synergy, control };

  const breakdowns: AxisBreakdown[] = [
    {
      key: 'aggro',
      label: 'Aggro / Pressure',
      score: aggro,
      summary:
        aggro >= 70
          ? 'High early pressure and lethal shield-push potential.'
          : aggro >= 45
          ? 'Balanced offensive output across mid-turns.'
          : 'Low early aggression; relies on stabilizing first.',
      drivers: [
        `${earlyDropCount} low-cost (≤2) Units`,
        `${breachCount} <Breach> / ${firstStrikeCount} <First Strike> threats`,
      ],
    },
    {
      key: 'defense',
      label: 'Defense / Durability',
      score: defense,
      summary:
        defense >= 70
          ? 'Fortified defensive shell capable of absorbing sustained attacks.'
          : defense >= 45
          ? 'Adequate defensive tools for trading efficiently.'
          : 'Vulnerable to wide aggro rushes without blockers or healing.',
      drivers: [
        `${blockerCount} <Blocker> / ${repairCount} <Repair> cards`,
        `${baseCount} Base cards protecting Shields`,
      ],
    },
    {
      key: 'tempo',
      label: 'Tempo / Resource',
      score: tempo,
      summary:
        tempo >= 70
          ? 'Smooth curve with strong early deployments or resource acceleration.'
          : tempo >= 45
          ? 'Standard turn-by-turn resource deployment.'
          : 'Heavy top-end curve risks clunky early turns.',
      drivers: [
        `Avg Cost ${avgCost} · Avg Lv. ${avgLv}`,
        `${rampCount} Resource ramp / cost-cheat cards`,
      ],
    },
    {
      key: 'liquidity',
      label: 'Card Liquidity',
      score: liquidity,
      summary:
        liquidity >= 70
          ? 'Strong draw & filtering velocity keeps hand stocked through long games.'
          : liquidity >= 40
          ? 'Moderate draw/search consistency to find key pieces.'
          : 'Low draw power — vulnerable to running out of gas after Turn 5.',
      drivers: [
        `${liquidityCount} direct draw / hand-add cards`,
        `${searchCount} deck look / search / trash-recursion cards`,
      ],
    },
    {
      key: 'synergy',
      label: 'Synergy / Link',
      score: synergy,
      summary:
        synergy >= 70
          ? 'Tightly woven Pilot–Unit Link network and faction cohesion.'
          : synergy >= 45
          ? 'Solid core pairings with room for tighter trait alignment.'
          : 'Low Link alignment; cards operate mostly individually.',
      drivers: [
        `${linkCoveragePct}% of Link Units matched with Pilots`,
        `${pilots.reduce((s, p) => s + p.qty, 0)} Pilots · Top trait count ${topTraitCount}`,
      ],
    },
    {
      key: 'control',
      label: 'Control / Disruption',
      score: control,
      summary:
        control >= 70
          ? 'Heavy interactive toolkit that disrupts opponent boards and tempo.'
          : control >= 40
          ? 'Selective removal and combat tricks.'
          : 'Minimal opponent interaction; races instead of controlling.',
      drivers: [
        `${disruptionCount} Rest / Damage / Removal effects`,
        `${commandCount} Command cards`,
      ],
    },
  ];

  return { hexagon, breakdowns, linkCoveragePct, avgCost, avgLv };
}

function classifyPacingAndStyle(
  hexagon: HexagonAxes,
  avgCost: number,
  avgLv: number,
  mainExpanded: { card: GundamCardPrint; qty: number }[]
): { pacing: PacingTier; styles: TacticalStyleTag[] } {
  const totalQty = Math.max(1, mainExpanded.reduce((s, x) => s + x.qty, 0));
  const rampCount = mainExpanded
    .filter((x) => scoreSingleCardSignals(x.card).hasRamp)
    .reduce((s, x) => s + x.qty, 0);
  const earlyUnits = mainExpanded
    .filter((x) => x.card.type === 'UNIT' && (x.card.cost ?? 9) <= 2)
    .reduce((s, x) => s + x.qty, 0);

  let pacing: PacingTier = 'Midrange Tempo';
  if (rampCount >= 6 && avgCost >= 2.6) {
    pacing = 'Ramp / Combo';
  } else if (avgCost <= 2.25 && earlyUnits / totalQty >= 0.24 && hexagon.aggro >= 58) {
    pacing = 'Early Rush';
  } else if (avgCost >= 2.85 || (hexagon.control >= 62 && hexagon.defense >= 55)) {
    pacing = 'Late-Game Control';
  }

  const styles: TacticalStyleTag[] = [];
  const breachCount = mainExpanded
    .filter((x) => scoreSingleCardSignals(x.card).hasBreach)
    .reduce((s, x) => s + x.qty, 0);
  const repairCount = mainExpanded
    .filter((x) => scoreSingleCardSignals(x.card).hasRepair)
    .reduce((s, x) => s + x.qty, 0);

  if (hexagon.synergy >= 62) styles.push('Link-Strike');
  if (hexagon.liquidity >= 58) styles.push('High-Liquidity Draw');
  if (repairCount >= 6 || hexagon.defense >= 65) styles.push('Repair Fortress');
  if (breachCount >= 6 || (hexagon.aggro >= 65 && avgCost <= 2.4)) styles.push('Shield Breach');
  if (earlyUnits >= 14 && avgLv <= 3.3) styles.push('Wide Swarm');
  if (hexagon.control >= 60) styles.push('Command Control');
  if (rampCount >= 6) styles.push('Resource Ramp');
  if (styles.length === 0) styles.push('Balanced Midrange');

  return { pacing, styles: styles.slice(0, 3) };
}

export interface MetaArchetype {
  name: string;
  colors: CardColor[];
  pacing: PacingTier;
  hexagon: HexagonAxes;
  threatNote: string;
}

export const META_ARCHETYPES: MetaArchetype[] = [
  {
    name: 'Red/Green Zeon Aggro Rush',
    colors: ['Red', 'Green'],
    pacing: 'Early Rush',
    hexagon: { aggro: 88, defense: 38, tempo: 84, liquidity: 36, synergy: 62, control: 42 },
    threatNote: 'Floods low-cost Units on Turns 1–3 and pushes lethal before slow hands stabilize.',
  },
  {
    name: 'Blue/White Link Control',
    colors: ['Blue', 'White'],
    pacing: 'Late-Game Control',
    hexagon: { aggro: 44, defense: 78, tempo: 56, liquidity: 76, synergy: 82, control: 84 },
    threatNote: 'Stacks <Repair> / <Blocker>, draws deeply, and locks combat with Rest Commands.',
  },
  {
    name: 'Green Resource Ramp & Titans',
    colors: ['Green'],
    pacing: 'Ramp / Combo',
    hexagon: { aggro: 62, defense: 60, tempo: 86, liquidity: 48, synergy: 58, control: 46 },
    threatNote: 'Accelerates Resources to deploy Lv.5–7 boss Units 1–2 turns ahead of curve.',
  },
  {
    name: 'White/Red SEED Midrange',
    colors: ['White', 'Red'],
    pacing: 'Midrange Tempo',
    hexagon: { aggro: 70, defense: 62, tempo: 68, liquidity: 58, synergy: 76, control: 62 },
    threatNote: 'Combines efficient Linked Units with flexible combat tricks and Burst shields.',
  },
  {
    name: 'Blue/Green Repair Fortress',
    colors: ['Blue', 'Green'],
    pacing: 'Late-Game Control',
    hexagon: { aggro: 40, defense: 90, tempo: 58, liquidity: 68, synergy: 64, control: 64 },
    threatNote: 'Grinds out attackers with <Repair>, high-HP Bases, and end-of-turn recovery.',
  },
  {
    name: 'Purple/Red Disruption Engine',
    colors: ['Purple', 'Red'],
    pacing: 'Midrange Tempo',
    hexagon: { aggro: 66, defense: 45, tempo: 60, liquidity: 62, synergy: 60, control: 86 },
    threatNote: 'Punishes wide boards with direct damage, AP debuffs, and Trash recursion.',
  },
];

export function evaluateMatchupBetween(
  myName: string,
  myHex: HexagonAxes,
  myPacing: PacingTier,
  oppName: string,
  oppColors: CardColor[],
  oppPacing: PacingTier,
  oppHex: HexagonAxes
): MatchupAssessment {
  // Rock-paper-scissors & axis edge model
  let edge = 0;

  // Offense vs Defense checks
  edge += (myHex.aggro - oppHex.defense) * 0.22;
  edge += (myHex.defense - oppHex.aggro) * 0.22;
  // Resource & Liquidity battle
  edge += (myHex.liquidity - oppHex.liquidity) * 0.25;
  edge += (myHex.tempo - oppHex.tempo) * 0.16;
  // Synergy vs Disruption battle
  edge += (myHex.synergy - oppHex.control) * 0.18;
  edge += (myHex.control - oppHex.synergy) * 0.18;

  // Pacing interaction adjustments
  if (myPacing === 'Early Rush' && oppPacing === 'Ramp / Combo') edge += 10;
  if (myPacing === 'Late-Game Control' && oppPacing === 'Early Rush') {
    edge += myHex.defense >= 65 ? 8 : -10;
  }
  if (myPacing === 'Ramp / Combo' && oppPacing === 'Late-Game Control') edge += 6;

  // Convert edge (-40..+40) into difficulty 1..5 (5 = hardest matchup for player)
  let difficultyScore = 3;
  let verdict: MatchupAssessment['verdict'] = 'Even';
  if (edge >= 14) {
    difficultyScore = 1;
    verdict = 'Favored';
  } else if (edge >= 5) {
    difficultyScore = 2;
    verdict = 'Slightly Favored';
  } else if (edge > -5) {
    difficultyScore = 3;
    verdict = 'Even';
  } else if (edge > -14) {
    difficultyScore = 4;
    verdict = 'Challenging';
  } else {
    difficultyScore = 5;
    verdict = 'Hard Matchup';
  }

  const advantages: string[] = [];
  const risks: string[] = [];

  if (myHex.liquidity - oppHex.liquidity >= 10) {
    advantages.push(`Higher Card Liquidity (+${myHex.liquidity - oppHex.liquidity}) lets you out-draw in long trades.`);
  } else if (oppHex.liquidity - myHex.liquidity >= 10) {
    risks.push(`Opponent out-draws you (${oppHex.liquidity} vs ${myHex.liquidity} Liquidity) if the game stalls.`);
  }

  if (myHex.aggro - oppHex.defense >= 10) {
    advantages.push(`Your Aggro (${myHex.aggro}) outpaces their Defense (${oppHex.defense}); pressure Shields early.`);
  } else if (oppHex.aggro - myHex.defense >= 10) {
    risks.push(`Their early pressure (${oppHex.aggro} Aggro) threatens your ${myHex.defense} Defense score.`);
  }

  if (myHex.control - oppHex.synergy >= 10) {
    advantages.push(`Your Control (${myHex.control}) disrupts their Link-reliant board before pairs stick.`);
  } else if (oppHex.control - myHex.synergy >= 12 && myHex.synergy >= 55) {
    risks.push(`Watch for Commands/Rest effects breaking your key Pilot–Unit Link turns.`);
  }

  if (advantages.length === 0) {
    advantages.push(`${myName} competes evenly on curve and board trades.`);
  }
  if (risks.length === 0) {
    risks.push(`Avoid overextending into ${oppName}'s Burst shields.`);
  }

  let keyTip = `Play around ${oppName}'s peak turn and protect your highest-value Link Units.`;
  if (oppPacing === 'Early Rush') {
    keyTip = 'Mulligan aggressively for Lv.1–3 Units, Blockers, or early removal to survive Turn 2–3.';
  } else if (oppPacing === 'Late-Game Control') {
    keyTip = 'Leverage your Card Liquidity or multi-threat turns so single Rest/Destroy Commands cannot lock you out.';
  } else if (oppPacing === 'Ramp / Combo') {
    keyTip = 'Attack Shields before they reach Lv.5–6 Resource thresholds.';
  }

  return {
    opponentName: oppName,
    opponentColors: oppColors,
    opponentPacing: oppPacing,
    opponentHexagon: oppHex,
    difficultyScore,
    verdict,
    advantages,
    risks,
    keyTip,
  };
}

function generateDeckPlaybook(
  mainExpanded: { card: GundamCardPrint; qty: number }[],
  hexagon: HexagonAxes,
  pacing: PacingTier,
  styles: TacticalStyleTag[]
): DeckPlaybook {
  const totalMain = mainExpanded.reduce((s, x) => s + x.qty, 0);
  const allCards = mainExpanded.map((x) => x.card);

  const earlyUnits = mainExpanded.filter((x) => x.card.type === 'UNIT' && (x.card.cost ?? 9) <= 2);
  const midUnits = mainExpanded.filter(
    (x) => x.card.type === 'UNIT' && (x.card.cost ?? 0) >= 3 && (x.card.cost ?? 0) <= 4
  );
  const heavyCards = mainExpanded.filter((x) => (x.card.lv ?? 0) >= 5 || (x.card.cost ?? 0) >= 4);
  const pilots = mainExpanded.filter((x) => x.card.type === 'PILOT');
  const units = mainExpanded.filter((x) => x.card.type === 'UNIT');
  const bases = mainExpanded.filter((x) => x.card.type === 'BASE');
  const commands = mainExpanded.filter((x) => x.card.type === 'COMMAND');
  const liquidityCards = mainExpanded.filter((x) => {
    const sig = scoreSingleCardSignals(x.card);
    return sig.hasDraw || sig.hasSearch;
  });

  // Detect Link pairs
  const linkCombos: DetectedCombo[] = [];
  const seenPairs = new Set<string>();
  for (const { card: u } of units) {
    if (!u.link) continue;
    for (const { card: p } of pilots) {
      if (doesPilotLinkUnit(p, u)) {
        const key = `${u.cardNo}+${p.cardNo}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          const totalAp = (u.ap ?? 0) + (p.ap ?? 0);
          const totalHp = (u.hp ?? 0) + (p.hp ?? 0);
          linkCombos.push({
            title: `${u.name} + ${p.name}`,
            category: 'Link Pair',
            cards: [u, p],
            description: `Links into a ${totalAp} AP / ${totalHp} HP unit (${u.link}). Triggers both Unit and Pilot Link abilities immediately.`,
          });
        }
      }
    }
  }

  // Detect Trait synergies
  const traitCombos: DetectedCombo[] = [];
  for (const { card } of mainExpanded) {
    const m = card.effect.match(/\(([A-Za-z0-9 '&-]+)\)\s*Unit/i);
    if (m) {
      const targetTrait = m[1].trim();
      const partners = units
        .map((x) => x.card)
        .filter(
          (u) =>
            u.cardNo !== card.cardNo &&
            u.traits.some((t) => t.toLowerCase() === targetTrait.toLowerCase())
        );
      if (partners.length > 0 && traitCombos.length < 4) {
        traitCombos.push({
          title: `(${targetTrait}) Formation`,
          category: 'Trait Synergy',
          cards: [card, ...partners.slice(0, 2)],
          description: `${card.name} buffs or deploys (${targetTrait}) Units (${partners.length} distinct matching targets in deck).`,
        });
      }
    }
  }

  // Detect Mechanic chains (Rest + Punish, Support + Attackers, Base + Unit)
  const mechanicCombos: DetectedCombo[] = [];
  const restCards = mainExpanded.filter((x) => scoreSingleCardSignals(x.card).hasRest).map((x) => x.card);
  const breachCards = mainExpanded.filter((x) => scoreSingleCardSignals(x.card).hasBreach).map((x) => x.card);
  const supportCards = mainExpanded.filter((x) => scoreSingleCardSignals(x.card).hasSupport).map((x) => x.card);

  if (restCards.length > 0 && (breachCards.length > 0 || units.length > 0)) {
    const attacker = breachCards[0] ?? units[0]?.card;
    if (attacker) {
      mechanicCombos.push({
        title: `Rest & Punish (${restCards[0].name} → ${attacker.name})`,
        category: 'Mechanic Chain',
        cards: [restCards[0], attacker],
        description: `Rest opposing blockers/threats with ${restCards[0].name} so ${attacker.name} swings cleanly into rested targets or Shields.`,
      });
    }
  }
  if (supportCards.length > 0 && units.length > 1) {
    const finisher = units.find((u) => u.card.cardNo !== supportCards[0].cardNo)?.card;
    if (finisher) {
      mechanicCombos.push({
        title: `<Support> Boost (${supportCards[0].name} → ${finisher.name})`,
        category: 'Mechanic Chain',
        cards: [supportCards[0], finisher],
        description: `Tap ${supportCards[0].name} during Main Phase to amplify ${finisher.name}'s AP for favorable trades or shield pressure.`,
      });
    }
  }

  const combos = [...linkCombos.slice(0, 6), ...traitCombos.slice(0, 3), ...mechanicCombos.slice(0, 3)];

  // Hypergeometric odds for a 5-card opening hand
  const earlyCount = earlyUnits.reduce((s, x) => s + x.qty, 0);
  const drawCount = liquidityCards.reduce((s, x) => s + x.qty, 0);
  const linkUnitCount = units.filter((u) => u.card.link && pilots.some((p) => doesPilotLinkUnit(p.card, u.card))).reduce((s, x) => s + x.qty, 0);
  const pilotCount = pilots.reduce((s, x) => s + x.qty, 0);

  const pop = Math.max(50, totalMain);
  const earlyPlayablePct = Math.round(hypergeometricAtLeast(pop, earlyCount, 5, 1) * 100);
  const drawEnginePct = Math.round(hypergeometricAtLeast(pop, drawCount, 5, 1) * 100);
  const linkPairPct = Math.round(
    hypergeometricAtLeast(pop, linkUnitCount, 5, 1) * hypergeometricAtLeast(pop, pilotCount, 5, 1) * 100
  );

  // Best starting hand (5 cards)
  const bestCards: GundamCardPrint[] = [];
  if (earlyUnits[0]) bestCards.push(earlyUnits[0].card);
  if (earlyUnits[1] && bestCards.length < 5) bestCards.push(earlyUnits[1].card);
  if (linkCombos[0]) {
    for (const c of linkCombos[0].cards) {
      if (bestCards.length < 5) bestCards.push(c);
    }
  }
  if (liquidityCards[0] && bestCards.length < 5) bestCards.push(liquidityCards[0].card);
  if (bases[0] && bestCards.length < 5) bestCards.push(bases[0].card);
  for (const c of allCards) {
    if (bestCards.length >= 5) break;
    if (!bestCards.some((b) => b.cardNo === c.cardNo)) bestCards.push(c);
  }

  // Worst starting hand (5 cards: high-Lv bricks, duplicate pilots/commands without units)
  const brickPool = [...heavyCards, ...commands, ...pilots, ...bases]
    .sort((a, b) => (b.card.lv ?? 0) - (a.card.lv ?? 0))
    .map((x) => x.card);
  const worstCards: GundamCardPrint[] = [];
  for (const c of brickPool) {
    if (worstCards.length >= 5) break;
    worstCards.push(c);
  }
  for (const c of [...allCards].reverse()) {
    if (worstCards.length >= 5) break;
    worstCards.push(c);
  }

  // Mulligan Criteria tailored to Pacing
  const keepRules: string[] = [
    earlyCount > 0
      ? 'Keep if you open at least 1–2 playable Units with Cost ≤ 2 (or Lv. ≤ 3) to establish early board presence.'
      : 'Keep if you open your lowest-cost Units (Cost ≤ 3) plus a Resource or Base card.',
  ];
  if (liquidityCards.length > 0) {
    keepRules.push('Keep hands pairing an early Unit with a Card Liquidity card (draw/search) to smooth midgame turns.');
  }
  if (linkCombos.length > 0) {
    keepRules.push(`Keep if you hold a matching Link pair (${linkCombos[0].title}) alongside a playable Turn 2–3 curve.`);
  }
  if (pacing === 'Ramp / Combo') {
    keepRules.push('Prioritize keeping any Resource ramp card to hit Lv. 5–6 ahead of schedule.');
  }

  const redrawRules: string[] = [
    'Mulligan any 5-card hand with zero Cost ≤ 3 Units (high brick risk on Turns 1–2).',
    'Mulligan Pilot-heavy or Command-only hands (3+ Pilots/Commands with ≤1 Unit).',
    'Mulligan hands with 3+ cards costing 4 or higher unless backed by Resource acceleration.',
  ];

  // Objective & Advantage
  let primaryObjective = 'Control board tempo through efficient trades and Linked Unit spikes, then close out Shields.';
  let advantageMechanism = 'Balanced card-for-card value and timely Pilot pairings.';
  if (styles.includes('Shield Breach') || pacing === 'Early Rush') {
    primaryObjective = 'Apply relentless Turn 1–4 Shield pressure using low-cost attackers and <Breach> / <First Strike>.';
    advantageMechanism = 'Forces opponents into unfavorable blocks before their high-Lv Units come online.';
  } else if (styles.includes('High-Liquidity Draw')) {
    primaryObjective = 'Out-resource the opponent via superior Card Liquidity, never missing land/resource curve drops.';
    advantageMechanism = 'Continuous draw & deck filtering generates +2 to +4 card advantage by midgame.';
  } else if (styles.includes('Repair Fortress')) {
    primaryObjective = 'Stabilize the board with <Blocker> and <Repair> Units, turning combat damage into free attrition.';
    advantageMechanism = 'Opponent runs out of attackers while your Units heal back to full HP every end step.';
  } else if (styles.includes('Link-Strike')) {
    primaryObjective = 'Assemble Link Unit + Pilot pairs to trigger massive 【When Linked】 swing turns.';
    advantageMechanism = 'Combined Unit+Pilot stats and dual triggers create 2-for-1 tempo swings.';
  } else if (styles.includes('Command Control')) {
    primaryObjective = 'Neutralize opposing Units with Rest, Damage, and removal Commands before deploying finishers.';
    advantageMechanism = 'Denies opponent Link payoffs and clears defenders for safe lethal pushes.';
  }

  // Critical Turns Timeline
  const t1Cards = earlyUnits.slice(0, 3).map((x) => x.card);
  const pivotCards = [
    ...(linkCombos[0]?.cards ?? []),
    ...midUnits.slice(0, 2).map((x) => x.card),
  ].slice(0, 4);
  const finisherCards = heavyCards.slice(0, 4).map((x) => x.card);

  const criticalTurns: CriticalTurnPoint[] = [
    {
      turnLabel: 'Turns 1–2 (Deployment)',
      levelWindow: 'Lv. 1–2 · 1–2 Resources',
      objective:
        pacing === 'Early Rush'
          ? 'Stick 1–2 low-cost attackers immediately and chip early Shields.'
          : 'Establish a cheap Unit or Base and dig with early Card Liquidity tools.',
      keyCards: t1Cards,
    },
    {
      turnLabel: 'Turn 3–4 (Pivot / First Link)',
      levelWindow: 'Lv. 3–4 · 3–4 Resources',
      objective:
        linkCombos.length > 0
          ? 'First major Link inflection turn: pair a Pilot onto a Lv.3–4 Unit for a board swing.'
          : 'Transition into mid-tier Units and hold Command interaction for enemy threats.',
      keyCards: pivotCards,
    },
    {
      turnLabel: 'Turn 5+ (Finisher / Lockout)',
      levelWindow: 'Lv. 5+ · 5+ Resources',
      objective:
        hexagon.control >= 60
          ? 'Lock down opposing Units with heavy Commands/bosses and close remaining Shields.'
          : 'Deploy top-end boss Units and push lethal through <Breach> or wide attacks.',
      keyCards: finisherCards,
    },
  ];

  return {
    primaryObjective,
    advantageMechanism,
    bestStartingHand: {
      title: 'Optimal 5-Card Opener',
      cards: bestCards.slice(0, 5),
      explanation:
        'Smooth Turn 1–3 deployment, immediate synergy or Card Liquidity follow-up, and zero dead high-cost bricks.',
    },
    worstStartingHand: {
      title: 'Worst-Case Bricked Opener',
      cards: worstCards.slice(0, 5),
      explanation:
        'Stranded high-Lv cards, reactive Commands, or unpaired Pilots with no early Unit board presence — automatic Mulligan.',
    },
    odds: {
      earlyPlayablePct,
      drawEnginePct,
      linkPairPct,
    },
    mulliganCriteria: {
      keepRules,
      redrawRules,
    },
    criticalTurns,
    combos,
  };
}

export function gradeSimulatedHand(
  hand: GundamCardPrint[],
  deckPacing: PacingTier,
  deckCards: GundamCardPrint[]
): HandVerdict {
  if (hand.length === 0) {
    return { status: 'Mulligan', score: 0, reasons: ['No cards drawn.'] };
  }

  let score = 50;
  const reasons: string[] = [];

  const units = hand.filter((c) => c.type === 'UNIT');
  const earlyUnits = units.filter((c) => (c.cost ?? 9) <= 2);
  const midUnits = units.filter((c) => (c.cost ?? 9) === 3);
  const pilots = hand.filter((c) => c.type === 'PILOT');
  const heavy = hand.filter((c) => (c.cost ?? 0) >= 4 || (c.lv ?? 0) >= 5);
  const liquidity = hand.filter((c) => {
    const s = scoreSingleCardSignals(c);
    return s.hasDraw || s.hasSearch;
  });
  const ramps = hand.filter((c) => scoreSingleCardSignals(c).hasRamp);

  if (earlyUnits.length >= 1 && earlyUnits.length <= 3) {
    score += 22;
    reasons.push(`Has ${earlyUnits.length} early Unit(s) (Cost ≤ 2) for Turn 1–2 board presence.`);
  } else if (earlyUnits.length === 0 && midUnits.length === 0) {
    score -= 32;
    reasons.push('Zero early Units (Cost ≤ 3) — risks skipping early turns.');
  } else if (earlyUnits.length === 0 && midUnits.length >= 1) {
    score -= 6;
    reasons.push('No Cost 1–2 play, relies on Turn 3 Cost 3 Unit.');
  }

  if (units.length === 0) {
    score -= 35;
    reasons.push('No Units in opening 5 cards.');
  }

  if (pilots.length >= 3) {
    score -= 18;
    reasons.push(`Pilot flood (${pilots.length} Pilots) with too few Units to pair onto.`);
  } else {
    const hasLink = units.some((u) => pilots.some((p) => doesPilotLinkUnit(p, u)));
    if (hasLink) {
      score += 18;
      reasons.push('Contains a natural Pilot + Unit Link pair ready for midgame swing.');
    }
  }

  if (liquidity.length > 0) {
    score += 12;
    reasons.push(`Includes Card Liquidity (${liquidity[0].name}) to smooth draws.`);
  }

  if (deckPacing === 'Ramp / Combo' && ramps.length > 0) {
    score += 15;
    reasons.push(`Hits Resource acceleration (${ramps[0].name}).`);
  }

  if (heavy.length >= 3) {
    score -= 22;
    reasons.push(`Too top-heavy (${heavy.length} cards at Lv.5+ / Cost 4+).`);
  }

  // Also check if deck actually has early units so we don't penalize unfairly
  const deckEarlyCount = deckCards.filter((c) => c.type === 'UNIT' && (c.cost ?? 9) <= 2).length;
  if (deckEarlyCount === 0 && earlyUnits.length === 0) {
    score += 10;
  }

  const finalScore = clamp(score);
  let status: HandVerdict['status'] = 'Borderline';
  if (finalScore >= 65) status = 'Keep';
  else if (finalScore < 45) status = 'Mulligan';

  return { status, score: finalScore, reasons };
}

export function analyzeDeck(
  deck: SavedDeck,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): DeckAnalysis {
  const validation = validateDeck(deck, byPrintId, byCardNo);
  const mainExpanded = expandEntries(deck.mainDeck, byPrintId, byCardNo);

  const { hexagon, breakdowns, linkCoveragePct, avgCost, avgLv } =
    computeHexagonAndBreakdowns(mainExpanded);
  const { pacing, styles } = classifyPacingAndStyle(hexagon, avgCost, avgLv, mainExpanded);

  // Strengths & Weaknesses
  const sortedAxes = [...breakdowns].sort((a, b) => b.score - a.score);
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const ax of sortedAxes.slice(0, 2)) {
    if (ax.score >= 55) strengths.push(`${ax.label} (${ax.score}/100): ${ax.summary}`);
  }
  if (linkCoveragePct >= 75) {
    strengths.push(`High Link Alignment (${linkCoveragePct}% of Link Units have matching Pilots).`);
  }
  if (strengths.length === 0 && mainExpanded.length > 0) {
    strengths.push('Balanced all-around profile without over-committing to a single gimmick.');
  }

  for (const ax of [...sortedAxes].reverse().slice(0, 2)) {
    if (ax.score <= 42) weaknesses.push(`Low ${ax.label} (${ax.score}/100): ${ax.summary}`);
  }
  if (validation.mainCount >= 20 && linkCoveragePct < 50) {
    weaknesses.push(`Unpaired Link Units (${linkCoveragePct}% Pilot match rate); consider adding matching Pilots.`);
  }
  if (weaknesses.length === 0 && mainExpanded.length > 0) {
    weaknesses.push('No critical structural weak axis detected; fine-tune curve ratios for target matchups.');
  }

  // Curves & splits
  const costBuckets: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6+': 0 };
  const lvBuckets: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7+': 0 };
  const typeCounts: Record<string, number> = { UNIT: 0, PILOT: 0, COMMAND: 0, BASE: 0 };
  const colorCounts = new Map<CardColor, number>();

  for (const { card, qty } of mainExpanded) {
    const c = card.cost ?? 0;
    const ck = c >= 6 ? '6+' : String(Math.max(0, c));
    costBuckets[ck] = (costBuckets[ck] ?? 0) + qty;

    const l = card.lv ?? 1;
    const lk = l >= 7 ? '7+' : String(Math.max(1, l));
    lvBuckets[lk] = (lvBuckets[lk] ?? 0) + qty;

    typeCounts[card.type] = (typeCounts[card.type] ?? 0) + qty;
    colorCounts.set(card.color, (colorCounts.get(card.color) ?? 0) + qty);
  }

  const costCurve = Object.entries(costBuckets).map(([cost, count]) => ({ cost, count }));
  const lvCurve = Object.entries(lvBuckets).map(([lv, count]) => ({ lv, count }));
  const typeSplit = Object.entries(typeCounts).map(([type, count]) => ({ type, count }));
  const colorSplit = [...colorCounts.entries()].map(([color, count]) => ({ color, count }));

  const matchups = META_ARCHETYPES.map((arch) =>
    evaluateMatchupBetween(
      deck.name,
      hexagon,
      pacing,
      arch.name,
      arch.colors,
      arch.pacing,
      arch.hexagon
    )
  );

  const playbook = generateDeckPlaybook(mainExpanded, hexagon, pacing, styles);

  return {
    validation,
    hexagon,
    breakdowns,
    pacing,
    styles,
    strengths,
    weaknesses,
    avgCost,
    avgLv,
    costCurve,
    lvCurve,
    typeSplit,
    colorSplit,
    linkCoveragePct,
    matchups,
    playbook,
  };
}

export function getRecommendedCardsForStrategy(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint,
  currentEntries: DeckEntry[],
  limit = 24
): { card: GundamCardPrint; fitScore: number; reason: string }[] {
  const uniqueBase = new Map<string, GundamCardPrint>();
  for (const c of allCards) {
    if (!MAIN_DECK_TYPES.has(c.type)) continue;
    const existing = uniqueBase.get(c.cardNo);
    if (!existing || (existing.isParallel && !c.isParallel)) {
      uniqueBase.set(c.cardNo, c);
    }
  }

  const allowedColors = new Set(blueprint.colors);
  const currentCounts = new Map<string, number>();
  const currentCards: GundamCardPrint[] = [];
  for (const e of currentEntries) {
    currentCounts.set(e.cardNo, (currentCounts.get(e.cardNo) ?? 0) + e.qty);
    const c = uniqueBase.get(e.cardNo);
    if (c) currentCards.push(c);
  }

  const currentUnits = currentCards.filter((c) => c.type === 'UNIT');
  const currentPilots = currentCards.filter((c) => c.type === 'PILOT');

  const scored: { card: GundamCardPrint; fitScore: number; reason: string }[] = [];

  for (const card of uniqueBase.values()) {
    if (allowedColors.size > 0 && card.color !== 'Colorless' && !allowedColors.has(card.color)) {
      continue;
    }
    if ((currentCounts.get(card.cardNo) ?? 0) >= 4) continue;

    const sig = scoreSingleCardSignals(card);
    const t = blueprint.targetHexagon;
    const totalWeight = Math.max(
      1,
      t.aggro + t.defense + t.tempo + t.liquidity + t.synergy + t.control
    );

    let fit =
      (sig.aggro * t.aggro +
        sig.defense * t.defense +
        sig.tempo * t.tempo +
        sig.liquidity * t.liquidity +
        sig.synergy * t.synergy +
        sig.control * t.control) /
      totalWeight;

    const reasons: string[] = [];

    // Pacing curve alignment
    const cost = card.cost ?? 2;
    if (blueprint.pacing === 'Early Rush') {
      if (cost <= 2) {
        fit += 18;
        reasons.push('Ideal Cost ≤ 2 Rush curve');
      } else if (cost >= 5) {
        fit -= 15;
      }
    } else if (blueprint.pacing === 'Late-Game Control') {
      if (cost >= 3 && (sig.hasRest || sig.hasRemoval || sig.hasRepair || sig.hasBlocker)) {
        fit += 16;
        reasons.push('Late-game defensive/control anchor');
      }
    } else if (blueprint.pacing === 'Ramp / Combo') {
      if (sig.hasRamp || cost >= 5) {
        fit += 16;
        reasons.push('Supports Ramp payoff');
      }
    }

    // Trait focus
    if (
      blueprint.traitFocus &&
      card.traits.some((tr) => tr.toLowerCase().includes(blueprint.traitFocus.toLowerCase()))
    ) {
      fit += 22;
      reasons.push(`Matches (${blueprint.traitFocus}) focus`);
    }

    // Link synergy with cards already in deck
    if (card.type === 'PILOT' && currentUnits.some((u) => doesPilotLinkUnit(card, u))) {
      fit += 28;
      reasons.push('Links with Units already in your deck');
    } else if (card.type === 'UNIT' && currentPilots.some((p) => doesPilotLinkUnit(p, card))) {
      fit += 24;
      reasons.push('Links with Pilots already in your deck');
    }

    if (sig.hasDraw || sig.hasSearch) {
      if (t.liquidity >= 60) fit += 14;
      reasons.push('Adds Card Liquidity');
    }

    scored.push({
      card,
      fitScore: clamp(fit),
      reason: reasons[0] ?? `${card.color} ${card.type} aligned with ${blueprint.primaryStyle}`,
    });
  }

  scored.sort((a, b) => b.fitScore - a.fitScore);
  return scored.slice(0, limit);
}

export function generateStrategyDeck(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint
): { mainDeck: DeckEntry[]; resourceDeck: DeckEntry[] } {
  const uniqueBase = new Map<string, GundamCardPrint>();
  const resourceCards: GundamCardPrint[] = [];

  for (const c of allCards) {
    if (c.type === 'RESOURCE') {
      resourceCards.push(c);
      continue;
    }
    if (!MAIN_DECK_TYPES.has(c.type)) continue;
    const existing = uniqueBase.get(c.cardNo);
    if (!existing || (existing.isParallel && !c.isParallel)) {
      uniqueBase.set(c.cardNo, c);
    }
  }

  const allowedColors = new Set(blueprint.colors.length > 0 ? blueprint.colors : ['Blue', 'White']);
  const pool = [...uniqueBase.values()].filter(
    (c) => c.color === 'Colorless' || allowedColors.has(c.color)
  );

  // Rank candidates
  const ranked = getRecommendedCardsForStrategy(pool, blueprint, [], 300);

  // Target type ratios by pacing
  const targetUnits = blueprint.pacing === 'Early Rush' ? 30 : blueprint.pacing === 'Late-Game Control' ? 24 : 26;
  const targetPilots = blueprint.primaryStyle === 'Link-Strike' ? 10 : 8;
  const targetBases = blueprint.primaryStyle === 'Repair Fortress' ? 6 : 4;
  const targetCommands = 50 - targetUnits - targetPilots - targetBases;

  const chosen = new Map<string, { card: GundamCardPrint; qty: number }>();
  let total = 0;

  const addCopies = (card: GundamCardPrint, desiredQty: number) => {
    if (total >= 50) return;
    const existing = chosen.get(card.cardNo)?.qty ?? 0;
    const room = Math.min(4 - existing, 50 - total, desiredQty);
    if (room <= 0) return;
    chosen.set(card.cardNo, { card, qty: existing + room });
    total += room;
  };

  // 1. Pick top Units respecting curve balance
  let unitTotal = 0;
  let earlyUnitTotal = 0;
  const minEarlyUnits = blueprint.pacing === 'Early Rush' ? 16 : 10;

  // First ensure early drops
  for (const { card } of ranked) {
    if (earlyUnitTotal >= minEarlyUnits || unitTotal >= targetUnits) break;
    if (card.type === 'UNIT' && (card.cost ?? 9) <= 2) {
      const q = Math.min(4, minEarlyUnits - earlyUnitTotal, targetUnits - unitTotal);
      addCopies(card, q);
      earlyUnitTotal += q;
      unitTotal += q;
    }
  }
  // Fill remaining units
  for (const { card } of ranked) {
    if (unitTotal >= targetUnits) break;
    if (card.type === 'UNIT') {
      const prev = chosen.get(card.cardNo)?.qty ?? 0;
      if (prev >= 4) continue;
      const q = Math.min(3, targetUnits - unitTotal, 4 - prev);
      addCopies(card, q);
      unitTotal += q;
    }
  }

  // 2. Pick Pilots prioritizing actual Link matches with chosen Units
  const chosenUnits = [...chosen.values()].filter((x) => x.card.type === 'UNIT').map((x) => x.card);
  const pilotRanked = ranked
    .filter((r) => r.card.type === 'PILOT')
    .map((r) => {
      const linkMatches = chosenUnits.filter((u) => doesPilotLinkUnit(r.card, u)).length;
      return { ...r, score: r.fitScore + linkMatches * 30 };
    })
    .sort((a, b) => b.score - a.score);

  let pilotTotal = 0;
  for (const { card } of pilotRanked) {
    if (pilotTotal >= targetPilots) break;
    const q = Math.min(3, targetPilots - pilotTotal);
    addCopies(card, q);
    pilotTotal += q;
  }

  // 3. Pick Bases
  let baseTotal = 0;
  for (const { card } of ranked) {
    if (baseTotal >= targetBases) break;
    if (card.type === 'BASE') {
      const q = Math.min(2, targetBases - baseTotal);
      addCopies(card, q);
      baseTotal += q;
    }
  }

  // 4. Pick Commands
  let cmdTotal = 0;
  for (const { card } of ranked) {
    if (cmdTotal >= targetCommands || total >= 50) break;
    if (card.type === 'COMMAND') {
      const q = Math.min(3, targetCommands - cmdTotal, 50 - total);
      addCopies(card, q);
      cmdTotal += q;
    }
  }

  // 5. Top off to exactly 50 if short
  for (const { card } of ranked) {
    if (total >= 50) break;
    const prev = chosen.get(card.cardNo)?.qty ?? 0;
    if (prev < 4) {
      addCopies(card, Math.min(4 - prev, 50 - total));
    }
  }

  const mainDeck: DeckEntry[] = [...chosen.values()].map(({ card, qty }) => ({
    cardNo: card.cardNo,
    printId: card.printId,
    qty,
  }));

  const defaultRes = resourceCards[0];
  const resourceDeck: DeckEntry[] = defaultRes
    ? [{ cardNo: defaultRes.cardNo, printId: defaultRes.printId, qty: 10 }]
    : [];

  return { mainDeck, resourceDeck };
}

export function exportDeckToText(
  deck: SavedDeck,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): string {
  const lines: string[] = [`// ${deck.name}`];
  lines.push('// Main Deck (50)');
  for (const entry of deck.mainDeck) {
    const card = byPrintId.get(entry.printId) ?? byCardNo.get(entry.cardNo);
    lines.push(`${entry.qty} ${entry.cardNo} ${card?.name ?? ''}`.trim());
  }
  if (deck.resourceDeck.length > 0) {
    lines.push('');
    lines.push('// Resource Deck (10)');
    for (const entry of deck.resourceDeck) {
      const card = byPrintId.get(entry.printId) ?? byCardNo.get(entry.cardNo);
      lines.push(`${entry.qty} ${entry.cardNo} ${card?.name ?? 'Resource'}`.trim());
    }
  }
  return lines.join('\n');
}

export function parseDeckFromText(
  rawText: string,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): { mainDeck: DeckEntry[]; resourceDeck: DeckEntry[]; unmatched: string[] } {
  const mainMap = new Map<string, DeckEntry>();
  const resMap = new Map<string, DeckEntry>();
  const unmatched: string[] = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // Supports "4 GD01-001 Gundam", "4x GD01-001", "GD01-001 x4", etc.
    const m1 = line.match(/^(\d+)\s*[xX×]?\s+([A-Za-z0-9_-]+)/);
    const m2 = line.match(/^([A-Za-z0-9_-]+)\s*[xX×]?\s*(\d+)$/);

    let qty = 1;
    let idToken = '';
    if (m1) {
      qty = parseInt(m1[1], 10);
      idToken = m1[2];
    } else if (m2) {
      idToken = m2[1];
      qty = parseInt(m2[2], 10);
    } else {
      idToken = line.split(/\s+/)[0];
    }

    const card = byPrintId.get(idToken) ?? byCardNo.get(idToken.toUpperCase());
    if (!card) {
      unmatched.push(line);
      continue;
    }

    const targetMap = card.type === 'RESOURCE' ? resMap : mainMap;
    const prev = targetMap.get(card.cardNo);
    targetMap.set(card.cardNo, {
      cardNo: card.cardNo,
      printId: prev?.printId ?? card.printId,
      qty: (prev?.qty ?? 0) + Math.max(1, qty),
    });
  }

  return {
    mainDeck: [...mainMap.values()],
    resourceDeck: [...resMap.values()],
    unmatched,
  };
}

export function encodeDeckShareParam(deck: SavedDeck): string {
  const compact = {
    n: deck.name,
    m: deck.mainDeck.map((e) => [e.cardNo, e.qty]),
    r: deck.resourceDeck.map((e) => [e.cardNo, e.qty]),
  };
  const json = JSON.stringify(compact);
  if (typeof window !== 'undefined') {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, 'utf-8').toString('base64');
}

export function decodeDeckShareParam(
  encoded: string,
  byCardNo: Map<string, GundamCardPrint>
): SavedDeck | null {
  try {
    const json =
      typeof window !== 'undefined'
        ? decodeURIComponent(escape(atob(encoded)))
        : Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.m)) return null;
    const mainDeck: DeckEntry[] = [];
    for (const [cardNo, qty] of parsed.m) {
      const c = byCardNo.get(cardNo);
      if (c && Number(qty) > 0) {
        mainDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: Number(qty) });
      }
    }
    const resourceDeck: DeckEntry[] = [];
    if (Array.isArray(parsed.r)) {
      for (const [cardNo, qty] of parsed.r) {
        const c = byCardNo.get(cardNo);
        if (c && Number(qty) > 0) {
          resourceDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: Number(qty) });
        }
      }
    }
    return {
      id: `shared-${Date.now()}`,
      name: String(parsed.n || 'Shared Gundam Deck'),
      updatedAt: new Date().toISOString(),
      mainDeck,
      resourceDeck,
    };
  } catch {
    return null;
  }
}

export interface StarterPresetMeta {
  code: string;
  name: string;
  colors: CardColor[];
  subtitle: string;
}

export const STARTER_PRESETS: StarterPresetMeta[] = [
  { code: 'ST01', name: 'ST01 Heroic Beginnings', colors: ['Blue', 'White'], subtitle: 'White Base Repair & Link Control' },
  { code: 'ST02', name: 'ST02 Wings of Advance', colors: ['Green', 'Blue'], subtitle: 'Operation Meteor Ramp & Tempo' },
  { code: 'ST03', name: "ST03 Zeon's Rush", colors: ['Red', 'Green'], subtitle: 'Zeon Aggro & Early Breach' },
  { code: 'ST04', name: 'ST04 SEED Strike', colors: ['White', 'Red'], subtitle: 'ZAFT / Archangel Link Midrange' },
];

export function buildStarterDeckFromCatalog(
  presetCode: string,
  allCards: GundamCardPrint[]
): SavedDeck {
  const preset = STARTER_PRESETS.find((p) => p.code === presetCode) ?? STARTER_PRESETS[0];
  const prefix = `${preset.code}-`;
  const stCards = allCards.filter(
    (c) => c.cardNo.startsWith(prefix) && !c.isParallel && MAIN_DECK_TYPES.has(c.type)
  );
  const resCard = allCards.find((c) => c.type === 'RESOURCE');

  const mainDeck: DeckEntry[] = [];
  let total = 0;

  // Build authentic 50-card starter structure (2x of LR bosses, 4x of commons/uncommons)
  for (const c of stCards) {
    if (total >= 50) break;
    const qty = c.rarity === 'LR' ? 2 : c.rarity === 'R' ? 3 : 4;
    const add = Math.min(qty, 50 - total);
    if (add > 0) {
      mainDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: add });
      total += add;
    }
  }
  // Top up to 50 if ST pool had fewer cards
  let idx = 0;
  while (total < 50 && mainDeck.length > 0 && idx < mainDeck.length * 4) {
    const entry = mainDeck[idx % mainDeck.length];
    if (entry.qty < 4) {
      entry.qty += 1;
      total += 1;
    }
    idx += 1;
  }

  return {
    id: `starter-${preset.code}-${Date.now()}`,
    name: preset.name,
    updatedAt: new Date().toISOString(),
    mainDeck,
    resourceDeck: resCard ? [{ cardNo: resCard.cardNo, printId: resCard.printId, qty: 10 }] : [],
  };
}
