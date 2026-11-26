import type {
  GundamCardPrint,
  SandboxMatchState,
  SandboxMoveSuggestion,
  SandboxPlayerState,
} from '../types/gundam.ts';
import type {
  AbilityAst,
  ContinuousModifierAst,
  CustomHookAst,
  EffectClauseAst,
  ProhibitionRule,
} from './cfg-parser.ts';
import {
  compileCardEffect,
  type ActivationCost,
  type EffectCondition,
  type EffectDuration,
  type EffectStep,
  type EffectTiming,
  type KeywordAbility,
  type KeywordName,
  type ScaleMetric,
  type TargetSelector,
} from './effect-parser.ts';
import { doesPilotLinkUnit, isCommandPilot } from './gundam-keywords.ts';

// ---------------------------------------------------------------------------
// 1. Public State & Request / Witness Types (Seam 3)
// ---------------------------------------------------------------------------

export type ChainSide = 'A' | 'B';

export type IllegalChainReason =
  | 'WRONG_PHASE'
  | 'NOT_ACTIVE_PLAYER'
  | 'INSUFFICIENT_LV'
  | 'INSUFFICIENT_RESOURCES'
  | 'MISSING_WITNESS'
  | 'INVALID_TARGET'
  | 'NO_LEGAL_TARGET'
  | 'PROHIBITED_BY_CANT'
  | 'UNIT_RESTED'
  | 'SUMMON_SICKNESS'
  | 'ALREADY_PAIRED'
  | 'PILOT_RESTRICTED'
  | 'CONDITION_NOT_MET'
  | 'ONCE_PER_TURN_EXHAUSTED'
  | 'UNIMPLEMENTED_CUSTOM_HOOK'
  | 'INVALID_ACTION';

export interface TemporaryModifier {
  id: string;
  layer: 2 | 3 | 4;
  duration: EffectDuration;
  stat?: 'AP' | 'HP';
  delta?: number;
  keyword?: KeywordAbility;
  traits?: string[];
  rule?: ProhibitionRule;
  sourceFilter?: TargetSelector;
}

export interface ChainUnitInstance {
  instanceId: string;
  card: GundamCardPrint;
  pairedPilot?: GundamCardPrint;
  rested: boolean;
  damage: number;
  deployedTurn: number;
  deployedFromZone?: 'hand' | 'trash';
  temporaryModifiers: TemporaryModifier[];
  triggeredOnceThisTurn: string[];
}

export interface ChainBaseInstance {
  instanceId: string;
  card: GundamCardPrint;
  damage: number;
  temporaryModifiers?: TemporaryModifier[];
}

export interface ChainShieldCard {
  id: string;
  card: GundamCardPrint;
}

export interface ChainPlayerState {
  hand: GundamCardPrint[];
  deck: GundamCardPrint[];
  trash: GundamCardPrint[];
  battleArea: ChainUnitInstance[];
  base: ChainBaseInstance | null;
  shields: ChainShieldCard[];
  activeResources: number;
  restedResources: number;
  exResources: number;
  exiled?: GundamCardPrint[];
  activatedCommandTraitsThisTurn?: string[];
}

export interface ChainMatchState {
  turn: number;
  phase: 'MAIN' | 'ACTION_STEP' | 'END';
  activeSide: ChainSide;
  players: Record<ChainSide, ChainPlayerState>;
  pendingActionStep: null | {
    attackerId: string;
    defenderSide: ChainSide;
    targetKind: 'SHIELD' | 'UNIT';
    targetId?: string;
  };
  shieldDamageProhibitions?: {
    side: ChainSide;
    lvMax?: number;
    apMax?: number;
    duration: EffectDuration;
  }[];
  exResourceSpentOnCurrentPlay?: boolean;
}

export type PlayerAction =
  | { type: 'DEPLOY_UNIT'; side: ChainSide; handIndex: number }
  | { type: 'DEPLOY_BASE'; side: ChainSide; handIndex: number }
  | { type: 'PAIR_PILOT'; side: ChainSide; handIndex: number; targetUnitId: string }
  | { type: 'PLAY_COMMAND'; side: ChainSide; handIndex: number }
  | { type: 'ACTIVATE_ABILITY'; side: ChainSide; sourceId: string; clauseIndex: number }
  | { type: 'ATTACK_SHIELD'; side: ChainSide; attackerId: string }
  | { type: 'ATTACK_UNIT'; side: ChainSide; attackerId: string; targetId: string }
  | { type: 'PASS_TURN'; side: ChainSide };

export interface ActionStepWitnessMove {
  kind: 'PASS' | 'BLOCKER' | 'PLAY_ACTION';
  side: ChainSide;
  unitId?: string;
  handIndex?: number;
}

export interface ChainWitness {
  resourceSpends?: { regular: number; ex: number }[];
  zoneReplacements?: string[];
  targets?: string[][];
  optionalAccepts?: boolean[];
  modalChoices?: number[];
  triggerOrders?: number[][];
  replacementChoices?: { accept: boolean; targetId?: string }[];
  actionSteps?: ActionStepWitnessMove[];
  burstAccepts?: boolean[];
  burstOrder?: number[];
  deckTopReveals?: GundamCardPrint[];
}

export interface DummyUnitSpec {
  cardNo?: string;
  name?: string;
  lv?: number;
  ap?: number;
  hp?: number;
  rested?: boolean;
  traits?: string[];
  keywords?: KeywordAbility[];
  effect?: string;
}

export type ChainVerificationRequest = {
  mode:
    | { kind: 'CONCRETE_SNAPSHOT'; state: ChainMatchState }
    | {
        kind: 'MINIMAL_FEASIBILITY';
        turn: number;
        activeHand: GundamCardPrint[];
        activeBattleArea?: ChainUnitInstance[];
        activeTrash?: GundamCardPrint[];
        activeDeck?: GundamCardPrint[];
        opponentDummyBoard?: {
          units?: DummyUnitSpec[];
          shields?: number;
          hasBase?: boolean;
        };
      };
  playLine: PlayerAction[];
  witness: ChainWitness;
};

export interface ChainTraceEntry {
  kind: 'ACTION' | 'TRIGGER' | 'REPLACEMENT' | 'SBA' | 'DAMAGE' | 'BURST';
  detail: string;
}

export type ChainVerificationResult =
  | { legal: true; finalState: ChainMatchState; trace: ChainTraceEntry[] }
  | { legal: false; reason: IllegalChainReason; detail: string; trace: ChainTraceEntry[] };

export interface EffectiveUnitState {
  ap: number;
  maxHp: number;
  remainingHp: number;
  lv: number;
  isLinked: boolean;
  keywords: Set<KeywordName>;
  keywordValues: Map<KeywordName, number | null>;
  traits: Set<string>;
  prohibitions: Set<ProhibitionRule>;
  damageImmunities: { damageType: 'BATTLE' | 'EFFECT' | 'ANY'; apMax?: number; lvMax?: number }[];
  canAttack: boolean;
  canAttackPlayer: boolean;
  canBlock: boolean;
  canBeChosen: boolean;
}

// ---------------------------------------------------------------------------
// 2. Helpers: Cloning, Card Abilities, and 4-Layer Continuous Evaluator
// ---------------------------------------------------------------------------

function cloneState(state: ChainMatchState): ChainMatchState {
  return structuredClone(state);
}

function oppositeSide(side: ChainSide): ChainSide {
  return side === 'A' ? 'B' : 'A';
}

function getCardAbilities(card: GundamCardPrint): { keywords: KeywordAbility[]; abilities: AbilityAst[] } {
  const compiled = card.compiledEffect ?? compileCardEffect(card);
  return {
    keywords: compiled.keywords ?? [],
    abilities: compiled.abilities ?? [],
  };
}

function isUnitLinked(unit: ChainUnitInstance): boolean {
  if (!unit.pairedPilot) return false;
  return doesPilotLinkUnit(unit.pairedPilot, unit.card);
}

