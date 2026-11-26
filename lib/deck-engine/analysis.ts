import type { CardColor, DeckAnalysis, GundamCardPrint, HandVerdict, PacingTier, SavedDeck } from '@/types/gundam';
import { doesPilotLinkUnit, isCommandPilot } from '@/lib/gundam-keywords';
import { scoreSingleCardSignals } from './card-signals';
import { expandEntries, validateDeck } from './deck-validation';
import { classifyPacingAndStyle, computeHexagonAndBreakdowns } from './hexagon';
import { META_ARCHETYPES, evaluateMatchupBetween } from './matchup';
import { generateDeckPlaybook } from './playbook';
import { clamp } from './shared';

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
