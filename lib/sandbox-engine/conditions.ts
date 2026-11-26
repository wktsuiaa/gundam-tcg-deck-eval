import type { SandboxMatchState, SandboxSide, SandboxUnitInstance } from '@/types/gundam';
import type { EffectCondition, ScaleMetric } from '@/lib/effect-parser';
import { effectiveAp, effectiveRemainingHp, unitHasKeyword } from './unit-stats';

export function evaluateScaleMetric(
  scale: ScaleMetric | undefined,
  state: SandboxMatchState,
  side: SandboxSide,
  selfUnit?: SandboxUnitInstance
): number | null {
  if (!scale) return 1;
  const player = state.players[side];
  const opp = state.players[side === 'A' ? 'B' : 'A'];

  switch (scale.metric) {
    case 'HAND_COUNT':
      return scale.owner === 'ENEMY' ? opp.hand.length : player.hand.length;
    case 'TRASH_COUNT': {
      const pool = scale.owner === 'ENEMY' ? opp.trash : player.trash;
      const filtered = pool.filter((c) => {
        if (scale.traits?.length && !scale.traits.some((tr) => c.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))) return false;
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
          ? opp.battleArea
          : scale.owner === 'ANY'
          ? [...player.battleArea, ...opp.battleArea]
          : player.battleArea;
      return pool.filter((u) => {
        if ((scale.metric === 'RESTED_ENEMY_UNIT_COUNT' || scale.rested) && !u.rested) return false;
        if (scale.cardType === 'UNIT_TOKEN' && u.card.cardNo !== 'TOKEN') return false;
        if (scale.traits?.length && !scale.traits.some((tr) => u.card.traits.some((ct) => ct.toLowerCase() === tr.toLowerCase()))) return false;
        return true;
      }).length;
    }
    case 'ENEMY_PLAYER_COUNT':
      return 1;
    case 'SELF_DAMAGE':
      return selfUnit?.damage ?? 0;
    default:
      return null;
  }
}

export function checkCondition(
  cond: EffectCondition | undefined,
  state: SandboxMatchState,
  side: SandboxSide,
  selfUnit?: SandboxUnitInstance,
  destroyedByBattle = false,
  unsimulated?: { hit: boolean }
): boolean {
  if (!cond) return true;
  const player = state.players[side];
  const opp = state.players[side === 'A' ? 'B' : 'A'];

  switch (cond.kind) {
    case 'DEPLOYED_FROM_ZONE':
      return selfUnit?.deployedFromZone === cond.zone;
    case 'TRASH_COUNT_AT_LEAST': {
      const pool = cond.owner === 'ENEMY' ? opp.trash : player.trash;
      const matching = pool.filter((c) => {
        if (cond.color && c.color !== cond.color) return false;
        if (cond.traits?.length && !cond.traits.some((tr) => c.traits.some((t) => t.toLowerCase() === tr.toLowerCase()))) return false;
        else if (cond.trait && !c.traits.some((t) => t.toLowerCase() === cond.trait!.toLowerCase())) return false;
        if (cond.cardType && c.type !== cond.cardType) return false;
        if (cond.nameContains && !c.name.toLowerCase().includes(cond.nameContains.toLowerCase())) return false;
        return true;
      });
      return matching.length >= cond.count;
    }
    case 'FRIENDLY_BASE_IN_PLAY':
      if (!player.base) return false;
      if (cond.color && player.base.color !== cond.color) return false;
      if (cond.trait && !player.base.traits.some((t) => t.toLowerCase() === cond.trait!.toLowerCase())) return false;
      return true;
    case 'SELF_AP_AT_LEAST':
      return selfUnit ? effectiveAp(selfUnit, state, side) >= cond.minAp : false;
    case 'UNIT_TRAIT_IS': {
      if (!selfUnit) return false;
      const traits = cond.traits?.length ? cond.traits : [cond.trait];
      return traits.some((tr) => selfUnit.card.traits.some((t) => t.toLowerCase() === tr.toLowerCase()));
    }
    case 'IS_YOUR_TURN':
      return state.activeSide === side;
    case 'IS_OPPONENT_TURN':
      return state.activeSide !== side;
    case 'SELF_RESTED':
      return Boolean(selfUnit?.rested);
    case 'DESTROYED_BY_BATTLE':
      return destroyedByBattle;
    case 'UNIT_COUNT_AT_LEAST': {
      const count =
        cond.owner === 'ENEMY'
          ? opp.battleArea.length
          : cond.owner === 'SELF'
          ? player.battleArea.length
          : player.battleArea.length + opp.battleArea.length;
      return count >= cond.count;
    }
    case 'ALL_OF':
      return cond.conditions.every((c) => checkCondition(c, state, side, selfUnit, destroyedByBattle, unsimulated));
    case 'ANY_OF':
      return cond.conditions.some((c) => checkCondition(c, state, side, selfUnit, destroyedByBattle, unsimulated));
    case 'NOT':
      return !checkCondition(cond.condition, state, side, selfUnit, destroyedByBattle, unsimulated);
    case 'HAND_COUNT': {
      const count = cond.owner === 'ENEMY' ? opp.hand.length : player.hand.length;
      if (cond.min !== undefined && count < cond.min) return false;
      if (cond.max !== undefined && count > cond.max) return false;
      return true;
    }
    case 'SHIELD_COUNT': {
      const counts =
        cond.owner === 'ENEMY'
          ? [opp.shields]
          : cond.owner === 'SELF'
          ? [player.shields]
          : [player.shields, opp.shields];
      return counts.some(
        (cnt) => (cond.min === undefined || cnt >= cond.min) && (cond.max === undefined || cnt <= cond.max)
      );
    }
    case 'PLAYER_LV_AT_LEAST':
      return player.resourcesTotal >= cond.minLv;
    case 'ENEMY_PLAYER_COUNT_AT_LEAST':
      return 1 >= cond.count;
    case 'BOARD_CARD_COUNT': {
      if (cond.pairedPilotLvMax !== undefined || cond.hasDestroyedEffect !== undefined) {
        if (unsimulated) unsimulated.hit = true;
        return false;
      }
      const pools =
        cond.owner === 'SELF'
          ? [{ p: player, s: side }]
          : cond.owner === 'ENEMY'
          ? [{ p: opp, s: (side === 'A' ? 'B' : 'A') as SandboxSide }]
          : [
              { p: player, s: side },
              { p: opp, s: (side === 'A' ? 'B' : 'A') as SandboxSide },
            ];
      let matched = 0;
      if (cond.cardType === 'BASE') {
        for (const { p } of pools) {
          if (!p.base) continue;
          if (cond.color && p.base.color !== cond.color) continue;
          if (cond.traits?.length && !cond.traits.some((tr) => p.base!.traits.some((t) => t.toLowerCase() === tr.toLowerCase()))) continue;
          matched++;
        }
      } else if (cond.cardType === 'PILOT') {
        for (const { p } of pools) {
          for (const u of p.battleArea) {
            if (!u.pairedPilot) continue;
            if (cond.color && u.pairedPilot.color !== cond.color) continue;
            if (cond.traits?.length && !cond.traits.some((tr) => u.pairedPilot!.traits.some((t) => t.toLowerCase() === tr.toLowerCase()))) continue;
            matched++;
          }
        }
      } else {
        for (const { p, s: unitSide } of pools) {
          for (const u of p.battleArea) {
            if (cond.other && selfUnit && u.instanceId === selfUnit.instanceId) continue;
            if (cond.cardType === 'UNIT_TOKEN' && u.card.cardNo !== 'TOKEN') continue;
            if (cond.rested !== undefined && u.rested !== cond.rested) continue;
            if (cond.linked !== undefined && u.isLinked !== cond.linked) continue;
            if (cond.paired !== undefined && Boolean(u.pairedPilot) !== cond.paired) continue;
            if (cond.color && u.card.color !== cond.color) continue;
            if (cond.notColor && u.card.color === cond.notColor) continue;
            if (cond.traits?.length && !cond.traits.some((tr) => u.card.traits.some((t) => t.toLowerCase() === tr.toLowerCase()))) continue;
            if (cond.keyword && !unitHasKeyword(u, cond.keyword, state, unitSide)) continue;
            if (cond.nameContains && !u.card.name.toLowerCase().includes(cond.nameContains.toLowerCase())) continue;
            const lv = u.card.lv ?? 1;
            if (cond.lvMin !== undefined && lv < cond.lvMin) continue;
            if (cond.lvMax !== undefined && lv > cond.lvMax) continue;
            if (cond.apMax !== undefined && effectiveAp(u, state, unitSide) > cond.apMax) continue;
            matched++;
          }
        }
      }
      if (cond.min !== undefined && matched < cond.min) return false;
      if (cond.max !== undefined && matched > cond.max) return false;
      return true;
    }
    case 'SELF_STATE': {
      if (cond.destroyedBy || cond.attackingTarget || cond.battlingEnemy || cond.pairedWithUnit) {
        if (unsimulated) unsimulated.hit = true;
        return false;
      }
      if (!selfUnit) return false;
      if (cond.color && selfUnit.card.color !== cond.color) return false;
      if (cond.traits?.length && !cond.traits.some((tr) => selfUnit.card.traits.some((t) => t.toLowerCase() === tr.toLowerCase()))) return false;
      if (cond.paired !== undefined && Boolean(selfUnit.pairedPilot) !== cond.paired) return false;
      if (cond.damaged && selfUnit.damage <= 0) return false;
      const remHp = effectiveRemainingHp(selfUnit);
      if (cond.hpMin !== undefined && remHp < cond.hpMin) return false;
      if (cond.hpMax !== undefined && remHp > cond.hpMax) return false;
      const lv = selfUnit.card.lv ?? 1;
      if (cond.lvMin !== undefined && lv < cond.lvMin) return false;
      if (cond.lvMax !== undefined && lv > cond.lvMax) return false;
      if (cond.keyword && !unitHasKeyword(selfUnit, cond.keyword, state, side)) return false;
      return true;
    }
    case 'RESOURCE_COUNT':
    case 'TURN_HISTORY':
    case 'EX_RESOURCE_USED_TO_PLAY':
    case 'PHASE_AT_START_OF_OPPONENT_TURN':
    case 'DEVELOPMENT_EXILE':
    case 'RAW_CONDITION':
      if (unsimulated) unsimulated.hit = true;
      return false;
  }
}
