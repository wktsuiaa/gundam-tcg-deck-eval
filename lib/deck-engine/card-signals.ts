import type { EffectStyleTag, GundamCardPrint } from '@/types/gundam';
import { flattenEffectSteps, type EffectCondition, type EffectStep, type EffectTiming } from '@/lib/effect-parser';
import { getAbilitySteps, getAbilityTimings } from '@/lib/cfg-parser';
import { clamp } from './shared';

export function hasDensityGateCondition(cond: EffectCondition | undefined): boolean {
  if (!cond) return false;
  if (cond.kind === 'DEPLOYED_FROM_ZONE' || cond.kind === 'TRASH_COUNT_AT_LEAST' || cond.kind === 'DEVELOPMENT_EXILE') {
    return true;
  }
  if (cond.kind === 'ALL_OF' || cond.kind === 'ANY_OF') {
    return cond.conditions.some((c) => hasDensityGateCondition(c));
  }
  if (cond.kind === 'NOT') {
    return hasDensityGateCondition(cond.condition);
  }
  return false;
}

/** Flattens a card's lowered ability AST into steps, flagging steps that sit behind a density gate. */
export function collectLoweredSteps(card: GundamCardPrint) {
  const parsed = card.compiledEffect ?? { keywords: [], abilities: [] };
  const steps: { step: EffectStep; gated: boolean }[] = [];

  for (const ab of parsed.abilities) {
    const gated = hasDensityGateCondition('condition' in ab ? ab.condition : undefined);
    for (const step of flattenEffectSteps(getAbilitySteps(ab))) steps.push({ step, gated });
  }
  return { parsed, steps };
}

export const PAIR_TIMINGS: EffectTiming[] = ['WHEN_PAIRED', 'WHEN_LINKED', 'DURING_PAIR', 'DURING_LINK'];

export const ATTACK_KEYWORDS = new Set(['Breach', 'First Strike', 'High-Maneuver', 'Suppression']);

/** Maps each lowered step to the single Effect Style it belongs to (undefined = no style). */
export function effectStyleOfStep(step: EffectStep): EffectStyleTag | undefined {
  switch (step.action) {
    case 'DEAL_DAMAGE':
      return 'Attack / Ping';
    case 'MODIFY_AP':
      return step.delta < 0 ? 'Removal / Disrupt' : undefined;
    case 'DESTROY':
    case 'BOUNCE':
    case 'REST':
    case 'FREEZE':
      return 'Removal / Disrupt';
    case 'DAMAGE_PROOF':
    case 'RECOVER_HP':
    case 'DEPLOY_TOKEN':
      return 'Board / Deploy';
    case 'DRAW':
    case 'LOOK_TOP':
    case 'REVEAL_TOP':
    case 'ADD_FROM_TRASH_TO_HAND':
    case 'DEPLOY_FROM_TRASH':
      return 'Draw / Recursion';
    case 'ADD_RESOURCE':
    case 'COST_REDUCTION':
      return 'Resource / Ramp';
    case 'PAIR_SELF_FROM_TRASH':
    case 'PAIR_FROM_HAND':
      return 'Link / Synergy';
    case 'GRANT_KEYWORD':
      return effectStyleOfKeyword(step.keyword.name);
    default:
      return undefined;
  }
}

export function effectStyleOfKeyword(name: string): EffectStyleTag {
  if (ATTACK_KEYWORDS.has(name)) return 'Attack / Ping';
  if (name === 'Support') return 'Link / Synergy';
  return 'Board / Deploy'; // Blocker, Repair
}

export function detectEffectStyles(card: GundamCardPrint): EffectStyleTag[] {
  const { parsed, steps } = collectLoweredSteps(card);
  const tags = new Set<EffectStyleTag>();

  for (const kw of parsed.keywords) tags.add(effectStyleOfKeyword(kw.name));
  for (const { step } of steps) {
    const tag = effectStyleOfStep(step);
    if (tag) tags.add(tag);
  }
  if (parsed.abilities.some((ab) => getAbilityTimings(ab).some((t) => PAIR_TIMINGS.includes(t)))) {
    tags.add('Link / Synergy');
  }

  return [...tags];
}