function matchesTargetSelectorSimple(
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

function findUnitSide(state: ChainMatchState, instanceId: string): ChainSide | null {
  if (state.players.A.battleArea.some((u) => u.instanceId === instanceId)) return 'A';
  if (state.players.B.battleArea.some((u) => u.instanceId === instanceId)) return 'B';
  return null;
}

function findUnitById(state: ChainMatchState, instanceId: string): { side: ChainSide; unit: ChainUnitInstance } | null {
  for (const side of ['A', 'B'] as const) {
    const found = state.players[side].battleArea.find((u) => u.instanceId === instanceId);
    if (found) return { side, unit: found };
  }
  return null;
}

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

function getActiveContinuousModifiers(
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

function effectivePlayCost(card: GundamCardPrint, state: ChainMatchState, side: ChainSide): number {
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

class WitnessCursor {
  private readonly w: ChainWitness;
  private resIdx = 0;
  private zoneIdx = 0;
  private targetIdx = 0;
  private optIdx = 0;
  private modalIdx = 0;
  private orderIdx = 0;
  private repIdx = 0;
  private actionIdx = 0;
  private burstAccIdx = 0;
  private deckIdx = 0;

  constructor(w: ChainWitness) {
    this.w = w;
  }

  nextResourceSpend(cost: number, activeReg: number, activeEx: number): { regular: number; ex: number } | null {
    const provided = this.w.resourceSpends?.[this.resIdx];
    if (provided) {
      this.resIdx += 1;
      if (provided.regular + provided.ex !== cost) return null;
      if (provided.regular > activeReg || provided.ex > activeEx) return null;
      return provided;
    }
    // Unambiguous auto-spend if only regular or only ex resources cover it
    if (cost === 0) return { regular: 0, ex: 0 };
    if (activeEx === 0 && activeReg >= cost) return { regular: cost, ex: 0 };
    if (activeReg === 0 && activeEx >= cost) return { regular: 0, ex: cost };
    if (activeReg >= cost) return { regular: cost, ex: 0 };
    const exNeeded = cost - activeReg;
    if (activeEx >= exNeeded) return { regular: activeReg, ex: exNeeded };
    return null;
  }

  nextZoneReplacement(): string | null {
    const v = this.w.zoneReplacements?.[this.zoneIdx];
    if (v === undefined) return null;
    this.zoneIdx += 1;
    return v;
  }

  nextTargets(): string[] | null {
    const v = this.w.targets?.[this.targetIdx];
    if (v === undefined) return null;
    this.targetIdx += 1;
    return v;
  }

  nextOptionalAccept(defaultVal = true): boolean {
    const v = this.w.optionalAccepts?.[this.optIdx];
    if (v === undefined) return defaultVal;
    this.optIdx += 1;
    return v;
  }

  nextModalChoice(): number | null {
    const v = this.w.modalChoices?.[this.modalIdx];
    if (v === undefined) return null;
    this.modalIdx += 1;
    return v;
  }

  nextTriggerOrder(count: number): number[] {
    const v = this.w.triggerOrders?.[this.orderIdx];
    if (v !== undefined && v.length === count) {
      this.orderIdx += 1;
      return v;
    }
    return Array.from({ length: count }, (_, i) => i);
  }

  nextReplacementChoice(): { accept: boolean; targetId?: string } | null {
    const v = this.w.replacementChoices?.[this.repIdx];
    if (v === undefined) return null;
    this.repIdx += 1;
    return v;
  }

  nextActionStepMove(): ActionStepWitnessMove | null {
    const v = this.w.actionSteps?.[this.actionIdx];
    if (v === undefined) return null;
    this.actionIdx += 1;
    return v;
  }

  nextBurstAccept(): boolean {
    const v = this.w.burstAccepts?.[this.burstAccIdx];
    if (v === undefined) return true;
    this.burstAccIdx += 1;
    return v;
  }

  peekBurstOrder(count: number): number[] {
    if (this.w.burstOrder && this.w.burstOrder.length === count) {
      return this.w.burstOrder;
    }
    return Array.from({ length: count }, (_, i) => i);
  }

  drawFromDeck(player: ChainPlayerState): GundamCardPrint | null {
    if (player.deck.length > 0) return player.deck.shift()!;
    const revealed = this.w.deckTopReveals?.[this.deckIdx];
    if (revealed) {
      this.deckIdx += 1;
      return revealed;
    }
    return null;
  }
}

interface QueuedTrigger {
  side: ChainSide;
  clause: EffectClauseAst;
  sourceCard: GundamCardPrint;
  sourceUnitId?: string;
  lastKnownUnit?: ChainUnitInstance;
  ctx?: { destroyedByBattle?: boolean };
}

class ChainFailError extends Error {
  public readonly reason: IllegalChainReason;
  constructor(reason: IllegalChainReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

class VerifierRunner {
  public state: ChainMatchState;
  public readonly witness: WitnessCursor;
  public readonly trace: ChainTraceEntry[] = [];
  private eventSeq = 0;
  private readonly appliedReplacements = new Set<string>();
  private readonly selfPairedCards = new Set<GundamCardPrint>();

  constructor(initial: ChainMatchState, witness: ChainWitness) {
    this.state = cloneState(initial);
    this.witness = new WitnessCursor(witness);
  }

  private nextEventId(prefix: string): string {
    this.eventSeq += 1;
    return `${prefix}#${this.eventSeq}`;
  }

  public executeAction(action: PlayerAction): void {
    if (action.side !== this.state.activeSide && action.type !== 'PASS_TURN') {
      throw new ChainFailError('NOT_ACTIVE_PLAYER', `Side ${action.side} is not active.`);
    }

    if (action.type === 'PASS_TURN') {
      this.endTurn();
      return;
    }

    if (this.state.phase !== 'MAIN') {
      throw new ChainFailError('WRONG_PHASE', `Cannot execute ${action.type} during ${this.state.phase}.`);
    }

    switch (action.type) {
      case 'DEPLOY_UNIT':
        this.doDeployUnit(action.side, action.handIndex);
        break;
      case 'DEPLOY_BASE':
        this.doDeployBase(action.side, action.handIndex);
        break;
      case 'PAIR_PILOT':
        this.doPairPilot(action.side, action.handIndex, action.targetUnitId);
        break;
      case 'PLAY_COMMAND':
        this.doPlayCommand(action.side, action.handIndex);
        break;
      case 'ACTIVATE_ABILITY':
        this.doActivateAbility(action.side, action.sourceId, action.clauseIndex);
        break;
      case 'ATTACK_SHIELD':
        this.doAttack(action.side, action.attackerId, 'SHIELD');
        break;
      case 'ATTACK_UNIT':
        this.doAttack(action.side, action.attackerId, 'UNIT', action.targetId);
        break;
    }
  }

  private payLvAndCost(side: ChainSide, card: GundamCardPrint, extraCost = 0): void {
    const player = this.state.players[side];
    const totalLv = player.activeResources + player.restedResources + player.exResources;
    const reqLv = card.lv ?? 1;
    if (totalLv < reqLv) {
      throw new ChainFailError(
        'INSUFFICIENT_LV',
        `${card.cardNo} requires Lv.${reqLv} but player ${side} has Lv.${totalLv}.`
      );
    }

    const cost = effectivePlayCost(card, this.state, side) + extraCost;
    const totalActive = player.activeResources + player.exResources;
    if (totalActive < cost) {
      throw new ChainFailError(
        'INSUFFICIENT_RESOURCES',
        `${card.cardNo} costs ${cost} but player ${side} only has ${totalActive} active resources.`
      );
    }

    const spend = this.witness.nextResourceSpend(cost, player.activeResources, player.exResources);
    if (!spend) {
      throw new ChainFailError(
        'MISSING_WITNESS',
        `Unable to determine valid resource spend of ${cost} for ${card.cardNo}.`
      );
    }

    player.activeResources -= spend.regular;
    player.restedResources += spend.regular;
    player.exResources -= spend.ex;
    this.state.exResourceSpentOnCurrentPlay = spend.ex > 0;
  }

  private doDeployUnit(side: ChainSide, handIndex: number): void {
    const player = this.state.players[side];
    const card = player.hand[handIndex];
    if (!card || card.type !== 'UNIT') {
      throw new ChainFailError('INVALID_ACTION', `Hand index ${handIndex} is not a UNIT.`);
    }

    this.payLvAndCost(side, card);
    player.hand.splice(handIndex, 1);

    // 6-Unit Battle Area limit: displacing an existing Unit places it into Trash WITHOUT destruction triggers
    if (player.battleArea.length >= 6) {
      const replaceId = this.witness.nextZoneReplacement();
      if (!replaceId) {
        throw new ChainFailError(
          'MISSING_WITNESS',
          'Battle Area has 6 Units; ChainWitness.zoneReplacements must select a Unit to displace.'
        );
      }
      const idx = player.battleArea.findIndex((u) => u.instanceId === replaceId);
      if (idx < 0) {
        throw new ChainFailError('INVALID_TARGET', `Displaced Unit ${replaceId} not found.`);
      }
      const [displaced] = player.battleArea.splice(idx, 1);
      player.trash.push(displaced.card);
      if (displaced.pairedPilot) player.trash.push(displaced.pairedPilot);
      this.trace.push({
        kind: 'ACTION',
        detail: `Displaced ${displaced.card.cardNo} to Trash (not destroyed)`,
      });
    }

    const instance: ChainUnitInstance = {
      instanceId: `${side}-U-${this.nextEventId('unit')}`,
      card,
      rested: false,
      damage: 0,
      deployedTurn: this.state.turn,
      deployedFromZone: 'hand',
      temporaryModifiers: [],
      triggeredOnceThisTurn: [],
    };
    player.battleArea.push(instance);
    this.trace.push({ kind: 'ACTION', detail: `${side} deployed ${card.cardNo}` });

    const frame: QueuedTrigger[] = [];
    this.collectUnitTimingTriggers(side, instance, 'DEPLOY', frame);
    this.collectBoardTimingTriggers('WHEN_UNIT_DEPLOYED', frame, side);
    this.drainResolutionFrame(frame);
  }

  private doDeployBase(side: ChainSide, handIndex: number): void {
    const player = this.state.players[side];
    const card = player.hand[handIndex];
    if (!card || card.type !== 'BASE') {
      throw new ChainFailError('INVALID_ACTION', `Hand index ${handIndex} is not a BASE.`);
    }
    this.payLvAndCost(side, card);
    player.hand.splice(handIndex, 1);
    if (player.base) {
      player.trash.push(player.base.card); // Base displacement is NOT destruction
    }
    player.base = {
      instanceId: `${side}-BASE-${this.nextEventId('base')}`,
      card,
      damage: 0,
      temporaryModifiers: [],
    };
    this.trace.push({ kind: 'ACTION', detail: `${side} deployed Base ${card.cardNo}` });
    const frame: QueuedTrigger[] = [];
    this.collectCardTimingTriggers(side, card, 'DEPLOY', frame);
    this.drainResolutionFrame(frame);
  }

  private doPairPilot(side: ChainSide, handIndex: number, targetUnitId: string): void {
    const player = this.state.players[side];
    const pilot = player.hand[handIndex];
    if (!pilot) throw new ChainFailError('INVALID_ACTION', `Missing card at hand[${handIndex}].`);
    const isCmdPilot = getCardAbilities(pilot).abilities.some(
      (a) => a.kind === 'CONTINUOUS_MODIFIER' && a.modifier.type === 'GRANT_PILOT_MODE'
    );
    if (pilot.type !== 'PILOT' && !isCmdPilot) {
      throw new ChainFailError('INVALID_ACTION', `${pilot.cardNo} cannot be paired as a Pilot.`);
    }

    const target = player.battleArea.find((u) => u.instanceId === targetUnitId);
    if (!target) throw new ChainFailError('INVALID_TARGET', `Unit ${targetUnitId} not found.`);
    if (target.pairedPilot) throw new ChainFailError('ALREADY_PAIRED', `${targetUnitId} already has a Pilot.`);

    const eff = evaluateUnitEffectiveState(target, this.state, side);
    if (eff.prohibitions.has('CANT_BE_PAIRED')) {
      throw new ChainFailError('PROHIBITED_BY_CANT', `${targetUnitId} cannot be paired.`);
    }

    this.payLvAndCost(side, pilot);
    player.hand.splice(handIndex, 1);
    target.pairedPilot = pilot;
    const linked = isUnitLinked(target);

    this.trace.push({
      kind: 'ACTION',
      detail: `${side} paired ${pilot.cardNo} onto ${target.card.cardNo} (linked=${linked})`,
    });

    const frame: QueuedTrigger[] = [];
    this.collectUnitTimingTriggers(side, target, 'WHEN_PAIRED', frame);
    if (linked) {
      this.collectUnitTimingTriggers(side, target, 'WHEN_LINKED', frame);
    }
    this.drainResolutionFrame(frame);
  }

  private doPlayCommand(side: ChainSide, handIndex: number): void {
    const player = this.state.players[side];
    const card = player.hand[handIndex];
    if (!card || card.type !== 'COMMAND') {
      throw new ChainFailError('INVALID_ACTION', `Hand index ${handIndex} is not a COMMAND.`);
    }

    const { abilities } = getCardAbilities(card);
    const mainClauses = abilities.filter(
      (a): a is EffectClauseAst => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('MAIN')
    );
    if (mainClauses.length === 0) {
      throw new ChainFailError('INVALID_ACTION', `${card.cardNo} has no 【Main】 clause.`);
    }

    const chosenIdx = mainClauses.length > 1 ? this.witness.nextModalChoice() ?? 0 : 0;
    const clause = mainClauses[chosenIdx];
    if (!clause) throw new ChainFailError('MISSING_WITNESS', `Invalid modal choice ${chosenIdx}.`);

    // Bandai FAQ: cannot activate/play a card requiring a target when no legal target exists
    this.assertMandatoryTargetsExist(clause.steps, side);

    this.payLvAndCost(side, card);
    player.hand.splice(handIndex, 1);
    player.activatedCommandTraitsThisTurn = [
      ...(player.activatedCommandTraitsThisTurn ?? []),
      ...(card.traits ?? []),
    ];

    this.trace.push({ kind: 'ACTION', detail: `${side} played Command ${card.cardNo}` });
    this.resolveClause(side, clause, card);
    if (!this.selfPairedCards.delete(card)) {
      player.trash.push(card);
    }
  }

  private doActivateAbility(side: ChainSide, sourceId: string, clauseIndex: number): void {
    const found = findUnitById(this.state, sourceId);
    if (!found || found.side !== side) {
      throw new ChainFailError('INVALID_TARGET', `Source Unit ${sourceId} not controlled by ${side}.`);
    }
    const { unit } = found;
    const allAbilities = [
      ...getCardAbilities(unit.card).abilities,
      ...(unit.pairedPilot ? getCardAbilities(unit.pairedPilot).abilities : []),
    ];
    const targetAb = allAbilities.find((a) => a.clauseIndex === clauseIndex) ?? allAbilities[clauseIndex];
    if (!targetAb) {
      throw new ChainFailError('INVALID_ACTION', `Clause #${clauseIndex} not found on ${sourceId}.`);
    }
    if (targetAb.kind === 'CUSTOM_HOOK') {
      this.executeCustomHook(side, unit, targetAb);
      return;
    }
    if (targetAb.kind !== 'EFFECT_CLAUSE') {
      throw new ChainFailError('INVALID_ACTION', `Clause #${clauseIndex} is not an activatable EffectClause.`);
    }

    if (targetAb.oncePerTurn && unit.triggeredOnceThisTurn.includes(targetAb.raw)) {
      throw new ChainFailError('ONCE_PER_TURN_EXHAUSTED', `${targetAb.raw} already used this turn.`);
    }
    if (!evaluateCondition(targetAb.condition, this.state, side, unit)) {
      throw new ChainFailError('CONDITION_NOT_MET', `Condition failed for ${targetAb.raw}.`);
    }

    this.assertMandatoryTargetsExist(targetAb.steps, side, unit);
    this.payActivationCost(side, unit, targetAb.cost);
    if (targetAb.oncePerTurn) unit.triggeredOnceThisTurn.push(targetAb.raw);

    this.trace.push({ kind: 'ACTION', detail: `${side} activated ${unit.card.cardNo}#${clauseIndex}` });
    this.resolveClause(side, targetAb, unit.card, unit);
  }

  private payActivationCost(side: ChainSide, unit: ChainUnitInstance, cost?: ActivationCost): void {
    if (!cost) return;
    const player = this.state.players[side];
    if (cost.restSelf) {
      if (unit.rested) throw new ChainFailError('UNIT_RESTED', `${unit.card.cardNo} is already rested.`);
      unit.rested = true;
    }
    if (cost.resourceCost && cost.resourceCost > 0) {
      const totalActive = player.activeResources + player.exResources;
      if (totalActive < cost.resourceCost) {
        throw new ChainFailError('INSUFFICIENT_RESOURCES', `Ability cost ${cost.resourceCost} exceeds active resources.`);
      }
      const spend = this.witness.nextResourceSpend(cost.resourceCost, player.activeResources, player.exResources);
      if (!spend) throw new ChainFailError('MISSING_WITNESS', 'Missing resource spend witness for activation cost.');
      player.activeResources -= spend.regular;
      player.restedResources += spend.regular;
      player.exResources -= spend.ex;
    }
    if (cost.returnSelfToDeckBottom) {
      const idx = player.battleArea.findIndex((u) => u.instanceId === unit.instanceId);
      if (idx >= 0) {
        player.battleArea.splice(idx, 1);
        player.deck.push(unit.card);
        if (unit.pairedPilot) player.trash.push(unit.pairedPilot);
      }
    }
    if (cost.discardCount && cost.discardCount > 0) {
      if (player.hand.length < cost.discardCount) {
        throw new ChainFailError('INSUFFICIENT_RESOURCES', `Need ${cost.discardCount} cards in hand to discard.`);
      }
      for (let i = 0; i < cost.discardCount; i += 1) {
        player.trash.push(player.hand.pop()!);
      }
    }
  }

  private doAttack(
    side: ChainSide,
    attackerId: string,
    targetKind: 'SHIELD' | 'UNIT',
    targetId?: string
  ): void {
    const attackerFound = findUnitById(this.state, attackerId);
    if (!attackerFound || attackerFound.side !== side) {
      throw new ChainFailError('INVALID_TARGET', `Attacker ${attackerId} not controlled by ${side}.`);
    }
    const attacker = attackerFound.unit;
    const effAttacker = evaluateUnitEffectiveState(attacker, this.state, side);

    if (attacker.rested) throw new ChainFailError('UNIT_RESTED', `${attacker.card.cardNo} is rested.`);
    if (attacker.deployedTurn === this.state.turn && !effAttacker.isLinked) {
      throw new ChainFailError('SUMMON_SICKNESS', `${attacker.card.cardNo} cannot attack on deploy turn without Link.`);
    }
    if (effAttacker.prohibitions.has('CANT_ATTACK')) {
      throw new ChainFailError('PROHIBITED_BY_CANT', `${attacker.card.cardNo} cannot attack (Layer 4).`);
    }
    if (targetKind === 'SHIELD' && effAttacker.prohibitions.has('CANT_CHOOSE_ENEMY_PLAYER')) {
      throw new ChainFailError(
        'PROHIBITED_BY_CANT',
        `${attacker.card.cardNo} cannot choose enemy player/Base/Shields as attack target.`
      );
    }

    const defSide = oppositeSide(side);
    let currentTargetKind = targetKind;
    let currentTargetId = targetId;

    if (currentTargetKind === 'UNIT') {
      const defFound = currentTargetId ? findUnitById(this.state, currentTargetId) : null;
      if (!defFound || defFound.side !== defSide) {
        throw new ChainFailError('INVALID_TARGET', `Target Unit ${currentTargetId} not found.`);
      }
      if (!defFound.unit.rested) {
        throw new ChainFailError('INVALID_ACTION', `Cannot attack active enemy Unit ${currentTargetId}.`);
      }
    }

    attacker.rested = true;
    this.trace.push({
      kind: 'ACTION',
      detail: `${side} attacked ${currentTargetKind}${currentTargetId ? `(${currentTargetId})` : ''} with ${attacker.card.cardNo}`,
    });

    // Attack & When-Attacked trigger frame
    const attackFrame: QueuedTrigger[] = [];
    this.collectUnitTimingTriggers(side, attacker, 'ATTACK', attackFrame);
    if (currentTargetKind === 'UNIT' && currentTargetId) {
      const defNow = findUnitById(this.state, currentTargetId);
      if (defNow) this.collectUnitTimingTriggers(defSide, defNow.unit, 'WHEN_ATTACKED', attackFrame);
    }
    this.drainResolutionFrame(attackFrame);

    // Action Step (Blocker & 【Action】 alternating single activations; no stack)
    let blockerUsed = false;
    while (true) {
      const move = this.witness.nextActionStepMove();
      if (!move || move.kind === 'PASS') break;
      if (move.kind === 'BLOCKER') {
        if (blockerUsed || move.side !== defSide || !move.unitId) {
          throw new ChainFailError('INVALID_ACTION', 'Invalid Blocker activation.');
        }
        if (effAttacker.keywords.has('High-Maneuver')) {
          throw new ChainFailError('PROHIBITED_BY_CANT', '<High-Maneuver> prevents blocking.');
        }
        const blkFound = findUnitById(this.state, move.unitId);
        if (!blkFound || blkFound.side !== defSide) {
          throw new ChainFailError('INVALID_TARGET', `Blocker ${move.unitId} not found.`);
        }
        const blkEff = evaluateUnitEffectiveState(blkFound.unit, this.state, defSide);
        if (!blkEff.canBlock) {
          throw new ChainFailError('PROHIBITED_BY_CANT', `${blkFound.unit.card.cardNo} cannot activate <Blocker>.`);
        }
        blkFound.unit.rested = true;
        blockerUsed = true;
        currentTargetKind = 'UNIT';
        currentTargetId = blkFound.unit.instanceId;
        this.trace.push({ kind: 'ACTION', detail: `${defSide} intercepted with <Blocker> ${blkFound.unit.card.cardNo}` });
        const blkFrame: QueuedTrigger[] = [];
        this.collectUnitTimingTriggers(defSide, blkFound.unit, 'WHEN_ATTACKED', blkFrame);
        this.drainResolutionFrame(blkFrame);
      } else if (move.kind === 'PLAY_ACTION' && move.handIndex !== undefined) {
        const cmdPlayer = this.state.players[move.side];
        const cmd = cmdPlayer.hand[move.handIndex];
        if (!cmd) throw new ChainFailError('INVALID_ACTION', 'Missing Action Command.');
        const actionClause = getCardAbilities(cmd).abilities.find(
          (a): a is EffectClauseAst => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('ACTION')
        );
        if (!actionClause) throw new ChainFailError('INVALID_ACTION', `${cmd.cardNo} has no 【Action】.`);
        this.payLvAndCost(move.side, cmd);
        cmdPlayer.hand.splice(move.handIndex, 1);
        this.resolveClause(move.side, actionClause, cmd);
        cmdPlayer.trash.push(cmd);
      }
    }

    // Damage Step
    const atkNow = findUnitById(this.state, attacker.instanceId);
    if (!atkNow) return;
    const atkEffNow = evaluateUnitEffectiveState(atkNow.unit, this.state, side);

    if (currentTargetKind === 'UNIT' && currentTargetId) {
      const defNow = findUnitById(this.state, currentTargetId);
      if (!defNow) return;
      const defEffNow = evaluateUnitEffectiveState(defNow.unit, this.state, defSide);

      if (atkEffNow.keywords.has('First Strike')) {
        // First Strike deals attacker damage first; if defender is destroyed, skip reciprocal damage
        this.dealDamageToUnit(defSide, defNow.unit, atkEffNow.ap, 'BATTLE', atkNow.unit, side);
        const defStillAlive = findUnitById(this.state, currentTargetId);
        if (defStillAlive) {
          this.dealDamageToUnit(side, atkNow.unit, defEffNow.ap, 'BATTLE', defStillAlive.unit, defSide);
        }
      } else {
        // Simultaneous battle damage
        this.applyBattleDamagePair(side, atkNow.unit, atkEffNow.ap, defSide, defNow.unit, defEffNow.ap);
      }
    } else {
      // Attacking Opponent Shields / Base
      if (atkEffNow.ap <= 0) return; // 0 AP cannot destroy a Shield per Bandai FAQ
      const oppPlayer = this.state.players[defSide];
      if (oppPlayer.base) {
        this.dealDamageToBase(defSide, atkEffNow.ap, 'BATTLE', atkNow.unit, side);
      } else if (oppPlayer.shields.length > 0) {
        const shieldCount = atkEffNow.keywords.has('Suppression')
          ? Math.min(2, oppPlayer.shields.length)
          : 1;
        this.destroyShieldsSimultaneously(defSide, shieldCount, atkNow.unit, side, true);
      }
    }

    this.expireDurationModifiers('THIS_BATTLE');
  }

  private dealDamageToUnit(
    targetSide: ChainSide,
    target: ChainUnitInstance,
    rawAmount: number,
    damageType: 'BATTLE' | 'EFFECT',
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): void {
    if (rawAmount <= 0) return;
    const effTarget = evaluateUnitEffectiveState(target, this.state, targetSide);

    // Layer-4 damage immunity check
    if (damageType === 'BATTLE' && sourceUnit && sourceSide) {
      const effSrc = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide);
      const immune = effTarget.damageImmunities.some(
        (imm) =>
          (imm.damageType === 'BATTLE' || imm.damageType === 'ANY') &&
          (imm.apMax === undefined || effSrc.ap <= imm.apMax) &&
          (imm.lvMax === undefined || effSrc.lv <= imm.lvMax)
      );
      if (immune) {
        this.trace.push({ kind: 'DAMAGE', detail: `${target.card.cardNo} prevented ${rawAmount} battle damage (Layer 4)` });
        return;
      }
    }

    // Pre-commit Replacement Effects (max 1x per source per event)
    const eventId = this.nextEventId('dmg');
    const replaced = this.tryRunDamageReplacement(eventId, targetSide, target, rawAmount, damageType, sourceUnit, sourceSide);
    if (replaced) return;

    target.damage += rawAmount;
    this.trace.push({ kind: 'DAMAGE', detail: `${target.card.cardNo} took ${rawAmount} ${damageType} damage` });

    const sbaDestroyed = this.runStateBasedChecks(damageType === 'BATTLE');
    const frame: QueuedTrigger[] = [];
    for (const d of sbaDestroyed) {
      this.enqueueDestructionTriggers(d.side, d.unit, damageType, frame);
      if (damageType === 'BATTLE' && sourceUnit && sourceSide && findUnitById(this.state, sourceUnit.instanceId)) {
        this.collectUnitTimingTriggers(sourceSide, sourceUnit, 'WHEN_DESTROY_BY_BATTLE', frame, {
          destroyedByBattle: true,
        });
      }
    }
    // Note: <Breach> also triggers even if both Units died in battle (sourceUnit may be in sbaDestroyed!)
    if (damageType === 'BATTLE' && sourceUnit && sourceSide && sbaDestroyed.some((d) => d.unit.instanceId === target.instanceId)) {
      const srcEff = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide);
      const breachVal = srcEff.keywordValues.get('Breach');
      if (srcEff.keywords.has('Breach') && breachVal && breachVal > 0) {
        const oppSide = oppositeSide(sourceSide);
        const oppPlayer = this.state.players[oppSide];
        const breachClause: EffectClauseAst = {
          kind: 'EFFECT_CLAUSE',
          clauseIndex: -1,
          raw: `<Breach ${breachVal}>`,
          timings: ['WHEN_DESTROY_BY_BATTLE'],
          oncePerTurn: false,
          steps: [{ action: 'DEAL_DAMAGE', amount: breachVal, target: { owner: 'ENEMY', cardType: 'SHIELD', count: 1 } }],
        };
        if (oppPlayer.base || oppPlayer.shields.length > 0) {
          frame.push({
            side: sourceSide,
            clause: breachClause,
            sourceCard: sourceUnit.card,
            sourceUnitId: sourceUnit.instanceId,
            lastKnownUnit: sourceUnit,
          });
        }
      }
    }
    this.drainResolutionFrame(frame);
  }

  private applyBattleDamagePair(
    sideA: ChainSide,
    unitA: ChainUnitInstance,
    apA: number,
    sideB: ChainSide,
    unitB: ChainUnitInstance,
    apB: number
  ): void {
    const effA = evaluateUnitEffectiveState(unitA, this.state, sideA);
    const effB = evaluateUnitEffectiveState(unitB, this.state, sideB);

    const immuneB = effB.damageImmunities.some(
      (i) => (i.apMax === undefined || effA.ap <= i.apMax) && (i.lvMax === undefined || effA.lv <= i.lvMax)
    );
    const immuneA = effA.damageImmunities.some(
      (i) => (i.apMax === undefined || effB.ap <= i.apMax) && (i.lvMax === undefined || effB.lv <= i.lvMax)
    );

    if (!immuneB && apA > 0) {
      const repB = this.tryRunDamageReplacement(this.nextEventId('bdmg'), sideB, unitB, apA, 'BATTLE', unitA, sideA);
      if (!repB) unitB.damage += apA;
    }
    if (!immuneA && apB > 0) {
      const repA = this.tryRunDamageReplacement(this.nextEventId('bdmg'), sideA, unitA, apB, 'BATTLE', unitB, sideB);
      if (!repA) unitA.damage += apB;
    }

    const destroyed = this.runStateBasedChecks(true);
    const frame: QueuedTrigger[] = [];

    // <Breach> on either survivor/attacker if opposing Unit was destroyed
    if (destroyed.some((d) => d.unit.instanceId === unitB.instanceId)) {
      const breachVal = effA.keywordValues.get('Breach');
      if (effA.keywords.has('Breach') && breachVal && breachVal > 0) {
        frame.push({
          side: sideA,
          clause: {
            kind: 'EFFECT_CLAUSE',
            clauseIndex: -1,
            raw: `<Breach ${breachVal}>`,
            timings: ['WHEN_DESTROY_BY_BATTLE'],
            oncePerTurn: false,
            steps: [{ action: 'DEAL_DAMAGE', amount: breachVal, target: { owner: 'ENEMY', cardType: 'SHIELD', count: 1 } }],
          },
          sourceCard: unitA.card,
          sourceUnitId: unitA.instanceId,
          lastKnownUnit: unitA,
        });
      }
      this.collectUnitTimingTriggers(sideA, unitA, 'WHEN_DESTROY_BY_BATTLE', frame, { destroyedByBattle: true });
    }

    for (const d of destroyed) {
      this.enqueueDestructionTriggers(d.side, d.unit, 'BATTLE', frame);
    }
    this.drainResolutionFrame(frame);
  }

  // shortcut: only WOULD_TAKE_DAMAGE and WOULD_REST exist in current 1,290-card corpus; add WOULD_BE_DESTROYED/WOULD_MOVE_ZONE pre-commit hooks when new sets introduce them.
  private tryRunDamageReplacement(
    eventId: string,
    targetSide: ChainSide,
    target: ChainUnitInstance,
    _amount: number,
    damageType: 'BATTLE' | 'EFFECT',
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): boolean {
    if (damageType !== 'BATTLE') return false;
    const cards = target.pairedPilot ? [target.card, target.pairedPilot] : [target.card];
    for (const c of cards) {
      for (const ab of getCardAbilities(c).abilities) {
        if (ab.kind !== 'REPLACEMENT_EFFECT' || ab.intercepts !== 'WOULD_TAKE_DAMAGE') continue;
        if (ab.scope === 'PAIRED' && !target.pairedPilot) continue;
        if (ab.scope === 'LINKED' && !isUnitLinked(target)) continue;
        const guardKey = `${eventId}:${target.instanceId}:${ab.clauseIndex}`;
        if (this.appliedReplacements.has(guardKey)) continue;
        if (ab.raw.includes('AP equal to or less than it') && sourceUnit && sourceSide) {
          const srcAp = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide).ap;
          const tgtAp = evaluateUnitEffectiveState(target, this.state, targetSide).ap;
          if (srcAp > tgtAp) continue;
        }
        const accept = ab.optional ? this.witness.nextOptionalAccept(true) : true;
        if (!accept) continue;
        this.appliedReplacements.add(guardKey);
        this.trace.push({ kind: 'REPLACEMENT', detail: `Replacement prevented damage on ${target.card.cardNo}` });
        return true;
      }
    }
    return false;
  }

  private dealDamageToBase(
    targetSide: ChainSide,
    amount: number,
    damageType: 'BATTLE' | 'EFFECT',
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): void {
    const player = this.state.players[targetSide];
    if (!player.base) return;
    if (this.isShieldAreaDamageProhibited(targetSide, sourceUnit, sourceSide)) {
      this.trace.push({ kind: 'DAMAGE', detail: `${targetSide} Base prevented ${amount} damage (shield immunity)` });
      return;
    }
    player.base.damage += amount;
    const maxHp = player.base.card.hp ?? 5;
    if (player.base.damage >= maxHp) {
      const deadBase = player.base;
      player.base = null;
      player.trash.push(deadBase.card);
      this.trace.push({ kind: 'SBA', detail: `${targetSide} Base ${deadBase.card.cardNo} destroyed` });
      if (sourceUnit && sourceSide) {
        const frame: QueuedTrigger[] = [];
        this.collectDestroyCardTriggers(sourceSide, sourceUnit, 'BASE', damageType, frame);
        this.drainResolutionFrame(frame);
      }
    }
  }

  private isShieldAreaDamageProhibited(
    targetSide: ChainSide,
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): boolean {
    const prohs = (this.state.shieldDamageProhibitions ?? []).filter((p) => p.side === targetSide);
    if (prohs.length === 0 || !sourceUnit || !sourceSide) return false;
    const eff = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide);
    return prohs.some(
      (p) =>
        (p.lvMax === undefined || eff.lv <= p.lvMax) &&
        (p.apMax === undefined || eff.ap <= p.apMax)
    );
  }

  private collectDestroyCardTriggers(
    actorSide: ChainSide,
    actorUnit: ChainUnitInstance,
    targetKind: 'BASE' | 'SHIELD',
    damageType: 'BATTLE' | 'EFFECT',
    frame: QueuedTrigger[]
  ): void {
    const ctx = { destroyedByBattle: damageType === 'BATTLE', actorUnit, actorSide, targetKind, damageType };
    this.collectUnitTimingTriggers(actorSide, actorUnit, 'WHEN_DESTROY_BY_BATTLE', frame, ctx);
    for (const u of this.state.players[actorSide].battleArea) {
      if (u.instanceId === actorUnit.instanceId) continue;
      this.collectUnitTimingTriggers(actorSide, u, 'WHEN_DESTROY_BY_BATTLE', frame, ctx);
    }
  }

  private destroyShieldsSimultaneously(
    targetSide: ChainSide,
    count: number,
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide,
    byBattle = false
  ): void {
    const player = this.state.players[targetSide];
    if (this.isShieldAreaDamageProhibited(targetSide, sourceUnit, sourceSide)) {
      this.trace.push({ kind: 'DAMAGE', detail: `${targetSide} Shields prevented damage (shield immunity)` });
      return;
    }
    const destroyed = player.shields.splice(0, Math.min(count, player.shields.length));
    if (destroyed.length === 0) return;

    this.trace.push({
      kind: 'DAMAGE',
      detail: `${targetSide} lost ${destroyed.length} Shield(s) simultaneously`,
    });

    // Check which revealed Shields have 【Burst】
    const burstEntries = destroyed
      .map((s) => ({
        shield: s,
        burstClause: getCardAbilities(s.card).abilities.find(
          (a): a is EffectClauseAst => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('BURST')
        ),
      }))
      .filter((x) => Boolean(x.burstClause));

    const order = this.witness.peekBurstOrder(destroyed.length);
    const ordered = order.map((idx) => destroyed[idx]).filter(Boolean);

    // Move Shields not activating Burst (or after Burst) into Trash; per FAQ, a Base deployed by Burst 1
    // cannot pick up Shield 2 that was destroyed simultaneously because `destroyed` is already spliced!
    const frame: QueuedTrigger[] = [];
    for (const s of ordered) {
      const entry = burstEntries.find((b) => b.shield.id === s.id);
      if (entry?.burstClause && this.witness.nextBurstAccept()) {
        this.trace.push({ kind: 'BURST', detail: `${targetSide} activated 【Burst】 on ${s.card.cardNo}` });
        if (entry.burstClause.steps.some((st) => st.action === 'DEPLOY_SELF')) {
          if (s.card.type === 'BASE') {
            if (player.base) player.trash.push(player.base.card);
            player.base = { instanceId: `${targetSide}-BASE-${this.nextEventId('base')}`, card: s.card, damage: 0 };
            this.collectCardTimingTriggers(targetSide, s.card, 'DEPLOY', frame);
          } else {
            player.battleArea.push({
              instanceId: `${targetSide}-U-${this.nextEventId('unit')}`,
              card: s.card,
              rested: false,
              damage: 0,
              deployedTurn: this.state.turn,
              temporaryModifiers: [],
              triggeredOnceThisTurn: [],
            });
          }
        } else if (entry.burstClause.steps.some((st) => st.action === 'ADD_SELF_TO_HAND')) {
          player.hand.push(s.card);
        } else {
          frame.push({
            side: targetSide,
            clause: entry.burstClause,
            sourceCard: s.card,
          });
          player.trash.push(s.card);
        }
      } else {
        player.trash.push(s.card);
      }
    }

    if (sourceUnit && sourceSide) {
      this.collectDestroyCardTriggers(sourceSide, sourceUnit, 'SHIELD', byBattle ? 'BATTLE' : 'EFFECT', frame);
    }
    this.drainResolutionFrame(frame);
  }

  private runStateBasedChecks(destroyedByBattle: boolean): { side: ChainSide; unit: ChainUnitInstance }[] {
    const destroyed: { side: ChainSide; unit: ChainUnitInstance }[] = [];
    for (const side of ['A', 'B'] as const) {
      const player = this.state.players[side];
      const survivors: ChainUnitInstance[] = [];
      for (const u of player.battleArea) {
        const eff = evaluateUnitEffectiveState(u, this.state, side);
        if (eff.remainingHp <= 0) {
          player.trash.push(u.card);
          if (u.pairedPilot) player.trash.push(u.pairedPilot);
          destroyed.push({ side, unit: u });
          this.trace.push({
            kind: 'SBA',
            detail: `${u.card.cardNo} destroyed by SBA (${destroyedByBattle ? 'BATTLE' : 'EFFECT'})`,
          });
        } else {
          survivors.push(u);
        }
      }
      player.battleArea = survivors;
    }
    return destroyed;
  }

  private enqueueDestructionTriggers(
    ownerSide: ChainSide,
    unit: ChainUnitInstance,
    damageType: 'BATTLE' | 'EFFECT',
    frame: QueuedTrigger[]
  ): void {
    this.collectUnitTimingTriggers(ownerSide, unit, 'DESTROYED', frame, {
      destroyedByBattle: damageType === 'BATTLE',
    });
    this.collectBoardTimingTriggers('WHEN_UNIT_DESTROYED', frame, ownerSide, {
      destroyedByBattle: damageType === 'BATTLE',
    });
  }

  private collectUnitTimingTriggers(
    side: ChainSide,
    unit: ChainUnitInstance,
    timing: EffectTiming,
    frame: QueuedTrigger[],
    ctx?: {
      destroyedByBattle?: boolean;
      actorUnit?: ChainUnitInstance;
      actorSide?: ChainSide;
      targetKind?: 'BASE' | 'SHIELD';
      damageType?: 'BATTLE' | 'EFFECT';
    }
  ): void {
    const cards = unit.pairedPilot ? [unit.card, unit.pairedPilot] : [unit.card];
    for (const c of cards) {
      for (const ab of getCardAbilities(c).abilities) {
        if (ab.kind !== 'EFFECT_CLAUSE') continue;
        if (!ab.timings.includes(timing)) continue;
        if (ab.timings.includes('DURING_PAIR')) {
          if (!unit.pairedPilot) continue;
          if (ab.pairFilter?.trait) {
            const reqT = ab.pairFilter.trait.toLowerCase();
            if (!unit.pairedPilot.traits.some((t) => t.toLowerCase() === reqT)) continue;
          }
        }
        if (ab.triggerEvent?.actor === 'SELF' && ctx?.actorUnit && ctx.actorUnit.instanceId !== unit.instanceId) {
          continue;
        }
        if (ab.triggerEvent?.actor === 'FRIENDLY' && ctx?.actorUnit) {
          if (ctx.actorSide !== side) continue;
          if (ab.triggerEvent.actorFilter?.trait) {
            const reqT = ab.triggerEvent.actorFilter.trait.toLowerCase();
            if (!ctx.actorUnit.card.traits.some((t) => t.toLowerCase() === reqT)) continue;
          }
        }
        if (ab.triggerEvent?.damageType === 'BATTLE' && ctx?.damageType === 'EFFECT') continue;
        if (ab.oncePerTurn && unit.triggeredOnceThisTurn.includes(ab.raw)) continue;
        if (!evaluateCondition(ab.condition, this.state, side, unit, ctx)) continue;
        if (ab.oncePerTurn) unit.triggeredOnceThisTurn.push(ab.raw);
        frame.push({
          side,
          clause: ab,
          sourceCard: c,
          sourceUnitId: unit.instanceId,
          lastKnownUnit: structuredClone(unit),
          ctx,
        });
      }
    }
  }

  private collectCardTimingTriggers(
    side: ChainSide,
    card: GundamCardPrint,
    timing: EffectTiming,
    frame: QueuedTrigger[]
  ): void {
    for (const ab of getCardAbilities(card).abilities) {
      if (ab.kind !== 'EFFECT_CLAUSE' || !ab.timings.includes(timing)) continue;
      if (!evaluateCondition(ab.condition, this.state, side)) continue;
      frame.push({ side, clause: ab, sourceCard: card });
    }
  }

  private collectBoardTimingTriggers(
    timing: EffectTiming,
    frame: QueuedTrigger[],
    _actorSide?: ChainSide,
    ctx?: { destroyedByBattle?: boolean }
  ): void {
    for (const side of ['A', 'B'] as const) {
      for (const u of this.state.players[side].battleArea) {
        this.collectUnitTimingTriggers(side, u, timing, frame, ctx);
      }
    }
  }

  private drainResolutionFrame(frame: QueuedTrigger[]): void {
    if (frame.length === 0) return;
    const active = this.state.activeSide;
    const nonActive = oppositeSide(active);

    for (const side of [active, nonActive] as const) {
      const sideTriggers = frame.filter((t) => t.side === side);
      if (sideTriggers.length === 0) continue;
      const order = sideTriggers.length > 1 ? this.witness.nextTriggerOrder(sideTriggers.length) : [0];
      for (const idx of order) {
        const trig = sideTriggers[idx];
        if (!trig) continue;
        const liveUnit = trig.sourceUnitId ? findUnitById(this.state, trig.sourceUnitId)?.unit : undefined;
        const contextUnit = liveUnit ?? trig.lastKnownUnit;
        this.trace.push({
          kind: 'TRIGGER',
          detail: `Resolve ${trig.side} ${trig.sourceCard.cardNo} (${trig.clause.timings.join(',')})`,
        });
        // Even if trig.sourceUnitId left play, pending trigger still resolves via lastKnownUnit!
        this.resolveClause(trig.side, trig.clause, trig.sourceCard, contextUnit);
      }
    }
  }

  private assertMandatoryTargetsExist(
    steps: EffectStep[],
    side: ChainSide,
    selfUnit?: ChainUnitInstance
  ): void {
    for (const s of steps) {
      if (s.action === 'DESTROY' || s.action === 'BOUNCE' || s.action === 'REST' || s.action === 'DEAL_DAMAGE') {
        if (s.target.cardType === 'UNIT' && s.target.count !== 'ALL' && s.target.count !== 'UP_TO' && !s.target.self) {
          const candidates = this.findLegalUnitTargets(s.target, side, selfUnit);
          if (candidates.length === 0) {
            throw new ChainFailError('NO_LEGAL_TARGET', `No legal target for ${s.action}.`);
          }
        }
      }
    }
  }

  private findLegalUnitTargets(
    selector: TargetSelector,
    side: ChainSide,
    selfUnit?: ChainUnitInstance
  ): { side: ChainSide; unit: ChainUnitInstance }[] {
    const out: { side: ChainSide; unit: ChainUnitInstance }[] = [];
    for (const s of ['A', 'B'] as const) {
      for (const u of this.state.players[s].battleArea) {
        const eff = evaluateUnitEffectiveState(u, this.state, s);
        if (!eff.canBeChosen && s !== side) continue;
        if (matchesTargetSelectorSimple(u, selector, this.state, side, selfUnit)) {
          out.push({ side: s, unit: u });
        }
      }
    }
    return out;
  }

  private resolveClause(
    side: ChainSide,
    clause: EffectClauseAst,
    sourceCard: GundamCardPrint,
    selfUnit?: ChainUnitInstance
  ): void {
    let prevSucceeded = true;
    for (const step of clause.steps) {
      prevSucceeded = this.executeStep(side, step, sourceCard, selfUnit, prevSucceeded);
    }
  }

  private executeStep(
    side: ChainSide,
    step: EffectStep,
    sourceCard: GundamCardPrint,
    selfUnit: ChainUnitInstance | undefined,
    prevSucceeded: boolean
  ): boolean {
    const player = this.state.players[side];
    switch (step.action) {
      case 'DRAW': {
        for (let i = 0; i < step.count; i += 1) {
          const drawn = this.witness.drawFromDeck(player);
          if (drawn) player.hand.push(drawn);
        }
        return true;
      }
      case 'ADD_SHIELD_TO_HAND': {
        for (let i = 0; i < step.count; i += 1) {
          const s = player.shields.shift();
          if (s) player.hand.push(s.card);
        }
        return true;
      }
      case 'SET_ACTIVE': {
        if (step.target.self && selfUnit) {
          const eff = evaluateUnitEffectiveState(selfUnit, this.state, side);
          if (eff.prohibitions.has('CANT_SET_ACTIVE')) return false;
          selfUnit.rested = false;
          return true;
        }
        return false;
      }
      case 'CANT_ATTACK': {
        if (step.target.self && selfUnit) {
          selfUnit.temporaryModifiers.push({
            id: this.nextEventId('cant'),
            layer: 4,
            rule: 'CANT_ATTACK',
            duration: step.duration ?? 'THIS_TURN',
          });
          return true;
        }
        return false;
      }
      case 'DEAL_DAMAGE': {
        if (step.target.cardType === 'SHIELD') {
          const oppSide = oppositeSide(side);
          const opp = this.state.players[oppSide];
          if (opp.base) this.dealDamageToBase(oppSide, step.amount, 'EFFECT', selfUnit, side);
          else if (opp.shields.length > 0) this.destroyShieldsSimultaneously(oppSide, 1, selfUnit, side, false);
          return true;
        }
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) this.dealDamageToUnit(found.side, found.unit, step.amount, 'EFFECT', selfUnit, side);
        }
        return true;
      }
      case 'MODIFY_HP': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) {
            found.unit.temporaryModifiers.push({
              id: this.nextEventId('hp'),
              layer: 3,
              stat: 'HP',
              delta: step.delta,
              duration: step.duration ?? 'THIS_TURN',
            });
          }
        }
        const dead = this.runStateBasedChecks(false);
        const frame: QueuedTrigger[] = [];
        for (const d of dead) this.enqueueDestructionTriggers(d.side, d.unit, 'EFFECT', frame);
        this.drainResolutionFrame(frame);
        return true;
      }
      case 'MODIFY_AP': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) {
            found.unit.temporaryModifiers.push({
              id: this.nextEventId('ap'),
              layer: 3,
              stat: 'AP',
              delta: step.delta,
              duration: step.duration ?? 'THIS_TURN',
            });
          }
        }
        return true;
      }
      case 'DESTROY': {
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        const frame: QueuedTrigger[] = [];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (!found) continue;
          const p = this.state.players[found.side];
          const idx = p.battleArea.findIndex((u) => u.instanceId === id);
          if (idx >= 0) {
            const [dead] = p.battleArea.splice(idx, 1);
            p.trash.push(dead.card);
            if (dead.pairedPilot) p.trash.push(dead.pairedPilot);
            this.enqueueDestructionTriggers(found.side, dead, 'EFFECT', frame);
          }
        }
        this.drainResolutionFrame(frame);
        return true;
      }
      case 'REST': {
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds = this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) {
            // Check if a friendly Base/Unit has a WOULD_REST replacement (e.g. GD05-124)
            const repChoice = this.tryRunRestReplacement(found.side, found.unit);
            if (!repChoice) found.unit.rested = true;
          }
        }
        return true;
      }
      case 'DEPLOY_FROM_TRASH': {
        const trashMatches = player.trash.filter((c) => {
          if (step.target.cardType && c.type !== step.target.cardType) return false;
          if (step.target.lvMin !== undefined && (c.lv ?? 1) < step.target.lvMin) return false;
          if (step.target.lvMax !== undefined && (c.lv ?? 1) > step.target.lvMax) return false;
          if (step.target.nameContains && !c.name.toLowerCase().includes(step.target.nameContains.toLowerCase())) {
            return false;
          }
          return true;
        });
        if (trashMatches.length === 0) return false;
        const chosen = trashMatches[0];
        const tIdx = player.trash.indexOf(chosen);
        player.trash.splice(tIdx, 1);
        const unit: ChainUnitInstance = {
          instanceId: `${side}-U-${this.nextEventId('unit')}`,
          card: chosen,
          rested: Boolean(step.rested),
          damage: 0,
          deployedTurn: this.state.turn,
          deployedFromZone: 'trash',
          temporaryModifiers: [],
          triggeredOnceThisTurn: [],
        };
        player.battleArea.push(unit);
        const frame: QueuedTrigger[] = [];
        this.collectUnitTimingTriggers(side, unit, 'DEPLOY', frame);
        this.collectBoardTimingTriggers('WHEN_UNIT_DEPLOYED', frame, side);
        this.drainResolutionFrame(frame);
        return true;
      }
      case 'IF_CONDITION': {
        if (evaluateCondition(step.condition, this.state, side, selfUnit)) {
          let ok = true;
          for (const sub of step.thenSteps) ok = this.executeStep(side, sub, sourceCard, selfUnit, ok);
          return ok;
        } else if (step.elseSteps) {
          let ok = true;
          for (const sub of step.elseSteps) ok = this.executeStep(side, sub, sourceCard, selfUnit, ok);
          return ok;
        }
        return false;
      }
      case 'IF_PREVIOUS_SUCCEEDED': {
        const matches = step.negated ? !prevSucceeded : prevSucceeded;
        if (!matches) return false;
        let ok = true;
        for (const sub of step.thenSteps) ok = this.executeStep(side, sub, sourceCard, selfUnit, ok);
        return ok;
      }
      case 'DAMAGE_PROOF': {
        if (/shield area cards/i.test(step.summary)) {
          const lvM = step.summary.match(/Lv\.(\d+)\s+or lower/i);
          const apM = step.summary.match(/(\d+)\s+or less AP/i);
          this.state.shieldDamageProhibitions = this.state.shieldDamageProhibitions ?? [];
          this.state.shieldDamageProhibitions.push({
            side,
            ...(lvM ? { lvMax: parseInt(lvM[1], 10) } : {}),
            ...(apM ? { apMax: parseInt(apM[1], 10) } : {}),
            duration: step.duration ?? 'THIS_BATTLE',
          });
          return true;
        }
        return true;
      }
      case 'RECOVER_HP': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds = this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) found.unit.damage = Math.max(0, found.unit.damage - step.amount);
        }
        return true;
      }
      case 'PAIR_SELF_FROM_TRASH': {
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit).filter(
          (c) => c.side === side && !c.unit.pairedPilot
        );
        if (candidates.length === 0) return false;
        if (!this.witness.nextOptionalAccept(true)) return false;
        const chosenIds = this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        const target = candidates.find((c) => c.unit.instanceId === chosenIds[0])?.unit ?? candidates[0].unit;
        const trashIdx = player.trash.indexOf(sourceCard);
        if (trashIdx >= 0) {
          player.trash.splice(trashIdx, 1);
        } else {
          this.selfPairedCards.add(sourceCard);
        }
        target.pairedPilot = sourceCard;
        const linked = isUnitLinked(target);
        this.trace.push({
          kind: 'ACTION',
          detail: `${side} paired ${sourceCard.cardNo} from trash onto ${target.card.cardNo} (linked=${linked})`,
        });
        const frame: QueuedTrigger[] = [];
        this.collectUnitTimingTriggers(side, target, 'WHEN_PAIRED', frame);
        if (linked) {
          this.collectUnitTimingTriggers(side, target, 'WHEN_LINKED', frame);
        }
        this.drainResolutionFrame(frame);
        return true;
      }
      default:
        return true;
    }
  }

  private tryRunRestReplacement(targetSide: ChainSide, _targetUnit: ChainUnitInstance): boolean {
    const player = this.state.players[targetSide];
    const sources: { card: GundamCardPrint; id: string; isBase: boolean }[] = [];
    if (player.base) sources.push({ card: player.base.card, id: player.base.instanceId, isBase: true });
    for (const u of player.battleArea) sources.push({ card: u.card, id: u.instanceId, isBase: false });

    const eventId = this.nextEventId('rest');
    for (const src of sources) {
      for (const ab of getCardAbilities(src.card).abilities) {
        if (ab.kind !== 'REPLACEMENT_EFFECT' || ab.intercepts !== 'WOULD_REST') continue;
        const key = `${eventId}:${src.id}:${ab.clauseIndex}`;
        if (this.appliedReplacements.has(key)) continue;
        if (!evaluateCondition(ab.condition, this.state, targetSide)) continue;
        const choice = this.witness.nextReplacementChoice();
        const accept = choice ? choice.accept : ab.optional ? this.witness.nextOptionalAccept(true) : true;
        if (!accept) continue;
        this.appliedReplacements.add(key);
        this.trace.push({ kind: 'REPLACEMENT', detail: `${src.card.cardNo} replaced WOULD_REST` });
        return true;
      }
    }
    return false;
  }

  private executeCustomHook(side: ChainSide, unit: ChainUnitInstance, hook: CustomHookAst): void {
    if (hook.hookId === 'ST01-015#2') {
      const player = this.state.players[side];
      this.payActivationCost(side, unit, { resourceCost: 2 });
      const n = player.battleArea.length;
      const spec =
        n === 0
          ? { name: 'Gundam', ap: 3, hp: 3 }
          : n === 1
          ? { name: 'Guncannon', ap: 2, hp: 2 }
          : { name: 'Guntank', ap: 1, hp: 1 };
      const tokenCard: GundamCardPrint = {
        ...unit.card,
        cardNo: 'TOKEN',
        printId: `TOKEN-${spec.name}`,
        name: spec.name,
        type: 'UNIT TOKEN',
        traits: ['White Base Team'],
        ap: spec.ap,
        hp: spec.hp,
        effect: '',
      };
      player.battleArea.push({
        instanceId: `${side}-TOK-${this.nextEventId('tok')}`,
        card: tokenCard,
        rested: false,
        damage: 0,
        deployedTurn: this.state.turn,
        temporaryModifiers: [],
        triggeredOnceThisTurn: [],
      });
      return;
    }
    throw new ChainFailError('UNIMPLEMENTED_CUSTOM_HOOK', `No execution handler for ${hook.hookId}.`);
  }

  private expireDurationModifiers(duration: EffectDuration): void {
    for (const side of ['A', 'B'] as const) {
      for (const u of this.state.players[side].battleArea) {
        u.temporaryModifiers = u.temporaryModifiers.filter((m) => m.duration !== duration);
      }
    }
    if (this.state.shieldDamageProhibitions) {
      this.state.shieldDamageProhibitions = this.state.shieldDamageProhibitions.filter(
        (p) => p.duration !== duration
      );
    }
  }

  private endTurn(): void {
    this.expireDurationModifiers('THIS_TURN');
    const nextSide = oppositeSide(this.state.activeSide);
    this.state.activeSide = nextSide;
    this.state.turn += 1;
    const nextPlayer = this.state.players[nextSide];
    nextPlayer.activeResources += nextPlayer.restedResources;
    nextPlayer.restedResources = 0;
    for (const u of nextPlayer.battleArea) {
      u.rested = false;
      u.triggeredOnceThisTurn = [];
    }
    if (nextPlayer.activeResources + nextPlayer.restedResources < 10) {
      nextPlayer.activeResources += 1;
    }
    const drawn = this.witness.drawFromDeck(nextPlayer);
    if (drawn) nextPlayer.hand.push(drawn);
  }
}

