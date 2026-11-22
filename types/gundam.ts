export type CardColor = 'Blue' | 'Green' | 'Red' | 'Purple' | 'White' | 'Colorless';

export type CardType =
  | 'UNIT'
  | 'PILOT'
  | 'COMMAND'
  | 'BASE'
  | 'RESOURCE'
  | 'EX BASE'
  | 'EX RESOURCE'
  | 'UNIT TOKEN'
  | string;

export interface CardFaq {
  q: string;
  a: string;
}

export interface GundamCardPrint {
  printId: string;
  cardNo: string;
  name: string;
  rarity: string;
  blockIcon: string;
  lv: number | null;
  cost: number | null;
  color: CardColor;
  type: CardType;
  effect: string;
  zones: string[];
  traits: string[];
  link: string;
  apRaw: string;
  hpRaw: string;
  ap: number | null;
  hp: number | null;
  sourceTitle: string;
  whereToGet: string;
  imagePath: string;
  isParallel: boolean;
  faqs: CardFaq[];
  packageIds: string[];
  packageNames: string[];
  packageCodes: string[];
}

export interface GundamCardGroup {
  cardNo: string;
  primary: GundamCardPrint;
  variants: GundamCardPrint[];
}

export interface GundamPackage {
  id: string;
  name: string;
  code: string;
  category: string;
  cardCount: number;
}

export interface CatalogPayload {
  syncedAt: string;
  source: string;
  totalPrints: number;
  packages: GundamPackage[];
  cards: GundamCardPrint[];
}

export interface DeckEntry {
  cardNo: string;
  printId: string; // Preferred artwork printId
  qty: number;
}

export type PacingTier = 'Early Rush' | 'Midrange Tempo' | 'Late-Game Control' | 'Ramp / Combo';

export type TacticalStyleTag =
  | 'Link-Strike'
  | 'High-Liquidity Draw'
  | 'Repair Fortress'
  | 'Shield Breach'
  | 'Wide Swarm'
  | 'Command Control'
  | 'Resource Ramp'
  | 'Balanced Midrange';

export interface HexagonAxes {
  aggro: number;      // Aggro / Pressure (0-100)
  defense: number;    // Defense / Durability (0-100)
  tempo: number;      // Tempo / Resource (0-100)
  liquidity: number;  // Card Liquidity (0-100)
  synergy: number;    // Synergy / Link (0-100)
  control: number;    // Control / Disruption (0-100)
}

export interface AxisBreakdown {
  key: keyof HexagonAxes;
  label: string;
  score: number;
  summary: string;
  drivers: string[];
}

export interface SavedDeck {
  id: string;
  name: string;
  updatedAt: string;
  mainDeck: DeckEntry[];
  resourceDeck: DeckEntry[];
  strategyBlueprint?: StrategyBlueprint;
  notes?: string;
}

export interface StrategyBlueprint {
  colors: CardColor[];
  pacing: PacingTier;
  primaryStyle: TacticalStyleTag;
  traitFocus: string;
  targetHexagon: HexagonAxes;
}

export interface DeckValidationResult {
  isLegal: boolean;
  mainCount: number;
  resourceCount: number;
  colors: CardColor[];
  errors: string[];
  warnings: string[];
}

export interface MatchupAssessment {
  opponentName: string;
  opponentColors: CardColor[];
  opponentPacing: PacingTier;
  opponentHexagon: HexagonAxes;
  difficultyScore: number; // 1 (Very Favored) to 5 (Hard Counter)
  verdict: 'Favored' | 'Slightly Favored' | 'Even' | 'Challenging' | 'Hard Matchup';
  advantages: string[];
  risks: string[];
  keyTip: string;
}

export interface StartingHandScenario {
  title: string;
  cards: GundamCardPrint[];
  explanation: string;
}

export interface CriticalTurnPoint {
  turnLabel: string;
  levelWindow: string;
  objective: string;
  keyCards: GundamCardPrint[];
}

export interface DetectedCombo {
  title: string;
  category: 'Link Pair' | 'Trait Synergy' | 'Mechanic Chain';
  cards: GundamCardPrint[];
  description: string;
}

export interface DeckPlaybook {
  primaryObjective: string;
  advantageMechanism: string;
  bestStartingHand: StartingHandScenario;
  worstStartingHand: StartingHandScenario;
  odds: {
    earlyPlayablePct: number;
    drawEnginePct: number;
    linkPairPct: number;
  };
  mulliganCriteria: {
    keepRules: string[];
    redrawRules: string[];
  };
  criticalTurns: CriticalTurnPoint[];
  combos: DetectedCombo[];
}

export interface HandVerdict {
  status: 'Keep' | 'Borderline' | 'Mulligan';
  score: number;
  reasons: string[];
}

export interface DeckAnalysis {
  validation: DeckValidationResult;
  hexagon: HexagonAxes;
  breakdowns: AxisBreakdown[];
  pacing: PacingTier;
  styles: TacticalStyleTag[];
  strengths: string[];
  weaknesses: string[];
  avgCost: number;
  avgLv: number;
  costCurve: { cost: string; count: number }[];
  lvCurve: { lv: string; count: number }[];
  typeSplit: { type: string; count: number }[];
  colorSplit: { color: CardColor; count: number }[];
  linkCoveragePct: number;
  matchups: MatchupAssessment[];
  playbook: DeckPlaybook;
}

export type CollectionMap = Record<string, number>; // printId -> owned count