export interface CardSignalScores {
  aggro: number;
  defense: number;
  attack: number;
  liquidity: number;
  synergy: number;
  control: number;
  hasDraw: boolean;
  hasSearch: boolean;
  hasRamp: boolean;
  hasRest: boolean;
  hasRemoval: boolean;
  hasRepair: boolean;
  hasBlocker: boolean;
  hasBreach: boolean;
  hasFirstStrike: boolean;
  hasSupport: boolean;
  hasPing: boolean;
  hasPairTrigger: boolean;
  hasConditionalGate: boolean;
  effectStyles: EffectStyleTag[];
}

export function scoreSingleCardSignals(card: GundamCardPrint): CardSignalScores {
  const { parsed, steps } = collectLoweredSteps(card);
  const cost = card.cost ?? 2;
  const ap = card.ap ?? 0;
  const hp = card.hp ?? 0;
  const effectStyles = detectEffectStyles(card);

  const hasStep = (pred: (s: EffectStep) => boolean) => steps.some((x) => pred(x.step));
  const hasKeywordNamed = (name: string) =>
    parsed.keywords.some((k) => k.name === name) ||
    hasStep((s) => s.action === 'GRANT_KEYWORD' && s.keyword.name === name);

  const hasDraw = hasStep((s) => s.action === 'DRAW');
  const hasSearch = hasStep(
    (s) =>
      s.action === 'LOOK_TOP' ||
      s.action === 'REVEAL_TOP' ||
      s.action === 'ADD_FROM_TRASH_TO_HAND' ||
      s.action === 'DEPLOY_FROM_TRASH'
  );
  const hasRamp = hasStep((s) => s.action === 'ADD_RESOURCE' || s.action === 'COST_REDUCTION');
  const hasRest = hasStep((s) => s.action === 'REST' || s.action === 'FREEZE');
  const hasPing = hasStep((s) => s.action === 'DEAL_DAMAGE');
  const hasRemoval = hasStep(
    (s) => s.action === 'DEAL_DAMAGE' || s.action === 'DESTROY' || s.action === 'BOUNCE' || (s.action === 'MODIFY_AP' && s.delta < 0)
  );

  const hasRepair = hasKeywordNamed('Repair');
  const hasBlocker = hasKeywordNamed('Blocker');
  const hasBreach = hasKeywordNamed('Breach');
  const hasFirstStrike = hasKeywordNamed('First Strike');
  const hasHighManeuver = hasKeywordNamed('High-Maneuver');
  const hasSupport = hasKeywordNamed('Support');
  const hasPairTrigger = parsed.abilities.some((ab) => getAbilityTimings(ab).some((t) => PAIR_TIMINGS.includes(t)));
  const hasAttackTrigger = parsed.abilities.some((ab) => getAbilityTimings(ab).includes('ATTACK'));
  const hasConditionalGate = steps.length > 0 && steps.every((x) => x.gated);
  const gateMult = hasConditionalGate ? 0.5 : 1;

  let aggro = 0;
  let defense = 0;
  let attack = 0;
  let liquidity = 0;
  let synergy = 0;
  let control = 0;

  // Aggro / Pressure
  if (card.type === 'UNIT') {
    if (cost <= 2) aggro += 28;
    else if (cost === 3) aggro += 18;
    const apEff = cost > 0 ? ap / cost : ap;
    if (apEff >= 1.5) aggro += 26;
    else if (apEff >= 1.0) aggro += 14;
    if (ap >= 4) aggro += 12;
  } else if (card.type === 'PILOT' && ap >= 2) {
    aggro += 22;
  }
  if (hasBreach) aggro += 28;
  if (hasFirstStrike) aggro += 22;
  if (hasHighManeuver) aggro += 22;
  if (hasAttackTrigger) aggro += 16;
  if (hasStep((s) => s.action === 'MODIFY_AP' && s.delta > 0)) aggro += 12;

  // Defense / Durability
  if (card.type === 'UNIT') {
    const hpEff = cost > 0 ? hp / cost : hp;
    if (hpEff >= 1.5) defense += 25;
    else if (hpEff >= 1.1) defense += 14;
    if (hp >= 5) defense += 15;
  }
  if (card.type === 'BASE') defense += 42;
  if (card.type === 'PILOT' && hp >= 2) defense += 22;
  if (hasBlocker) defense += 34;
  if (hasRepair) defense += 32;
  if (hasStep((s) => s.action === 'DAMAGE_PROOF')) defense += 28;
  if (hasStep((s) => s.action === 'RECOVER_HP' || s.action === 'ADD_SHIELD_TO_HAND')) defense += 14;

  // Attack / Ping: effect-driven damage, evasion keywords and attack triggers, plus heavy hitters
  if (hasPing) attack += 40 * gateMult;
  if (hasBreach) attack += 26;
  if (hasFirstStrike) attack += 16;
  if (hasHighManeuver) attack += 22;
  if (hasKeywordNamed('Suppression')) attack += 22;
  if (hasAttackTrigger) attack += 20;
  if (hasStep((s) => s.action === 'MODIFY_AP' && s.delta > 0)) attack += 14;
  if (card.type === 'UNIT' && ap >= 4) attack += 14;
  else if (card.type === 'PILOT' && ap >= 2) attack += 10;

  // Card Liquidity
  if (hasDraw) liquidity += 48 * gateMult;
  if (hasRamp) liquidity += 30;
  if (hasSearch) liquidity += 34 * gateMult;
  if (
    parsed.abilities.some(
      (ab) =>
        ab.kind === 'EFFECT_CLAUSE' &&
        ab.timings.includes('BURST') &&
        ab.steps.some((s) => s.action === 'DRAW' || s.action === 'ADD_SELF_TO_HAND')
    )
  ) {
    // Burst self-add preserves card presence without inflating active deck draw velocity
    if (hasDraw) liquidity += 12;
  }

  // Synergy / Link
  if (card.link) synergy += 26;
  if (card.type === 'PILOT') synergy += 32;
  if (hasPairTrigger) synergy += 28;
  if (hasSupport) synergy += 24;
  if (hasStep((s) => s.action === 'PAIR_SELF_FROM_TRASH')) synergy += 14;
  if (hasStep((s) => 'target' in s && Boolean(s.target?.trait || s.target?.traits?.length))) synergy += 22;

  // Control / Disruption (with conditional discount on gated effects like ST09-006)
  if (card.type === 'COMMAND') control += 26;
  if (hasRest) control += 26 * gateMult;
  if (hasRemoval) control += 32 * gateMult;
  if (hasStep((s) => s.action === 'MODIFY_AP' && s.delta < 0)) control += 18 * gateMult;
  if (hasStep((s) => s.action === 'DESTROY')) control += 20 * gateMult;
  if (hasStep((s) => s.action === 'BOUNCE')) control += 20 * gateMult;
  if (
    parsed.abilities.some(
      (ab) =>
        ab.kind === 'EFFECT_CLAUSE' &&
        ab.timings.includes('BURST') &&
        ab.steps.some(
          (s) =>
            s.action === 'REST' ||
            s.action === 'DESTROY' ||
            s.action === 'DEAL_DAMAGE' ||
            s.action === 'ACTIVATE_MAIN_EFFECT'
        )
    )
  ) {
    control += 14;
  }
  if (hasStep((s) => s.action === 'CANT_ATTACK')) control += 16 * gateMult;

  return {
    aggro: clamp(aggro),
    defense: clamp(defense),
    attack: clamp(attack),
    liquidity: clamp(liquidity),
    synergy: clamp(synergy),
    control: clamp(control),
    hasDraw,
    hasSearch,
    hasRamp,
    hasRest,
    hasRemoval,
    hasRepair,
    hasBlocker,
    hasBreach,
    hasFirstStrike,
    hasSupport,
    hasPing,
    hasPairTrigger,
    hasConditionalGate,
    effectStyles,
  };
}
