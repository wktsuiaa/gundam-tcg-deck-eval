import type { CompiledCardEffect } from '@/lib/effect-parser';

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
  compiledEffect?: CompiledCardEffect;
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

export interface RuleDocument {
  title: string;
  url: string;
}

export interface RuleSection {
  id: string;
  title: string;
  category: string;
  summary: string;
  sourceUrl: string;
}

export interface DeckConstructionRules {
  mainDeckSize: number;
  resourceDeckSize: number;
  maxColors: number;
  maxCopiesPerCardNo: number;
  allowedMainTypes: string[];
  allowedResourceTypes: string[];
  startingHandSize: number;
  startingShieldCount: number;
  turnPhases: { phase: string; summary: string }[];
}

export interface RulesPayload {
  syncedAt: string;
  source: string;
  faqSource: string;
  deckConstruction: DeckConstructionRules;
  documents: RuleDocument[];
  sections: RuleSection[];
  generalFaqs: CardFaq[];
  cardFaqs: Record<string, CardFaq[]>;
}

export interface CatalogPayload {
  syncedAt: string;
  source: string;
  totalPrints: number;
  packages: GundamPackage[];
  cards: GundamCardPrint[];
  rules?: RulesPayload;
}

export interface DeckEntry {
  cardNo: string;
  printId: string;
  qty: number;
}

export type PacingTier = 'Early Rush' | 'Midrange Tempo' | 'Late-Game Control' | 'Ramp / Combo';

export type TacticalStyleTag =
  | 'Rush / Aggro'
  | 'Midrange / Value'
  | 'Control / Attrition'
  | 'Ramp / Big Unit'
  | 'Link / Synergy Combo'
  | 'Burn / Ping';

export type EffectStyleTag =
  | 'Attack / Ping'
  | 'Board / Deploy'
  | 'Removal / Disrupt'
  | 'Draw / Recursion'
  | 'Resource / Ramp'
  | 'Link / Synergy';

export interface HexagonAxes {
  aggro: number;
  defense: number;
  attack: number;
  liquidity: number;
  synergy: number;
  control: number;
}

export interface AxisBreakdown {
  key: keyof HexagonAxes;
  label: string;
  score: number;
  summary: string;
  drivers: string[];
}

export interface DeckGenerationConstraints {
  allowedPackageCodes: string[]; // empty = All Sets
  maxCopiesPerCard: 1 | 2 | 3 | 4;
  maxCost: number | null;
  maxLv: number | null;
  rarityCap: 'ALL' | 'NO_LR' | 'C_U_R_ONLY';
  strictTraitLinkLock: boolean;
}

export interface StrategyBlueprint {
  colors: CardColor[]; // empty = Auto Best 2
  pacing: PacingTier;
  styles: TacticalStyleTag[];
  effectStyles: EffectStyleTag[];
  traitFocus: string[];
  targetHexagon: HexagonAxes;
  constraints: DeckGenerationConstraints;
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
  difficultyScore: number;
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

export interface TurnActionInsight {
  turnNumber: number;
  turnLabel: string;
  levelWindow: string;
  bestAction: string;
  worstAction: string;
  bestCards: GundamCardPrint[];
  worstCards: GundamCardPrint[];
}

export type TurnOrderSetting = 'first' | 'second';
export type OpeningHandQuality = 'optimal' | 'average' | 'mulliganed';

export interface TurnWinChancePoint {
  turnNumber: number;
  turnLabel: string;
  winChancePct: number;
  curveHitPct: number;
  linkReadyPct: number;
  tempoDelta: number;
  note: string;
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
  turnInsights: TurnActionInsight[];
  combos: DetectedCombo[];
}

export interface HandVerdict {
  status: 'Keep' | 'Borderline' | 'Mulligan';
  score: number;
  reasons: string[];
}

export interface DeckRecommendation {
  card: GundamCardPrint;
  fitScore: number;
  coherenceScore: number;
  primaryAxis: keyof HexagonAxes;
  primaryAxisLabel: string;
  matchedEffectStyles: EffectStyleTag[];
  reason: string;
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

export type SandboxPhase = 'START' | 'MAIN' | 'END';
export type SandboxSide = 'A' | 'B';

export interface SandboxUnitInstance {
  instanceId: string;
  card: GundamCardPrint;
  pairedPilot: GundamCardPrint | null;
  isLinked: boolean;
  rested: boolean;
  damage: number;
  apBuff: number;
  summonedTurn: number;
  deployedFromZone?: 'hand' | 'trash';
  activatedMainTurn?: number;
  triggeredClauseTurns?: Record<string, number>;
}

export interface SandboxPlayerState {
  side: SandboxSide;
  deckName: string;
  colors: CardColor[];
  library: GundamCardPrint[];
  hand: GundamCardPrint[];
  shields: number;
  resourcesTotal: number;
  resourcesActive: number;
  base: GundamCardPrint | null;
  baseDamage: number;
  activatedBaseMainTurn?: number;
  battleArea: SandboxUnitInstance[];
  trash: GundamCardPrint[];
}

export interface SandboxActionLogEntry {
  id: string;
  turn: number;
  side: SandboxSide;
  summary: string;
}

export interface SandboxMoveSuggestion {
  id: string;
  rank: 1 | 2 | 3;
  actionType: 'DEPLOY_UNIT' | 'PAIR_PILOT' | 'PLAY_COMMAND' | 'DEPLOY_BASE' | 'ACTIVATE_MAIN' | 'ATTACK_SHIELD' | 'ATTACK_UNIT' | 'PASS_TURN';
  title: string;
  reason: string;
  winDeltaPct: number;
  priorityScore: number;
  card?: GundamCardPrint;
  unitInstanceId?: string;
  targetInstanceId?: string;
}

export interface SandboxMatchState {
  turn: number;
  activeSide: SandboxSide;
  firstSide: SandboxSide;
  phase: SandboxPhase;
  winner: SandboxSide | null;
  lastOpponentAction: string;
  players: Record<SandboxSide, SandboxPlayerState>;
  log: SandboxActionLogEntry[];
}
