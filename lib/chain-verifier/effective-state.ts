import type { GundamCardPrint } from '../../types/gundam.ts';
import type { ContinuousModifierAst, ProhibitionRule } from '../cfg-parser.ts';
import { type KeywordAbility, type KeywordName } from '../effect-parser.ts';
import { evaluateCondition, evaluateScaleMetric } from './conditions';
import { getCardAbilities, isUnitLinked } from './state-helpers';
import { ChainMatchState, ChainSide, ChainUnitInstance, EffectiveUnitState } from './types';

export function getActiveContinuousModifiers(
  unit: ChainUnitInstance,
  state: ChainMatchState,
  side: ChainSide
): ContinuousModifierAst[] {
  const mods: ContinuousModifierAst[] = [];
  const cards = unit.pairedPilot ? [unit.card, unit.pairedPilot] : [unit.card];
  const linked = isUnitLinked(unit);

  for (const c of cards) {
    for (const ab of getCardAbilities(c).abilities) {
      if (ab.kind !== 'CONTINUOUS_MODIFIER') continue;
      if (ab.activeIn !== 'BATTLE_AREA' && ab.activeIn !== 'ANY') continue;
      if (ab.requiresPair && !unit.pairedPilot) continue;
      if (ab.requiresLink && !linked) continue;
      if (!evaluateCondition(ab.condition, state, side, unit)) continue;
      mods.push(ab);
    }
  }
  return mods;
}

