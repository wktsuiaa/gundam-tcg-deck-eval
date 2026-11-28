import type { GundamCardPrint } from '@/types/gundam';
import { type CfgParseResult, getAbilitySteps, parseCardAbilities } from '../cfg-parser.ts';
import { type EffectCondition, type EffectStep, type EffectTiming, type TargetSelector } from './types.ts';

export type SynergyNodeKey =
  | 'DEPLOY_FROM_TRASH'
  | 'TRASH_COUNT_FUEL'
  | 'AP_THRESHOLD_5'
  | 'DAMAGED_ENEMY_TARGET'
  | 'RESTED_ENEMY_TARGET'
  | 'PLAYER_LV_UP'
  | 'RESOURCE_RAMP'
  | 'RESOURCE_ACTIVATE'
  | 'AP_REDUCTION';

export interface CardSynergyProfile {
  requires: SynergyNodeKey[];
  enables: SynergyNodeKey[];
}

export function collectNestedConditions(cond: EffectCondition | undefined, out: EffectCondition[]) {
  if (!cond) return;
  out.push(cond);
  if (cond.kind === 'ALL_OF' || cond.kind === 'ANY_OF') {
    for (const c of cond.conditions) collectNestedConditions(c, out);
  } else if (cond.kind === 'NOT') {
    collectNestedConditions(cond.condition, out);
  }
}

export function flattenEffectSteps(steps: EffectStep[]): EffectStep[] {
  const out: EffectStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.action === 'IF_CONDITION') {
      out.push(...flattenEffectSteps(step.thenSteps));
      if (step.elseSteps) out.push(...flattenEffectSteps(step.elseSteps));
    } else if (step.action === 'IF_PREVIOUS_SUCCEEDED') {
      out.push(...flattenEffectSteps(step.thenSteps));
    } else if (step.action === 'GRANT_CLAUSE') {
      out.push(...flattenEffectSteps(step.clause.steps));
    }
  }
  return out;
}

function collectStepSelectors(step: EffectStep): TargetSelector[] {
  const selectors: TargetSelector[] = [];
  if ('target' in step && step.target) selectors.push(step.target);
  if ('defenderFilter' in step && step.defenderFilter) selectors.push(step.defenderFilter);
  if ('sourceFilter' in step && step.sourceFilter) selectors.push(step.sourceFilter);
  if ('attackerFilter' in step && step.attackerFilter) selectors.push(step.attackerFilter);
  return selectors;
}

function applyTimingSynergy(
  timings: EffectTiming[],
  triggerKind: EffectTiming | undefined,
  requires: Set<SynergyNodeKey>
) {
  const all = triggerKind ? [...timings, triggerKind] : timings;
  if (
    all.includes('WHEN_PLACE_EX_RESOURCE') ||
    all.includes('WHEN_EXILE_EX_RESOURCE') ||
    all.includes('WHEN_PLAY_CARD_WITH_EX_RESOURCE')
  ) {
    requires.add('RESOURCE_RAMP');
  }
  if (all.includes('WHEN_AP_REDUCED')) {
    requires.add('AP_REDUCTION');
  }
}

/** Derives high-signal Enabler <-> Payoff Knowledge Map edges strictly from structured AbilityAst nodes. */
export function extractSynergyProfile(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'name' | 'traits' | 'link'>>,
  parsed: Pick<CfgParseResult, 'keywords' | 'abilities'> = parseCardAbilities(card)
): CardSynergyProfile {
  const requires = new Set<SynergyNodeKey>();
  const enables = new Set<SynergyNodeKey>();

  for (const ab of parsed.abilities) {
    const conds: EffectCondition[] = [];
    if ('condition' in ab && ab.condition) {
      collectNestedConditions(ab.condition, conds);
    }
    if (ab.kind === 'EFFECT_CLAUSE') {
      applyTimingSynergy(ab.timings, ab.triggerEvent?.kind, requires);
    }
    const flatSteps = flattenEffectSteps(getAbilitySteps(ab));
    for (const step of flatSteps) {
      if (step.action === 'IF_CONDITION') collectNestedConditions(step.condition, conds);
      if (step.action === 'GRANT_CLAUSE') {
        collectNestedConditions(step.clause.condition, conds);
        applyTimingSynergy(step.clause.timings, step.clause.triggerEvent?.kind, requires);
      }
    }

    for (const cond of conds) {
      if (cond.kind === 'DEPLOYED_FROM_ZONE' && cond.zone === 'trash') {
        requires.add('DEPLOY_FROM_TRASH');
      }
      if (cond.kind === 'TRASH_COUNT_AT_LEAST') {
        requires.add('TRASH_COUNT_FUEL');
      }
      if (cond.kind === 'SELF_AP_AT_LEAST' && cond.minAp >= 5) {
        requires.add('AP_THRESHOLD_5');
      }
      if (cond.kind === 'PLAYER_LV_AT_LEAST') {
        requires.add('PLAYER_LV_UP');
      }
      if (cond.kind === 'EX_RESOURCE_USED_TO_PLAY') {
        requires.add('RESOURCE_RAMP');
      }
      if (cond.kind === 'RESOURCE_COUNT' && cond.owner !== 'ENEMY') {
        requires.add('RESOURCE_RAMP');
      }
      if (cond.kind === 'TURN_HISTORY' && cond.event === 'SET_RESOURCE_ACTIVE_BY_EFFECT') {
        requires.add('RESOURCE_ACTIVATE');
      }
    }

    for (const step of flatSteps) {
      if (step.action === 'DEPLOY_FROM_TRASH') enables.add('DEPLOY_FROM_TRASH');
      if (step.action === 'DISCARD' || step.action === 'MILL' || (step.action === 'LOOK_TOP' && step.trashRest)) {
        enables.add('TRASH_COUNT_FUEL');
      }
      if (step.action === 'MODIFY_AP' && step.delta > 0 && step.target.owner === 'SELF') {
        enables.add('AP_THRESHOLD_5');
      }
      if (step.action === 'MODIFY_AP' && step.delta < 0 && step.target.owner !== 'SELF') {
        enables.add('AP_REDUCTION');
      }
      if (step.action === 'DEAL_DAMAGE' && step.target.owner === 'ENEMY') {
        enables.add('DAMAGED_ENEMY_TARGET');
      }
      if (step.action === 'REST' && step.target.owner === 'ENEMY') {
        enables.add('RESTED_ENEMY_TARGET');
      }
      if (step.action === 'ADD_RESOURCE') {
        if (step.ex) enables.add('RESOURCE_RAMP');
        else enables.add('PLAYER_LV_UP');
      }
      if (step.action === 'COST_REDUCTION') {
        enables.add('RESOURCE_RAMP');
      }
      if (
        step.action === 'SET_ACTIVE' &&
        (step.target.cardType === 'RESOURCE' || step.target.cardType === 'EX_RESOURCE')
      ) {
        enables.add('RESOURCE_ACTIVATE');
      }
      for (const sel of collectStepSelectors(step)) {
        if (sel.owner === 'ENEMY') {
          if (sel.state === 'DAMAGED') requires.add('DAMAGED_ENEMY_TARGET');
          if (sel.state === 'RESTED') requires.add('RESTED_ENEMY_TARGET');
        }
        if (sel.owner !== 'SELF' && (sel.apMax !== undefined || sel.apMaxRef !== undefined)) {
          requires.add('AP_REDUCTION');
        }
      }
    }
  }

  if (parsed.keywords.some((k) => k.name === 'Support')) {
    enables.add('AP_THRESHOLD_5');
  }

  return { requires: [...requires], enables: [...enables] };
}