// ---------------------------------------------------------------------------
// 4. Minimal-Board Synthesizer & Public Entry Point verifyPlayLine
// ---------------------------------------------------------------------------

function buildMinimalFeasibilityState(
  req: Extract<ChainVerificationRequest['mode'], { kind: 'MINIMAL_FEASIBILITY' }>
): ChainMatchState {
  const mkDummy = (name: string, overrides: Partial<GundamCardPrint> = {}): GundamCardPrint => {
    const base: GundamCardPrint = {
      printId: name,
      cardNo: name,
      name,
      rarity: 'C',
      blockIcon: '1',
      lv: 1,
      cost: 1,
      color: 'Blue',
      type: 'UNIT',
      effect: '',
      zones: ['Space'],
      traits: [],
      link: '',
      apRaw: '2',
      hpRaw: '2',
      ap: 2,
      hp: 2,
      sourceTitle: '',
      whereToGet: '',
      imagePath: '',
      isParallel: false,
      faqs: [],
      packageIds: [],
      packageNames: [],
      packageCodes: [],
      ...overrides,
    };
    return { ...base, compiledEffect: compileCardEffect(base) };
  };

  const oppUnits: ChainUnitInstance[] = (req.opponentDummyBoard?.units ?? []).map((u, idx) => ({
    instanceId: `B-DUMMY-${idx}`,
    card: mkDummy(u.cardNo ?? `DUMMY-${idx}`, {
      name: u.name ?? `Dummy Unit ${idx}`,
      lv: u.lv ?? 1,
      ap: u.ap ?? 2,
      hp: u.hp ?? 2,
      traits: u.traits ?? [],
      effect: u.effect ?? '',
    }),
    rested: Boolean(u.rested),
    damage: 0,
    deployedTurn: 1,
    temporaryModifiers: [],
    triggeredOnceThisTurn: [],
  }));

  const oppShields = Array.from({ length: req.opponentDummyBoard?.shields ?? 6 }, (_, i) => ({
    id: `B-SH-${i}`,
    card: mkDummy(`SH-${i}`),
  }));

  return {
    turn: req.turn,
    phase: 'MAIN',
    activeSide: 'A',
    pendingActionStep: null,
    players: {
      A: {
        hand: [...req.activeHand],
        deck: [...(req.activeDeck ?? [])],
        trash: [...(req.activeTrash ?? [])],
        battleArea: [...(req.activeBattleArea ?? [])],
        base: null,
        shields: [{ id: 'A-SH-0', card: mkDummy('SH-A0') }],
        activeResources: req.turn,
        restedResources: 0,
        exResources: 0,
      },
      B: {
        hand: [],
        deck: [],
        trash: [],
        battleArea: oppUnits,
        base: req.opponentDummyBoard?.hasBase
          ? { instanceId: 'B-BASE', card: mkDummy('B-BASE', { type: 'BASE', hp: 5 }), damage: 0 }
          : null,
        shields: oppShields,
        activeResources: req.turn,
        restedResources: 0,
        exResources: 0,
      },
    },
  };
}