export function evaluateUnitEffectiveState(
  unit: ChainUnitInstance,
  state: ChainMatchState,
  side: ChainSide
): EffectiveUnitState {
  // Layer 1: Base printed + Paired Pilot stats
  let ap = (unit.card.ap ?? 0) + (unit.pairedPilot?.ap ?? 0);
  let maxHp = Math.max(0, (unit.card.hp ?? 1) + (unit.pairedPilot?.hp ?? 0));
  const lv = unit.card.lv ?? 1;
  const isLinked = isUnitLinked(unit);

  // Layer 2: Traits, Keywords (deduplicated per Bandai FAQ)
  const traits = new Set<string>(unit.card.traits ?? []);
  const keywords = new Set<KeywordName>();
  const keywordValues = new Map<KeywordName, number | null>();

  const addKeyword = (kw: KeywordAbility) => {
    keywords.add(kw.name);
    const prev = keywordValues.get(kw.name) ?? null;
    if (kw.value !== null && (prev === null || kw.value > prev)) {
      keywordValues.set(kw.name, kw.value);
    } else if (!keywordValues.has(kw.name)) {
      keywordValues.set(kw.name, kw.value);
    }
  };

  for (const kw of getCardAbilities(unit.card).keywords) addKeyword(kw);
  if (unit.pairedPilot) {
    for (const kw of getCardAbilities(unit.pairedPilot).keywords) addKeyword(kw);
  }

  const continuousMods = getActiveContinuousModifiers(unit, state, side);

  for (const cm of continuousMods) {
    if (cm.layer !== 2) continue;
    if (cm.modifier.type === 'GRANT_KEYWORD' && cm.modifier.target.self) {
      addKeyword(cm.modifier.keyword);
    } else if (cm.modifier.type === 'GRANT_TRAIT' && cm.modifier.target.self) {
      for (const tr of cm.modifier.traits) traits.add(tr);
    }
  }
  for (const tm of unit.temporaryModifiers) {
    if (tm.layer !== 2) continue;
    if (tm.keyword) addKeyword(tm.keyword);
    if (tm.traits) for (const tr of tm.traits) traits.add(tr);
  }

  // Layer 3: Additive AP / HP adjustments (avoid recursion when checking SELF_AP_AT_LEAST by checking L3 after)
  for (const cm of continuousMods) {
    if (cm.layer !== 3) continue;
    if (cm.modifier.type === 'MODIFY_STAT' && cm.modifier.target.self) {
      const factor = evaluateScaleMetric(cm.modifier.scaleBy, state, side, unit);
      if (cm.modifier.stat === 'AP') ap += cm.modifier.delta * factor;
      else maxHp += cm.modifier.delta * factor;
    }
  }
  for (const tm of unit.temporaryModifiers) {
    if (tm.layer !== 3) continue;
    if (tm.stat === 'AP') ap += tm.delta ?? 0;
    if (tm.stat === 'HP') maxHp += tm.delta ?? 0;
  }

  // Also check SELF_AP_AT_LEAST-gated Layer-2 grants (e.g. GD01-054 Duel Gundam) after L3 AP is computed
  const cards = unit.pairedPilot ? [unit.card, unit.pairedPilot] : [unit.card];
  for (const c of cards) {
    for (const ab of getCardAbilities(c).abilities) {
      if (
        ab.kind === 'CONTINUOUS_MODIFIER' &&
        ab.layer === 2 &&
        ab.condition?.kind === 'SELF_AP_AT_LEAST' &&
        ap >= ab.condition.minAp &&
        ab.modifier.type === 'GRANT_KEYWORD' &&
        ab.modifier.target.self
      ) {
        addKeyword(ab.modifier.keyword);
      }
    }
  }

  ap = Math.max(0, ap);
  maxHp = Math.max(0, maxHp);

  // Layer 4: Prohibitions ("can't") — unconditionally dominate Layers 1–3
  const prohibitions = new Set<ProhibitionRule>();
  const damageImmunities: EffectiveUnitState['damageImmunities'] = [];

  for (const cm of continuousMods) {
    if (cm.layer !== 4 || cm.modifier.type !== 'PROHIBITION') continue;
    prohibitions.add(cm.modifier.rule);
    if (cm.modifier.rule === 'CANT_RECEIVE_BATTLE_DAMAGE') {
      const apM = cm.raw.match(/(\d+)\s+or less AP/i);
      const lvM = cm.raw.match(/Lv\.(\d+)\s+or lower/i);
      damageImmunities.push({
        damageType: 'BATTLE',
        ...(apM ? { apMax: parseInt(apM[1], 10) } : {}),
        ...(lvM ? { lvMax: parseInt(lvM[1], 10) } : {}),
      });
    }
  }
  for (const tm of unit.temporaryModifiers) {
    if (tm.layer !== 4 || !tm.rule) continue;
    prohibitions.add(tm.rule);
    if (tm.rule === 'CANT_RECEIVE_BATTLE_DAMAGE') {
      damageImmunities.push({
        damageType: 'BATTLE',
        apMax: tm.sourceFilter?.apMax,
        lvMax: tm.sourceFilter?.lvMax,
      });
    }
  }

  const summonSick = unit.deployedTurn === state.turn && !isLinked;
  const canAttack = !unit.rested && !summonSick && !prohibitions.has('CANT_ATTACK');
  const canAttackPlayer = canAttack && !prohibitions.has('CANT_CHOOSE_ENEMY_PLAYER');
  const canBlock =
    keywords.has('Blocker') && !unit.rested && !prohibitions.has('CANT_ACTIVATE_BLOCKER');
  const canBeChosen = !prohibitions.has('CANT_BE_CHOSEN');

  return {
    ap,
    maxHp,
    remainingHp: maxHp - unit.damage,
    lv,
    isLinked,
    keywords,
    keywordValues,
    traits,
    prohibitions,
    damageImmunities,
    canAttack,
    canAttackPlayer,
    canBlock,
    canBeChosen,
  };
}

export function effectivePlayCost(card: GundamCardPrint, state: ChainMatchState, side: ChainSide): number {
  let cost = card.cost ?? 0;
  for (const ab of getCardAbilities(card).abilities) {
    if (ab.kind === 'CONTINUOUS_MODIFIER' && ab.layer === 3 && ab.modifier.type === 'COST_REDUCTION') {
      if (evaluateCondition(ab.condition, state, side)) {
        cost -= ab.modifier.amount;
      }
    }
  }
  return Math.max(0, cost);
}

// ---------------------------------------------------------------------------
// 3. Witness Cursor & Resolution Controller (No Stack, Depth-First Frames)
// ---------------------------------------------------------------------------
