import { type EffectCondition, type ScaleMetric } from '../effect-parser.ts';
import { evaluateUnitEffectiveState } from './effective-state';
import { getCardAbilities, isUnitLinked, oppositeSide } from './state-helpers';
import { ChainMatchState, ChainSide, ChainUnitInstance } from './types';

export function evaluateScaleMetric(
  scale: ScaleMetric | undefined,
  state: ChainMatchState,
  side: ChainSide,
  selfUnit?: ChainUnitInstance
): number {
  if (!scale) return 1;
  const selfP = state.players[side];
  const oppP = state.players[oppositeSide(side)];
  switch (scale.metric) {
    case 'HAND_COUNT':
      return scale.owner === 'ENEMY' ? oppP.hand.length : selfP.hand.length;
    case 'TRASH_COUNT': {
      const pool = scale.owner === 'ENEMY' ? oppP.trash : selfP.trash;
      const filtered = pool.filter((c) => {
        if (
          scale.traits?.length &&
          !scale.traits.some((tr) => c.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))
        ) {
          return false;
        }
        if (scale.nameContains && !c.name.toLowerCase().includes(scale.nameContains.toLowerCase())) return false;
        return true;
      });
      return scale.uniqueNames ? new Set(filtered.map((c) => c.name)).size : filtered.length;
    }
    case 'BOARD_UNIT_COUNT':
    case 'ENEMY_UNIT_COUNT':
    case 'RESTED_ENEMY_UNIT_COUNT': {
      const pool =
        scale.metric === 'ENEMY_UNIT_COUNT' || scale.metric === 'RESTED_ENEMY_UNIT_COUNT' || scale.owner === 'ENEMY'
          ? oppP.battleArea
          : scale.owner === 'ANY'
          ? [...selfP.battleArea, ...oppP.battleArea]
          : selfP.battleArea;
      return pool.filter((u) => {
        if ((scale.metric === 'RESTED_ENEMY_UNIT_COUNT' || scale.rested) && !u.rested) return false;
        if (
          scale.traits?.length &&
          !scale.traits.some((tr) => u.card.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))
        ) {
          return false;
        }
        return true;
      }).length;
    }
    case 'ENEMY_PLAYER_COUNT':
      return 1;
    case 'SELF_DAMAGE':
      return selfUnit?.damage ?? 0;
    default:
      return 1;
  }
}

