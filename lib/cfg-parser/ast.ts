import type { ActivationCost, EffectCondition, EffectDuration, EffectPrerequisite, EffectStep, EffectTiming, KeywordAbility, LinkRequirement, PairFilter, ScaleMetric, TargetSelector, TriggerEvent } from '../effect-parser.ts';

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
  | 'CANT_CHOOSE_ENEMY_PLAYER'
  | 'CANT_BE_CHOSEN'
  | 'CANT_SET_ACTIVE'
  | 'CANT_BE_RESTED'
  | 'CANT_BE_PAIRED'
  | 'CANT_DEPLOY'
  | 'CANT_BE_DESTROYED';

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
  insteadUpgrade?: {
    condition?: EffectCondition;
    rawUpgrade: string;
  };
}

export interface ReplacementEffectAst {
  kind: 'REPLACEMENT_EFFECT';
  clauseIndex: number;
  raw: string;
  scope: 'ACTIVE_ZONE' | 'PAIRED' | 'LINKED';
  intercepts: ReplacementEventKind;
  subject: TargetSelector;
  pairFilter?: PairFilter;
  condition?: EffectCondition;
  optional: boolean;
  duration?: EffectDuration;
  steps?: EffectStep[];
  replacementSummary: string;
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
        summary: string;
      }
    | {
        type: 'REDIRECT_ATTACK_TARGET';
        rule: string;
        target: TargetSelector;
      }
    | {
        type: 'STATIC_PERMISSION';
        summary: string;
        target: TargetSelector;
      };
}

export interface CustomHookAst {
  kind: 'CUSTOM_HOOK';
  clauseIndex: number;
  hookId: string;
  version: number;
  raw: string;
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
  prerequisites?: EffectPrerequisite[];
}

/**
 * Deterministic versioned registry for rare 1-of card clauses outside core CFG rules.
 * CI fails if any card references an unregistered CustomHook.
 */
export const CUSTOM_HOOK_REGISTRY: Record<string, CustomHookDefinition> = {
  'ST01-015#2': {
    hookId: 'ST01-015#2',
    version: 1,
    description:
      'White Base: Activate-Main pay 2 to deploy 1 Gundam (0 Units), Guncannon (1 Unit), or Guntank (2+ Units) token.',
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