export function verifyPlayLine(req: ChainVerificationRequest): ChainVerificationResult {
  const initialState =
    req.mode.kind === 'CONCRETE_SNAPSHOT'
      ? req.mode.state
      : buildMinimalFeasibilityState(req.mode);

  const runner = new VerifierRunner(initialState, req.witness);
  try {
    for (const action of req.playLine) {
      runner.executeAction(action);
    }
    return {
      legal: true,
      finalState: runner.state,
      trace: runner.trace,
    };
  } catch (err) {
    if (err instanceof ChainFailError) {
      return {
        legal: false,
        reason: err.reason,
        detail: err.message,
        trace: runner.trace,
      };
    }
    return {
      legal: false,
      reason: 'INVALID_ACTION',
      detail: err instanceof Error ? err.message : String(err),
      trace: runner.trace,
    };
  }
}

// ---------------------------------------------------------------------------
// 5. Chain Preview Builders for Deck Builder & Match Sandbox UI
// ---------------------------------------------------------------------------

export interface DeckChainPreview {
  id: string;
  title: string;
  category: 'Link Pair' | 'Command-Pilot Link' | 'Mechanic Chain';
  cards: GundamCardPrint[];
  minTurn: number;
  firstPlayerResult: ChainVerificationResult;
  secondPlayerResult: ChainVerificationResult;
}

