import type { AxisBreakdown, GundamCardPrint, HexagonAxes, PacingTier, TacticalStyleTag } from '@/types/gundam';
import { doesPilotLinkUnit, isCommandPilot } from '@/lib/gundam-keywords';
import { scoreSingleCardSignals } from './card-signals';
import { clamp } from './shared';

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
      attack: 0,
      liquidity: 0,
      synergy: 0,
      control: 0,
    };
    return {
      hexagon: empty,
      breakdowns: [
        { key: 'aggro', label: 'Aggro / Pressure', score: 0, summary: 'Add cards to measure attack pressure.', drivers: [] },
        { key: 'defense', label: 'Defense / Durability', score: 0, summary: 'Add cards to measure board survival.', drivers: [] },
        { key: 'attack', label: 'Attack / Ping', score: 0, summary: 'Add cards to measure ping damage & attack triggers.', drivers: [] },
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
  let attackSum = 0;
  let pingCount = 0;
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
    attackSum += sig.attack * qty;
    if (sig.hasPing) pingCount += qty;

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
  const attack = clamp(
    (attackSum / norm) * 1.5 + ((pingCount + breachCount + firstStrikeCount) / norm) * 45
  );
  const liquidity = clamp(
    (liquidityCount / norm) * 160 + (searchCount / norm) * 120 + (supportCount / norm) * 20 + (rampCount / norm) * 40
  );
  const synergy = clamp(
    linkCoveragePct * 0.45 +
      (pilots.reduce((s, p) => s + p.qty, 0) / norm) * 90 +
      (topTraitCount / norm) * 48 +
      (supportCount / norm) * 40
  );
  const control = clamp((disruptionCount / norm) * 155 + (commandCount / norm) * 70);

  const hexagon: HexagonAxes = { aggro, defense, attack, liquidity, synergy, control };

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
      key: 'attack',
      label: 'Attack / Ping',
      score: attack,
      summary:
        attack >= 70
          ? 'Constant ping damage, attack triggers and evasive threats chip through defenses.'
          : attack >= 45
          ? 'Some effect-based damage and attack payoffs alongside normal combat.'
          : 'Little effect damage or attack-trigger value; relies on plain combat.',
      drivers: [
        `${pingCount} direct damage / ping cards`,
        `${breachCount} <Breach> / ${firstStrikeCount} <First Strike> threats`,
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
        `${searchCount} deck look / search / trash-recursion cards · ${rampCount} Resource ramp / cost-cheat`,
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

export function classifyPacingAndStyle(
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

  const isRush = breachCount >= 6 || (hexagon.aggro >= 65 && avgCost <= 2.4) || (earlyUnits >= 14 && avgLv <= 3.3);
  const isControl = repairCount >= 6 || hexagon.defense >= 65 || hexagon.control >= 60;
  if (hexagon.synergy >= 62) styles.push('Link / Synergy Combo');
  if (isRush) styles.push('Rush / Aggro');
  if (isControl) styles.push('Control / Attrition');
  if (hexagon.attack >= 62) styles.push('Burn / Ping');
  if (rampCount >= 6) styles.push('Ramp / Big Unit');
  if (hexagon.liquidity >= 58 || styles.length === 0) styles.push('Midrange / Value');

  return { pacing, styles: styles.slice(0, 3) };
}