export function evaluateCondition(
  cond: EffectCondition | undefined,
  state: ChainMatchState,
  side: ChainSide,
  selfUnit?: ChainUnitInstance,
  ctx?: { destroyedByBattle?: boolean }
): boolean {
  if (!cond) return true;
  const selfP = state.players[side];
  const oppP = state.players[oppositeSide(side)];

  switch (cond.kind) {
    case 'IS_YOUR_TURN':
      return state.activeSide === side;
    case 'IS_OPPONENT_TURN':
      return state.activeSide !== side;
    case 'FRIENDLY_BASE_IN_PLAY':
      if (!selfP.base) return false;
      if (cond.color && selfP.base.card.color !== cond.color) return false;
      if (cond.trait && !selfP.base.card.traits.some((t) => t.toLowerCase() === cond.trait!.toLowerCase())) {
        return false;
      }
      return true;
    case 'HAND_COUNT': {
      const n = cond.owner === 'ENEMY' ? oppP.hand.length : selfP.hand.length;
      if (cond.min !== undefined && n < cond.min) return false;
      if (cond.max !== undefined && n > cond.max) return false;
      return true;
    }
    case 'SHIELD_COUNT': {
      const counts =
        cond.owner === 'ENEMY'
          ? [oppP.shields.length]
          : cond.owner === 'SELF'
          ? [selfP.shields.length]
          : [selfP.shields.length, oppP.shields.length];
      return counts.some(
        (n) => (cond.min === undefined || n >= cond.min) && (cond.max === undefined || n <= cond.max)
      );
    }
    case 'TRASH_COUNT_AT_LEAST': {
      const pool = cond.owner === 'ENEMY' ? oppP.trash : selfP.trash;
      const matched = pool.filter((c) => {
        if (cond.color && c.color !== cond.color) return false;
        if (cond.cardType && c.type !== cond.cardType) return false;
        if (cond.trait && !c.traits.some((t) => t.toLowerCase() === cond.trait!.toLowerCase())) return false;
        if (
          cond.traits?.length &&
          !cond.traits.some((tr) => c.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))
        ) {
          return false;
        }
        if (cond.nameContains && !c.name.toLowerCase().includes(cond.nameContains.toLowerCase())) return false;
        return true;
      });
      return matched.length >= cond.count;
    }
    case 'BOARD_CARD_COUNT': {
      const pool =
        cond.owner === 'ENEMY'
          ? oppP.battleArea
          : cond.owner === 'ANY'
          ? [...selfP.battleArea, ...oppP.battleArea]
          : selfP.battleArea;
      const filtered = pool.filter((u) => {
        if (cond.other && selfUnit && u.instanceId === selfUnit.instanceId) return false;
        if (cond.rested !== undefined && u.rested !== cond.rested) return false;
        if (cond.linked && !isUnitLinked(u)) return false;
        if (cond.paired && !u.pairedPilot) return false;
        if (cond.color && u.card.color !== cond.color) return false;
        if (
          cond.traits?.length &&
          !cond.traits.some((tr) => u.card.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))
        ) {
          return false;
        }
        return true;
      });
      if (cond.min !== undefined && filtered.length < cond.min) return false;
      if (cond.max !== undefined && filtered.length > cond.max) return false;
      return true;
    }
    case 'SELF_AP_AT_LEAST':
      return selfUnit ? evaluateUnitEffectiveState(selfUnit, state, side).ap >= cond.minAp : false;
    case 'SELF_RESTED':
      return selfUnit ? selfUnit.rested : false;
    case 'DEPLOYED_FROM_ZONE':
      return selfUnit?.deployedFromZone === cond.zone;
    case 'DESTROYED_BY_BATTLE':
      return Boolean(ctx?.destroyedByBattle);
    case 'PLAYER_LV_AT_LEAST':
      return selfP.activeResources + selfP.restedResources + selfP.exResources >= cond.minLv;
    case 'RESOURCE_COUNT': {
      const p = cond.owner === 'ENEMY' ? oppP : selfP;
      const n = cond.ex ? p.exResources : p.activeResources + p.restedResources;
      if (cond.min !== undefined && n < cond.min) return false;
      if (cond.max !== undefined && n > cond.max) return false;
      return true;
    }
    case 'UNIT_COUNT_AT_LEAST': {
      const pool =
        cond.owner === 'ENEMY'
          ? oppP.battleArea
          : cond.owner === 'ANY'
          ? [...selfP.battleArea, ...oppP.battleArea]
          : selfP.battleArea;
      return pool.length >= cond.count;
    }
    case 'EX_RESOURCE_USED_TO_PLAY':
      return Boolean(state.exResourceSpentOnCurrentPlay);
    case 'ALL_OF':
      return cond.conditions.every((c) => evaluateCondition(c, state, side, selfUnit, ctx));
    case 'ANY_OF':
      return cond.conditions.some((c) => evaluateCondition(c, state, side, selfUnit, ctx));
    case 'NOT':
      return !evaluateCondition(cond.condition, state, side, selfUnit, ctx);
    case 'SELF_STATE': {
      if (!selfUnit) return false;
      if (cond.paired && !selfUnit.pairedPilot) return false;
      if (cond.damaged && selfUnit.damage <= 0) return false;
      if (cond.keyword) {
        const kw = getCardAbilities(selfUnit.card).keywords.some((k) => k.name === cond.keyword);
        if (!kw) return false;
      }
      if (
        cond.traits?.length &&
        !cond.traits.some((tr) => selfUnit.card.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))
      ) {
        return false;
      }
      return true;
    }
    default:
      return true;
  }
}
