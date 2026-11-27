import type {
  ActivationCost,
  EffectCondition,
  EffectDuration,
  EffectPrerequisite,
  EffectStep,
  EffectTiming,
  KeywordAbility,
  LinkRequirement,
  PairFilter,
  ScaleMetric,
  TargetSelector,
  TriggerEvent,
} from '../effect-parser.ts';

export type ReplacementEventKind =
  | 'WOULD_BE_DESTROYED'
  | 'WOULD_TAKE_DAMAGE'
  | 'WOULD_REST'
  | 'WOULD_MOVE_ZONE';

export type ProhibitionRule =
  | 'CANT_ATTACK'
  | 'CANT_BLOCK'
  | 'CANT_ACTIVATE_BLOCKER'
  | 'CANT_RECEIVE_BATTLE_DAMAGE'
  | 'CANT_RECEIVE_EFFECT_DAMAGE'
  | 'CANT_RECEIVE_DAMAGE'
  | 'CANT_REDUCE_AP'
  | 'CANT_CHOOSE_ENEMY_PLAYER'
  | 'CANT_BE_CHOSEN'
  | 'CANT_SET_ACTIVE'
  | 'CANT_BE_RESTED'
  | 'CANT_BE_PAIRED'
  | 'CANT_DEPLOY'
  | 'CANT_BE_DESTROYED';

export interface ReplacementOutcome {
  kind: 'PREVENT_DAMAGE' | 'REST_OTHER' | 'PREVENT_DESTROY' | 'PREVENT_MOVE';
  damageType?: 'BATTLE' | 'EFFECT' | 'ANY';
  target?: TargetSelector;
  steps?: EffectStep[];
}

export interface EffectClauseAst {
  kind: 'EFFECT_CLAUSE';
  clauseIndex: number;
  raw: string;
  timings: EffectTiming[];
  oncePerTurn: boolean;
  triggerEvent?: TriggerEvent;
  pairFilter?: PairFilter;
  linkRequirement?: LinkRequirement;
  cost?: ActivationCost;
  condition?: EffectCondition;
  steps: EffectStep[];
  modalGroup?: string;
}

export interface ReplacementEffectAst {
  kind: 'REPLACEMENT_EFFECT';
  clauseIndex: number;
  raw: string;
  scope: 'ACTIVE_ZONE' | 'PAIRED' | 'LINKED';
  intercepts: ReplacementEventKind;
  subject: TargetSelector;
  sourceFilter?: TargetSelector;
  pairFilter?: PairFilter;
  oncePerTurn?: boolean;
  condition?: EffectCondition;
  optional: boolean;
  duration?: EffectDuration;
  steps?: EffectStep[];
  outcome: ReplacementOutcome;
  maxPerEventInstance: 1;
}

export interface ContinuousModifierAst {
  kind: 'CONTINUOUS_MODIFIER';
  clauseIndex: number;
  raw: string;
  layer: 2 | 3 | 4;
  activeIn: 'BATTLE_AREA' | 'HAND' | 'TRASH' | 'ANY';
  requiresPair?: boolean;
  requiresLink?: LinkRequirement;
  pairFilter?: PairFilter;
  oncePerTurn?: boolean;
  condition?: EffectCondition;
  duration?: EffectDuration;
  modifier:
    | {
        type: 'MODIFY_STAT';
        stat: 'AP' | 'HP';
        delta: number;
        scaleBy?: ScaleMetric;
        target: TargetSelector;
      }
    | {
        type: 'COST_REDUCTION';
        amount: number;
        lvDelta?: number;
        perTarget?: ScaleMetric;
        target: TargetSelector;
      }
    | {
        type: 'GRANT_KEYWORD';
        keyword: KeywordAbility;
        scaleBy?: ScaleMetric;
        target: TargetSelector;
      }
    | {
        type: 'GRANT_TRAIT';
        traits: string[];
        target: TargetSelector;
      }
    | {
        type: 'NAME_ALIAS';
        alias: string;
      }
    | {
        type: 'GRANT_PILOT_MODE';
        pilotName: string;
      }
    | {
        type: 'PROHIBITION';
        rule: ProhibitionRule;
        target: TargetSelector;
        sourceFilter?: TargetSelector;
        damageMax?: number;
        additionalRules?: ProhibitionRule[];
      }
    | {
        type: 'ALLOW_ATTACK_ACTIVE';
        target: TargetSelector;
      }
    | {
        type: 'FREEZE_AURA';
        target: TargetSelector;
      }
    | {
        type: 'RESTRICTION';
        rule: string;
        target: TargetSelector;
        sourceFilter?: TargetSelector;
      }
    | {
        type: 'REDIRECT_ATTACK_TARGET';
        rule: 'MUST_ATTACK_TARGET' | 'CANT_CHOOSE_TARGET' | 'CANT_CHOOSE_SAME_PLAYER';
        target: TargetSelector;
        attackerFilter?: TargetSelector;
      };
}

export interface CustomHookAst {
  kind: 'CUSTOM_HOOK';
  clauseIndex: number;
  hookId: string;
  version: number;
  raw: string;
  timings: EffectTiming[];
  cost?: ActivationCost;
  steps: EffectStep[];
  prerequisites: EffectPrerequisite[];
}

export type DiagnosticCode = 'LEX_ERROR' | 'PARSE_ERROR' | 'NO_LOWERING' | 'UNPARSED_RESIDUAL';

/** Explicit marker for a clause the grammar or lowering could not fully understand; never silently dropped. */
export interface DiagnosticAst {
  kind: 'DIAGNOSTIC';
  clauseIndex: number;
  code: DiagnosticCode;
  message: string;
  raw: string;
}

export type AbilityAst =
  | EffectClauseAst
  | ReplacementEffectAst
  | ContinuousModifierAst
  | CustomHookAst
  | DiagnosticAst;

export interface CustomHookDefinition {
  hookId: string;
  version: number;
  description: string;
  timings: EffectTiming[];
  cost?: ActivationCost;
  steps: EffectStep[];
  prerequisites?: EffectPrerequisite[];
}

/**
 * Deterministic versioned registry for rare 1-of card clauses outside core CFG rules.
 * CI fails if any card references an unregistered CustomHook.
 */
export const CUSTOM_HOOK_REGISTRY: Record<string, CustomHookDefinition> = {
  'ST01-015#2': {
    hookId: 'ST01-015#2',
    version: 2,
    description:
      'White Base: Activate-Main pay 2 to deploy 1 Gundam (0 Units), Guncannon (1 Unit), or Guntank (2+ Units) token.',
    timings: ['ACTIVATE_MAIN'],
    cost: { resourceCost: 2 },
    steps: [
      {
        action: 'DEPLOY_TOKEN',
        count: 1,
        name: 'White Base Token',
        ap: 3,
        hp: 3,
        traits: ['White Base Team'],
      },
    ],
  },
};

export interface CfgParseResult {
  cardNo: string;
  keywords: KeywordAbility[];
  abilities: AbilityAst[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// 2. Deterministic Pre-Parse Structural Normalizer
// ---------------------------------------------------------------------------
