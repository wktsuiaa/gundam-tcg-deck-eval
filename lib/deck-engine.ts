import type {
  AxisBreakdown,
  CardColor,
  DeckAnalysis,
  DeckEntry,
  DeckGenerationConstraints,
  DeckPlaybook,
  DeckRecommendation,
  DeckValidationResult,
  DetectedCombo,
  EffectStyleTag,
  GundamCardPrint,
  HandVerdict,
  HexagonAxes,
  MatchupAssessment,
  OpeningHandQuality,
  PacingTier,
  SavedDeck,
  StartingHandScenario,
  StrategyBlueprint,
  TacticalStyleTag,
  TurnActionInsight,
  TurnOrderSetting,
  TurnWinChancePoint,
} from '@/types/gundam';
import { doesPilotLinkUnit, extractPilotNamesForLink, isCommandPilot } from '@/lib/gundam-keywords';
import {
  flattenEffectSteps,
  type CardSynergyProfile,
  type EffectCondition,
  type EffectPrerequisite,
  type EffectStep,
  type SynergyNodeKey,
} from '@/lib/effect-parser';
import { getAbilitySteps, getAbilityTimings } from '@/lib/cfg-parser';

const EMPTY_SYNERGY: CardSynergyProfile = { requires: [], enables: [] };

const MAIN_DECK_TYPES = new Set(['UNIT', 'PILOT', 'COMMAND', 'BASE']);

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export interface StrategyStyleMeta {
  tag: TacticalStyleTag;
  description: string;
  targetBias: Partial<HexagonAxes>;
}

export const TACTICAL_STYLE_META: StrategyStyleMeta[] = [
  {
    tag: 'Link-Strike',
    description: 'Maximizes Pilot–Unit Link pairs for immediate 【When Linked】 triggers and combined AP/HP spikes.',
    targetBias: { synergy: 88, aggro: 70, tempo: 68 },
  },
  {
    tag: 'High-Liquidity Draw',
    description: 'Stacks draw, top-deck look, and search effects so your hand stays full past Turn 5.',
    targetBias: { liquidity: 88, tempo: 68, control: 60 },
  },
  {
    tag: 'Repair Fortress',
    description: 'Anchors the board with <Blocker>, <Repair>, and high-HP Bases to win long attrition wars.',
    targetBias: { defense: 90, synergy: 62, control: 65 },
  },
  {
    tag: 'Shield Breach',
    description: 'Prioritizes low-cost attackers, <Breach>, and <First Strike> to burn Shields early.',
    targetBias: { aggro: 90, tempo: 82 },
  },
  {
    tag: 'Wide Swarm',
    description: 'Floods Cost 1–2 Units and Token generators to overwhelm single-target removal.',
    targetBias: { aggro: 82, tempo: 85, synergy: 65 },
  },
  {
    tag: 'Command Control',
    description: 'Focuses on Rest, Direct Damage, AP Deduction, Bounce, and Destroy Commands.',
    targetBias: { control: 90, defense: 70, liquidity: 65 },
  },
  {
    tag: 'Resource Ramp',
    description: 'Accelerates Resources and EX Resources to deploy Lv.5–7 boss Units ahead of curve.',
    targetBias: { tempo: 88, defense: 62, aggro: 66 },
  },
  {
    tag: 'Balanced Midrange',
    description: 'Blends curve efficiency, solid Unit bodies, Link threats, and flexible removal.',
    targetBias: { aggro: 65, defense: 65, tempo: 70, liquidity: 60, synergy: 70, control: 60 },
  },
];

export interface EffectStyleMeta {
  tag: EffectStyleTag;
  label: string;
  description: string;
  primaryAxis: keyof HexagonAxes;
}

export const EFFECT_STYLE_META: EffectStyleMeta[] = [
  {
    tag: 'AP Deduction',
    label: 'AP Deduction',
    description: 'Reduces opposing Unit AP (AP-X) to win combat trades and neutralize attackers.',
    primaryAxis: 'control',
  },
  {
    tag: 'Destroy',
    label: 'Destroy / Hard Removal',
    description: 'Directly destroys enemy Units or Shields to clear high-HP threats.',
    primaryAxis: 'control',
  },
  {
    tag: 'Damage Proof',
    label: 'Damage Proof / Reduction',
    description: 'Reduces incoming battle/effect damage or shields Units from destruction and targeting.',
    primaryAxis: 'defense',
  },
  {
    tag: 'Repair',
    label: 'Repair / Recovery',
    description: 'Heals Unit/Base HP at end of turn (<Repair X>) or recovers Shield durability.',
    primaryAxis: 'defense',
  },
  {
    tag: 'Bounce',
    label: 'Back to Hand (Bounce)',
    description: 'Returns opposing Units or Bases to hand to reset paired Pilots and stall tempo.',
    primaryAxis: 'control',
  },
  {
    tag: 'Rest Lock',
    label: 'Rest / Freeze Lock',
    description: 'Rests enemy Units or keeps them from setting active during Start Phase.',
    primaryAxis: 'control',
  },
  {
    tag: 'Direct Damage',
    label: 'Direct Effect Damage',
    description: 'Deals ping or burst damage directly to enemy Units or Shields outside combat.',
    primaryAxis: 'aggro',
  },
  {
    tag: 'Draw & Search',
    label: 'Draw & Deck Filter',
    description: 'Draws extra cards or reveals/searches top cards to stabilize curve and Link pieces.',
    primaryAxis: 'liquidity',
  },
  {
    tag: 'Trash Recursion',
    label: 'Trash Recursion',
    description: 'Recovers Units, Pilots, or Commands from the Trash back to hand or play.',
    primaryAxis: 'liquidity',
  },
  {
    tag: 'Resource Ramp',
    label: 'Resource Ramp / Cost Cheat',
    description: 'Adds active/EX Resources or reduces card play costs to accelerate Lv.5+ threats.',
    primaryAxis: 'tempo',
  },
  {
    tag: 'Combat Keywords',
    label: 'Combat Keywords',
    description: 'Packs <Blocker>, <Breach>, <First Strike>, <High-Maneuver>, <Support>, or <Suppression>.',
    primaryAxis: 'aggro',
  },
  {
    tag: 'Token Deploy',
    label: 'Token & Extra Deploy',
    description: 'Deploys Unit tokens or extra bodies onto the Battle Area for wider boards.',
    primaryAxis: 'tempo',
  },
];

export const DEFAULT_CONSTRAINTS: DeckGenerationConstraints = {
  allowedPackageCodes: [],
  maxCopiesPerCard: 4,
  maxCost: null,
  maxLv: null,
  rarityCap: 'ALL',
  strictTraitLinkLock: false,
};

export function normalizeTraitFocus(raw?: string | string[] | null): string[] {
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      const trimmed = typeof item === 'string' ? item.trim() : '';
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        out.push(trimmed);
      }
    }
    return out;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

export const DEFAULT_BLUEPRINT: StrategyBlueprint = {
  colors: ['Blue', 'White'],
  pacing: 'Midrange Tempo',
  styles: ['Link-Strike'],
  effectStyles: [],
  traitFocus: [],
  targetHexagon: {
    aggro: 65,
    defense: 60,
    tempo: 70,
    liquidity: 65,
    synergy: 85,
    control: 55,
  },
  constraints: DEFAULT_CONSTRAINTS,
};

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
    const kk = Math.min(k, n - k);
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

function hasDensityGateCondition(cond: EffectCondition | undefined): boolean {
  if (!cond) return false;
  if (cond.kind === 'DEPLOYED_FROM_ZONE' || cond.kind === 'TRASH_COUNT_AT_LEAST' || cond.kind === 'DEVELOPMENT_EXILE') {
    return true;
  }
  if (cond.kind === 'ALL_OF' || cond.kind === 'ANY_OF') {
    return cond.conditions.some((c) => hasDensityGateCondition(c));
  }
  if (cond.kind === 'NOT') {
    return hasDensityGateCondition(cond.condition);
  }
  return false;
}

function collectStepsAndResiduals(card: GundamCardPrint) {
  const parsed = card.compiledEffect ?? { keywords: [], abilities: [] };
  const steps: { step: EffectStep; gated: boolean }[] = [];

  for (const ab of parsed.abilities) {
    const cond = ab.kind === 'CUSTOM_HOOK' ? undefined : ab.condition;
    const gated = hasDensityGateCondition(cond);
    for (const step of flattenEffectSteps(getAbilitySteps(ab))) steps.push({ step, gated });
  }
  return { parsed, steps, residualText: '' };
}

