import type { DeckAnalysis, DetectedCombo, GundamCardPrint, HexagonAxes, OpeningHandQuality, PacingTier, TurnActionInsight, TurnOrderSetting, TurnWinChancePoint } from '@/types/gundam';
import { scoreSingleCardSignals } from './card-signals';
import { hypergeometricAtLeast } from './deck-validation';
import { evaluateMatchupBetween } from './matchup';
import { clamp } from './shared';

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
      if (p === 'Early Rush') return hex.aggro * (turn <= 3 ? 1.15 : 0.85) + hex.attack * 0.4;
      if (p === 'Ramp / Combo') return hex.liquidity * 0.65 + (turn >= 4 ? hex.aggro * 1.1 + hex.defense * 0.6 : hex.defense * 0.4);
      if (p === 'Late-Game Control') return hex.control * 0.6 + hex.defense * 0.6 + (turn >= 4 ? hex.liquidity * 0.9 : 20);
      return (hex.aggro + hex.attack + hex.synergy) * 0.48 + (turn >= 3 ? hex.liquidity * 0.3 : 10);
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
