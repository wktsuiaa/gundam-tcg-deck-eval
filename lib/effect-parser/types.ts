import type { CardColor } from '@/types/gundam';
import { type AbilityAst } from '../cfg-parser.ts';
import { type EffectPrerequisite } from './prerequisites.ts';
import { type CardSynergyProfile } from './synergy.ts';

export type EffectTiming =
  | 'DEPLOY'
  | 'ATTACK'
  | 'DESTROYED'
  | 'WHEN_PAIRED'
  | 'WHEN_LINKED'
  | 'DURING_PAIR'
  | 'DURING_LINK'
  | 'BURST'
  | 'ACTIVATE_MAIN'
  | 'ACTIVATE_ACTION'
  | 'MAIN'
  | 'ACTION'
  | 'END_OF_TURN'
  | 'START_OF_OPPONENT_TURN'
  | 'WHEN_PLAYING'
  | 'WHEN_ATTACKED'
  | 'WHEN_DESTROY_BY_BATTLE'
  | 'WHEN_DEAL_DAMAGE'
  | 'WHEN_RECEIVE_DAMAGE'
  | 'WHEN_RECOVER_HP'
  | 'WHEN_UNIT_DEPLOYED'
  | 'WHEN_UNIT_PAIRED'
  | 'WHEN_UNIT_LINKED'
  | 'WHEN_UNIT_DESTROYED'
  | 'WHEN_RESTED'
  | 'WHEN_BLOCKED'
  | 'WHEN_PLACE_EX_RESOURCE'
  | 'WHEN_EXILE_EX_RESOURCE'
  | 'WHEN_ACTIVATE_COMMAND'
  | 'WHEN_PAY_EFFECT_COST'
  | 'WHEN_DRAW'
  | 'WHEN_AP_REDUCED'
  | 'WHEN_PLAY_CARD_WITH_EX_RESOURCE'
  | 'CONTINUOUS';

export type KeywordName =
  | 'Repair'
  | 'Breach'
  | 'Support'
  | 'Blocker'
  | 'First Strike'
  | 'High-Maneuver'
  | 'Suppression';

export interface KeywordAbility {
  name: KeywordName;
  value: number | null;
}

export interface TriggerEvent {
  kind: EffectTiming;
  actor?: 'SELF' | 'FRIENDLY' | 'ENEMY' | 'ANY';
  actorFilter?: TargetSelector;
  targetKind?: 'UNIT' | 'SHIELD' | 'BASE' | 'ANY_ENEMY_CARD' | 'EX_RESOURCE' | 'COMMAND' | 'CARD';
  targetFilter?: TargetSelector;
  damageType?: 'BATTLE' | 'EFFECT' | 'ANY';
  whileAttacking?: boolean;
  raw?: string;
}

export interface LinkRequirement {
  role: 'UNIT_REQUIRES_PILOT' | 'PILOT_MATCHING_UNIT';
  names: string[];
  traits: string[];
  raw: string;
}

export interface TargetSelector {
  owner: 'ENEMY' | 'SELF' | 'ANY' | 'ALL_PLAYERS';
  self?: boolean;
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'SHIELD' | 'RESOURCE' | 'CARD' | 'EX_RESOURCE' | 'UNIT_TOKEN';
  count?: number | 'ALL' | 'UP_TO';
  maxCount?: number;
  countRef?: 'ENEMY_PLAYERS' | 'COUNTED_VALUE';
  lvMin?: number;
  lvMax?: number;
  lvMaxRef?: 'SELF_LV' | 'COUNTED_VALUE';
  lvRank?: 'LOWEST' | 'HIGHEST';
  apMin?: number;
  apMax?: number;
  apMaxRef?: 'SELF_AP';
  hpMin?: number;
  hpMax?: number;
  hpRank?: 'LOWEST' | 'HIGHEST';
  state?: 'ACTIVE' | 'RESTED' | 'DAMAGED';
  trait?: string;
  traits?: string[];
  color?: CardColor;
  notColor?: CardColor;
  token?: boolean;
  excludeToken?: boolean;
  linked?: boolean;
  paired?: boolean | 'NONE';
  keyword?: KeywordName;
  hasDestroyedEffect?: boolean;
  nameContains?: string;
  excludeName?: string;
  zone?: 'BATTLE_AREA' | 'TRASH' | 'HAND' | 'DECK' | 'SHIELD' | 'RESOURCE';
  other?: boolean;
}

