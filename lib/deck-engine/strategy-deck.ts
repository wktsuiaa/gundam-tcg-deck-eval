import type { CardColor, DeckEntry, DeckRecommendation, GundamCardPrint, StrategyBlueprint } from '@/types/gundam';
import { doesPilotLinkUnit, isCommandPilot } from '@/lib/gundam-keywords';
import { rankCandidatesForStrategy } from './candidate-ranking';
import { ConstraintFeasibility, evaluateConstraintFeasibility, filterPoolByConstraints } from './constraints';

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
  const targetPilots = activeStyles.has('Link / Synergy Combo') ? 10 : 8;
  const targetBases = activeStyles.has('Control / Attrition') ? 6 : 4;
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
