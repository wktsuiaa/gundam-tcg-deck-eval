import type { DeckPlaybook, DetectedCombo, GundamCardPrint, HexagonAxes, PacingTier, TacticalStyleTag } from '@/types/gundam';
import { doesPilotLinkUnit, isCommandPilot } from '@/lib/gundam-keywords';
import { type SynergyNodeKey } from '@/lib/effect-parser';
import { scoreSingleCardSignals } from './card-signals';
import { hypergeometricAtLeast } from './deck-validation';
import { EMPTY_SYNERGY } from './shared';
import { generateTurnActionInsights } from './turn-insights';

export function generateDeckPlaybook(
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
  if (styles.includes('Rush / Aggro') || pacing === 'Early Rush') {
    primaryObjective = 'Apply relentless Turn 1–4 Shield pressure using low-cost attackers and <Breach> / <First Strike>.';
    advantageMechanism = 'Forces opponents into unfavorable blocks before their high-Lv Units come online.';
  } else if (styles.includes('Burn / Ping')) {
    primaryObjective = 'Chip Shields and Units with direct damage and attack triggers while staying ahead on board.';
    advantageMechanism = 'Effect damage bypasses blockers and turns every attack into extra value.';
  } else if (styles.includes('Midrange / Value')) {
    primaryObjective = 'Out-resource the opponent via superior Card Liquidity, never missing curve drops.';
    advantageMechanism = 'Continuous draw & deck filtering generates +2 to +4 card advantage by midgame.';
  } else if (styles.includes('Control / Attrition')) {
    primaryObjective = 'Stabilize with <Blocker>, <Repair> and removal, turning combat into free attrition.';
    advantageMechanism = 'Opponent runs out of attackers while your Units heal back and Link payoffs are denied.';
  } else if (styles.includes('Link / Synergy Combo')) {
    primaryObjective = 'Assemble Link Unit + Pilot pairs to trigger massive 【When Linked】 swing turns.';
    advantageMechanism = 'Combined Unit+Pilot stats and dual triggers create 2-for-1 tempo swings.';
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
