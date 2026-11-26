import type { CardColor, HexagonAxes, MatchupAssessment, PacingTier } from '@/types/gundam';

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
    hexagon: { aggro: 88, defense: 38, attack: 70, liquidity: 36, synergy: 62, control: 42 },
    threatNote: 'Floods low-cost Units on Turns 1–3 and pushes lethal before slow hands stabilize.',
  },
  {
    name: 'Blue/White Link Control',
    colors: ['Blue', 'White'],
    pacing: 'Late-Game Control',
    hexagon: { aggro: 44, defense: 78, attack: 40, liquidity: 76, synergy: 82, control: 84 },
    threatNote: 'Stacks <Repair> / <Blocker>, draws deeply, and locks combat with Rest Commands.',
  },
  {
    name: 'Green Resource Ramp & Titans',
    colors: ['Green'],
    pacing: 'Ramp / Combo',
    hexagon: { aggro: 62, defense: 60, attack: 50, liquidity: 70, synergy: 58, control: 46 },
    threatNote: 'Accelerates Resources to deploy Lv.5–7 boss Units 1–2 turns ahead of curve.',
  },
  {
    name: 'White/Red SEED Midrange',
    colors: ['White', 'Red'],
    pacing: 'Midrange Tempo',
    hexagon: { aggro: 70, defense: 62, attack: 55, liquidity: 58, synergy: 76, control: 62 },
    threatNote: 'Combines efficient Linked Units with flexible combat tricks and Burst shields.',
  },
  {
    name: 'Blue/Green Repair Fortress',
    colors: ['Blue', 'Green'],
    pacing: 'Late-Game Control',
    hexagon: { aggro: 40, defense: 90, attack: 30, liquidity: 68, synergy: 64, control: 64 },
    threatNote: 'Grinds out attackers with <Repair>, high-HP Bases, and end-of-turn recovery.',
  },
  {
    name: 'Purple/Red Disruption Engine',
    colors: ['Purple', 'Red'],
    pacing: 'Midrange Tempo',
    hexagon: { aggro: 66, defense: 45, attack: 62, liquidity: 62, synergy: 60, control: 86 },
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
  edge += (myHex.attack - oppHex.attack) * 0.16;
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
