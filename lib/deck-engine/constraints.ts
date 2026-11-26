import type { CardColor, GundamCardPrint, HexagonAxes, StrategyBlueprint } from '@/types/gundam';
import { doesPilotLinkUnit, isCommandPilot } from '@/lib/gundam-keywords';
import { MAIN_DECK_TYPES, clamp } from './shared';
import { DEFAULT_BLUEPRINT, DEFAULT_CONSTRAINTS, TACTICAL_STYLE_META, normalizeTraitFocus } from './strategy-meta';

export function blendTargetHexagon(blueprint: StrategyBlueprint): HexagonAxes {
  const base = { ...blueprint.targetHexagon };
  const activeStyles = blueprint.styles.length > 0 ? blueprint.styles : DEFAULT_BLUEPRINT.styles;
  const styleBiases = activeStyles
    .map((s) => TACTICAL_STYLE_META.find((m) => m.tag === s)?.targetBias)
    .filter(Boolean) as Partial<HexagonAxes>[];

  if (styleBiases.length === 0) return base;

  const keys: (keyof HexagonAxes)[] = ['aggro', 'defense', 'attack', 'liquidity', 'synergy', 'control'];
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
