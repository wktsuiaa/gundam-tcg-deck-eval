import type { GundamCardPrint } from '../../types/gundam.ts';
import type { AbilityAst } from '../cfg-parser.ts';
import { compileCardEffect, type KeywordAbility, type TargetSelector } from '../effect-parser.ts';
import { doesPilotLinkUnit } from '../gundam-keywords.ts';
import { evaluateUnitEffectiveState } from './effective-state';
import { ChainMatchState, ChainSide, ChainUnitInstance } from './types';

export function cloneState(state: ChainMatchState): ChainMatchState {
  return structuredClone(state);
}

export function oppositeSide(side: ChainSide): ChainSide {
  return side === 'A' ? 'B' : 'A';
}

export function getCardAbilities(card: GundamCardPrint): { keywords: KeywordAbility[]; abilities: AbilityAst[] } {
  const compiled = card.compiledEffect ?? compileCardEffect(card);
  return {
    keywords: compiled.keywords ?? [],
    abilities: compiled.abilities ?? [],
  };
}

export function isUnitLinked(unit: ChainUnitInstance): boolean {
  if (!unit.pairedPilot) return false;
  return doesPilotLinkUnit(unit.pairedPilot, unit.card);
}

export function matchesTargetSelectorSimple(
  targetUnit: ChainUnitInstance,
  selector: TargetSelector,
  state: ChainMatchState,
  sourceSide: ChainSide,
  sourceUnit?: ChainUnitInstance
): boolean {
  const ownerSide = findUnitSide(state, targetUnit.instanceId);
  if (!ownerSide) return false;
  if (selector.owner === 'SELF' && ownerSide !== sourceSide) return false;
  if (selector.owner === 'ENEMY' && ownerSide === sourceSide) return false;
  if (selector.other && sourceUnit && targetUnit.instanceId === sourceUnit.instanceId) return false;
  if (selector.state === 'RESTED' && !targetUnit.rested) return false;
  if (selector.state === 'ACTIVE' && targetUnit.rested) return false;
  if (selector.state === 'DAMAGED' && targetUnit.damage <= 0) return false;
  if (selector.linked && !isUnitLinked(targetUnit)) return false;
  if (selector.paired === true && !targetUnit.pairedPilot) return false;
  if (selector.paired === 'NONE' && targetUnit.pairedPilot) return false;

  const eff = evaluateUnitEffectiveState(targetUnit, state, ownerSide);
  if (selector.lvMin !== undefined && eff.lv < selector.lvMin) return false;
  if (selector.lvMax !== undefined && eff.lv > selector.lvMax) return false;
  if (selector.lvMaxRef === 'SELF_LV' && sourceUnit && eff.lv > (sourceUnit.card.lv ?? 1)) return false;
  if (selector.apMin !== undefined && eff.ap < selector.apMin) return false;
  if (selector.apMax !== undefined && eff.ap > selector.apMax) return false;
  if (selector.hpMin !== undefined && eff.remainingHp < selector.hpMin) return false;
  if (selector.hpMax !== undefined && eff.remainingHp > selector.hpMax) return false;
  if (selector.keyword && !eff.keywords.has(selector.keyword)) return false;

  const wantedTraits = selector.traits ?? (selector.trait ? [selector.trait] : []);
  if (wantedTraits.length > 0) {
    const hasAny = wantedTraits.some((wt) =>
      [...eff.traits].some((t) => t.toLowerCase() === wt.toLowerCase())
    );
    if (!hasAny) return false;
  }

  if (selector.nameContains && !targetUnit.card.name.toLowerCase().includes(selector.nameContains.toLowerCase())) {
    return false;
  }
  if (selector.color && targetUnit.card.color !== selector.color) return false;
  if (selector.notColor && targetUnit.card.color === selector.notColor) return false;
  return true;
}

export function findUnitSide(state: ChainMatchState, instanceId: string): ChainSide | null {
  if (state.players.A.battleArea.some((u) => u.instanceId === instanceId)) return 'A';
  if (state.players.B.battleArea.some((u) => u.instanceId === instanceId)) return 'B';
  return null;
}

export function findUnitById(state: ChainMatchState, instanceId: string): { side: ChainSide; unit: ChainUnitInstance } | null {
  for (const side of ['A', 'B'] as const) {
    const found = state.players[side].battleArea.find((u) => u.instanceId === instanceId);
    if (found) return { side, unit: found };
  }
  return null;
}
