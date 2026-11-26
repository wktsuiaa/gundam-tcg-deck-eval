import type { SandboxMatchState, SandboxSide, SandboxUnitInstance } from '@/types/gundam';
import type { CompiledCardEffect, KeywordName } from '@/lib/effect-parser';
import { checkCondition, evaluateScaleMetric } from './conditions';

export const EMPTY_PARSED_EFFECTS: Pick<CompiledCardEffect, 'keywords' | 'abilities'> = {
  keywords: [],
  abilities: [],
};

export function continuousApBuff(u: SandboxUnitInstance, state?: SandboxMatchState, side?: SandboxSide): number {
  if (!state || !side) return 0;
  let bonus = 0;
  const cards = u.pairedPilot ? [u.card, u.pairedPilot] : [u.card];
  for (const c of cards) {
    const parsed = c.compiledEffect ?? EMPTY_PARSED_EFFECTS;
    for (const ab of parsed.abilities) {
      if (ab.kind !== 'CONTINUOUS_MODIFIER' || ab.layer !== 3) continue;
      if (ab.requiresPair && !u.pairedPilot) continue;
      if (ab.requiresLink && !u.isLinked) continue;
      if (!checkCondition(ab.condition, state, side, u)) continue;
      if (ab.modifier.type === 'MODIFY_STAT' && ab.modifier.stat === 'AP' && ab.modifier.target.self) {
        const factor = evaluateScaleMetric(ab.modifier.scaleBy, state, side, u);
        if (factor !== null) bonus += ab.modifier.delta * factor;
      }
    }
  }
  return bonus;
}

export function effectiveAp(u: SandboxUnitInstance, state?: SandboxMatchState, side?: SandboxSide): number {
  return Math.max(0, (u.card.ap ?? 2) + (u.pairedPilot?.ap ?? 0) + u.apBuff + continuousApBuff(u, state, side));
}

export function effectiveMaxHp(u: SandboxUnitInstance): number {
  return Math.max(1, (u.card.hp ?? 2) + (u.pairedPilot?.hp ?? 0));
}

export function effectiveRemainingHp(u: SandboxUnitInstance): number {
  return effectiveMaxHp(u) - u.damage;
}

export function unitKeywordValue(
  u: SandboxUnitInstance,
  name: KeywordName,
  state?: SandboxMatchState,
  side?: SandboxSide
): number | null {
  const cards = u.pairedPilot ? [u.card, u.pairedPilot] : [u.card];
  for (const c of cards) {
    const parsed = c.compiledEffect ?? EMPTY_PARSED_EFFECTS;
    const innate = parsed.keywords.find((k) => k.name === name);
    if (innate) return innate.value ?? 1;

    if (state && side) {
      for (const ab of parsed.abilities) {
        if (ab.kind !== 'CONTINUOUS_MODIFIER' || ab.layer !== 2) continue;
        if (ab.requiresPair && !u.pairedPilot) continue;
        if (ab.requiresLink && !u.isLinked) continue;
        if (!checkCondition(ab.condition, state, side, u)) continue;
        if (ab.modifier.type === 'GRANT_KEYWORD' && ab.modifier.keyword.name === name) {
          return ab.modifier.keyword.value ?? 1;
        }
      }
    }
  }
  return null;
}

export function unitHasKeyword(
  u: SandboxUnitInstance,
  name: KeywordName,
  state?: SandboxMatchState,
  side?: SandboxSide
): boolean {
  return unitKeywordValue(u, name, state, side) !== null;
}
