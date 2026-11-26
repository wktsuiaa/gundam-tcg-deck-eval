import type { CardColor, DeckEntry, DeckValidationResult, GundamCardPrint, SavedDeck } from '@/types/gundam';
import { MAIN_DECK_TYPES } from './shared';

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