export interface ScaleMetric {
  metric:
    | 'HAND_COUNT'
    | 'TRASH_COUNT'
    | 'BOARD_UNIT_COUNT'
    | 'ENEMY_UNIT_COUNT'
    | 'ENEMY_PLAYER_COUNT'
    | 'RESTED_ENEMY_UNIT_COUNT'
    | 'SELF_DAMAGE'
    | 'PAID_COST'
    | 'AFFECTED_COUNT'
    | 'DRAWN_COUNT';
  owner?: 'SELF' | 'ENEMY' | 'ANY';
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'CARD' | 'UNIT_TOKEN';
  traits?: string[];
  nameContains?: string;
  uniqueNames?: boolean;
  rested?: boolean;
}

export type EffectCondition =
  | { kind: 'DEPLOYED_FROM_ZONE'; zone: 'trash' | 'hand' }
  | {
      kind: 'TRASH_COUNT_AT_LEAST';
      count: number;
      owner?: 'SELF' | 'ENEMY';
      color?: CardColor;
      trait?: string;
      traits?: string[];
      cardType?: string;
      nameContains?: string;
    }
  | { kind: 'FRIENDLY_BASE_IN_PLAY'; color?: CardColor; trait?: string }
  | { kind: 'SELF_AP_AT_LEAST'; minAp: number }
  | { kind: 'UNIT_TRAIT_IS'; trait: string; traits?: string[] }
  | { kind: 'IS_YOUR_TURN' }
  | { kind: 'IS_OPPONENT_TURN' }
  | { kind: 'SELF_RESTED' }
  | { kind: 'DESTROYED_BY_BATTLE' }
  | { kind: 'UNIT_COUNT_AT_LEAST'; owner: 'ENEMY' | 'SELF' | 'ANY'; count: number }
  | { kind: 'DEVELOPMENT_EXILE'; count: number }
  | { kind: 'ALL_OF'; conditions: EffectCondition[] }
  | { kind: 'ANY_OF'; conditions: EffectCondition[] }
  | { kind: 'NOT'; condition: EffectCondition }
  | {
      kind: 'BOARD_CARD_COUNT';
      owner: 'SELF' | 'ENEMY' | 'ANY';
      cardType: 'UNIT' | 'PILOT' | 'BASE' | 'UNIT_TOKEN';
      min?: number;
      max?: number;
      other?: boolean;
      rested?: boolean;
      linked?: boolean;
      paired?: boolean;
      pairedPilotLvMax?: number;
      color?: CardColor;
      notColor?: CardColor;
      traits?: string[];
      keyword?: KeywordName;
      nameContains?: string;
      lvMin?: number;
      lvMax?: number;
      apMax?: number;
      hasDestroyedEffect?: boolean;
    }
  | {
      kind: 'SELF_STATE';
      color?: CardColor;
      traits?: string[];
      linked?: boolean;
      paired?: boolean;
      pairedPilotLvMax?: number;
      damaged?: boolean;
      hpMin?: number;
      hpMax?: number;
      lvMin?: number;
      lvMax?: number;
      keyword?: KeywordName;
      destroyedBy?: { owner?: 'SELF' | 'ENEMY'; traits?: string[]; cardEffect?: boolean };
      attackingTarget?: 'ENEMY_UNIT' | 'ENEMY_PLAYER' | 'DAMAGED_ENEMY_UNIT';
      battlingEnemy?: {
        keyword?: KeywordName;
        lvMax?: number;
        damaged?: boolean;
        hasDestroyedEffect?: boolean;
        apMaxRef?: 'SELF_AP';
      };
      pairedWithUnit?: { traits?: string[]; nameContains?: string; linkNames?: string[]; lvMin?: number };
    }
  | { kind: 'HAND_COUNT'; owner: 'SELF' | 'ENEMY'; min?: number; max?: number }
  | { kind: 'SHIELD_COUNT'; owner: 'SELF' | 'ENEMY' | 'ANY'; min?: number; max?: number }
  | { kind: 'RESOURCE_COUNT'; owner: 'SELF' | 'ENEMY'; ex?: boolean; min?: number; max?: number }
  | { kind: 'PLAYER_LV_AT_LEAST'; minLv: number }
  | { kind: 'ENEMY_PLAYER_COUNT_AT_LEAST'; count: number }
  | {
      kind: 'TURN_HISTORY';
      event:
        | 'ACTIVATED_COMMAND'
        | 'UNIT_DESTROYED_BY_EFFECT'
        | 'PAID_EFFECT_COST_AT_LEAST'
        | 'DRAWN_BY_EFFECT'
        | 'NO_ENEMY_ATTACKED'
        | 'PAIRED_UNIT_DESTROYED_ENEMY_BY_BATTLE'
        | 'FRIENDLY_UNIT_DEPLOYED'
        | 'SET_RESOURCE_ACTIVE_BY_EFFECT';
      traits?: string[];
      minCost?: number;
      other?: boolean;
    }
  | { kind: 'EX_RESOURCE_USED_TO_PLAY' }
  | { kind: 'PHASE_AT_START_OF_OPPONENT_TURN' };