export function detectEffectStyles(card: GundamCardPrint): EffectStyleTag[] {
  const { parsed, steps, residualText } = collectStepsAndResiduals(card);
  const tags = new Set<EffectStyleTag>();

  for (const kw of parsed.keywords) {
    if (kw.name === 'Repair') tags.add('Repair');
    else tags.add('Combat Keywords');
  }

  for (const { step } of steps) {
    switch (step.action) {
      case 'MODIFY_AP':
        if (step.delta < 0) tags.add('AP Deduction');
        break;
      case 'DESTROY':
        tags.add('Destroy');
        break;
      case 'DAMAGE_PROOF':
        tags.add('Damage Proof');
        break;
      case 'RECOVER_HP':
        tags.add('Repair');
        break;
      case 'BOUNCE':
        tags.add('Bounce');
        break;
      case 'REST':
      case 'FREEZE':
        tags.add('Rest Lock');
        break;
      case 'DEAL_DAMAGE':
        tags.add('Direct Damage');
        break;
      case 'DRAW':
      case 'LOOK_TOP':
      case 'REVEAL_TOP':
        tags.add('Draw & Search');
        break;
      case 'ADD_FROM_TRASH_TO_HAND':
      case 'DEPLOY_FROM_TRASH':
        tags.add('Trash Recursion');
        break;
      case 'ADD_RESOURCE':
      case 'COST_REDUCTION':
        tags.add('Resource Ramp');
        break;
      case 'GRANT_KEYWORD':
        tags.add(step.keyword.name === 'Repair' ? 'Repair' : 'Combat Keywords');
        break;
      case 'DEPLOY_TOKEN':
        tags.add('Token Deploy');
        break;
    }
  }

  // Fallback only on unparsed residual prose (never on reminder text or parsed condition gates)
  if (residualText) {
    if (/ap-|ap\s*-\d|gets\s*-\d+\s*ap|ap is reduced/i.test(residualText)) tags.add('AP Deduction');
    if (/\bdestroy\b/i.test(residualText)) tags.add('Destroy');
    if (/reduce.*damage|cannot be damaged|take no damage|cannot be destroyed|cannot be chosen/i.test(residualText)) tags.add('Damage Proof');
    if (/recover\s+\d+\s+hp/i.test(residualText)) tags.add('Repair');
    if (/return.*to.*hand/i.test(residualText)) tags.add('Bounce');
    if (/\brest\b|won't be set as active/i.test(residualText)) tags.add('Rest Lock');
    if (/\bdeal \d+ damage/i.test(residualText)) tags.add('Direct Damage');
    if (/\bdraw\s+\d+|look at the top|reveal|search/i.test(residualText)) tags.add('Draw & Search');
    if (/(?:choose|return|add|deploy|play).*from your trash/i.test(residualText)) tags.add('Trash Recursion');
    if (/resource area|ex resource|reduce the cost|cost -/i.test(residualText)) tags.add('Resource Ramp');
    if (/\btoken\b|deploy 1/i.test(residualText)) tags.add('Token Deploy');
  }

  return [...tags];
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
  hasConditionalGate: boolean;
  effectStyles: EffectStyleTag[];
}

export function scoreSingleCardSignals(card: GundamCardPrint): CardSignalScores {
  const { parsed, steps, residualText } = collectStepsAndResiduals(card);
  const resLower = residualText.toLowerCase();
  const cost = card.cost ?? 2;
  const lv = card.lv ?? 2;
  const ap = card.ap ?? 0;
  const hp = card.hp ?? 0;
  const effectStyles = detectEffectStyles(card);

  const hasStep = (pred: (s: EffectStep) => boolean) => steps.some((x) => pred(x.step));
  const hasKeywordNamed = (name: string) =>
    parsed.keywords.some((k) => k.name === name) ||
    hasStep((s) => s.action === 'GRANT_KEYWORD' && s.keyword.name === name);

  const hasDraw =
    hasStep((s) => s.action === 'DRAW') ||
    /\bdraw\s+\d+/i.test(resLower);
  const hasSearch =
    hasStep((s) => s.action === 'LOOK_TOP' || s.action === 'REVEAL_TOP' || s.action === 'ADD_FROM_TRASH_TO_HAND' || s.action === 'DEPLOY_FROM_TRASH') ||
    resLower.includes('look at the top') ||
    resLower.includes('reveal') ||
    resLower.includes('search');
  const hasRamp =
    hasStep((s) => s.action === 'ADD_RESOURCE' || s.action === 'COST_REDUCTION') ||
    resLower.includes('resource area') ||
    resLower.includes('ex resource') ||
    resLower.includes('reduce the cost');
  const hasRest =
    hasStep((s) => s.action === 'REST' || s.action === 'FREEZE') ||
    /\brest\b/.test(resLower);
  const hasRemoval =
    hasStep((s) => s.action === 'DEAL_DAMAGE' || s.action === 'DESTROY' || s.action === 'BOUNCE' || (s.action === 'MODIFY_AP' && s.delta < 0)) ||
    /\b(deal \d+ damage|destroy|return .* hand|ap-)\b/.test(resLower);

  const hasRepair = hasKeywordNamed('Repair');
  const hasBlocker = hasKeywordNamed('Blocker');
  const hasBreach = hasKeywordNamed('Breach');
  const hasFirstStrike = hasKeywordNamed('First Strike');
  const hasHighManeuver = hasKeywordNamed('High-Maneuver');
  const hasSupport = hasKeywordNamed('Support');
  const hasPairTrigger = parsed.abilities.some((ab) =>
    getAbilityTimings(ab).some(
      (t) => t === 'WHEN_PAIRED' || t === 'WHEN_LINKED' || t === 'DURING_PAIR' || t === 'DURING_LINK'
    )
  );
  const hasConditionalGate = steps.length > 0 && steps.every((x) => x.gated);
  const gateMult = hasConditionalGate ? 0.5 : 1;

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
  if (parsed.abilities.some((ab) => getAbilityTimings(ab).includes('ATTACK'))) aggro += 16;
  if (hasStep((s) => s.action === 'MODIFY_AP' && s.delta > 0)) aggro += 12;

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
  if (effectStyles.includes('Damage Proof')) defense += 28;
  if (hasStep((s) => s.action === 'RECOVER_HP' || s.action === 'ADD_SHIELD_TO_HAND')) defense += 14;

  // Tempo / Resource
  if (lv <= 3 && cost <= 2) tempo += 34;
  else if (lv <= 4 && cost <= 3) tempo += 20;
  if (hasRamp) tempo += 42;
  if (hasStep((s) => s.action === 'DEPLOY_TOKEN' || s.action === 'DEPLOY_FROM_TRASH')) tempo += 25;
  if (hasStep((s) => s.action === 'SET_ACTIVE' && s.target.owner === 'SELF')) tempo += 24;

  // Card Liquidity
  if (hasDraw) liquidity += 48 * gateMult;
  if (hasSearch) liquidity += 34 * gateMult;
  if (
    parsed.abilities.some(
      (ab) =>
        ab.kind === 'EFFECT_CLAUSE' &&
        ab.timings.includes('BURST') &&
        ab.steps.some((s) => s.action === 'DRAW' || s.action === 'ADD_SELF_TO_HAND')
    )
  ) {
    // Burst self-add preserves card presence without inflating active deck draw velocity
    if (hasDraw) liquidity += 12;
  }

  // Synergy / Link
  if (card.link) synergy += 26;
  if (card.type === 'PILOT') synergy += 32;
  if (hasPairTrigger) synergy += 28;
  if (hasSupport) synergy += 24;
  if (hasStep((s) => s.action === 'PAIR_SELF_FROM_TRASH')) synergy += 14;
  if (card.traits.length > 0 && /\([a-z0-9 '&-]+\)\s*unit/i.test(card.effect)) synergy += 22;

  // Control / Disruption (with conditional discount on gated effects like ST09-006)
  if (card.type === 'COMMAND') control += 26;
  if (hasRest) control += 26 * gateMult;
  if (hasRemoval) control += 32 * gateMult;
  if (effectStyles.includes('AP Deduction')) control += 18 * gateMult;
  if (effectStyles.includes('Destroy')) control += 20 * gateMult;
  if (effectStyles.includes('Bounce')) control += 20 * gateMult;
  if (
    parsed.abilities.some(
      (ab) =>
        ab.kind === 'EFFECT_CLAUSE' &&
        ab.timings.includes('BURST') &&
        ab.steps.some(
          (s) =>
            s.action === 'REST' ||
            s.action === 'DESTROY' ||
            s.action === 'DEAL_DAMAGE' ||
            s.action === 'ACTIVATE_MAIN_EFFECT'
        )
    )
  ) {
    control += 14;
  }
  if (hasStep((s) => s.action === 'CANT_ATTACK')) control += 16 * gateMult;

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
    hasConditionalGate,
    effectStyles,
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
  const pilots = mainExpanded.filter((x) => x.card.type === 'PILOT' || isCommandPilot(x.card));
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
    linkCoveragePct * 0.45 +
      (pilots.reduce((s, p) => s + p.qty, 0) / norm) * 90 +
      (topTraitCount / norm) * 48 +
      (supportCount / norm) * 40
  );
  const control = clamp((disruptionCount / norm) * 155 + (commandCount / norm) * 70);

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
          ? 'Tightly woven Pilot–Unit Link network and Trait cohesion.'
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
  let edge = 0;

  edge += (myHex.aggro - oppHex.defense) * 0.22;
  edge += (myHex.defense - oppHex.aggro) * 0.22;
  edge += (myHex.liquidity - oppHex.liquidity) * 0.25;
  edge += (myHex.tempo - oppHex.tempo) * 0.16;
  edge += (myHex.synergy - oppHex.control) * 0.18;
  edge += (myHex.control - oppHex.synergy) * 0.18;

  if (myPacing === 'Early Rush' && oppPacing === 'Ramp / Combo') edge += 10;
  if (myPacing === 'Late-Game Control' && oppPacing === 'Early Rush') {
    edge += myHex.defense >= 65 ? 8 : -10;
  }
  if (myPacing === 'Ramp / Combo' && oppPacing === 'Late-Game Control') edge += 6;

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

export function generateTurnActionInsights(
  mainExpanded: { card: GundamCardPrint; qty: number }[],
  pacing: PacingTier,
  linkCombos: DetectedCombo[]
): TurnActionInsight[] {
  const all = mainExpanded.map((x) => x.card);
  const units = mainExpanded.filter((x) => x.card.type === 'UNIT').map((x) => x.card);
  const pilots = mainExpanded.filter((x) => x.card.type === 'PILOT').map((x) => x.card);
  const commands = mainExpanded.filter((x) => x.card.type === 'COMMAND').map((x) => x.card);
  const bases = mainExpanded.filter((x) => x.card.type === 'BASE').map((x) => x.card);

  const byTurnWindow = (maxLv: number, minLv = 1) =>
    all.filter((c) => (c.lv ?? 1) >= minLv && (c.lv ?? 1) <= maxLv && (c.cost ?? 1) <= maxLv);

  const t1Drops = byTurnWindow(1, 1);
  const t2Drops = byTurnWindow(2, 1);
  const t3Drops = byTurnWindow(3, 2);
  const t4Drops = byTurnWindow(4, 3);
  const t5Drops = byTurnWindow(5, 4);
  const t6Drops = all.filter((c) => (c.lv ?? 0) >= 6 || (c.cost ?? 0) >= 5);

  const heavyBricks = [...t6Drops, ...t5Drops].slice(0, 3);
  const linkUnit = linkCombos[0]?.cards[0];
  const linkPilot = linkCombos[0]?.cards[1];
  const rampCard = all.find((c) => scoreSingleCardSignals(c).hasRamp);
  const blockerCard = units.find((c) => scoreSingleCardSignals(c).hasBlocker);
  const drawCard = all.find((c) => scoreSingleCardSignals(c).hasDraw || scoreSingleCardSignals(c).hasSearch);
  const controlCmd = commands.find((c) => {
    const s = scoreSingleCardSignals(c);
    return s.hasRemoval || s.hasRest;
  });

  return [
    {
      turnNumber: 1,
      turnLabel: 'Turn 1',
      levelWindow: 'Lv. 1 · 1 Resource (2 on 2nd)',
      bestAction:
        t1Drops.length > 0
          ? `Deploy ${t1Drops[0].name} (or hold 1 Resource if Going 2nd for a Turn 2 Lv.2+ play) to apply immediate board presence.`
          : 'Place your Resource cleanly and pass without wasting reactive Commands; set up Turn 2 development.',
      worstAction:
        'Keeping an opener packed with Lv.5–6 finishers or multiple unpaired Pilots and missing Turn 1–2 plays completely.',
      bestCards: t1Drops.slice(0, 3),
      worstCards: heavyBricks.length > 0 ? heavyBricks : pilots.slice(0, 2),
    },
    {
      turnNumber: 2,
      turnLabel: 'Turn 2',
      levelWindow: 'Lv. 2 · 2 Resources',
      bestAction:
        rampCard && (rampCard.cost ?? 9) <= 3
          ? `Sequence early board presence (${t2Drops[0]?.name ?? 'Cost ≤2 Unit'}) or prepare ${rampCard.name} to accelerate past opponent curve.`
          : drawCard && (drawCard.cost ?? 9) <= 2
          ? `Stick ${t2Drops.find((c) => c.type === 'UNIT')?.name ?? 'an early Unit'} or cycle with ${drawCard.name} to hit Turn 3 Link pieces.`
          : `Develop a Cost ≤2 Unit (${t2Drops[0]?.name ?? 'early attacker'}) and chip an undefended Shield if safe.`,
      worstAction:
        'Over-trading a value <Blocker> or <Support> Unit into a low-impact trade, or leaving Resources unspent with playable Units in hand.',
      bestCards: t2Drops.slice(0, 3),
      worstCards: (commands.length > 0 ? commands : heavyBricks).slice(0, 3),
    },
    {
      turnNumber: 3,
      turnLabel: 'Turn 3',
      levelWindow: 'Lv. 3 · 3 Resources',
      bestAction:
        bases[0] && (bases[0].cost ?? 9) <= 3
          ? `Deploy ${bases[0].name} to absorb incoming Shield pressure, or land a Lv.3 tempo Unit (${t3Drops[0]?.name ?? 'mid-curve Unit'}).`
          : `Transition into mid-curve Units (${t3Drops[0]?.name ?? 'Lv.3 Unit'}) while keeping 1 Resource open if holding an Action Command.`,
      worstAction:
        'Dropping a Pilot onto a fragile Unit that gets destroyed before attacking, wasting a 2-for-1 Link opportunity.',
      bestCards: t3Drops.slice(0, 3),
      worstCards: pilots.slice(0, 2),
    },
    {
      turnNumber: 4,
      turnLabel: 'Turn 4',
      levelWindow: 'Lv. 4 · 4 Resources',
      bestAction:
        linkUnit && linkPilot
          ? `Pivot turn: pair ${linkPilot.name} onto ${linkUnit.name} (or similar Link Unit) for an immediate 【When Linked】 combat swing.`
          : controlCmd
          ? `Use ${controlCmd.name} to clear or rest an opposing blocker before committing your Lv.4 threat.`
          : `Stabilize with ${t4Drops[0]?.name ?? blockerCard?.name ?? 'a Lv.4 Unit'} and establish favorable AP/HP trades.`,
      worstAction:
        'Tapping out blindly into opponent Shields when they have active Resources for Action removal or <Blocker> ambush.',
      bestCards: [linkUnit, linkPilot, ...t4Drops].filter((c): c is GundamCardPrint => Boolean(c)).slice(0, 3),
      worstCards: t1Drops.slice(0, 2),
    },
    {
      turnNumber: 5,
      turnLabel: 'Turn 5',
      levelWindow: 'Lv. 5 · 5 Resources',
      bestAction:
        t5Drops[0]
          ? `Deploy ${t5Drops[0].name} backed by ${drawCard?.name ?? controlCmd?.name ?? 'secondary interaction'} to seize board control.`
          : `Double-spell two efficient mid-cost cards to out-tempo single-threat turns.`,
      worstAction:
        pacing === 'Early Rush'
          ? 'Trading into high-HP defenders instead of pushing remaining Shield lethal with <Breach> / <High-Maneuver>.'
          : 'Ignoring an opposing Link threat on board to greedily deploy an unprotected Base.',
      bestCards: t5Drops.slice(0, 3),
      worstCards: t1Drops.slice(0, 2),
    },
    {
      turnNumber: 6,
      turnLabel: 'Turn 6+',
      levelWindow: 'Lv. 6+ · 6–10 Resources',
      bestAction:
        t6Drops[0]
          ? `Resolve top-end closer ${t6Drops[0].name} paired with a Link Pilot or ${controlCmd?.name ?? 'removal Command'} to break remaining Shields.`
          : `Chain multiple Threats + ${controlCmd?.name ?? 'Commands'} in one turn so opponent <Blocker> cannot cover lethal.`,
      worstAction:
        'Holding removal or lethal attackers passively while Control/Ramp opponents heal with <Repair> and rebuild Shields.',
      bestCards: (t6Drops.length > 0 ? t6Drops : all.slice(-3)).slice(0, 3),
      worstCards: t1Drops.slice(0, 2),
    },
  ];
}

export function computeTurnWinChances(
  analysis: DeckAnalysis,
  deckCards: GundamCardPrint[],
  turnOrder: TurnOrderSetting,
  opponent: { name: string; pacing: PacingTier; hexagon: HexagonAxes },
  handQuality: OpeningHandQuality
): TurnWinChancePoint[] {
  const totalPop = Math.max(50, deckCards.length);
  const earlyUnitCount = deckCards.filter((c) => c.type === 'UNIT' && (c.cost ?? 9) <= 2).length;
  const linkUnitCount = deckCards.filter((c) => c.type === 'UNIT' && Boolean(c.link)).length;
  const pilotCount = deckCards.filter((c) => c.type === 'PILOT').length;

  const baseMatchup = evaluateMatchupBetween(
    'Your Deck',
    analysis.hexagon,
    analysis.pacing,
    opponent.name,
    [],
    opponent.pacing,
    opponent.hexagon
  );
  // Base edge (-40..40) converted to baseline win% around 50%
  const matchupOffset = (3 - baseMatchup.difficultyScore) * 6;
  const handOffset = handQuality === 'optimal' ? 11 : handQuality === 'mulliganed' ? -9 : 0;
  const secondTurnBoost = turnOrder === 'second' ? 3 : 0;

  const points: TurnWinChancePoint[] = [];

  for (let t = 1; t <= 6; t++) {
    const effectiveLv = turnOrder === 'second' && t <= 4 ? t + 1 : t;
    const cardsSeen = 5 + (turnOrder === 'second' ? 1 : 0) + (t - 1);
    const playableByT = deckCards.filter((c) => (c.cost ?? 1) <= effectiveLv).length;

    let curveHitPct = Math.round(hypergeometricAtLeast(totalPop, playableByT, cardsSeen, 1) * 100);
    if (handQuality === 'optimal') curveHitPct = Math.min(99, Math.max(curveHitPct, 78 + t * 3));
    if (handQuality === 'mulliganed' && t <= 2) curveHitPct = Math.max(20, curveHitPct - 18);

    const linkReadyPct = Math.round(
      hypergeometricAtLeast(totalPop, linkUnitCount, cardsSeen, 1) *
        hypergeometricAtLeast(totalPop, pilotCount, cardsSeen, 1) *
        100
    );

    // Pacing power curve across turns 1..6
    const pacingCurve = (p: PacingTier, hex: HexagonAxes, turn: number) => {
      if (p === 'Early Rush') return hex.aggro * (turn <= 3 ? 1.15 : 0.85) + hex.tempo * 0.4;
      if (p === 'Ramp / Combo') return hex.tempo * 0.65 + (turn >= 4 ? hex.aggro * 1.1 + hex.defense * 0.6 : hex.defense * 0.4);
      if (p === 'Late-Game Control') return hex.control * 0.6 + hex.defense * 0.6 + (turn >= 4 ? hex.liquidity * 0.9 : 20);
      return (hex.aggro + hex.tempo + hex.synergy) * 0.48 + (turn >= 3 ? hex.liquidity * 0.3 : 10);
    };

    const myPower = pacingCurve(analysis.pacing, analysis.hexagon, t) + (earlyUnitCount >= 10 && t <= 2 ? 12 : 0);
    const oppPower = pacingCurve(opponent.pacing, opponent.hexagon, t);
    const tempoDelta = Math.round((myPower - oppPower) * 0.22);

    const rawWin =
      50 +
      matchupOffset * 0.65 +
      handOffset * (t <= 3 ? 1 : 0.55) +
      secondTurnBoost * (t <= 3 ? 1 : 0.4) +
      (curveHitPct - 70) * 0.22 +
      (t >= 3 ? (linkReadyPct - 45) * 0.12 : 0) +
      tempoDelta;

    const winChancePct = clamp(rawWin, 14, 90);
    const note =
      tempoDelta >= 6
        ? `Favorable tempo window (+${tempoDelta}) against ${opponent.name}'s ${opponent.pacing} curve.`
        : tempoDelta <= -6
        ? `Caution: opponent's ${opponent.pacing} curve spikes here (${tempoDelta} tempo delta).`
        : `Even board trade window; prioritize curve consistency (${curveHitPct}% hit rate).`;

    points.push({
      turnNumber: t,
      turnLabel: t === 6 ? 'T6+' : `T${t}`,
      winChancePct,
      curveHitPct,
      linkReadyPct,
      tempoDelta,
      note,
    });
  }

  return points;
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
  const heavyCards = mainExpanded.filter((x) => (x.card.lv ?? 0) >= 5 || (x.card.cost ?? 0) >= 4);
  const pilots = mainExpanded.filter((x) => x.card.type === 'PILOT' || isCommandPilot(x.card));
  const units = mainExpanded.filter((x) => x.card.type === 'UNIT');
  const bases = mainExpanded.filter((x) => x.card.type === 'BASE');
  const commands = mainExpanded.filter((x) => x.card.type === 'COMMAND');
  const liquidityCards = mainExpanded.filter((x) => {
    const sig = scoreSingleCardSignals(x.card);
    return sig.hasDraw || sig.hasSearch;
  });

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

  // Knowledge Map Enabler <-> Payoff Mechanic Chains derived from parsed Effect Clauses
  const mechanicCombos: DetectedCombo[] = [];
  const SYNERGY_LABELS: Record<SynergyNodeKey, { title: string; verb: string }> = {
    DEPLOY_FROM_TRASH: { title: 'Trash-Deploy Payoff', verb: 'recurs from trash to unlock' },
    TRASH_COUNT_FUEL: { title: 'Trash-Threshold Engine', verb: 'fuels Trash count for' },
    AP_THRESHOLD_5: { title: '5+ AP Threshold Boost', verb: 'pushes AP to 5+ for' },
    DAMAGED_ENEMY_TARGET: { title: 'Ping & Punish', verb: 'marks damaged enemy Units for' },
    RESTED_ENEMY_TARGET: { title: 'Rest & Punish', verb: 'rests enemy Units for' },
  };
  const profiles = mainExpanded.map((x) => ({
    card: x.card,
    profile: x.card.compiledEffect?.synergy ?? EMPTY_SYNERGY,
  }));
  const seenSynergy = new Set<string>();
  for (const payoff of profiles) {
    for (const key of payoff.profile.requires) {
      const enabler = profiles.find(
        (e) => e.card.cardNo !== payoff.card.cardNo && e.profile.enables.includes(key)
      );
      if (enabler) {
        const pairKey = `${key}:${enabler.card.cardNo}:${payoff.card.cardNo}`;
        if (!seenSynergy.has(pairKey) && mechanicCombos.length < 4) {
          seenSynergy.add(pairKey);
          const meta = SYNERGY_LABELS[key];
          mechanicCombos.push({
            title: `${meta.title} (${enabler.card.name} → ${payoff.card.name})`,
            category: 'Mechanic Chain',
            cards: [enabler.card, payoff.card],
            description: `${enabler.card.name} ${meta.verb} ${payoff.card.name}'s Effect Clause.`,
          });
        }
      }
    }
  }

  const combos = [...linkCombos.slice(0, 6), ...traitCombos.slice(0, 3), ...mechanicCombos.slice(0, 4)];

  const earlyCount = earlyUnits.reduce((s, x) => s + x.qty, 0);
  const drawCount = liquidityCards.reduce((s, x) => s + x.qty, 0);
  const linkUnitCount = units
    .filter((u) => u.card.link && pilots.some((p) => doesPilotLinkUnit(p.card, u.card)))
    .reduce((s, x) => s + x.qty, 0);
  const pilotCount = pilots.reduce((s, x) => s + x.qty, 0);

  const pop = Math.max(50, totalMain);
  const earlyPlayablePct = Math.round(hypergeometricAtLeast(pop, earlyCount, 5, 1) * 100);
  const drawEnginePct = Math.round(hypergeometricAtLeast(pop, drawCount, 5, 1) * 100);
  const linkPairPct = Math.round(
    hypergeometricAtLeast(pop, linkUnitCount, 5, 1) * hypergeometricAtLeast(pop, pilotCount, 5, 1) * 100
  );

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

  let primaryObjective = 'Control board tempo through efficient trades and Linked Unit spikes, then close out Shields.';
  let advantageMechanism = 'Balanced card-for-card value and timely Pilot pairings.';
  if (styles.includes('Shield Breach') || pacing === 'Early Rush') {
    primaryObjective = 'Apply relentless Turn 1–4 Shield pressure using low-cost attackers and <Breach> / <First Strike>.';
    advantageMechanism = 'Forces opponents into unfavorable blocks before their high-Lv Units come online.';
  } else if (styles.includes('High-Liquidity Draw')) {
    primaryObjective = 'Out-resource the opponent via superior Card Liquidity, never missing curve drops.';
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

  const turnInsights = generateTurnActionInsights(mainExpanded, pacing, linkCombos);

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
    turnInsights,
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
  const pilots = hand.filter((c) => c.type === 'PILOT' || isCommandPilot(c));
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

export function blendTargetHexagon(blueprint: StrategyBlueprint): HexagonAxes {
  const base = { ...blueprint.targetHexagon };
  const activeStyles = blueprint.styles.length > 0 ? blueprint.styles : ['Balanced Midrange'];
  const styleBiases = activeStyles
    .map((s) => TACTICAL_STYLE_META.find((m) => m.tag === s)?.targetBias)
    .filter(Boolean) as Partial<HexagonAxes>[];

  if (styleBiases.length === 0) return base;

  const keys: (keyof HexagonAxes)[] = ['aggro', 'defense', 'tempo', 'liquidity', 'synergy', 'control'];
  for (const key of keys) {
    const vals = styleBiases.map((b) => b[key]).filter((v): v is number => typeof v === 'number');
    if (vals.length > 0) {
      const avgBias = vals.reduce((s, v) => s + v, 0) / vals.length;
      base[key] = clamp(base[key] * 0.65 + avgBias * 0.35, 10, 98);
    }
  }
  return base;
}

export function filterPoolByConstraints(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint
): GundamCardPrint[] {
  const uniqueBase = new Map<string, GundamCardPrint>();
  for (const c of allCards) {
    if (!MAIN_DECK_TYPES.has(c.type)) continue;
    const existing = uniqueBase.get(c.cardNo);
    if (!existing || (existing.isParallel && !c.isParallel)) {
      uniqueBase.set(c.cardNo, c);
    }
  }

  const c = blueprint.constraints ?? DEFAULT_CONSTRAINTS;
  const allowedSets = new Set(c.allowedPackageCodes);

  let pool = [...uniqueBase.values()].filter((card) => {
    if (allowedSets.size > 0 && !card.packageCodes.some((code) => allowedSets.has(code))) {
      return false;
    }
    if (c.maxCost !== null && (card.cost ?? 0) > c.maxCost) {
      return false;
    }
    if (c.maxLv !== null && (card.lv ?? 0) > c.maxLv) {
      return false;
    }
    const baseRarity = card.rarity.replace(/\+/g, '');
    if (c.rarityCap === 'NO_LR' && (baseRarity === 'LR' || baseRarity === 'SP' || baseRarity === 'LKR')) {
      return false;
    }
    if (c.rarityCap === 'C_U_R_ONLY' && !['C', 'U', 'R', 'P', 'LKC', 'LKU'].includes(baseRarity)) {
      return false;
    }
    return true;
  });

  if (blueprint.colors.length > 0) {
    const allowedColors = new Set(blueprint.colors);
    pool = pool.filter((card) => card.color === 'Colorless' || allowedColors.has(card.color));
  }

  // Strict Trait / Link Lock (NO Series!)
  if (c.strictTraitLinkLock) {
    const focuses = normalizeTraitFocus(blueprint.traitFocus as unknown as string | string[]);
    if (focuses.length > 0) {
      const focusLowers = focuses.map((f) => f.toLowerCase());
      const matchesAnyTrait = (card: GundamCardPrint) =>
        card.traits.some((t) => {
          const tl = t.toLowerCase();
          return focusLowers.some((fl) => tl === fl || tl.includes(fl));
        });
      const traitMatches = pool.filter(matchesAnyTrait);
      pool = pool.filter((card) => {
        if (matchesAnyTrait(card)) return true;
        if (
          (card.type === 'PILOT' || isCommandPilot(card)) &&
          traitMatches.some((u) => u.type === 'UNIT' && doesPilotLinkUnit(card, u))
        ) {
          return true;
        }
        if (
          card.type === 'UNIT' &&
          traitMatches.some((p) => (p.type === 'PILOT' || isCommandPilot(p)) && doesPilotLinkUnit(p, card))
        ) {
          return true;
        }
        return false;
      });
    } else {
      // Lock to cards participating in at least one Pilot-Unit Link pair within the constrained pool
      const units = pool.filter((card) => card.type === 'UNIT' && Boolean(card.link));
      const pilots = pool.filter((card) => card.type === 'PILOT' || isCommandPilot(card));
      pool = pool.filter((card) => {
        if (card.type === 'UNIT') return pilots.some((p) => doesPilotLinkUnit(p, card));
        if (card.type === 'PILOT' || isCommandPilot(card)) return units.some((u) => doesPilotLinkUnit(card, u));
        return true;
      });
    }
  }

  return pool;
}

export interface ConstraintFeasibility {
  feasible: boolean;
  uniqueCards: number;
  maxCards: number;
  reason: string;
}

export function evaluateConstraintFeasibility(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint
): ConstraintFeasibility {
  const pool = filterPoolByConstraints(allCards, blueprint);
  const maxCopies = blueprint.constraints?.maxCopiesPerCard ?? 4;

  if (blueprint.colors.length > 0) {
    const uniqueCards = pool.length;
    const maxCards = uniqueCards * maxCopies;
    if (maxCards < 50) {
      return {
        feasible: false,
        uniqueCards,
        maxCards,
        reason: `Only ${uniqueCards} eligible cards (${maxCards} max copies at ×${maxCopies}) match your constraints; need at least 50 Main Deck cards. Relax a Set, Cost/Lv, Rarity, or Strict Lock filter.`,
      };
    }
    return {
      feasible: true,
      uniqueCards,
      maxCards,
      reason: `${uniqueCards} eligible cards (${maxCards} max slots) available under current constraints.`,
    };
  }

  // Any (Auto Best 2 Colors): check if at least one 2-color pair has >= 50 max slots
  const colorList: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White'];
  let bestPairCount = 0;
  for (let i = 0; i < colorList.length; i++) {
    for (let j = i; j < colorList.length; j++) {
      const pair = new Set([colorList[i], colorList[j]]);
      const sub = pool.filter((c) => c.color === 'Colorless' || pair.has(c.color));
      if (sub.length > bestPairCount) bestPairCount = sub.length;
    }
  }
  const maxCards = bestPairCount * maxCopies;
  return {
    feasible: maxCards >= 50,
    uniqueCards: pool.length,
    maxCards,
    reason:
      maxCards >= 50
        ? `${pool.length} total eligible cards across colors (up to ${maxCards} slots in best 2-color pair).`
        : `Even the largest 2-color pair only reaches ${maxCards}/50 slots. Relax a Set, Cost/Lv, Rarity, or Strict Lock filter.`,
  };
}

const AXIS_LABELS: Record<keyof HexagonAxes, string> = {
  aggro: 'Aggro / Pressure',
  defense: 'Defense / Durability',
  tempo: 'Tempo / Resource',
  liquidity: 'Card Liquidity',
  synergy: 'Synergy / Link',
  control: 'Control / Disruption',
};

function matchesEffectPrerequisite(card: GundamCardPrint, prereq: EffectPrerequisite): boolean {
  if (prereq.kind === 'LINK') {
    if (prereq.cardType === 'PILOT') {
      const pilotNames = extractPilotNamesForLink(card);
      if (card.type !== 'PILOT' && pilotNames.length === 0) return false;
      if (prereq.color && card.color !== prereq.color) return false;
      const nameHit =
        prereq.anyNames?.some((n) => {
          const nl = n.toLowerCase();
          return pilotNames.some((pn) => {
            const pnl = pn.toLowerCase();
            return pnl === nl || pnl.includes(nl) || nl.includes(pnl);
          });
        }) ?? false;
      const traitHit =
        prereq.anyTraits?.some((tr) => card.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase())) ?? false;
      return nameHit || traitHit;
    }
    if (prereq.cardType === 'UNIT') {
      if (card.type !== 'UNIT' || !card.link) return false;
      const linkLower = card.link.toLowerCase();
      const nameHit = prereq.anyNames?.some((n) => linkLower.includes(`[${n.toLowerCase()}]`)) ?? false;
      const traitHit = prereq.anyTraits?.some((tr) => linkLower.includes(`(${tr.toLowerCase()})`)) ?? false;
      return nameHit || traitHit;
    }
  }

  if (prereq.cardType && prereq.cardType !== 'CARD' && card.type !== prereq.cardType) return false;
  if (prereq.color && card.color !== prereq.color) return false;
  if (prereq.anyTraits?.length) {
    if (!prereq.anyTraits.some((tr) => card.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))) return false;
  } else if (prereq.trait && !card.traits.some((t) => t.toLowerCase() === prereq.trait!.toLowerCase())) {
    return false;
  }
  if (prereq.anyNames?.length) {
    const names = [card.name, ...extractPilotNamesForLink(card)];
    if (!prereq.anyNames.some((n) => names.some((cn) => cn.toLowerCase().includes(n.toLowerCase())))) return false;
  } else if (prereq.nameContains) {
    const names = [card.name, ...extractPilotNamesForLink(card)];
    if (!names.some((cn) => cn.toLowerCase().includes(prereq.nameContains!.toLowerCase()))) return false;
  }
  return true;
}

interface UnmetPrereqCheck {
  unmetPrimary: boolean;
  penalty: number;
  reasons: string[];
}

function evaluateCardPrerequisites(
  card: GundamCardPrint,
  currentEntries: DeckEntry[],
  currentCardObjs: { card: GundamCardPrint; qty: number }[],
  pool: GundamCardPrint[],
  focusPool: GundamCardPrint[]
): UnmetPrereqCheck {
  const prereqs = card.compiledEffect?.prerequisites ?? [];
  if (prereqs.length === 0) return { unmetPrimary: false, penalty: 0, reasons: [] };

  let unmetPrimary = false;
  let penalty = 0;
  const reasons: string[] = [];
  const hasDeckContext = currentEntries.length > 0;

  for (const prereq of prereqs) {
    let met: boolean;
    if (hasDeckContext) {
      const deckMatches = currentCardObjs.reduce(
        (sum, e) => (e.card.cardNo !== card.cardNo && matchesEffectPrerequisite(e.card, prereq) ? sum + e.qty : sum),
        0
      );
      met = deckMatches >= prereq.minCopies;
    } else if (focusPool.length > 0 && prereq.kind === 'TRAIT') {
      // shortcut: blank-deck check infers trait availability from focusPool rather than brute-forcing sub-archetype shares; upgrade to full archetype graph if multi-subtrait pools proliferate
      met = focusPool.some((c) => c.cardNo !== card.cardNo && matchesEffectPrerequisite(c, prereq));
    } else {
      const poolMatches = pool.filter((c) => c.cardNo !== card.cardNo && matchesEffectPrerequisite(c, prereq)).length;
      met = poolMatches >= (prereq.minCopies === 8 ? 2 : 1);
    }

    if (!met) {
      if (prereq.primaryClause) unmetPrimary = true;
      penalty += prereq.primaryClause ? 70 : 30;
      reasons.push(prereq.reason);
    }
  }

  return { unmetPrimary, penalty, reasons };
}

interface RankedInternal extends DeckRecommendation {
  unmetPrimary: boolean;
  enablesUnitPrereq: boolean;
}

function rankCandidatesForStrategy(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint,
  currentEntries: DeckEntry[],
  limit = 24
): RankedInternal[] {
  const pool = filterPoolByConstraints(allCards, blueprint);
  const uniqueByNo = new Map(pool.map((c) => [c.cardNo, c]));

  const maxCopies = blueprint.constraints?.maxCopiesPerCard ?? 4;
  const currentCounts = new Map<string, number>();
  const currentCardObjs: { card: GundamCardPrint; qty: number }[] = [];
  const currentCards: GundamCardPrint[] = [];
  const deckTraitFreq = new Map<string, number>();

  for (const e of currentEntries) {
    currentCounts.set(e.cardNo, (currentCounts.get(e.cardNo) ?? 0) + e.qty);
    const c = uniqueByNo.get(e.cardNo);
    if (c) {
      currentCardObjs.push({ card: c, qty: e.qty });
      currentCards.push(c);
      for (const tr of c.traits) {
        deckTraitFreq.set(tr.toLowerCase(), (deckTraitFreq.get(tr.toLowerCase()) ?? 0) + e.qty);
      }
    }
  }

  const poolTraitFreq = new Map<string, number>();
  for (const c of pool) {
    for (const tr of c.traits) {
      poolTraitFreq.set(tr.toLowerCase(), (poolTraitFreq.get(tr.toLowerCase()) ?? 0) + 1);
    }
  }

  const currentUnits = currentCards.filter((c) => c.type === 'UNIT');
  const currentPilots = currentCards.filter((c) => c.type === 'PILOT' || isCommandPilot(c));
  const poolUnits = pool.filter((c) => c.type === 'UNIT');
  const poolPilots = pool.filter((c) => c.type === 'PILOT' || isCommandPilot(c));

  const focuses = normalizeTraitFocus(blueprint.traitFocus as unknown as string | string[]);
  const focusPool =
    focuses.length > 0
      ? pool.filter((c) => c.traits.some((tr) => focuses.some((f) => tr.toLowerCase().includes(f.toLowerCase()))))
      : [];

  // Knowledge Map Enabler/Payoff sets across cards already in the deck
  const deckEnablers = new Map<SynergyNodeKey, GundamCardPrint>();
  const deckPayoffs = new Map<SynergyNodeKey, GundamCardPrint>();
  const neededDeckPrereqs: { card: GundamCardPrint; prereq: EffectPrerequisite }[] = [];
  for (const { card: c } of currentCardObjs) {
    const prof = c.compiledEffect?.synergy ?? EMPTY_SYNERGY;
    for (const k of prof.enables) if (!deckEnablers.has(k)) deckEnablers.set(k, c);
    for (const k of prof.requires) if (!deckPayoffs.has(k)) deckPayoffs.set(k, c);
    for (const p of c.compiledEffect?.prerequisites ?? []) {
      const have = currentCardObjs.reduce(
        (s, x) => (x.card.cardNo !== c.cardNo && matchesEffectPrerequisite(x.card, p) ? s + x.qty : s),
        0
      );
      if (have < p.minCopies) neededDeckPrereqs.push({ card: c, prereq: p });
    }
  }

  const blendedTarget = blendTargetHexagon(blueprint);
  const totalWeight = Math.max(
    1,
    blendedTarget.aggro +
      blendedTarget.defense +
      blendedTarget.tempo +
      blendedTarget.liquidity +
      blendedTarget.synergy +
      blendedTarget.control
  );

  const selectedStyles = new Set(blueprint.styles);
  const selectedEffects = new Set(blueprint.effectStyles ?? []);
  const wantsTrashFuel = selectedEffects.has('Trash Recursion') || deckEnablers.has('DEPLOY_FROM_TRASH');

  const scored: RankedInternal[] = [];

  for (const card of pool) {
    if ((currentCounts.get(card.cardNo) ?? 0) >= maxCopies) continue;

    const sig = scoreSingleCardSignals(card);
    const axisContribs: { axis: keyof HexagonAxes; val: number }[] = [
      { axis: 'aggro', val: sig.aggro * blendedTarget.aggro },
      { axis: 'defense', val: sig.defense * blendedTarget.defense },
      { axis: 'tempo', val: sig.tempo * blendedTarget.tempo },
      { axis: 'liquidity', val: sig.liquidity * blendedTarget.liquidity },
      { axis: 'synergy', val: sig.synergy * blendedTarget.synergy },
      { axis: 'control', val: sig.control * blendedTarget.control },
    ];
    axisContribs.sort((a, b) => b.val - a.val);
    const primaryAxis = axisContribs[0].axis;

    let fit = axisContribs.reduce((s, x) => s + x.val, 0) / totalWeight;
    let coherenceScore = 0;
    const reasons: string[] = [];

    // 1. Multi-Strategy tactical bonuses
    const cost = card.cost ?? 2;
    if (selectedStyles.has('Link-Strike') && (card.link || card.type === 'PILOT' || isCommandPilot(card) || sig.hasPairTrigger)) {
      fit += 14;
      reasons.push('Triggers Link-Strike synergy');
    }
    if (selectedStyles.has('High-Liquidity Draw') && (sig.hasDraw || sig.hasSearch)) {
      fit += 18;
      reasons.push('Feeds High-Liquidity Draw engine');
    }
    if (selectedStyles.has('Repair Fortress') && (sig.hasRepair || sig.hasBlocker || card.type === 'BASE')) {
      fit += 18;
      reasons.push('Fortifies Repair/Blocker shell');
    }
    if (selectedStyles.has('Shield Breach') && (sig.hasBreach || sig.hasFirstStrike || (card.type === 'UNIT' && cost <= 2))) {
      fit += 16;
      reasons.push('Applies Shield Breach pressure');
    }
    if (selectedStyles.has('Wide Swarm') && ((card.type === 'UNIT' && cost <= 2) || sig.effectStyles.includes('Token Deploy'))) {
      fit += 16;
    }
    if (selectedStyles.has('Command Control') && (card.type === 'COMMAND' || sig.hasRemoval || sig.hasRest)) {
      fit += 16;
    }
    if (selectedStyles.has('Resource Ramp') && (sig.hasRamp || cost >= 5)) {
      fit += 16;
    }

    // 2. Effect Style factor bonuses & Self-mill/Discard Trash fuel enablers
    const candSynergy = card.compiledEffect?.synergy ?? EMPTY_SYNERGY;
    const matchedEffectStyles = sig.effectStyles.filter((es) => selectedEffects.has(es));
    if (matchedEffectStyles.length > 0) {
      fit += matchedEffectStyles.length * 18;
      reasons.push(`Matches Effect Style: ${matchedEffectStyles.join(', ')}`);
    }
    if (wantsTrashFuel && candSynergy.enables.includes('TRASH_COUNT_FUEL')) {
      fit += 18;
      reasons.push('Feeds Trash Recursion / self-mill setup');
    }

    // 3. Pacing alignment
    if (blueprint.pacing === 'Early Rush') {
      if (cost <= 2) {
        fit += 15;
        reasons.push('Ideal Cost ≤2 Rush curve');
      } else if (cost >= 5) {
        fit -= 15;
      }
    } else if (blueprint.pacing === 'Late-Game Control') {
      if (cost >= 3 && (sig.hasRest || sig.hasRemoval || sig.hasRepair || sig.hasBlocker)) {
        fit += 14;
        reasons.push('Control/defense stabilizer');
      }
    } else if (blueprint.pacing === 'Ramp / Combo') {
      if (sig.hasRamp || cost >= 5) {
        fit += 15;
        reasons.push('Supports Ramp payoff curve');
      }
    }

    // 4. Trait + Linkage Coherence Counting (Series intentionally excluded per Q9)
    if (focuses.length > 0) {
      const matchedFocuses = focuses.filter((focus) =>
        card.traits.some((tr) => tr.toLowerCase().includes(focus.toLowerCase()))
      );
      if (matchedFocuses.length > 0) {
        coherenceScore += card.type === 'COMMAND' ? 32 : 56;
        reasons.push(`Trait coherence: (${matchedFocuses.join(', ')})`);
      }
    }

    // Shared Trait overlap with cards already in deck (or dense Trait clusters in pool)
    let sharedTraitHits = 0;
    let bestSharedTrait = '';
    for (const tr of card.traits) {
      const freq = deckTraitFreq.get(tr.toLowerCase()) ?? 0;
      if (freq > sharedTraitHits) {
        sharedTraitHits = freq;
        bestSharedTrait = tr;
      }
    }
    if (sharedTraitHits > 0) {
      coherenceScore += Math.min(28, sharedTraitHits * 4);
      reasons.push(`Shares (${bestSharedTrait}) trait with ${sharedTraitHits} card(s) in deck`);
    } else if (card.traits.length > 0) {
      const maxPoolTrait = Math.max(...card.traits.map((t) => poolTraitFreq.get(t.toLowerCase()) ?? 0));
      if (maxPoolTrait >= 6) {
        coherenceScore += 10;
      }
    }

    // Trait-tutoring bonus: e.g. "(Zeon) Unit" in effect text matching deck traits
    const traitRef = card.effect.match(/\(([A-Za-z0-9 '&-]+)\)\s*Unit/i);
    if (traitRef && (deckTraitFreq.get(traitRef[1].trim().toLowerCase()) ?? 0) >= 2) {
      coherenceScore += 20;
      reasons.push(`Buffs/searches (${traitRef[1].trim()}) formation`);
    }

    // Pilot–Unit Linkage coherence (explicitly counts live Link pairs in deck or eligible pool)
    if (card.type === 'PILOT' || isCommandPilot(card)) {
      const deckLinks = currentUnits.filter((u) => doesPilotLinkUnit(card, u)).length;
      const poolLinks = poolUnits.filter((u) => doesPilotLinkUnit(card, u)).length;
      if (deckLinks > 0) {
        coherenceScore += 36 + Math.min(18, deckLinks * 6);
        reasons.push(`Links with ${deckLinks} Unit(s) in deck`);
      } else if (poolLinks > 0) {
        coherenceScore += 14;
        reasons.push(`Links with ${poolLinks} Unit(s) in set pool`);
      }
    } else if (card.type === 'UNIT' && card.link) {
      const deckLinks = currentPilots.filter((p) => doesPilotLinkUnit(p, card)).length;
      const poolLinks = poolPilots.filter((p) => doesPilotLinkUnit(p, card)).length;
      if (deckLinks > 0) {
        coherenceScore += 34;
        reasons.push(`Links with Pilot in deck (${card.link})`);
      } else if (poolLinks > 0) {
        coherenceScore += 14;
      }
    }

    // Knowledge Map Enabler <-> Payoff synergy (restores conditional discount + boosts coherence)
    for (const req of candSynergy.requires) {
      const enabler = deckEnablers.get(req);
      if (enabler && enabler.cardNo !== card.cardNo) {
        coherenceScore += 28;
        if (sig.hasConditionalGate) fit += 20;
        reasons.push(`Payoff unlocked by ${enabler.name} in deck`);
      }
    }
    for (const en of candSynergy.enables) {
      const payoff = deckPayoffs.get(en);
      if (payoff && payoff.cardNo !== card.cardNo) {
        coherenceScore += 24;
        reasons.push(`Enables ${payoff.name} in deck`);
      }
    }

    let enablesUnitPrereq = false;
    for (const need of neededDeckPrereqs) {
      if (need.card.cardNo !== card.cardNo && matchesEffectPrerequisite(card, need.prereq)) {
        coherenceScore += need.prereq.primaryClause ? 30 : 14;
        enablesUnitPrereq = true;
        reasons.push(`Enables ${need.card.name} (${need.prereq.reason})`);
        break;
      }
    }

    // 5. Effect Prerequisite penalty (enforces trait/color/pilot presence thresholds)
    const prereqCheck = evaluateCardPrerequisites(card, currentEntries, currentCardObjs, pool, focusPool);
    if (prereqCheck.penalty > 0) {
      fit -= prereqCheck.penalty;
      reasons.unshift(...prereqCheck.reasons);
    }

    const combinedFit = clamp(fit + coherenceScore * 0.65);

    scored.push({
      card,
      fitScore: combinedFit,
      coherenceScore: clamp(coherenceScore),
      primaryAxis,
      primaryAxisLabel: AXIS_LABELS[primaryAxis],
      matchedEffectStyles,
      reason:
        reasons[0] ??
        `${AXIS_LABELS[primaryAxis]} specialist (${card.color} ${card.type}, Lv.${card.lv ?? '-'})`,
      unmetPrimary: prereqCheck.unmetPrimary,
      enablesUnitPrereq,
    });
  }

  scored.sort((a, b) => b.fitScore - a.fitScore || b.coherenceScore - a.coherenceScore);
  return scored.slice(0, limit);
}

export function getRecommendedCardsForStrategy(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint,
  currentEntries: DeckEntry[],
  limit = 24
): DeckRecommendation[] {
  return rankCandidatesForStrategy(allCards, blueprint, currentEntries, limit).map(
    ({ unmetPrimary: _u, enablesUnitPrereq: _e, ...rec }) => rec
  );
}

export function generateStrategyDeck(
  allCards: GundamCardPrint[],
  blueprint: StrategyBlueprint
): {
  mainDeck: DeckEntry[];
  resourceDeck: DeckEntry[];
  resolvedColors: CardColor[];
  feasibility: ConstraintFeasibility;
} {
  const feasibility = evaluateConstraintFeasibility(allCards, blueprint);
  const resourceCards = allCards.filter((c) => c.type === 'RESOURCE');

  if (!feasibility.feasible) {
    return {
      mainDeck: [],
      resourceDeck: [],
      resolvedColors: blueprint.colors,
      feasibility,
    };
  }

  const maxCopies = blueprint.constraints?.maxCopiesPerCard ?? 4;
  let effectiveBlueprint = blueprint;

  // Resolve "Any (Auto Best 2)" colors if colors array is empty
  if (blueprint.colors.length === 0) {
    const colorPool: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White'];
    let bestPair: CardColor[] = ['Blue', 'White'];
    let bestScore = -Infinity;

    for (let i = 0; i < colorPool.length; i++) {
      for (let j = i + 1; j < colorPool.length; j++) {
        const candidateColors: CardColor[] = [colorPool[i], colorPool[j]];
        const candBlueprint = { ...blueprint, colors: candidateColors };
        const candPool = filterPoolByConstraints(allCards, candBlueprint);
        if (candPool.length * maxCopies < 50) continue;
        const rankedTop = getRecommendedCardsForStrategy(allCards, candBlueprint, [], 25);
        const sumScore = rankedTop.reduce((s, r) => s + r.fitScore + r.coherenceScore * 0.4, 0);
        if (sumScore > bestScore) {
          bestScore = sumScore;
          bestPair = candidateColors;
        }
      }
    }
    effectiveBlueprint = { ...blueprint, colors: bestPair };
  }

  const activeStyles = new Set(effectiveBlueprint.styles);

  const targetUnits =
    effectiveBlueprint.pacing === 'Early Rush'
      ? 30
      : effectiveBlueprint.pacing === 'Late-Game Control'
      ? 24
      : 26;
  const targetPilots = activeStyles.has('Link-Strike') ? 10 : 8;
  const targetBases = activeStyles.has('Repair Fortress') ? 6 : 4;
  const targetCommands = 50 - targetUnits - targetPilots - targetBases;

  const chosen = new Map<string, { card: GundamCardPrint; qty: number }>();
  let total = 0;

  const toEntries = (): DeckEntry[] =>
    [...chosen.values()].map(({ card, qty }) => ({ cardNo: card.cardNo, printId: card.printId, qty }));

  const addCopies = (card: GundamCardPrint, desiredQty: number) => {
    if (total >= 50) return;
    const existing = chosen.get(card.cardNo)?.qty ?? 0;
    const room = Math.min(maxCopies - existing, 50 - total, desiredQty);
    if (room <= 0) return;
    chosen.set(card.cardNo, { card, qty: existing + room });
    total += room;
  };

  // Pass 1: Units ranked against pool & Trait Focus
  const pass1Units = rankCandidatesForStrategy(allCards, effectiveBlueprint, [], 400);
  let unitTotal = 0;
  let earlyUnitTotal = 0;
  const minEarlyUnits = effectiveBlueprint.pacing === 'Early Rush' ? 16 : 10;

  for (const { card, unmetPrimary } of pass1Units) {
    if (earlyUnitTotal >= minEarlyUnits || unitTotal >= targetUnits) break;
    if (card.type === 'UNIT' && (card.cost ?? 9) <= 2 && !unmetPrimary) {
      const q = Math.min(maxCopies, minEarlyUnits - earlyUnitTotal, targetUnits - unitTotal);
      addCopies(card, q);
      earlyUnitTotal += q;
      unitTotal += q;
    }
  }
  for (const { card, unmetPrimary } of pass1Units) {
    if (unitTotal >= targetUnits) break;
    if (card.type === 'UNIT' && !unmetPrimary) {
      const prev = chosen.get(card.cardNo)?.qty ?? 0;
      if (prev >= maxCopies) continue;
      const q = Math.min(Math.min(3, maxCopies), targetUnits - unitTotal, maxCopies - prev);
      addCopies(card, q);
      unitTotal += q;
    }
  }

  // Pass 2: Pilots & Bases re-scored against chosen Units
  const chosenUnits = [...chosen.values()].filter((x) => x.card.type === 'UNIT').map((x) => x.card);
  const pass2Ranked = rankCandidatesForStrategy(allCards, effectiveBlueprint, toEntries(), 400);
  const pilotRanked = pass2Ranked
    .filter((r) => (r.card.type === 'PILOT' || isCommandPilot(r.card)) && !r.unmetPrimary)
    .map((r) => {
      const linkMatches = chosenUnits.filter((u) => doesPilotLinkUnit(r.card, u)).length;
      return { ...r, score: r.fitScore + linkMatches * 35 + (r.enablesUnitPrereq ? 50 : 0) };
    })
    .sort((a, b) => b.score - a.score);

  let pilotTotal = 0;
  for (const { card, enablesUnitPrereq } of pilotRanked) {
    if (pilotTotal >= targetPilots) break;
    const cap = enablesUnitPrereq ? maxCopies : Math.min(3, maxCopies);
    const q = Math.min(cap, targetPilots - pilotTotal);
    addCopies(card, q);
    pilotTotal += q;
  }

  let baseTotal = 0;
  for (const { card, unmetPrimary } of pass2Ranked) {
    if (baseTotal >= targetBases) break;
    if (card.type === 'BASE' && !unmetPrimary) {
      const q = Math.min(Math.min(2, maxCopies), targetBases - baseTotal);
      addCopies(card, q);
      baseTotal += q;
    }
  }

  // Pass 3: Commands & remaining slots re-scored against chosen Units + Pilots + Bases
  const pass3Ranked = rankCandidatesForStrategy(allCards, effectiveBlueprint, toEntries(), 400);
  let cmdTotal = 0;
  for (const { card, unmetPrimary } of pass3Ranked) {
    if (cmdTotal >= targetCommands || total >= 50) break;
    if (card.type === 'COMMAND' && !unmetPrimary) {
      const q = Math.min(Math.min(3, maxCopies), targetCommands - cmdTotal, 50 - total);
      addCopies(card, q);
      cmdTotal += q;
    }
  }

  for (const { card, unmetPrimary } of pass3Ranked) {
    if (total >= 50) break;
    if (unmetPrimary) continue;
    const prev = chosen.get(card.cardNo)?.qty ?? 0;
    if (prev < maxCopies) {
      addCopies(card, Math.min(maxCopies - prev, 50 - total));
    }
  }

  // Fallback only if constrained pool cannot reach 50 without relaxing primary prerequisites
  for (const { card } of pass3Ranked) {
    if (total >= 50) break;
    const prev = chosen.get(card.cardNo)?.qty ?? 0;
    if (prev < maxCopies) {
      addCopies(card, Math.min(maxCopies - prev, 50 - total));
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

  return {
    mainDeck,
    resourceDeck,
    resolvedColors: effectiveBlueprint.colors,
    feasibility,
  };
}

/** Strict `<number> <card number>` export only (Q4) */
export function exportDeckToText(
  deck: SavedDeck,
  _byPrintId?: Map<string, GundamCardPrint>,
  _byCardNo?: Map<string, GundamCardPrint>
): string {
  const lines: string[] = [];
  for (const entry of deck.mainDeck) {
    if (entry.qty > 0) lines.push(`${entry.qty} ${entry.cardNo}`);
  }
  for (const entry of deck.resourceDeck) {
    if (entry.qty > 0) lines.push(`${entry.qty} ${entry.cardNo}`);
  }
  return lines.join('\n');
}

/** Strict `<number> <card number>` import parser only (Q4) */
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
    if (!line) continue;

    // Accept strictly `<integer> <cardNo>` with no comments, `4x`, or card names
    const match = line.match(/^(\d+)\s+([A-Za-z0-9_-]+)$/);
    if (!match) {
      unmatched.push(line);
      continue;
    }

    const qty = parseInt(match[1], 10);
    const idToken = match[2];
    if (!Number.isInteger(qty) || qty <= 0) {
      unmatched.push(line);
      continue;
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
      qty: (prev?.qty ?? 0) + qty,
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

export function createBlankCustomDeck(index = 1): SavedDeck {
  return {
    id: `custom-${Date.now()}-${index}`,
    name: index === 1 ? 'Custom Deck' : `Custom Deck ${index}`,
    updatedAt: new Date().toISOString(),
    mainDeck: [],
    resourceDeck: [],
    strategyBlueprint: DEFAULT_BLUEPRINT,
  };
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
  { code: 'ST05', name: 'ST05 Iron Bloom', colors: ['Purple', 'White'], subtitle: 'Tekkadan Disruption & Recursion' },
  { code: 'ST06', name: 'ST06 Clan Unity', colors: ['Red', 'Blue'], subtitle: 'Clan Link Tempo' },
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

  for (const c of stCards) {
    if (total >= 50) break;
    const qty = c.rarity === 'LR' ? 2 : c.rarity === 'R' ? 3 : 4;
    const add = Math.min(qty, 50 - total);
    if (add > 0) {
      mainDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: add });
      total += add;
    }
  }
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