export interface SandboxMoveChainPreview {
  moveTitle: string;
  actionType: SandboxMoveSuggestion['actionType'];
  lvRequired: number;
  costRequired: number;
  activeResources: number;
  result: ChainVerificationResult;
}

function makeChainFeasibilitySeed(
  cards: GundamCardPrint[],
  turn: number,
  exResources: number
): ChainMatchState {
  const base = buildMinimalFeasibilityState({
    kind: 'MINIMAL_FEASIBILITY',
    turn,
    activeHand: cards,
    opponentDummyBoard: {
      units: [
        { cardNo: 'OPP-DUMMY-1', name: 'Target Unit (Rested)', lv: 3, ap: 3, hp: 3, rested: true },
        { cardNo: 'OPP-DUMMY-2', name: 'Enemy Defender', lv: 2, ap: 2, hp: 2, rested: false },
      ],
      shields: 6,
    },
  });
  base.players.A.exResources = exResources;
  return base;
}

export function verifyCustomDeckChain(
  cardA: GundamCardPrint,
  cardB: GundamCardPrint | null,
  goingSecond: boolean
): { turn: number; result: ChainVerificationResult } {
  const ex = goingSecond ? 1 : 0;
  const cards = cardB ? [cardA, cardB] : [cardA];
  const maxLv = Math.max(...cards.map((c) => c.lv ?? 1), 1);
  const totalCost = cards.reduce((s, c) => s + (c.cost ?? 0), 0);
  const minTurn = Math.max(1, maxLv, Math.max(0, totalCost - ex));

  // If cardA is a Unit and cardB is Pilot or Command-Pilot, simulate deploy -> pair (and immediate attack if linked)
  if (cardA.type === 'UNIT' && cardB && (cardB.type === 'PILOT' || isCommandPilot(cardB))) {
    const state = makeChainFeasibilitySeed([cardA, cardB], minTurn, ex);
    const linked = doesPilotLinkUnit(cardB, cardA);
    const playLine: PlayerAction[] = [
      { type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 },
      { type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-unit#1' },
      ...(linked ? [{ type: 'ATTACK_SHIELD' as const, side: 'A' as const, attackerId: 'A-U-unit#1' }] : []),
    ];
    return {
      turn: minTurn,
      result: verifyPlayLine({
        mode: { kind: 'CONCRETE_SNAPSHOT', state },
        playLine,
        witness: { targets: [['B-DUMMY-0'], ['B-DUMMY-1']] },
      }),
    };
  }

  // Otherwise play cardA then cardB in order according to their card types
  const state = makeChainFeasibilitySeed(cards, minTurn, ex);
  const playLine: PlayerAction[] = [];
  let hasDeployedUnit = false;
  for (let i = 0; i < cards.length; i += 1) {
    const c = cards[i];
    if (c.type === 'UNIT') {
      playLine.push({ type: 'DEPLOY_UNIT', side: 'A', handIndex: 0 });
      hasDeployedUnit = true;
    } else if (c.type === 'BASE') {
      playLine.push({ type: 'DEPLOY_BASE', side: 'A', handIndex: 0 });
    } else if (c.type === 'PILOT') {
      if (hasDeployedUnit) {
        playLine.push({ type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-unit#1' });
      } else {
        // Seed a friendly Unit so a Pilot can be verified cleanly
        state.players.A.battleArea.push({
          instanceId: 'A-U-HOST',
          card: { ...c, cardNo: 'ALLY-HOST', printId: 'ALLY-HOST', name: 'Friendly Unit', type: 'UNIT', ap: 3, hp: 3 },
          rested: false,
          damage: 0,
          deployedTurn: 1,
          temporaryModifiers: [],
          triggeredOnceThisTurn: [],
        });
        playLine.push({ type: 'PAIR_PILOT', side: 'A', handIndex: 0, targetUnitId: 'A-U-HOST' });
      }
    } else if (c.type === 'COMMAND') {
      const hasMain = getCardAbilities(c).abilities.some(
        (ab) => ab.kind === 'EFFECT_CLAUSE' && ab.timings.includes('MAIN')
      );
      if (hasMain) {
        playLine.push({ type: 'PLAY_COMMAND', side: 'A', handIndex: 0 });
      } else if (isCommandPilot(c)) {
        if (!hasDeployedUnit) {
          state.players.A.battleArea.push({
            instanceId: 'A-U-HOST',
            card: { ...c, cardNo: 'ALLY-HOST', printId: 'ALLY-HOST', name: 'Friendly Unit', type: 'UNIT', ap: 3, hp: 3 },
            rested: false,
            damage: 0,
            deployedTurn: 1,
            temporaryModifiers: [],
            triggeredOnceThisTurn: [],
          });
        }
        playLine.push({
          type: 'PAIR_PILOT',
          side: 'A',
          handIndex: 0,
          targetUnitId: hasDeployedUnit ? 'A-U-unit#1' : 'A-U-HOST',
        });
      }
    }
  }

  return {
    turn: minTurn,
    result: verifyPlayLine({
      mode: { kind: 'CONCRETE_SNAPSHOT', state },
      playLine,
      witness: { targets: [['B-DUMMY-0'], ['B-DUMMY-1']] },
    }),
  };
}

export function buildDeckChainPreviews(cards: GundamCardPrint[], maxItems = 6): DeckChainPreview[] {
  const uniqueMap = new Map<string, GundamCardPrint>();
  for (const c of cards) {
    if (!uniqueMap.has(c.cardNo)) uniqueMap.set(c.cardNo, c);
  }
  const unique = [...uniqueMap.values()];
  const units = unique.filter((c) => c.type === 'UNIT');
  const pilots = unique.filter((c) => c.type === 'PILOT' || isCommandPilot(c));

  const previews: DeckChainPreview[] = [];
  const seen = new Set<string>();

  for (const u of units) {
    if (!u.link) continue;
    for (const p of pilots) {
      if (!doesPilotLinkUnit(p, u)) continue;
      const key = `${u.cardNo}+${p.cardNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isCmd = isCommandPilot(p);
      const p1 = verifyCustomDeckChain(u, p, false);
      const p2 = verifyCustomDeckChain(u, p, true);
      previews.push({
        id: key,
        title: `${u.name} + ${p.name}`,
        category: isCmd ? 'Command-Pilot Link' : 'Link Pair',
        cards: [u, p],
        minTurn: p1.turn,
        firstPlayerResult: p1.result,
        secondPlayerResult: p2.result,
      });
      if (previews.length >= maxItems) return previews;
    }
  }

  // Enabler -> Payoff Mechanic Chains from compiledEffect.synergy
  for (const payoff of unique) {
    const reqs = payoff.compiledEffect?.synergy.requires ?? [];
    if (reqs.length === 0) continue;
    for (const req of reqs) {
      const enabler = unique.find(
        (e) => e.cardNo !== payoff.cardNo && e.compiledEffect?.synergy.enables.includes(req)
      );
      if (!enabler) continue;
      const key = `${enabler.cardNo}->${payoff.cardNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p1 = verifyCustomDeckChain(enabler, payoff, false);
      const p2 = verifyCustomDeckChain(enabler, payoff, true);
      previews.push({
        id: key,
        title: `${enabler.name} → ${payoff.name}`,
        category: 'Mechanic Chain',
        cards: [enabler, payoff],
        minTurn: p1.turn,
        firstPlayerResult: p1.result,
        secondPlayerResult: p2.result,
      });
      if (previews.length >= maxItems) return previews;
    }
  }

  return previews;
}

export function sandboxStateToChainState(state: SandboxMatchState): ChainMatchState {
  const mkDummyShield = (side: ChainSide, idx: number): ChainShieldCard => ({
    id: `${side}-SH-${idx}`,
    card: {
      printId: `SH-${side}-${idx}`,
      cardNo: `SH-${side}-${idx}`,
      name: 'Shield',
      rarity: 'C',
      blockIcon: '1',
      lv: 1,
      cost: 0,
      color: 'Colorless',
      type: 'UNIT',
      effect: '',
      zones: [],
      traits: [],
      link: '',
      apRaw: '0',
      hpRaw: '0',
      ap: 0,
      hp: 0,
      sourceTitle: '',
      whereToGet: '',
      imagePath: '',
      isParallel: false,
      faqs: [],
      packageIds: [],
      packageNames: [],
      packageCodes: [],
    },
  });

  const mapPlayer = (side: ChainSide, p: SandboxPlayerState): ChainPlayerState => ({
    hand: [...p.hand],
    deck: [...p.library],
    trash: [...p.trash],
    battleArea: p.battleArea.map((u) => ({
      instanceId: u.instanceId,
      card: u.card,
      ...(u.pairedPilot ? { pairedPilot: u.pairedPilot } : {}),
      rested: u.rested,
      damage: u.damage,
      deployedTurn: u.summonedTurn,
      ...(u.deployedFromZone ? { deployedFromZone: u.deployedFromZone } : {}),
      temporaryModifiers: u.apBuff !== 0
        ? [
            {
              id: `sandbox-ap-${u.instanceId}`,
              layer: 3,
              duration: 'THIS_TURN',
              stat: 'AP',
              delta: u.apBuff,
            },
          ]
        : [],
      triggeredOnceThisTurn: [],
    })),
    base: p.base
      ? {
          instanceId: `${side}-BASE`,
          card: p.base,
          damage: p.baseDamage,
          temporaryModifiers: [],
        }
      : null,
    shields: Array.from({ length: p.shields }, (_, i) => mkDummyShield(side, i)),
    activeResources: p.resourcesActive,
    restedResources: Math.max(0, p.resourcesTotal - p.resourcesActive),
    exResources: 0,
  });

  return {
    turn: state.turn,
    phase: 'MAIN',
    activeSide: state.activeSide,
    pendingActionStep: null,
    players: {
      A: mapPlayer('A', state.players.A),
      B: mapPlayer('B', state.players.B),
    },
  };
}

export function previewSandboxMoveChain(
  state: SandboxMatchState,
  move: SandboxMoveSuggestion
): SandboxMoveChainPreview {
  const side = state.activeSide;
  const player = state.players[side];
  const chainState = sandboxStateToChainState(state);

  const playLine: PlayerAction[] = [];
  if (move.actionType === 'DEPLOY_UNIT' && move.card) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) playLine.push({ type: 'DEPLOY_UNIT', side, handIndex });
  } else if (move.actionType === 'DEPLOY_BASE' && move.card) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) playLine.push({ type: 'DEPLOY_BASE', side, handIndex });
  } else if (move.actionType === 'PAIR_PILOT' && move.card && move.unitInstanceId) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) {
      playLine.push({ type: 'PAIR_PILOT', side, handIndex, targetUnitId: move.unitInstanceId });
    }
  } else if (move.actionType === 'PLAY_COMMAND' && move.card) {
    const handIndex = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIndex >= 0) playLine.push({ type: 'PLAY_COMMAND', side, handIndex });
  } else if (move.actionType === 'ACTIVATE_MAIN' && move.unitInstanceId) {
    const unit = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    const clauseIdx = unit
      ? getCardAbilities(unit.card).abilities.findIndex(
          (a) => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('ACTIVATE_MAIN')
        )
      : 0;
    playLine.push({
      type: 'ACTIVATE_ABILITY',
      side,
      sourceId: move.unitInstanceId,
      clauseIndex: Math.max(0, clauseIdx),
    });
  } else if (move.actionType === 'ATTACK_SHIELD' && move.unitInstanceId) {
    playLine.push({ type: 'ATTACK_SHIELD', side, attackerId: move.unitInstanceId });
  } else if (move.actionType === 'ATTACK_UNIT' && move.unitInstanceId && move.targetInstanceId) {
    playLine.push({
      type: 'ATTACK_UNIT',
      side,
      attackerId: move.unitInstanceId,
      targetId: move.targetInstanceId,
    });
  } else if (move.actionType === 'PASS_TURN') {
    playLine.push({ type: 'PASS_TURN', side });
  }

  const witness: ChainWitness = move.targetInstanceId
    ? { targets: [[move.targetInstanceId]] }
    : {};

  const result: ChainVerificationResult =
    playLine.length > 0
      ? verifyPlayLine({ mode: { kind: 'CONCRETE_SNAPSHOT', state: chainState }, playLine, witness })
      : {
          legal: false,
          reason: 'INVALID_ACTION',
          detail: 'Card or unit for this move is not currently in hand/play.',
          trace: [],
        };

  return {
    moveTitle: move.title,
    actionType: move.actionType,
    lvRequired: move.card?.lv ?? 1,
    costRequired: move.card?.cost ?? 0,
    activeResources: player.resourcesActive,
    result,
  };
}

