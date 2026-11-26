import type { GundamCardPrint } from '@/types/gundam';
import { parseCardEffects } from './clause-compile.ts';
import { type EffectCondition, type EffectStep } from './types.ts';

export type SynergyNodeKey =
  | 'DEPLOY_FROM_TRASH'
  | 'TRASH_COUNT_FUEL'
  | 'AP_THRESHOLD_5'
  | 'DAMAGED_ENEMY_TARGET'
  | 'RESTED_ENEMY_TARGET';

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

/** Derives high-signal Enabler <-> Payoff Knowledge Map edges from parsed Effect Clauses. */
export function extractSynergyProfile(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'name' | 'traits' | 'link'>>,
  parsed = parseCardEffects(card)
): CardSynergyProfile {
  const requires = new Set<SynergyNodeKey>();
  const enables = new Set<SynergyNodeKey>();

  for (const clause of parsed.clauses) {
    const conds: EffectCondition[] = [];
    collectNestedConditions(clause.condition, conds);
    for (const step of flattenEffectSteps(clause.steps)) {
      if (step.action === 'IF_CONDITION') collectNestedConditions(step.condition, conds);
      if (step.action === 'GRANT_CLAUSE') collectNestedConditions(step.clause.condition, conds);
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
    }

    for (const step of flattenEffectSteps(clause.steps)) {
      if (step.action === 'DEPLOY_FROM_TRASH') enables.add('DEPLOY_FROM_TRASH');
      if (step.action === 'DISCARD' || step.action === 'MILL' || (step.action === 'LOOK_TOP' && step.trashRest)) {
        enables.add('TRASH_COUNT_FUEL');
      }
      if (step.action === 'MODIFY_AP' && step.delta > 0 && step.target.owner === 'SELF') {
        enables.add('AP_THRESHOLD_5');
      }
      if (step.action === 'DEAL_DAMAGE' && step.target.owner === 'ENEMY') {
        enables.add('DAMAGED_ENEMY_TARGET');
      }
      if (step.action === 'REST' && step.target.owner === 'ENEMY') {
        enables.add('RESTED_ENEMY_TARGET');
      }
      if ('target' in step && step.target && step.target.owner === 'ENEMY') {
        if (step.target.state === 'DAMAGED') requires.add('DAMAGED_ENEMY_TARGET');
        if (step.target.state === 'RESTED') requires.add('RESTED_ENEMY_TARGET');
      }
    }
  }

  if (parsed.keywords.some((k) => k.name === 'Support') || (card.type === 'PILOT' && (card.ap ?? 0) >= 1)) {
    enables.add('AP_THRESHOLD_5');
  }

  return { requires: [...requires], enables: [...enables] };
}
