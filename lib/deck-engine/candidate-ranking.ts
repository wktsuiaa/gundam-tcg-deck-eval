import type { DeckEntry, DeckRecommendation, GundamCardPrint, HexagonAxes, StrategyBlueprint, TacticalStyleTag } from '@/types/gundam';
import { doesPilotLinkUnit, extractPilotNamesForLink, isCommandPilot } from '@/lib/gundam-keywords';
import { type EffectPrerequisite, type SynergyNodeKey } from '@/lib/effect-parser';
import { CardSignalScores, collectLoweredSteps, scoreSingleCardSignals } from './card-signals';
import { blendTargetHexagon, filterPoolByConstraints } from './constraints';
import { EMPTY_SYNERGY, clamp } from './shared';
import { normalizeTraitFocus } from './strategy-meta';

export const AXIS_LABELS: Record<keyof HexagonAxes, string> = {
  aggro: 'Aggro / Pressure',
  defense: 'Defense / Durability',
  attack: 'Attack / Ping',
  liquidity: 'Card Liquidity',
  synergy: 'Synergy / Link',
  control: 'Control / Disruption',
};

export interface StrategyFitRule {
  tag: TacticalStyleTag;
  bonus: number;
  reason?: string;
  matches: (card: GundamCardPrint, sig: CardSignalScores) => boolean;
}

/** Per-strategy card bonuses applied when ranking recommendations. */
export const STRATEGY_FIT_RULES: StrategyFitRule[] = [
  {
    tag: 'Link / Synergy Combo',
    bonus: 14,
    reason: 'Triggers Link / Synergy payoffs',
    matches: (c, sig) => Boolean(c.link) || c.type === 'PILOT' || isCommandPilot(c) || sig.hasPairTrigger,
  },
  {
    tag: 'Rush / Aggro',
    bonus: 16,
    reason: 'Applies Rush pressure',
    matches: (c, sig) => sig.hasBreach || sig.hasFirstStrike || (c.type === 'UNIT' && (c.cost ?? 2) <= 2),
  },
  {
    tag: 'Burn / Ping',
    bonus: 16,
    reason: 'Adds Burn / Ping damage',
    matches: (_c, sig) => sig.hasPing || sig.attack >= 40,
  },
  {
    tag: 'Control / Attrition',
    bonus: 16,
    reason: 'Fortifies Control / Attrition shell',
    matches: (c, sig) =>
      c.type === 'COMMAND' || c.type === 'BASE' || sig.hasRemoval || sig.hasRest || sig.hasRepair || sig.hasBlocker,
  },
  {
    tag: 'Ramp / Big Unit',
    bonus: 16,
    matches: (c, sig) => sig.hasRamp || (c.cost ?? 2) >= 5,
  },
  {
    tag: 'Midrange / Value',
    bonus: 16,
    reason: 'Feeds Midrange / Value card flow',
    matches: (_c, sig) => sig.hasDraw || sig.hasSearch,
  },
];

export function matchesEffectPrerequisite(card: GundamCardPrint, prereq: EffectPrerequisite): boolean {
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

export interface UnmetPrereqCheck {
  unmetPrimary: boolean;
  penalty: number;
  reasons: string[];
}

export function evaluateCardPrerequisites(
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

export interface RankedInternal extends DeckRecommendation {
  unmetPrimary: boolean;
  enablesUnitPrereq: boolean;
}

export function rankCandidatesForStrategy(
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
      blendedTarget.attack +
      blendedTarget.liquidity +
      blendedTarget.synergy +
      blendedTarget.control
  );

  const selectedStyles = new Set(blueprint.styles);
  const selectedEffects = new Set(blueprint.effectStyles ?? []);
  const wantsTrashFuel = selectedEffects.has('Draw / Recursion') || deckEnablers.has('DEPLOY_FROM_TRASH');

  const scored: RankedInternal[] = [];

  for (const card of pool) {
    if ((currentCounts.get(card.cardNo) ?? 0) >= maxCopies) continue;

    const sig = scoreSingleCardSignals(card);
    const axisContribs: { axis: keyof HexagonAxes; val: number }[] = [
      { axis: 'aggro', val: sig.aggro * blendedTarget.aggro },
      { axis: 'defense', val: sig.defense * blendedTarget.defense },
      { axis: 'attack', val: sig.attack * blendedTarget.attack },
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
    for (const rule of STRATEGY_FIT_RULES) {
      if (selectedStyles.has(rule.tag) && rule.matches(card, sig)) {
        fit += rule.bonus;
        if (rule.reason) reasons.push(rule.reason);
      }
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

    // Trait-tutoring bonus from compiled AST prerequisites & step targets (never prose regex)
    const unitTraitPrereq =
      card.compiledEffect?.prerequisites.find(
        (p) => p.kind === 'TRAIT' && (p.trait || p.anyTraits?.[0]) && (!p.cardType || p.cardType === 'UNIT')
      ) ?? null;
    const stepTrait = collectLoweredSteps(card)
      .steps.map((x) => ('target' in x.step ? x.step.target?.trait ?? x.step.target?.traits?.[0] : undefined))
      .find(Boolean);
    const refTrait = unitTraitPrereq?.trait ?? unitTraitPrereq?.anyTraits?.[0] ?? stepTrait;
    if (refTrait && (deckTraitFreq.get(refTrait.toLowerCase()) ?? 0) >= 2) {
      coherenceScore += 20;
      reasons.push(`Buffs/searches (${refTrait}) formation`);
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
