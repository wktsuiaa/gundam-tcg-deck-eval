import type { GundamCardPrint } from '../../types/gundam.ts';
import type { ProhibitionRule } from '../cfg-parser.ts';
import {
  type EffectDuration,
  type EffectStep,
  type KeywordAbility,
  type KeywordName,
  type TargetSelector,
} from '../effect-parser.ts';

export type ChainSide = 'A' | 'B';

export type IllegalChainReason =
  | 'WRONG_PHASE'
  | 'NOT_ACTIVE_PLAYER'
  | 'INSUFFICIENT_LV'
  | 'INSUFFICIENT_RESOURCES'
  | 'MISSING_WITNESS'
  | 'INVALID_TARGET'
  | 'NO_LEGAL_TARGET'
  | 'PROHIBITED_BY_CANT'
  | 'UNIT_RESTED'
  | 'SUMMON_SICKNESS'
  | 'ALREADY_PAIRED'
  | 'PILOT_RESTRICTED'
  | 'CONDITION_NOT_MET'
  | 'ONCE_PER_TURN_EXHAUSTED'
  | 'UNIMPLEMENTED_CUSTOM_HOOK'
  | 'INVALID_ACTION';

export interface TemporaryModifier {
  id: string;
  layer: 2 | 3 | 4;
  duration: EffectDuration;
  stat?: 'AP' | 'HP';
  delta?: number;
  keyword?: KeywordAbility;
  traits?: string[];
  rule?: ProhibitionRule | Extract<EffectStep, { action: 'RESTRICTION' }>['rule'] | 'ALLOW_ATTACK_ACTIVE';
  sourceFilter?: TargetSelector;
  defenderFilter?: TargetSelector;
}

export interface ChainUnitInstance {
  instanceId: string;
  card: GundamCardPrint;
  pairedPilot?: GundamCardPrint;
  rested: boolean;
  damage: number;
  deployedTurn: number;
  deployedFromZone?: 'hand' | 'trash';
  temporaryModifiers: TemporaryModifier[];
  triggeredOnceThisTurn: string[];
}

export interface ChainBaseInstance {
  instanceId: string;
  card: GundamCardPrint;
  damage: number;
  temporaryModifiers?: TemporaryModifier[];
}

export interface ChainShieldCard {
  id: string;
  card: GundamCardPrint;
}

export interface ChainPlayerState {
  hand: GundamCardPrint[];
  deck: GundamCardPrint[];
  trash: GundamCardPrint[];
  battleArea: ChainUnitInstance[];
  base: ChainBaseInstance | null;
  shields: ChainShieldCard[];
  activeResources: number;
  restedResources: number;
  exResources: number;
  exiled?: GundamCardPrint[];
  activatedCommandTraitsThisTurn?: string[];
}

export interface ChainMatchState {
  turn: number;
  phase: 'MAIN' | 'ACTION_STEP' | 'END';
  activeSide: ChainSide;
  players: Record<ChainSide, ChainPlayerState>;
  pendingActionStep: null | {
    attackerId: string;
    defenderSide: ChainSide;
    targetKind: 'SHIELD' | 'UNIT';
    targetId?: string;
  };
  shieldDamageProhibitions?: {
    side: ChainSide;
    lvMax?: number;
    apMax?: number;
    duration: EffectDuration;
  }[];
  exResourceSpentOnCurrentPlay?: boolean;
}

export type PlayerAction =
  | { type: 'DEPLOY_UNIT'; side: ChainSide; handIndex: number }
  | { type: 'DEPLOY_BASE'; side: ChainSide; handIndex: number }
  | { type: 'PAIR_PILOT'; side: ChainSide; handIndex: number; targetUnitId: string }
  | { type: 'PLAY_COMMAND'; side: ChainSide; handIndex: number }
  | { type: 'ACTIVATE_ABILITY'; side: ChainSide; sourceId: string; clauseIndex: number }
  | { type: 'ATTACK_SHIELD'; side: ChainSide; attackerId: string }
  | { type: 'ATTACK_UNIT'; side: ChainSide; attackerId: string; targetId: string }
  | { type: 'PASS_TURN'; side: ChainSide };

export interface ActionStepWitnessMove {
  kind: 'PASS' | 'BLOCKER' | 'PLAY_ACTION';
  side: ChainSide;
  unitId?: string;
  handIndex?: number;
}

export interface ChainWitness {
  resourceSpends?: { regular: number; ex: number }[];
  zoneReplacements?: string[];
  targets?: string[][];
  optionalAccepts?: boolean[];
  modalChoices?: number[];
  triggerOrders?: number[][];
  replacementChoices?: { accept: boolean; targetId?: string }[];
  actionSteps?: ActionStepWitnessMove[];
  burstAccepts?: boolean[];
  burstOrder?: number[];
  deckTopReveals?: GundamCardPrint[];
}

export interface DummyUnitSpec {
  cardNo?: string;
  name?: string;
  lv?: number;
  ap?: number;
  hp?: number;
  rested?: boolean;
  traits?: string[];
  keywords?: KeywordAbility[];
  effect?: string;
}

export type ChainVerificationRequest = {
  mode:
    | { kind: 'CONCRETE_SNAPSHOT'; state: ChainMatchState }
    | {
        kind: 'MINIMAL_FEASIBILITY';
        turn: number;
        activeHand: GundamCardPrint[];
        activeBattleArea?: ChainUnitInstance[];
        activeTrash?: GundamCardPrint[];
        activeDeck?: GundamCardPrint[];
        opponentDummyBoard?: {
          units?: DummyUnitSpec[];
          shields?: number;
          hasBase?: boolean;
        };
      };
  playLine: PlayerAction[];
  witness: ChainWitness;
};

export interface ChainTraceEntry {
  kind: 'ACTION' | 'TRIGGER' | 'REPLACEMENT' | 'SBA' | 'DAMAGE' | 'BURST';
  detail: string;
}

export type ChainVerificationResult =
  | { legal: true; finalState: ChainMatchState; trace: ChainTraceEntry[] }
  | { legal: false; reason: IllegalChainReason; detail: string; trace: ChainTraceEntry[] };

export interface EffectiveUnitState {
  ap: number;
  maxHp: number;
  remainingHp: number;
  lv: number;
  isLinked: boolean;
  keywords: Set<KeywordName>;
  keywordValues: Map<KeywordName, number | null>;
  traits: Set<string>;
  prohibitions: Set<NonNullable<TemporaryModifier['rule']>>;
  damageImmunities: { damageType: 'BATTLE' | 'EFFECT' | 'ANY'; apMax?: number; lvMax?: number }[];
  canAttack: boolean;
  canAttackPlayer: boolean;
  canBlock: boolean;
  canBeChosen: boolean;
}

// ---------------------------------------------------------------------------
// 2. Helpers: Cloning, Card Abilities, and 4-Layer Continuous Evaluator
// ---------------------------------------------------------------------------