export interface ActivationCost {
  resourceCost?: number;
  restSelf?: boolean;
  returnSelfToDeckBottom?: boolean;
  destroySelf?: boolean;
  discardCount?: number;
  exileFromTrashCount?: number;
  exileFilter?: TargetSelector;
  raw?: string;
}

export type EffectDuration = 'THIS_TURN' | 'THIS_BATTLE' | 'NEXT_TURN' | 'CONTINUOUS';

export type EffectStep =
  | { action: 'ADD_SELF_TO_HAND' }
  | { action: 'DEPLOY_SELF' }
  | { action: 'ACTIVATE_MAIN_EFFECT'; target?: TargetSelector; fromDiscard?: boolean }
  | { action: 'DESTROY'; target: TargetSelector }
  | { action: 'DEAL_DAMAGE'; amount: number; scaleBy?: ScaleMetric; target: TargetSelector }
  | { action: 'MODIFY_AP'; delta: number; scaleBy?: ScaleMetric; duration?: EffectDuration; target: TargetSelector }
  | { action: 'MODIFY_HP'; delta: number; scaleBy?: ScaleMetric; duration?: EffectDuration; target: TargetSelector }
  | { action: 'REST'; target: TargetSelector }
  | { action: 'SET_ACTIVE'; target: TargetSelector }
  | { action: 'FREEZE'; target: TargetSelector }
  | { action: 'BOUNCE'; target: TargetSelector }
  | { action: 'RETURN_TO_DECK'; position?: 'TOP' | 'BOTTOM' | 'SHUFFLE'; shuffle?: boolean; target: TargetSelector }
  | { action: 'DRAW'; count: number; scaleBy?: ScaleMetric; bothPlayers?: boolean; optional?: boolean; targetOwner?: 'SELF' | 'ENEMY' | 'ALL_PLAYERS' }
  | { action: 'DISCARD'; count: number; scaleBy?: ScaleMetric; targetOwner?: 'SELF' | 'ENEMY' | 'ALL_PLAYERS'; target?: TargetSelector; optional?: boolean }
  | { action: 'LOOK_TOP'; count: number; revealSearch?: boolean; trashRest?: boolean; trait?: string; target?: TargetSelector; remainderPosition?: 'TOP' | 'BOTTOM' | 'TRASH' }
  | { action: 'REVEAL_TOP'; count: number }
  | { action: 'ADD_SHIELD_TO_HAND'; count: number }
  | { action: 'ADD_FROM_TRASH_TO_HAND'; target: TargetSelector }
  | { action: 'DEPLOY_FROM_TRASH'; free: boolean; rested?: boolean; target: TargetSelector }
  | { action: 'DEPLOY_FROM_HAND'; free?: boolean; rested?: boolean; target: TargetSelector }
  | { action: 'DEPLOY_FROM_TOP_DECK'; target: TargetSelector }
  | { action: 'PAIR_SELF_FROM_TRASH'; target: TargetSelector }
  | { action: 'PAIR_FROM_HAND'; target: TargetSelector; pilotFilter?: TargetSelector }
  | { action: 'DEPLOY_TOKEN'; count: number; ap?: number; hp?: number; name?: string; traits?: string[]; owner?: 'SELF' | 'ENEMY' | 'DESTROYED_OWNER'; baseToken?: boolean; exBase?: boolean }
  | { action: 'RECOVER_HP'; amount: number; target: TargetSelector }
  | { action: 'GRANT_KEYWORD'; keyword: KeywordAbility; scaleBy?: ScaleMetric; duration?: EffectDuration; target: TargetSelector }
  | { action: 'GRANT_TRAIT'; traits: string[]; duration?: EffectDuration; target: TargetSelector }
  | { action: 'GRANT_PILOT_MODE'; pilotName: string }
  | { action: 'NAME_ALIAS'; alias: string }
  | {
      action: 'DAMAGE_PROOF';
      amount?: number;
      maxDamage?: number;
      damageType?: 'BATTLE' | 'EFFECT' | 'ANY';
      duration?: EffectDuration;
      target?: TargetSelector;
      sourceFilter?: TargetSelector;
    }
  | { action: 'ADD_RESOURCE'; count: number; ex?: boolean; rested?: boolean }
  | { action: 'PAY_RESOURCE'; amount: number; optional?: boolean }
  | { action: 'COST_REDUCTION'; amount: number; lvDelta?: number; zone?: 'HAND' | 'TRASH'; perTarget?: ScaleMetric; exactCost?: number; exactLv?: number }
  | { action: 'CANT_ATTACK'; duration?: EffectDuration; target: TargetSelector }
  | { action: 'ALLOW_ATTACK_ACTIVE'; target: TargetSelector; defenderFilter?: TargetSelector; duration?: EffectDuration }
  | { action: 'MILL'; count: number }
  | { action: 'EXILE'; target: TargetSelector }
  | { action: 'REVEAL_FROM_HAND'; target: TargetSelector }
  | { action: 'REDIRECT_ATTACK_TARGET'; rule: 'MUST_ATTACK_TARGET' | 'CANT_CHOOSE_TARGET' | 'CANT_CHOOSE_SAME_PLAYER'; target: TargetSelector; attackerFilter?: TargetSelector; duration?: EffectDuration }
  | { action: 'REDIRECT_BATTLE_DAMAGE'; fromTarget: TargetSelector; toTarget: TargetSelector; duration?: EffectDuration }
  | { action: 'FORCE_BATTLE_DAMAGE_STEP'; attacker: TargetSelector; defender: TargetSelector }
  | { action: 'MODIFY_DAMAGE_DEALT'; delta: number; sourceFilter?: TargetSelector; targetFilter?: TargetSelector; duration?: EffectDuration }
  | { action: 'COUNT_UNITS'; target: TargetSelector; plusSelf?: boolean }
  | {
      action: 'RESTRICTION';
      rule:
        | 'CANT_BE_PAIRED'
        | 'CANT_SET_ACTIVE'
        | 'CANT_BE_RESTED'
        | 'CAN_ATTACK_TURN_DEPLOYED'
        | 'ONLY_ATTACK_WHEN_DEPLOYED'
        | 'DEPLOYED_RESTED'
        | 'INSTEAD_REST_TARGET'
        | 'CANT_ACTIVATE_BLOCKER'
        | 'CANT_BE_DESTROYED'
        | 'CANT_BE_CHOSEN'
        | 'CANT_BLOCK'
        | 'CANT_CHOOSE_ENEMY_PLAYER'
        | 'CANT_ATTACK'
        | 'CANT_REDUCE_AP';
      target: TargetSelector;
      sourceFilter?: TargetSelector;
      duration?: EffectDuration;
    }
  | { action: 'IF_CONDITION'; condition: EffectCondition; thenSteps: EffectStep[]; elseSteps?: EffectStep[]; replacesPrevious?: boolean }
  | { action: 'IF_PREVIOUS_SUCCEEDED'; negated?: boolean; filter?: { count?: number; lvMin?: number; cardType?: string; traits?: string[]; drawAccepted?: boolean; placedFromDeck?: boolean }; thenSteps: EffectStep[] }
  | { action: 'GRANT_CLAUSE'; clause: EffectClause; duration?: EffectDuration; target: TargetSelector };

export interface PairFilter {
  trait?: string;
  color?: CardColor;
  lvMin?: number;
  lvMax?: number;
}

export interface EffectClause {
  raw: string;
  timings: EffectTiming[];
  oncePerTurn: boolean;
  triggerEvent?: TriggerEvent;
  pairFilter?: PairFilter;
  linkRequirement?: LinkRequirement;
  cost?: ActivationCost;
  condition?: EffectCondition;
  steps: EffectStep[];
}

export interface CompiledCardEffect {
  cardNo: string;
  sourcePrintId: string;
  name: string;
  type: string;
  color: CardColor;
  keywords: KeywordAbility[];
  abilities: AbilityAst[];
  synergy: CardSynergyProfile;
  prerequisites: EffectPrerequisite[];
}

export interface EffectShardFile {
  schemaVersion: 2;
  setPrefix: string;
  cardCount: number;
  effects: Record<string, CompiledCardEffect>;
}
