import type { GundamCardPrint, SandboxMatchState, SandboxSide, SandboxUnitInstance } from '@/types/gundam';
import type { EffectTiming, TargetSelector } from '@/lib/effect-parser';
import { checkCondition } from './conditions';
import { EMPTY_PARSED_EFFECTS, effectiveAp, effectiveRemainingHp, unitHasKeyword } from './unit-stats';

export function matchesUnitSelector(
  u: SandboxUnitInstance,
  sel: TargetSelector,
  selfUnit?: SandboxUnitInstance,
  state?: SandboxMatchState,
  unitSide?: SandboxSide
): boolean {
  if (sel.self && selfUnit && u.instanceId !== selfUnit.instanceId) return false;
  if (sel.other && selfUnit && u.instanceId === selfUnit.instanceId) return false;
  if (sel.cardType && sel.cardType !== 'UNIT' && sel.cardType !== 'UNIT_TOKEN' && sel.cardType !== 'CARD') return false;
  if ((sel.token || sel.cardType === 'UNIT_TOKEN') && u.card.cardNo !== 'TOKEN') return false;
  if (sel.excludeToken && u.card.cardNo === 'TOKEN') return false;
  if (sel.state === 'ACTIVE' && u.rested) return false;
  if (sel.state === 'RESTED' && !u.rested) return false;
  if (sel.state === 'DAMAGED' && u.damage <= 0) return false;
  if (sel.linked !== undefined && u.isLinked !== sel.linked) return false;
  if (sel.paired === 'NONE' && u.pairedPilot !== null) return false;
  if (sel.paired === true && u.pairedPilot === null) return false;
  if (sel.color && u.card.color !== sel.color) return false;
  if (sel.notColor && u.card.color === sel.notColor) return false;
  const lv = u.card.lv ?? 1;
  if (sel.lvMax !== undefined && lv > sel.lvMax) return false;
  if (sel.lvMin !== undefined && lv < sel.lvMin) return false;
  const ap = effectiveAp(u, state, unitSide);
  if (sel.apMax !== undefined && ap > sel.apMax) return false;
  if (sel.apMin !== undefined && ap < sel.apMin) return false;
  const remHp = effectiveRemainingHp(u);
  if (sel.hpMax !== undefined && remHp > sel.hpMax) return false;
  if (sel.hpMin !== undefined && remHp < sel.hpMin) return false;
  if (sel.traits?.length) {
    if (!sel.traits.some((tr) => u.card.traits.some((t) => t.toLowerCase() === tr.toLowerCase()))) return false;
  } else if (sel.trait && !u.card.traits.some((t) => t.toLowerCase() === sel.trait!.toLowerCase())) {
    return false;
  }
  if (sel.keyword && state && unitSide && !unitHasKeyword(u, sel.keyword, state, unitSide)) return false;
  if (sel.nameContains && !u.card.name.toLowerCase().includes(sel.nameContains.toLowerCase())) return false;
  if (sel.excludeName && u.card.name.toLowerCase().includes(sel.excludeName.toLowerCase())) return false;
  return true;
}

export function matchesCardSelector(card: GundamCardPrint, sel: TargetSelector): boolean {
  if (sel.cardType && sel.cardType !== 'CARD' && card.type !== sel.cardType) return false;
  const lv = card.lv ?? 1;
  if (sel.lvMax !== undefined && lv > sel.lvMax) return false;
  if (sel.lvMin !== undefined && lv < sel.lvMin) return false;
  if (sel.trait && !card.traits.some((t) => t.toLowerCase() === sel.trait!.toLowerCase())) return false;
  if (sel.nameContains && !card.name.toLowerCase().includes(sel.nameContains.toLowerCase())) return false;
  if (sel.excludeName && card.name.toLowerCase().includes(sel.excludeName.toLowerCase())) return false;
  return true;
}

export function findBattleAreaTargets(
  state: SandboxMatchState,
  side: SandboxSide,
  sel: TargetSelector,
  selfUnit?: SandboxUnitInstance
): { side: SandboxSide; unit: SandboxUnitInstance }[] {
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const pools: SandboxSide[] =
    sel.owner === 'SELF' ? [side] : sel.owner === 'ENEMY' ? [oppSide] : [oppSide, side];
  let out: { side: SandboxSide; unit: SandboxUnitInstance }[] = [];
  for (const s of pools) {
    for (const u of state.players[s].battleArea) {
      if (matchesUnitSelector(u, sel, selfUnit, state, s)) out.push({ side: s, unit: u });
    }
  }
  if (out.length > 0 && sel.hpRank) {
    const ext = sel.hpRank === 'LOWEST'
      ? Math.min(...out.map((x) => effectiveRemainingHp(x.unit)))
      : Math.max(...out.map((x) => effectiveRemainingHp(x.unit)));
    out = out.filter((x) => effectiveRemainingHp(x.unit) === ext);
  }
  if (out.length > 0 && sel.lvRank) {
    const ext = sel.lvRank === 'LOWEST'
      ? Math.min(...out.map((x) => x.unit.card.lv ?? 1))
      : Math.max(...out.map((x) => x.unit.card.lv ?? 1));
    out = out.filter((x) => (x.unit.card.lv ?? 1) === ext);
  }
  return out;
}

/** Exposes legal enemy Battle Area target options for UI prompts when human plays a targeted effect. */
export function getLegalTargetOptions(
  state: SandboxMatchState,
  side: SandboxSide,
  card: GundamCardPrint,
  timing: EffectTiming,
  selfUnit?: SandboxUnitInstance
): SandboxUnitInstance[] {
  const parsed = card.compiledEffect ?? EMPTY_PARSED_EFFECTS;
  for (const ab of parsed.abilities) {
    if (ab.kind !== 'EFFECT_CLAUSE') continue;
    if (!ab.timings.includes(timing)) continue;
    if (!checkCondition(ab.condition, state, side, selfUnit)) continue;
    for (const step of ab.steps) {
      if ('target' in step && step.target && step.target.owner === 'ENEMY' && step.target.count === 1) {
        return findBattleAreaTargets(state, side, step.target, selfUnit).map((x) => x.unit);
      }
    }
  }
  return [];
}
