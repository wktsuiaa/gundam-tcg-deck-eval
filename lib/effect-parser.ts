import type { CardColor, GundamCardPrint } from '@/types/gundam';
import { parseCardAbilities, type AbilityAst } from './cfg-parser.ts';

export type EffectTiming =
  | 'DEPLOY'
  | 'ATTACK'
  | 'DESTROYED'
  | 'WHEN_PAIRED'
  | 'WHEN_LINKED'
  | 'DURING_PAIR'
  | 'DURING_LINK'
  | 'BURST'
  | 'ACTIVATE_MAIN'
  | 'ACTIVATE_ACTION'
  | 'MAIN'
  | 'ACTION'
  | 'END_OF_TURN'
  | 'START_OF_OPPONENT_TURN'
  | 'WHEN_PLAYING'
  | 'WHEN_ATTACKED'
  | 'WHEN_DESTROY_BY_BATTLE'
  | 'WHEN_DEAL_DAMAGE'
  | 'WHEN_RECEIVE_DAMAGE'
  | 'WHEN_RECOVER_HP'
  | 'WHEN_UNIT_DEPLOYED'
  | 'WHEN_UNIT_PAIRED'
  | 'WHEN_UNIT_LINKED'
  | 'WHEN_UNIT_DESTROYED'
  | 'WHEN_RESTED'
  | 'WHEN_BLOCKED'
  | 'WHEN_PLACE_EX_RESOURCE'
  | 'WHEN_EXILE_EX_RESOURCE'
  | 'WHEN_ACTIVATE_COMMAND'
  | 'WHEN_PAY_EFFECT_COST'
  | 'WHEN_DRAW'
  | 'WHEN_AP_REDUCED'
  | 'WHEN_PLAY_CARD_WITH_EX_RESOURCE'
  | 'CONTINUOUS';

export type KeywordName =
  | 'Repair'
  | 'Breach'
  | 'Support'
  | 'Blocker'
  | 'First Strike'
  | 'High-Maneuver'
  | 'Suppression';

export interface KeywordAbility {
  name: KeywordName;
  value: number | null;
}

export interface TriggerEvent {
  kind: EffectTiming;
  actor?: 'SELF' | 'FRIENDLY' | 'ENEMY' | 'ANY';
  actorFilter?: TargetSelector;
  targetKind?: 'UNIT' | 'SHIELD' | 'BASE' | 'ANY_ENEMY_CARD' | 'EX_RESOURCE' | 'COMMAND' | 'CARD';
  targetFilter?: TargetSelector;
  damageType?: 'BATTLE' | 'EFFECT' | 'ANY';
  whileAttacking?: boolean;
  raw?: string;
}

export interface LinkRequirement {
  role: 'UNIT_REQUIRES_PILOT' | 'PILOT_MATCHING_UNIT';
  names: string[];
  traits: string[];
  raw: string;
}

export interface TargetSelector {
  owner: 'ENEMY' | 'SELF' | 'ANY' | 'ALL_PLAYERS';
  self?: boolean;
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'SHIELD' | 'RESOURCE' | 'CARD' | 'EX_RESOURCE' | 'UNIT_TOKEN';
  count?: number | 'ALL' | 'UP_TO';
  maxCount?: number;
  countRef?: 'ENEMY_PLAYERS' | 'COUNTED_VALUE';
  lvMin?: number;
  lvMax?: number;
  lvMaxRef?: 'SELF_LV' | 'COUNTED_VALUE';
  lvRank?: 'LOWEST' | 'HIGHEST';
  apMin?: number;
  apMax?: number;
  apMaxRef?: 'SELF_AP';
  hpMin?: number;
  hpMax?: number;
  hpRank?: 'LOWEST' | 'HIGHEST';
  state?: 'ACTIVE' | 'RESTED' | 'DAMAGED';
  trait?: string;
  traits?: string[];
  color?: CardColor;
  notColor?: CardColor;
  token?: boolean;
  excludeToken?: boolean;
  linked?: boolean;
  paired?: boolean | 'NONE';
  keyword?: KeywordName;
  hasDestroyedEffect?: boolean;
  nameContains?: string;
  excludeName?: string;
  zone?: 'BATTLE_AREA' | 'TRASH' | 'HAND' | 'DECK' | 'SHIELD' | 'RESOURCE';
  other?: boolean;
}

export interface ScaleMetric {
  metric:
    | 'HAND_COUNT'
    | 'TRASH_COUNT'
    | 'BOARD_UNIT_COUNT'
    | 'ENEMY_UNIT_COUNT'
    | 'ENEMY_PLAYER_COUNT'
    | 'RESTED_ENEMY_UNIT_COUNT'
    | 'SELF_DAMAGE'
    | 'PAID_COST'
    | 'AFFECTED_COUNT'
    | 'DRAWN_COUNT';
  owner?: 'SELF' | 'ENEMY' | 'ANY';
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'CARD' | 'UNIT_TOKEN';
  traits?: string[];
  nameContains?: string;
  uniqueNames?: boolean;
  rested?: boolean;
}

export type EffectCondition =
  | { kind: 'DEPLOYED_FROM_ZONE'; zone: 'trash' | 'hand' }
  | {
      kind: 'TRASH_COUNT_AT_LEAST';
      count: number;
      owner?: 'SELF' | 'ENEMY';
      color?: CardColor;
      trait?: string;
      traits?: string[];
      cardType?: string;
      nameContains?: string;
    }
  | { kind: 'FRIENDLY_BASE_IN_PLAY'; color?: CardColor; trait?: string }
  | { kind: 'SELF_AP_AT_LEAST'; minAp: number }
  | { kind: 'UNIT_TRAIT_IS'; trait: string; traits?: string[] }
  | { kind: 'IS_YOUR_TURN' }
  | { kind: 'IS_OPPONENT_TURN' }
  | { kind: 'SELF_RESTED' }
  | { kind: 'DESTROYED_BY_BATTLE' }
  | { kind: 'UNIT_COUNT_AT_LEAST'; owner: 'ENEMY' | 'SELF' | 'ANY'; count: number }
  | { kind: 'DEVELOPMENT_EXILE'; count: number }
  | { kind: 'ALL_OF'; conditions: EffectCondition[] }
  | { kind: 'ANY_OF'; conditions: EffectCondition[] }
  | { kind: 'NOT'; condition: EffectCondition }
  | {
      kind: 'BOARD_CARD_COUNT';
      owner: 'SELF' | 'ENEMY' | 'ANY';
      cardType: 'UNIT' | 'PILOT' | 'BASE' | 'UNIT_TOKEN';
      min?: number;
      max?: number;
      other?: boolean;
      rested?: boolean;
      linked?: boolean;
      paired?: boolean;
      pairedPilotLvMax?: number;
      color?: CardColor;
      notColor?: CardColor;
      traits?: string[];
      keyword?: KeywordName;
      nameContains?: string;
      lvMin?: number;
      lvMax?: number;
      apMax?: number;
      hasDestroyedEffect?: boolean;
    }
  | {
      kind: 'SELF_STATE';
      color?: CardColor;
      traits?: string[];
      paired?: boolean;
      pairedPilotLvMax?: number;
      damaged?: boolean;
      hpMin?: number;
      hpMax?: number;
      lvMin?: number;
      lvMax?: number;
      keyword?: KeywordName;
      destroyedBy?: { owner?: 'SELF' | 'ENEMY'; traits?: string[]; cardEffect?: boolean };
      attackingTarget?: 'ENEMY_UNIT' | 'ENEMY_PLAYER' | 'DAMAGED_ENEMY_UNIT';
      battlingEnemy?: {
        keyword?: KeywordName;
        lvMax?: number;
        damaged?: boolean;
        hasDestroyedEffect?: boolean;
        apMaxRef?: 'SELF_AP';
      };
      pairedWithUnit?: { traits?: string[]; nameContains?: string; linkNames?: string[]; lvMin?: number };
    }
  | { kind: 'HAND_COUNT'; owner: 'SELF' | 'ENEMY'; min?: number; max?: number }
  | { kind: 'SHIELD_COUNT'; owner: 'SELF' | 'ENEMY' | 'ANY'; min?: number; max?: number }
  | { kind: 'RESOURCE_COUNT'; owner: 'SELF' | 'ENEMY'; ex?: boolean; min?: number; max?: number }
  | { kind: 'PLAYER_LV_AT_LEAST'; minLv: number }
  | { kind: 'ENEMY_PLAYER_COUNT_AT_LEAST'; count: number }
  | {
      kind: 'TURN_HISTORY';
      event:
        | 'ACTIVATED_COMMAND'
        | 'UNIT_DESTROYED_BY_EFFECT'
        | 'PAID_EFFECT_COST_AT_LEAST'
        | 'DRAWN_BY_EFFECT'
        | 'NO_ENEMY_ATTACKED'
        | 'PAIRED_UNIT_DESTROYED_ENEMY_BY_BATTLE'
        | 'FRIENDLY_UNIT_DEPLOYED'
        | 'SET_RESOURCE_ACTIVE_BY_EFFECT';
      traits?: string[];
      minCost?: number;
      other?: boolean;
    }
  | { kind: 'EX_RESOURCE_USED_TO_PLAY' }
  | { kind: 'PHASE_AT_START_OF_OPPONENT_TURN' }
  | { kind: 'RAW_CONDITION'; text: string };

export interface ActivationCost {
  resourceCost?: number;
  restSelf?: boolean;
  returnSelfToDeckBottom?: boolean;
  destroySelf?: boolean;
  discardCount?: number;
  exileFromTrashCount?: number;
  exileFilter?: TargetSelector;
  raw?: string;
}

export type EffectDuration = 'THIS_TURN' | 'THIS_BATTLE' | 'NEXT_TURN' | 'CONTINUOUS';

export type EffectStep =
  | { action: 'ADD_SELF_TO_HAND' }
  | { action: 'DEPLOY_SELF' }
  | { action: 'ACTIVATE_MAIN_EFFECT'; target?: TargetSelector; fromDiscard?: boolean }
  | { action: 'DESTROY'; target: TargetSelector }
  | { action: 'DEAL_DAMAGE'; amount: number; scaleBy?: ScaleMetric; target: TargetSelector }
  | { action: 'MODIFY_AP'; delta: number; scaleBy?: ScaleMetric; duration?: EffectDuration; target: TargetSelector }
  | { action: 'MODIFY_HP'; delta: number; scaleBy?: ScaleMetric; duration?: EffectDuration; target: TargetSelector }
  | { action: 'REST'; target: TargetSelector }
  | { action: 'SET_ACTIVE'; target: TargetSelector }
  | { action: 'FREEZE'; target: TargetSelector }
  | { action: 'BOUNCE'; target: TargetSelector }
  | { action: 'RETURN_TO_DECK'; position?: 'TOP' | 'BOTTOM' | 'SHUFFLE'; shuffle?: boolean; target: TargetSelector }
  | { action: 'DRAW'; count: number; scaleBy?: ScaleMetric; bothPlayers?: boolean; optional?: boolean; targetOwner?: 'SELF' | 'ENEMY' | 'ALL_PLAYERS' }
  | { action: 'DISCARD'; count: number; scaleBy?: ScaleMetric; targetOwner?: 'SELF' | 'ENEMY' | 'ALL_PLAYERS'; target?: TargetSelector; optional?: boolean }
  | { action: 'LOOK_TOP'; count: number; revealSearch?: boolean; trashRest?: boolean; trait?: string; target?: TargetSelector; remainderPosition?: 'TOP' | 'BOTTOM' | 'TRASH' }
  | { action: 'REVEAL_TOP'; count: number }
  | { action: 'ADD_SHIELD_TO_HAND'; count: number }
  | { action: 'ADD_FROM_TRASH_TO_HAND'; target: TargetSelector }
  | { action: 'DEPLOY_FROM_TRASH'; free: boolean; rested?: boolean; target: TargetSelector }
  | { action: 'DEPLOY_FROM_HAND'; free?: boolean; rested?: boolean; target: TargetSelector }
  | { action: 'DEPLOY_FROM_TOP_DECK'; target: TargetSelector }
  | { action: 'PAIR_SELF_FROM_TRASH'; target: TargetSelector }
  | { action: 'PAIR_FROM_HAND'; target: TargetSelector; pilotFilter?: TargetSelector }
  | { action: 'DEPLOY_TOKEN'; count: number; ap?: number; hp?: number; name?: string; traits?: string[]; owner?: 'SELF' | 'ENEMY' | 'DESTROYED_OWNER'; baseToken?: boolean; exBase?: boolean }
  | { action: 'RECOVER_HP'; amount: number; target: TargetSelector }
  | { action: 'GRANT_KEYWORD'; keyword: KeywordAbility; scaleBy?: ScaleMetric; duration?: EffectDuration; target: TargetSelector }
  | { action: 'GRANT_TRAIT'; traits: string[]; duration?: EffectDuration; target: TargetSelector }
  | { action: 'GRANT_PILOT_MODE'; pilotName: string }
  | { action: 'NAME_ALIAS'; alias: string }
  | { action: 'DAMAGE_PROOF'; summary: string; amount?: number; maxDamage?: number; damageType?: 'BATTLE' | 'EFFECT' | 'ANY'; duration?: EffectDuration; target?: TargetSelector }
  | { action: 'ADD_RESOURCE'; count: number; ex?: boolean; rested?: boolean }
  | { action: 'PAY_RESOURCE'; amount: number; optional?: boolean }
  | { action: 'COST_REDUCTION'; amount: number; lvDelta?: number; zone?: 'HAND' | 'TRASH'; perTarget?: ScaleMetric; exactCost?: number; exactLv?: number }
  | { action: 'CANT_ATTACK'; duration?: EffectDuration; target: TargetSelector }
  | { action: 'ALLOW_ATTACK_ACTIVE'; target: TargetSelector }
  | { action: 'MILL'; count: number }
  | { action: 'EXILE'; target: TargetSelector }
  | { action: 'REVEAL_FROM_HAND'; target: TargetSelector }
  | { action: 'REDIRECT_ATTACK_TARGET'; rule: 'MUST_ATTACK_TARGET' | 'CANT_CHOOSE_TARGET' | 'CANT_CHOOSE_SAME_PLAYER'; target: TargetSelector; attackerFilter?: TargetSelector; duration?: EffectDuration }
  | { action: 'REDIRECT_BATTLE_DAMAGE'; fromTarget: TargetSelector; toTarget: TargetSelector; duration?: EffectDuration }
  | { action: 'FORCE_BATTLE_DAMAGE_STEP'; attacker: TargetSelector; defender: TargetSelector }
  | { action: 'MODIFY_DAMAGE_DEALT'; delta: number; sourceFilter?: TargetSelector; targetFilter?: TargetSelector; duration?: EffectDuration }
  | { action: 'COUNT_UNITS'; target: TargetSelector; plusSelf?: boolean }
  | { action: 'RESTRICTION'; rule: 'CANT_BE_PAIRED' | 'CANT_SET_ACTIVE' | 'CANT_BE_RESTED' | 'CAN_ATTACK_TURN_DEPLOYED' | 'ONLY_ATTACK_WHEN_DEPLOYED' | 'DEPLOYED_RESTED' | 'INSTEAD_REST_TARGET' | 'CANT_ACTIVATE_BLOCKER'; target: TargetSelector; duration?: EffectDuration; summary: string }
  | { action: 'IF_CONDITION'; condition: EffectCondition; thenSteps: EffectStep[]; elseSteps?: EffectStep[]; replacesPrevious?: boolean }
  | { action: 'IF_PREVIOUS_SUCCEEDED'; negated?: boolean; filter?: { count?: number; lvMin?: number; cardType?: string; traits?: string[]; drawAccepted?: boolean; placedFromDeck?: boolean }; thenSteps: EffectStep[] }
  | { action: 'GRANT_CLAUSE'; clause: EffectClause; duration?: EffectDuration; target: TargetSelector };

export interface EffectClause {
  raw: string;
  timings: EffectTiming[];
  oncePerTurn: boolean;
  triggerEvent?: TriggerEvent;
  pairFilter?: { trait?: string; color?: CardColor; lvMin?: number; lvMax?: number };
  linkRequirement?: LinkRequirement;
  cost?: ActivationCost;
  condition?: EffectCondition;
  steps: EffectStep[];
  unparsedResidual: string;
}

export interface ParsedCardEffects {
  cardNo: string;
  keywords: KeywordAbility[];
  clauses: EffectClause[];
}

export interface CompiledCardEffect {
  cardNo: string;
  sourcePrintId: string;
  name: string;
  type: string;
  color: CardColor;
  keywords: KeywordAbility[];
  clauses: EffectClause[];
  abilities?: AbilityAst[];
  synergy: CardSynergyProfile;
  prerequisites: EffectPrerequisite[];
}

export interface EffectShardFile {
  schemaVersion: 1;
  setPrefix: string;
  cardCount: number;
  effects: Record<string, CompiledCardEffect>;
}

export function getEffectSetPrefix(cardNo: string): string {
  const m = cardNo.match(/^([A-Za-z0-9]+)-/);
  const raw = m ? m[1] : 'MISC';
  return raw.replace(/[^A-Za-z0-9_-]/g, '_') || 'MISC';
}

const KEYWORD_NAMES: Record<string, KeywordName> = {
  repair: 'Repair',
  breach: 'Breach',
  support: 'Support',
  blocker: 'Blocker',
  'first strike': 'First Strike',
  'high-maneuver': 'High-Maneuver',
  suppression: 'Suppression',
};

const CIRCLED_NUMS: Record<string, number> = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
};

const COLORS: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White', 'Colorless'];

function parseColorWord(raw?: string): CardColor | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  return COLORS.find((c) => c.toLowerCase() === lower);
}

function extractAllTraits(s: string): string[] {
  return [...s.matchAll(/\(([^)]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((t) => !/^AP\d+/i.test(t) && !/^HP\d+/i.test(t) && !/･/.test(t));
}

function parseKeywordToken(raw: string): KeywordAbility | null {
  const m = raw.trim().match(/^([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s*(\d+)?$/);
  if (!m) return null;
  const canonical = KEYWORD_NAMES[m[1].toLowerCase()];
  if (!canonical) return null;
  return { name: canonical, value: m[2] ? parseInt(m[2], 10) : null };
}

/** Strips parenthetical rules reminders while preserving (Trait) and token stat tokens. */
export function stripReminderText(effect: string): string {
  const stripOnce = (txt: string) =>
    txt.replace(/\(([^()]*|\([^()]*\)[^()]*)*\)/g, (full) => {
      const inner = full.slice(1, -1).trim();
      if (
        inner.includes('.') ||
        inner.length > 34 ||
        /^(At the |When |While |Rest |Damage |During |If |After |This |You )/i.test(inner)
      ) {
        return '';
      }
      return full;
    });
  return stripOnce(stripOnce(effect));
}

function parseHeaderTag(
  tag: string,
  timings: Set<EffectTiming>,
  meta: { oncePerTurn: boolean; pairFilter?: EffectClause['pairFilter']; devCost?: number; isPilotTag?: boolean }
) {
  const inner = tag.slice(1, -1).trim();
  if (inner === 'Once per Turn') {
    meta.oncePerTurn = true;
    return;
  }
  const parts = inner.split(/[･・]/).map((p) => p.trim());
  for (const part of parts) {
    switch (part) {
      case 'Deploy': timings.add('DEPLOY'); break;
      case 'Attack': timings.add('ATTACK'); break;
      case 'Destroyed': timings.add('DESTROYED'); break;
      case 'When Paired': timings.add('WHEN_PAIRED'); break;
      case 'When Linked': timings.add('WHEN_LINKED'); break;
      case 'During Pair': timings.add('DURING_PAIR'); break;
      case 'During Link': timings.add('DURING_LINK'); break;
      case 'Burst': timings.add('BURST'); break;
      case 'Main': timings.add('MAIN'); break;
      case 'Action': timings.add('ACTION'); break;
      case 'Activate': break;
      case 'Pilot': meta.isPilotTag = true; break;
      default: {
        const dev = part.match(/^Development\s+(\d+)$/i);
        if (dev) {
          meta.devCost = parseInt(dev[1], 10);
        } else if (part.endsWith('Pilot')) {
          meta.pairFilter ??= {};
          const traitM = part.match(/\(([^)]+)\)/);
          if (traitM) meta.pairFilter.trait = traitM[1];
          const lvLo = part.match(/Lv\.(\d+)\s+or\s+Lower/i);
          if (lvLo) meta.pairFilter.lvMax = parseInt(lvLo[1], 10);
          const lvHi = part.match(/Lv\.(\d+)\s+or\s+Higher/i);
          if (lvHi) meta.pairFilter.lvMin = parseInt(lvHi[1], 10);
          for (const col of COLORS) {
            if (part.includes(col)) meta.pairFilter.color = col;
          }
        }
      }
    }
  }
  if (inner.startsWith('Activate')) {
    if (parts.includes('Main')) {
      timings.delete('MAIN');
      timings.add('ACTIVATE_MAIN');
    }
    if (parts.includes('Action')) {
      timings.delete('ACTION');
      timings.add('ACTIVATE_ACTION');
    }
  }
}

function parseCost(rawCost: string): ActivationCost {
  const cost: ActivationCost = { raw: rawCost };
  for (const [sym, val] of Object.entries(CIRCLED_NUMS)) {
    if (rawCost.includes(sym)) cost.resourceCost = (cost.resourceCost ?? 0) + val;
  }
  if (/rest this (?:unit|base|card)/i.test(rawCost)) cost.restSelf = true;
  if (/return this (?:unit|card) to the bottom of its owner'?s deck/i.test(rawCost)) {
    cost.returnSelfToDeckBottom = true;
  }
  if (/destroy this unit/i.test(rawCost)) cost.destroySelf = true;
  const disc = rawCost.match(/discard (\d+)/i);
  if (disc) cost.discardCount = parseInt(disc[1], 10);
  const exile = rawCost.match(/exile (\d+)/i);
  if (exile) {
    cost.exileFromTrashCount = parseInt(exile[1], 10);
    if (/pilot card/i.test(rawCost) || /\([^)]+\)/.test(rawCost)) {
      cost.exileFilter = parseTargetSelector(rawCost);
    }
  }
  return cost;
}

function parseBoardFilterFromText(c: string): {
  owner: 'SELF' | 'ENEMY' | 'ANY';
  cardType: 'UNIT' | 'PILOT' | 'BASE' | 'UNIT_TOKEN';
  min?: number;
  max?: number;
  other?: boolean;
  rested?: boolean;
  linked?: boolean;
  paired?: boolean;
  pairedPilotLvMax?: number;
  color?: CardColor;
  notColor?: CardColor;
  traits?: string[];
  keyword?: KeywordName;
  nameContains?: string;
  lvMin?: number;
  lvMax?: number;
  apMax?: number;
  hasDestroyedEffect?: boolean;
} {
  const cleanOwnerScope = c.replace(/\bat the start of your opponent'?s turn\b/gi, '');
  const owner: 'SELF' | 'ENEMY' | 'ANY' =
    /\benemy\b|\bopponent'?s\b/i.test(cleanOwnerScope) ? 'ENEMY' : /\bfriendly\b|\byou have\b|\byour\b|\bthere is a friendly\b/i.test(cleanOwnerScope) ? 'SELF' : 'ANY';

  const cardType: 'UNIT' | 'PILOT' | 'BASE' | 'UNIT_TOKEN' = /\bunit tokens?\b/i.test(c)
    ? 'UNIT_TOKEN'
    : /\bbases?\b/i.test(c)
    ? 'BASE'
    : /\bpilots?\b/i.test(c)
    ? 'PILOT'
    : 'UNIT';

  let min: number | undefined = 1;
  let max: number | undefined;
  if (/\bno\b/i.test(c) && !/with no/i.test(c)) {
    min = 0;
    max = 0;
  } else {
    const rng = c.match(/\b(\d+)\s+to\s+(\d+)\b/i);
    const minM = c.match(/(\d+)\s+or\s+more/i);
    const maxM = c.match(/(\d+)\s+or\s+less/i);
    if (rng) {
      min = parseInt(rng[1], 10);
      max = parseInt(rng[2], 10);
    } else if (minM) {
      min = parseInt(minM[1], 10);
    } else if (maxM && !/Lv\.|AP|HP/i.test(c.slice(Math.max(0, (maxM.index ?? 0) - 8), (maxM.index ?? 0) + 12))) {
      min = undefined;
      max = parseInt(maxM[1], 10);
    }
  }

  const traits = extractAllTraits(c);
  const notColM = c.match(/non-(blue|green|red|purple|white)/i);
  const colM = !notColM ? c.match(/\b(blue|green|red|purple|white)\b/i) : null;
  const kwM = c.match(/<([^>]+)>/);
  const kw = kwM ? parseKeywordToken(kwM[1])?.name : undefined;
  const nameM = c.match(/with "([^"]+)" in its card name/i);
  const lvMinM = c.match(/Lv\.(\d+)\s+or\s+higher/i);
  const lvMaxM = c.match(/Lv\.(\d+)\s+or\s+lower/i);
  const apMaxM = c.match(/(\d+)\s+or\s+less\s+AP/i);
  const pairedPilotLvM = c.match(/paired with a Pilot that is Lv\.(\d+)\s+or\s+lower/i);

  return {
    owner,
    cardType,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...( /\bother\b|\banother\b/i.test(c) ? { other: true } : {} ),
    ...( /\brested\b/i.test(c) ? { rested: true } : {} ),
    ...( /\blink unit/i.test(c) ? { linked: true } : {} ),
    ...( pairedPilotLvM ? { paired: true, pairedPilotLvMax: parseInt(pairedPilotLvM[1], 10) } : {} ),
    ...( colM ? { color: parseColorWord(colM[1]) } : {} ),
    ...( notColM ? { notColor: parseColorWord(notColM[1]) } : {} ),
    ...( traits.length > 0 ? { traits } : {} ),
    ...( kw ? { keyword: kw } : {} ),
    ...( nameM ? { nameContains: nameM[1] } : {} ),
    ...( lvMinM ? { lvMin: parseInt(lvMinM[1], 10) } : {} ),
    ...( lvMaxM ? { lvMax: parseInt(lvMaxM[1], 10) } : {} ),
    ...( apMaxM ? { apMax: parseInt(apMaxM[1], 10) } : {} ),
    ...( /with a 【Destroyed】 effect/i.test(c) ? { hasDestroyedEffect: true } : {} ),
  };
}

function parseSingleCondition(rawCond: string): EffectCondition {
  const c = rawCond.trim().replace(/^if\s+|^while\s+/i, '').trim();

  if (/^you deploy this unit from your trash$/i.test(c)) {
    return { kind: 'DEPLOYED_FROM_ZONE', zone: 'trash' };
  }
  if (/^you deploy this unit from your hand$/i.test(c)) {
    return { kind: 'DEPLOYED_FROM_ZONE', zone: 'hand' };
  }
  if (/^it is your turn$/i.test(c)) {
    return { kind: 'IS_YOUR_TURN' };
  }
  if (/^it is your opponent'?s turn$/i.test(c)) {
    return { kind: 'IS_OPPONENT_TURN' };
  }
  if (/^you used? an EX Resource to play this card$|^you use an EX Resource to play this card$/i.test(c)) {
    return { kind: 'EX_RESOURCE_USED_TO_PLAY' };
  }
  if (/^a friendly base (?:is )?in play$/i.test(c) || /^there is a friendly base in play$/i.test(c)) {
    return { kind: 'FRIENDLY_BASE_IN_PLAY' };
  }
  const colBaseM = c.match(/^(?:there is )?a friendly (blue|green|red|purple|white) Base (?:is )?in play$/i);
  if (colBaseM) {
    return { kind: 'FRIENDLY_BASE_IN_PLAY', color: parseColorWord(colBaseM[1]) };
  }
  const traitBaseM = c.match(/^(?:there is )?a friendly \(([^)]+)\) Base (?:is )?in play$/i);
  if (traitBaseM) {
    return { kind: 'FRIENDLY_BASE_IN_PLAY', trait: traitBaseM[1].trim() };
  }

  // Trash count
  const trashCount = c.match(
    /(?:there are |(?:an enemy player|your opponent) has )(\d+) or more (?:(blue|green|red|purple|white)\s+)?(?:(?:\([^)]+\)(?:\/\([^)]+\))*)\s+)?(?:with "([^"]+)" in their card name\s+)?(?:(unit|pilot|base|command)\s+)?cards? (?:with "([^"]+)" in their card name\s+)?in (your|their) trash/i
  );
  if (trashCount) {
    const traits = extractAllTraits(c);
    const nameContains = trashCount[3] ?? trashCount[5];
    return {
      kind: 'TRASH_COUNT_AT_LEAST',
      count: parseInt(trashCount[1], 10),
      ...(trashCount[6].toLowerCase() === 'their' ? { owner: 'ENEMY' as const } : {}),
      ...(trashCount[2] ? { color: parseColorWord(trashCount[2]) } : {}),
      ...(traits.length === 1 ? { trait: traits[0] } : {}),
      ...(traits.length > 0 ? { traits } : {}),
      ...(trashCount[4] ? { cardType: trashCount[4].toUpperCase() } : {}),
      ...(nameContains ? { nameContains } : {}),
    };
  }

  // Self AP
  const selfAp = c.match(/^this unit has (\d+) or more ap$/i);
  if (selfAp) {
    return { kind: 'SELF_AP_AT_LEAST', minAp: parseInt(selfAp[1], 10) };
  }

  // Simple exact Unit trait check (backward-compatible)
  const traitUnit = c.match(/^this is a \(([^)]+)\) unit$/i);
  if (traitUnit) {
    return { kind: 'UNIT_TRAIT_IS', trait: traitUnit[1].trim() };
  }

  if (/^this unit is rested$/i.test(c)) {
    return { kind: 'SELF_RESTED' };
  }
  if (/destroyed with battle damage/i.test(c) && !/friendly unit paired/i.test(c)) {
    return { kind: 'DESTROYED_BY_BATTLE' };
  }

  // Simple generic unit count (backward-compatible)
  const unitCountSimple = c.match(/^(\d+) or more (enemy|friendly)?\s*units? (?:are|is) in play$/i);
  if (unitCountSimple && !/\(|rested|link|token|lv\.|ap|</i.test(c)) {
    const owner =
      unitCountSimple[2]?.toLowerCase() === 'enemy'
        ? 'ENEMY'
        : unitCountSimple[2]?.toLowerCase() === 'friendly'
        ? 'SELF'
        : 'ANY';
    return { kind: 'UNIT_COUNT_AT_LEAST', owner, count: parseInt(unitCountSimple[1], 10) };
  }

  // Player Lv
  const lvM = c.match(/^you are Lv\.(\d+) or higher$/i);
  if (lvM) {
    return { kind: 'PLAYER_LV_AT_LEAST', minLv: parseInt(lvM[1], 10) };
  }

  // Enemy players count
  const epM = c.match(/^there are (\d+) or more enemy players$/i);
  if (epM) {
    return { kind: 'ENEMY_PLAYER_COUNT_AT_LEAST', count: parseInt(epM[1], 10) };
  }

  // Hand count
  const handM = c.match(/^(?:you have|(an enemy player|your opponent) has) (\d+) or (more|less) cards? in (?:your|their) hand$/i);
  if (handM) {
    const n = parseInt(handM[2], 10);
    return {
      kind: 'HAND_COUNT',
      owner: handM[1] ? 'ENEMY' : 'SELF',
      ...(handM[3].toLowerCase() === 'more' ? { min: n } : { max: n }),
    };
  }

  // Shield count
  const shieldAnyM = c.match(/^there is a player with (\d+) or (more|less) shields$/i);
  if (shieldAnyM) {
    const n = parseInt(shieldAnyM[1], 10);
    return {
      kind: 'SHIELD_COUNT',
      owner: 'ANY',
      ...(shieldAnyM[2].toLowerCase() === 'more' ? { min: n } : { max: n }),
    };
  }
  const shieldM = c.match(/^(?:there are (\d+) or (more|less) (enemy|friendly) shields|you have (any|\d+ or more|\d+ or less) shields(?: in play)?)$/i);
  if (shieldM) {
    if (shieldM[1]) {
      const n = parseInt(shieldM[1], 10);
      return {
        kind: 'SHIELD_COUNT',
        owner: shieldM[3].toLowerCase() === 'enemy' ? 'ENEMY' : 'SELF',
        ...(shieldM[2].toLowerCase() === 'more' ? { min: n } : { max: n }),
      };
    }
    if (/any/i.test(shieldM[4])) {
      return { kind: 'SHIELD_COUNT', owner: 'SELF', min: 1 };
    }
  }

  // EX Resource count
  if (/^(?:your opponent has an EX Resource|you have (?:no (?:remaining )?)?EX Resources?)$/i.test(c)) {
    const isEnemy = /opponent/i.test(c);
    const isZero = /\bno\b/i.test(c);
    return {
      kind: 'RESOURCE_COUNT',
      owner: isEnemy ? 'ENEMY' : 'SELF',
      ex: true,
      ...(isZero ? { min: 0, max: 0 } : { min: 1 }),
    };
  }

  // Turn history predicates
  if (/you have activated a \(([^)]+)\) command card'?s 【Main】\/【Action】 during this turn/i.test(c)) {
    const traits = extractAllTraits(c);
    return { kind: 'TURN_HISTORY', event: 'ACTIVATED_COMMAND', traits };
  }
  if (/one of your units has been destroyed by one of your \(([^)]+)\) card'?s effects during this turn/i.test(c)) {
    const traits = extractAllTraits(c);
    return { kind: 'TURN_HISTORY', event: 'UNIT_DESTROYED_BY_EFFECT', traits };
  }
  const paidM = c.match(/you have paid (?:a total of )?([①②③④⑤⑥⑦⑧⑨⑩]) or more for (?:one of )?your (?:other )?(?:\(([^)]+)\)(?:\/\(([^)]+)\))?\s+)?units?'?s? effects(?: this turn)?/i);
  if (paidM) {
    const traits = extractAllTraits(c);
    return {
      kind: 'TURN_HISTORY',
      event: 'PAID_EFFECT_COST_AT_LEAST',
      minCost: CIRCLED_NUMS[paidM[1]] ?? 1,
      ...(traits.length > 0 ? { traits } : {}),
      ...(/\bother\b/i.test(c) ? { other: true } : {}),
    };
  }
  if (/you have drawn with an effect during this turn/i.test(c)) {
    return { kind: 'TURN_HISTORY', event: 'DRAWN_BY_EFFECT' };
  }
  if (/no enemy units have attacked this turn/i.test(c)) {
    return { kind: 'TURN_HISTORY', event: 'NO_ENEMY_ATTACKED' };
  }
  if (/a friendly unit paired with a pilot has destroyed an enemy unit with battle damage this turn/i.test(c)) {
    return { kind: 'TURN_HISTORY', event: 'PAIRED_UNIT_DESTROYED_ENEMY_BY_BATTLE' };
  }
  if (/you have not set one of your resources as active with an effect this turn/i.test(c)) {
    return { kind: 'NOT', condition: { kind: 'TURN_HISTORY', event: 'SET_RESOURCE_ACTIVE_BY_EFFECT' } };
  }

  // Self state predicates
  if (/^a pilot is not paired with this unit$/i.test(c)) {
    return { kind: 'SELF_STATE', paired: false };
  }
  if (/^it is paired with a pilot that is Lv\.(\d+) or lower$/i.test(c) || /^this unit is paired with a pilot/i.test(c)) {
    const m = c.match(/Lv\.(\d+)/i);
    return { kind: 'SELF_STATE', paired: true, ...(m ? { pairedPilotLvMax: parseInt(m[1], 10) } : {}) };
  }
  if (/^this(?: unit)? is damaged/i.test(c)) {
    const lvMaxM = c.match(/Lv\.(\d+)\s+or\s+lower/i);
    return { kind: 'SELF_STATE', damaged: true, ...(lvMaxM ? { lvMax: parseInt(lvMaxM[1], 10) } : {}) };
  }
  const selfHpM = c.match(/^this unit has (\d+) HP$/i);
  if (selfHpM) {
    const n = parseInt(selfHpM[1], 10);
    return { kind: 'SELF_STATE', hpMin: n, hpMax: n };
  }
  const selfKwM = c.match(/^this unit has\s*<([^>]+)>$/i);
  if (selfKwM) {
    const kw = parseKeywordToken(selfKwM[1]);
    if (kw) return { kind: 'SELF_STATE', keyword: kw.name };
  }
  const selfColTraitM = c.match(/^this(?: is an?| unit is)?\s+(?:(blue|green|red|purple|white)\s+)?(?:\(([^)]+)\)(?:\/\(([^)]+)\))?\s*)?unit$|^this unit is (blue|green|red|purple|white|\([^)]+\))$/i);
  if (selfColTraitM) {
    const col = parseColorWord(selfColTraitM[1] ?? selfColTraitM[4]);
    const traits = extractAllTraits(c);
    return { kind: 'SELF_STATE', ...(col ? { color: col } : {}), ...(traits.length > 0 ? { traits } : {}) };
  }
  if (/^it has\s*<([^>]+)>$/i.test(c)) {
    const kw = parseKeywordToken(c.match(/<([^>]+)>/)![1]);
    if (kw) return { kind: 'SELF_STATE', keyword: kw.name };
  }
  if (/^this unit is destroyed by one of your \(([^)]+)\) card'?s effects$/i.test(c)) {
    return {
      kind: 'SELF_STATE',
      destroyedBy: { owner: 'SELF', traits: extractAllTraits(c), cardEffect: true },
    };
  }
  if (/^(?:you are|this unit is|it is) attacking (?:an? |the )?(damaged enemy unit|enemy unit|enemy player)/i.test(c)) {
    const tgt = /damaged enemy unit/i.test(c)
      ? 'DAMAGED_ENEMY_UNIT'
      : /enemy player/i.test(c)
      ? 'ENEMY_PLAYER'
      : 'ENEMY_UNIT';
    return { kind: 'SELF_STATE', attackingTarget: tgt };
  }
  if (/^this unit is battling an enemy unit/i.test(c) || /^this unit is battling a damaged enemy unit/i.test(c)) {
    const kwM = c.match(/<([^>]+)>/);
    const kw = kwM ? parseKeywordToken(kwM[1])?.name : undefined;
    const lvMaxM = c.match(/Lv\.(\d+)\s+or\s+lower/i);
    return {
      kind: 'SELF_STATE',
      battlingEnemy: {
        ...(kw ? { keyword: kw } : {}),
        ...(lvMaxM ? { lvMax: parseInt(lvMaxM[1], 10) } : {}),
        ...(/damaged/i.test(c) ? { damaged: true } : {}),
        ...(/【Destroyed】 effect/i.test(c) ? { hasDestroyedEffect: true } : {}),
      },
    };
  }
  if (/^it is a \(([^)]+)\) unit$/i.test(c)) {
    return { kind: 'UNIT_TRAIT_IS', trait: extractAllTraits(c)[0] };
  }

  // Board card count (friendly/enemy/any Units, Pilots, Bases, Tokens)
  if (/(?:units?|pilots?|bases?|unit tokens?)\b/i.test(c) && /\bin play\b|\byou have\b|\bat the start of your opponent'?s turn/i.test(c)) {
    const bf = parseBoardFilterFromText(c);
    if (/at the start of your opponent'?s turn/i.test(c)) {
      return {
        kind: 'ALL_OF',
        conditions: [
          { kind: 'PHASE_AT_START_OF_OPPONENT_TURN' },
          { kind: 'BOARD_CARD_COUNT', ...bf },
        ],
      };
    }
    return { kind: 'BOARD_CARD_COUNT', ...bf };
  }

  return { kind: 'RAW_CONDITION', text: rawCond.trim() };
}

function parseCondition(condText: string): EffectCondition {
  const trimmed = condText.trim();
  const body = trimmed.replace(/^(?:if|while)\s+/i, '').trim();

  // Split compound "A and B" when B starts a distinct predicate (not inside "with <Blocker> and 3 or less AP" or "Lv.5 and cost")
  const andSplit = body.split(/\s+and\s+(?=(?:you have|there (?:is|are)|it is|no enemy|this(?: unit)? |a friendly|friendly|another|an? (?:enemy|friendly)|\d+ or more))/i);
  if (andSplit.length > 1) {
    return {
      kind: 'ALL_OF',
      conditions: andSplit.map((part) => parseSingleCondition(part)),
    };
  }

  // Handle "it is your turn a friendly ..." (missing "and" typo in GD02-128)
  const typoTurn = body.match(/^it is your turn\s+(a friendly .+)$/i);
  if (typoTurn) {
    return {
      kind: 'ALL_OF',
      conditions: [{ kind: 'IS_YOUR_TURN' }, parseSingleCondition(typoTurn[1])],
    };
  }

  return parseSingleCondition(trimmed);
}

function combineConditions(a: EffectCondition | undefined, b: EffectCondition | undefined): EffectCondition | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.kind === 'ALL_OF' && b.kind === 'ALL_OF') {
    return { kind: 'ALL_OF', conditions: [...a.conditions, ...b.conditions] };
  }
  if (a.kind === 'ALL_OF') return { kind: 'ALL_OF', conditions: [...a.conditions, b] };
  if (b.kind === 'ALL_OF') return { kind: 'ALL_OF', conditions: [a, ...b.conditions] };
  return { kind: 'ALL_OF', conditions: [a, b] };
}

function parseTargetSelector(phrase: string): TargetSelector {
  const s = phrase.trim();
  const sel: TargetSelector = {
    owner: /\benemy\b|\bopponent'?s\b/i.test(s)
      ? 'ENEMY'
      : /\bfriendly\b|\byour\b|\bof your\b/i.test(s)
      ? 'SELF'
      : 'ANY',
  };
  if (/belonging to each enemy player/i.test(s)) {
    sel.owner = 'ENEMY';
    sel.countRef = 'ENEMY_PLAYERS';
  }
  if (/^all players$/i.test(s)) {
    sel.owner = 'ALL_PLAYERS';
  }

  if (/^this (?:rested |active )?unit$/i.test(s) || /\bthis (?:rested |active )?unit\b/i.test(s)) {
    sel.owner = 'SELF';
    sel.self = true;
    sel.cardType = 'UNIT';
  }
  if (/this unit'?s paired pilot|card paired with this unit/i.test(s)) {
    sel.owner = 'SELF';
    sel.self = true;
    sel.cardType = 'PILOT';
  } else if (/\bunit tokens?\b/i.test(s)) {
    sel.cardType = 'UNIT_TOKEN';
    sel.token = true;
  } else if (/\bbases?\b/i.test(s)) sel.cardType = 'BASE';
  else if (/\bshields?\b/i.test(s)) sel.cardType = 'SHIELD';
  else if (/\bex resources?\b/i.test(s)) sel.cardType = 'EX_RESOURCE';
  else if (/\bresources?\b/i.test(s)) sel.cardType = 'RESOURCE';
  else if (/\bpilots?\b/i.test(s)) sel.cardType = 'PILOT';
  else if (/\bcommands?\b/i.test(s)) sel.cardType = 'COMMAND';
  else if (/\bunits?\b/i.test(s)) sel.cardType = 'UNIT';
  else if (/\bcards?\b/i.test(s)) sel.cardType = 'CARD';

  if (/\ball\b/i.test(s) && !/all players/i.test(s)) sel.count = 'ALL';
  else if (/equal to the number of enemy players/i.test(s)) {
    sel.countRef = 'ENEMY_PLAYERS';
    sel.count = 'UP_TO';
  } else {
    const rng = s.match(/\b(\d+)\s+to\s+(\d+)\b/i);
    const upTo = s.match(/\bup to (\d+)\b/i);
    const exact = s.match(/\b(\d+)\b/);
    if (rng) {
      sel.count = 'UP_TO';
      sel.maxCount = parseInt(rng[2], 10);
    } else if (upTo) {
      sel.count = 'UP_TO';
      sel.maxCount = parseInt(upTo[1], 10);
    } else if (exact && !/Lv\.|AP|HP/i.test(s.slice(Math.max(0, (exact.index ?? 0) - 4), (exact.index ?? 0) + 1))) {
      sel.count = parseInt(exact[1], 10);
    } else {
      sel.count = 1;
    }
  }

  if (/\bactive\b/i.test(s)) sel.state = 'ACTIVE';
  else if (/\brested\b/i.test(s)) sel.state = 'RESTED';
  else if (/\bdamaged\b/i.test(s)) sel.state = 'DAMAGED';

  if (/\bother\b/i.test(s)) sel.other = true;
  if (/other than unit tokens/i.test(s)) sel.excludeToken = true;
  if (/\blink units?\b/i.test(s)) sel.linked = true;
  if (/with no paired pilot/i.test(s)) sel.paired = 'NONE';
  else if (/paired with a pilot/i.test(s)) sel.paired = true;

  const lvMax = s.match(/Lv\.(\d+)\s+or\s+lower/i);
  if (lvMax) sel.lvMax = parseInt(lvMax[1], 10);
  const lvMin = s.match(/Lv\.(\d+)\s+or\s+higher/i);
  if (lvMin) sel.lvMin = parseInt(lvMin[1], 10);
  const lvEq = s.match(/that is Lv\.(\d+)(?!\s+or)/i);
  if (lvEq) {
    sel.lvMin = parseInt(lvEq[1], 10);
    sel.lvMax = parseInt(lvEq[1], 10);
  }
  if (/whose Lv\. is equal to or lower than this unit/i.test(s)) sel.lvMaxRef = 'SELF_LV';
  if (/whose Lv\. is equal to or lower than (?:that number|the unit rested with this ability)/i.test(s)) sel.lvMaxRef = 'COUNTED_VALUE';
  if (/with the lowest Lv\./i.test(s)) sel.lvRank = 'LOWEST';
  if (/with the highest Lv\./i.test(s)) sel.lvRank = 'HIGHEST';

  const apMax = s.match(/(\d+)\s+or\s+less\s+AP/i);
  if (apMax) sel.apMax = parseInt(apMax[1], 10);
  const apMin = s.match(/(\d+)\s+or\s+more\s+AP/i);
  if (apMin) sel.apMin = parseInt(apMin[1], 10);
  if (/AP equal to or less than it/i.test(s)) sel.apMaxRef = 'SELF_AP';

  const hpMax = s.match(/(\d+)\s+HP\s+or\s+less|(\d+)\s+or\s+less\s+HP/i);
  if (hpMax) sel.hpMax = parseInt(hpMax[1] ?? hpMax[2], 10);
  const hpMin = s.match(/(\d+)\s+or\s+more\s+HP/i);
  if (hpMin) sel.hpMin = parseInt(hpMin[1], 10);
  const hpExact = s.match(/with (\d+) HP\b(?!\s+or)/i);
  if (hpExact) {
    const val = parseInt(hpExact[1], 10);
    sel.hpMin = val;
    sel.hpMax = val;
  }
  if (/with the lowest HP/i.test(s)) sel.hpRank = 'LOWEST';
  if (/with the highest HP/i.test(s)) sel.hpRank = 'HIGHEST';

  const traits = extractAllTraits(s);
  if (traits.length > 0) {
    sel.trait = traits[0];
    if (traits.length > 1) sel.traits = traits;
  }
  const notCol = s.match(/non-(blue|green|red|purple|white)/i);
  if (notCol) sel.notColor = parseColorWord(notCol[1]);
  const col = !notCol ? s.match(/\b(blue|green|red|purple|white)\b/i) : null;
  if (col) sel.color = parseColorWord(col[1]);

  const kwM = s.match(/with\s*<([^>]+)>/i);
  if (kwM) {
    const kw = parseKeywordToken(kwM[1]);
    if (kw) sel.keyword = kw.name;
  }
  if (/with a 【Destroyed】 effect/i.test(s)) sel.hasDestroyedEffect = true;

  const nameM = s.match(/with "([^"]+)"(?:\/"([^"]+)")? in (?:its|their) card names?/i);
  if (nameM) sel.nameContains = nameM[1];
  const exclM = s.match(/without "([^"]+)" in its card name/i);
  if (exclM) sel.excludeName = exclM[1];

  if (/from your trash|in your trash/i.test(s)) sel.zone = 'TRASH';
  else if (/from your hand|in your hand/i.test(s)) sel.zone = 'HAND';
  else if (/shield/i.test(s)) sel.zone = 'SHIELD';

  return sel;
}

function parseDuration(s: string): EffectDuration | undefined {
  if (/during this battle/i.test(s)) return 'THIS_BATTLE';
  if (/during this turn|until the end of this turn|until end of turn|this turn/i.test(s)) return 'THIS_TURN';
  if (/opponent'?s next turn/i.test(s)) return 'NEXT_TURN';
  return undefined;
}

function parseScaleMetric(phrase: string): ScaleMetric | undefined {
  const s = phrase.trim();
  if (/number of cards in your hand/i.test(s)) return { metric: 'HAND_COUNT', owner: 'SELF' };
  if (/amount of damage it has received/i.test(s)) return { metric: 'SELF_DAMAGE', owner: 'SELF' };
  if (/cost paid/i.test(s)) return { metric: 'PAID_COST' };
  if (/number of enemy players/i.test(s)) return { metric: 'ENEMY_PLAYER_COUNT', owner: 'ENEMY' };
  if (/number of Units rested with this effect/i.test(s)) return { metric: 'AFFECTED_COUNT' };
  if (/same number of cards you drew with this effect/i.test(s)) return { metric: 'DRAWN_COUNT' };
  if (/number of \([^)]+\) cards placed with this effect/i.test(s)) {
    return { metric: 'AFFECTED_COUNT', traits: extractAllTraits(s) };
  }
  if (/in your trash/i.test(s)) {
    const nameM = s.match(/with "([^"]+)"/i);
    return {
      metric: 'TRASH_COUNT',
      owner: 'SELF',
      ...(extractAllTraits(s).length > 0 ? { traits: extractAllTraits(s) } : {}),
      ...(nameM ? { nameContains: nameM[1] } : {}),
      ...(/unique names/i.test(s) ? { uniqueNames: true } : {}),
    };
  }
  if (/rested enemy units/i.test(s)) {
    return { metric: 'RESTED_ENEMY_UNIT_COUNT', owner: 'ENEMY', cardType: 'UNIT', rested: true };
  }
  if (/enemy units? in play/i.test(s)) {
    return { metric: 'ENEMY_UNIT_COUNT', owner: 'ENEMY', cardType: 'UNIT' };
  }
  if (/unit tokens? you have in play|friendly unit tokens? in play/i.test(s)) {
    return { metric: 'BOARD_UNIT_COUNT', owner: 'SELF', cardType: 'UNIT_TOKEN', traits: extractAllTraits(s) };
  }
  if (/units? (?:you have in play|in play)/i.test(s) || /friendly .* units?/i.test(s)) {
    return {
      metric: 'BOARD_UNIT_COUNT',
      owner: /enemy/i.test(s) ? 'ENEMY' : 'SELF',
      cardType: 'UNIT',
      traits: extractAllTraits(s),
    };
  }
  return undefined;
}

function parseLeadingWhenTrigger(rawClause: string): {
  triggerEvent: TriggerEvent;
  extraCondition?: EffectCondition;
  restBody: string;
} | null {
  // Match leading "When ..." (outside quotes/subclauses) up to the comma before the effect body
  const m = rawClause.match(/^(when\s+.+?),\s*(.+)$/i);
  if (!m) return null;
  let triggerText = m[1].trim();
  let restBody = m[2].trim();

  // Pull trailing guard condition if split like "When X, if Y, action"
  let extraCondition: EffectCondition | undefined;
  const nestedIf = restBody.match(/^((?:if|while)\s+[^,]+),\s*(.+)$/i);
  if (nestedIf && !/^if you do/i.test(nestedIf[1]) && !/^if (?:it|they|you placed|you draw|you discard|you increase)/i.test(nestedIf[1])) {
    extraCondition = parseCondition(nestedIf[1]);
    restBody = nestedIf[2].trim();
  }

  // Pull trailing "while ..." inside triggerText e.g. "When an enemy Link Unit is destroyed with damage while this Unit is attacking"
  const whileM = triggerText.match(/^(.+?)\s+(while\s+.+)$/i);
  let whileAttacking = false;
  if (whileM) {
    if (/while this unit is attacking/i.test(whileM[2])) {
      whileAttacking = true;
      triggerText = whileM[1].trim();
    } else {
      extraCondition = combineConditions(extraCondition, parseCondition(whileM[2]));
      triggerText = whileM[1].trim();
    }
  }

  let kind: EffectTiming = 'WHEN_ATTACKED';
  let actor: TriggerEvent['actor'] = 'SELF';
  let actorFilter: TargetSelector | undefined;
  let targetKind: TriggerEvent['targetKind'];
  let targetFilter: TargetSelector | undefined;
  let damageType: TriggerEvent['damageType'];

  if (/when this unit is attacked/i.test(triggerText)) {
    kind = 'WHEN_ATTACKED';
    actor = 'SELF';
  } else if (/when another unit attacks/i.test(triggerText)) {
    kind = 'ATTACK';
    actor = 'ANY';
    actorFilter = parseTargetSelector(triggerText.replace(/^when\s+/i, ''));
  } else if (/destroys? .* with (?:battle )?damage|is destroyed with (?:effect |battle )?damage/i.test(triggerText)) {
    kind = 'WHEN_DESTROY_BY_BATTLE';
    damageType = /battle damage/i.test(triggerText) ? 'BATTLE' : /effect damage/i.test(triggerText) ? 'EFFECT' : 'ANY';
    if (/^when an enemy/i.test(triggerText)) {
      actor = 'ENEMY';
      targetKind = 'UNIT';
      targetFilter = parseTargetSelector(triggerText);
    } else if (/one of your|friendly/i.test(triggerText)) {
      actor = 'FRIENDLY';
      actorFilter = parseTargetSelector(triggerText.split(/destroys?/i)[0]);
    } else {
      actor = 'SELF';
    }
    if (/enemy card/i.test(triggerText)) targetKind = 'ANY_ENEMY_CARD';
    else if (/shield area card/i.test(triggerText)) targetKind = 'SHIELD';
    else if (/enemy unit/i.test(triggerText)) {
      targetKind = 'UNIT';
      const afterDest = triggerText.split(/destroys?/i)[1];
      if (afterDest) targetFilter = parseTargetSelector(afterDest);
    }
  } else if (/deals (?:battle )?damage/i.test(triggerText)) {
    kind = 'WHEN_DEAL_DAMAGE';
    damageType = /battle damage/i.test(triggerText) ? 'BATTLE' : 'ANY';
    actor = /your .* cards/i.test(triggerText) ? 'FRIENDLY' : 'SELF';
    if (/your \([^)]+\) cards/i.test(triggerText)) actorFilter = parseTargetSelector(triggerText);
    const toPart = triggerText.split(/\bto\b/i)[1];
    if (toPart) targetFilter = parseTargetSelector(toPart);
    targetKind = 'UNIT';
  } else if (/(?:receives?|would receive) .* damage/i.test(triggerText)) {
    kind = 'WHEN_RECEIVE_DAMAGE';
    damageType = /battle damage/i.test(triggerText) ? 'BATTLE' : /effect damage/i.test(triggerText) ? 'EFFECT' : 'ANY';
    actor = /friendly|one of your/i.test(triggerText) ? 'FRIENDLY' : 'SELF';
    if (/shield/i.test(triggerText)) targetKind = 'SHIELD';
    else if (/this base/i.test(triggerText)) targetKind = 'BASE';
    else targetKind = 'UNIT';
  } else if (/recovers HP/i.test(triggerText)) {
    kind = 'WHEN_RECOVER_HP';
    actor = 'SELF';
  } else if (/is deployed/i.test(triggerText)) {
    kind = 'WHEN_UNIT_DEPLOYED';
    actor = /this unit or/i.test(triggerText) || /one of your|friendly/i.test(triggerText) ? 'FRIENDLY' : 'SELF';
    actorFilter = parseTargetSelector(triggerText);
  } else if (/pair a pilot/i.test(triggerText)) {
    kind = 'WHEN_UNIT_PAIRED';
    actor = 'FRIENDLY';
  } else if (/links\b/i.test(triggerText)) {
    kind = 'WHEN_UNIT_LINKED';
    actor = 'FRIENDLY';
    actorFilter = parseTargetSelector(triggerText);
  } else if (/is destroyed by an effect/i.test(triggerText)) {
    kind = 'WHEN_UNIT_DESTROYED';
    actor = 'FRIENDLY';
  } else if (/is rested by|would rest/i.test(triggerText)) {
    kind = 'WHEN_RESTED';
    actor = /this unit/i.test(triggerText) ? 'SELF' : 'FRIENDLY';
  } else if (/is blocked|activates\s*<Blocker>/i.test(triggerText)) {
    kind = 'WHEN_BLOCKED';
    actor = 'SELF';
  } else if (/exile[sd]? .* ex resource/i.test(triggerText)) {
    kind = 'WHEN_EXILE_EX_RESOURCE';
    actor = 'FRIENDLY';
  } else if (/place an EX Resource/i.test(triggerText)) {
    kind = 'WHEN_PLACE_EX_RESOURCE';
    actor = 'SELF';
  } else if (/play and activate .* using an EX Resource/i.test(triggerText)) {
    kind = 'WHEN_PLAY_CARD_WITH_EX_RESOURCE';
    actor = 'SELF';
    targetFilter = parseTargetSelector(triggerText);
  } else if (/activate a .* command/i.test(triggerText)) {
    kind = 'WHEN_ACTIVATE_COMMAND';
    actor = 'SELF';
    targetFilter = parseTargetSelector(triggerText);
  } else if (/pay [①②③④⑤⑥⑦⑧⑨⑩] or more/i.test(triggerText)) {
    kind = 'WHEN_PAY_EFFECT_COST';
    actor = 'FRIENDLY';
  } else if (/draw with an effect/i.test(triggerText)) {
    kind = 'WHEN_DRAW';
    actor = 'SELF';
  } else if (/AP is reduced/i.test(triggerText)) {
    kind = 'WHEN_AP_REDUCED';
    actor = 'SELF';
  } else if (/playing this card/i.test(triggerText)) {
    kind = 'WHEN_PLAYING';
    actor = 'SELF';
    if (/pairing it with/i.test(triggerText)) {
      const pairingPart = triggerText.split(/pairing it with/i)[1];
      if (pairingPart) {
        const tgt = parseTargetSelector(pairingPart);
        const linkM = pairingPart.match(/\[([^\]]+)\]\s*link condition/i);
        extraCondition = {
          kind: 'SELF_STATE',
          pairedWithUnit: {
            ...(tgt.traits ? { traits: tgt.traits } : tgt.trait ? { traits: [tgt.trait] } : {}),
            ...(tgt.nameContains ? { nameContains: tgt.nameContains } : {}),
            ...(linkM ? { linkNames: [linkM[1]] } : {}),
            ...(tgt.lvMin !== undefined ? { lvMin: tgt.lvMin } : {}),
          },
        };
      }
    }
  }

  return {
    triggerEvent: {
      kind,
      actor,
      ...(actorFilter ? { actorFilter } : {}),
      ...(targetKind ? { targetKind } : {}),
      ...(targetFilter ? { targetFilter } : {}),
      ...(damageType ? { damageType } : {}),
      ...(whileAttacking ? { whileAttacking } : {}),
      raw: triggerText,
    },
    ...(extraCondition ? { extraCondition } : {}),
    restBody,
  };
}

function parseSubClause(
  rawText: string,
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>,
  depth = 1
): EffectClause {
  return compileSingleClauseLine(rawText, card, [], [], depth);
}

function parseMultiSentenceSteps(
  text: string,
  state: {
    chosenTarget?: TargetSelector;
    steps: EffectStep[];
    residual: string[];
    card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>;
    depth?: number;
  }
) {
  const sents = splitSentencesSmart(text);
  for (const s of sents) {
    parseSentenceSteps(s, state);
  }
}

function parseSentenceSteps(
  sent: string,
  state: {
    chosenTarget?: TargetSelector;
    steps: EffectStep[];
    residual: string[];
    card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>;
    depth?: number;
  }
) {
  let s = sent.replace(/^(?:Then,?\s*|Also,?\s*|After activating this card'?s 【[^】]+】,?\s*)/i, '').trim();
  if (!s) return;
  const depth = state.depth ?? 0;

  // 1. "If you do, <rest>" / "If you placed/draw/discard/increase..., <rest>" / "If they don't discard with this effect, <rest>"
  const ifYouDoM = s.match(/^If you do,\s*(.+)$/i);
  if (ifYouDoM) {
    const sub = { chosenTarget: state.chosenTarget, steps: [] as EffectStep[], residual: [] as string[], card: state.card, depth };
    parseMultiSentenceSteps(ifYouDoM[1], sub);
    if (sub.residual.length === 0) {
      if (sub.chosenTarget) state.chosenTarget = sub.chosenTarget;
      if (sub.steps.length > 0) {
        state.steps.push({ action: 'IF_PREVIOUS_SUCCEEDED', thenSteps: sub.steps });
      }
      return;
    }
  }

  const ifFilterM = s.match(
    /^If (?:(you|they) )?(don'?t\s+)?(?:placed?|draw|discard|increase)\s*(.+?)\s*with this effect,\s*(.+)$/i
  );
  if (ifFilterM) {
    const negated = Boolean(ifFilterM[2]);
    const mid = ifFilterM[3].trim();
    const sub = { chosenTarget: state.chosenTarget, steps: [] as EffectStep[], residual: [] as string[], card: state.card, depth };
    parseMultiSentenceSteps(ifFilterM[4], sub);
    if (sub.residual.length === 0) {
      if (sub.chosenTarget) state.chosenTarget = sub.chosenTarget;
      const lvMinM = mid.match(/Lv\.(\d+)\s+or\s+higher/i);
      const traits = extractAllTraits(mid);
      const numM = mid.match(/\b(\d+)\b/);
      if (sub.steps.length > 0) {
        state.steps.push({
          action: 'IF_PREVIOUS_SUCCEEDED',
          ...(negated ? { negated: true } : {}),
          filter: {
            ...(numM && !lvMinM ? { count: parseInt(numM[1], 10) } : {}),
            ...(lvMinM ? { lvMin: parseInt(lvMinM[1], 10) } : {}),
            ...(traits.length > 0 ? { traits } : {}),
            ...( /\bdraw\b/i.test(s) ? { drawAccepted: true } : {} ),
            ...( /command/i.test(mid) ? { cardType: 'COMMAND' } : /unit/i.test(mid) ? { cardType: 'UNIT' } : {} ),
          },
          thenSteps: sub.steps,
        });
      }
      return;
    }
  }

  // 2. "gains the following effect during this turn: <sub-clause>"
  const grantFollowingM = depth < 2 ? s.match(/^(.+?)\s+gains the following effect([^:：]*)[:：]\s*(.+)$/i) : null;
  if (grantFollowingM) {
    const tgt = /^(it|they|them)$/i.test(grantFollowingM[1].trim()) && state.chosenTarget
      ? state.chosenTarget
      : parseTargetSelector(grantFollowingM[1]);
    const subClause = parseSubClause(grantFollowingM[3].trim(), state.card, depth + 1);
    if (!subClause.unparsedResidual) {
      state.steps.push({
        action: 'GRANT_CLAUSE',
        duration: parseDuration(grantFollowingM[2]) ?? 'THIS_TURN',
        target: tgt,
        clause: subClause,
      });
      return;
    }
  }

  // 3. "During this turn/battle, when/if <event>, <action>" or "When this effect destroys ..., <action>"
  const inlineSubClauseM = depth < 2
    ? s.match(
        /^(?:During this turn,\s*(?:when|if)\s+.+|During this battle,\s*when\s+.+|When (?:it|this effect) (?:destroys|deals)\s+.+|At the end of (?:the|a) turn\s+(?:when|where)\s+.+)$/i
      )
    : null;
  if (inlineSubClauseM) {
    const dur = parseDuration(s) ?? 'THIS_TURN';
    const strippedDur = s.replace(/^(?:During this turn|During this battle),\s*/i, '');
    if (strippedDur !== s || /^At the end of (?:the|a) turn\s+(?:when|where)\s+/i.test(s) || /^When (?:it|this effect) (?:destroys|deals)\s+/i.test(s)) {
      const subClause = parseSubClause(strippedDur, state.card, depth + 1);
      if (!subClause.unparsedResidual) {
        state.steps.push({
          action: 'GRANT_CLAUSE',
          duration: dur,
          target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
          clause: subClause,
        });
        return;
      }
    }
  }

  // 4. Mid-clause conditional "If it is <top-deck filter>, ..." or "If <cond>, <body ...> instead" or "If <cond>, <steps>"
  const ifTopMatchM = s.match(/^If it is (.+?),\s*(?:you|they) may reveal (?:it|them) and add (?:it|them) to (?:your|their) hand\.?$/i);
  if (ifTopMatchM) {
    const filterTxt = ifTopMatchM[1].trim();
    const traits = extractAllTraits(filterTxt);
    const lvMinM = filterTxt.match(/Lv\.(\d+)\s+or\s+higher/i);
    const isUnit = /\bunit card\b/i.test(filterTxt);
    state.steps.push({
      action: 'IF_PREVIOUS_SUCCEEDED',
      filter: {
        ...(lvMinM ? { lvMin: parseInt(lvMinM[1], 10) } : {}),
        ...(traits.length > 0 ? { traits } : {}),
        ...(isUnit ? { cardType: 'UNIT' } : {}),
        placedFromDeck: true,
      },
      thenSteps: [
        {
          action: 'LOOK_TOP',
          count: 1,
          revealSearch: true,
          target: parseTargetSelector(filterTxt),
        },
      ],
    });
    return;
  }

  const midCondM = s.match(/^(If\s+[^,]+),\s*(.+)$/i);
  if (midCondM) {
    const cond = parseCondition(midCondM[1]);
    const restText = midCondM[2].trim();
    const isInstead = /\binstead\b/i.test(restText);
    const cleanedRest = restText.replace(/\s+instead\.?$/i, '').replace(/\.$/, '').trim();

    if (cond.kind !== 'RAW_CONDITION') {
      const sub = { chosenTarget: state.chosenTarget, steps: [] as EffectStep[], residual: [] as string[], card: state.card, depth };
      if (/^AP\s*([+-]\d+)$/i.test(cleanedRest)) {
        const d = parseInt(cleanedRest.match(/([+-]\d+)/)![1], 10);
        sub.steps.push({
          action: 'MODIFY_AP',
          delta: d,
          duration: 'THIS_TURN',
          target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
        });
      } else if (/^reduce by (\d+)$/i.test(cleanedRest)) {
        const amt = parseInt(cleanedRest.match(/(\d+)/)![1], 10);
        sub.steps.push({
          action: 'DAMAGE_PROOF',
          amount: amt,
          summary: cleanedRest,
          target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
        });
      } else if (/^deal (\d+) damage$/i.test(cleanedRest)) {
        const amt = parseInt(cleanedRest.match(/(\d+)/)![1], 10);
        sub.steps.push({
          action: 'DEAL_DAMAGE',
          amount: amt,
          target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
        });
      } else if (/^(?:you may\s+)?deploy it as an \(AP(\d+)[･・]HP(\d+)\) Unit$/i.test(cleanedRest)) {
        const mTok = cleanedRest.match(/AP(\d+)[･・]HP(\d+)/i)!;
        sub.steps.push({
          action: 'DEPLOY_TOKEN',
          count: 1,
          ap: parseInt(mTok[1], 10),
          hp: parseInt(mTok[2], 10),
        });
      } else if (/^add the card to your hand instead of returning it to your deck\.?$/i.test(restText)) {
        sub.steps.push({
          action: 'LOOK_TOP',
          count: 1,
          revealSearch: true,
        });
      } else {
        parseMultiSentenceSteps(cleanedRest, sub);
        if (sub.chosenTarget && sub.steps.length === 0) {
          const prev = state.steps[state.steps.length - 1];
          if (prev && 'target' in prev) {
            sub.steps.push({ ...prev, target: sub.chosenTarget } as EffectStep);
          } else {
            sub.steps.push({ action: 'DESTROY', target: sub.chosenTarget });
          }
        }
      }

      if (sub.residual.length === 0 && sub.steps.length > 0) {
        if (sub.chosenTarget) state.chosenTarget = sub.chosenTarget;
        state.steps.push({
          action: 'IF_CONDITION',
          condition: cond,
          thenSteps: sub.steps,
          ...(isInstead ? { replacesPrevious: true } : {}),
        });
        return;
      }
    }
  }

  // Strip optional "You may"
  let optional = false;
  const mayM = s.match(/^(?:you|they) may\s+(.+)$/i);
  if (mayM) {
    optional = true;
    s = mayM[1].trim();
  }

  // 5. Pilot mode token "[Lowe Guele]" leftover from 【Pilot】[Lowe Guele]
  if (/^\[([^\]]+)\]$/.test(s)) {
    const inner = s.slice(1, -1).trim();
    const kw = parseKeywordToken(inner);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      });
    } else {
      state.steps.push({ action: 'GRANT_PILOT_MODE', pilotName: inner });
    }
    return;
  }

  // 6. Name alias: "This card's name is also treated as [Char Aznable]."
  const aliasM = s.match(/^This card'?s name is also treated as \[([^\]]+)\]\.?$/i);
  if (aliasM) {
    state.steps.push({ action: 'NAME_ALIAS', alias: aliasM[1].trim() });
    return;
  }

  // 7. Standard self/activation steps
  if (/^add this card to your hand\.?$/i.test(s)) {
    state.steps.push({ action: 'ADD_SELF_TO_HAND' });
    return;
  }
  if (/^deploy this card\.?$/i.test(s)) {
    state.steps.push({ action: 'DEPLOY_SELF' });
    return;
  }
  if (/^activate (?:this card'?s |its )?【(?:Main|Action)】/i.test(s) || /^activate 【(?:Main|Action)】 on /i.test(s)) {
    state.steps.push({ action: 'ACTIVATE_MAIN_EFFECT', ...(state.chosenTarget ? { target: state.chosenTarget } : {}) });
    return;
  }

  // 8. "Pay ①/②"
  const payM = s.match(/^pay ([①②③④⑤⑥⑦⑧⑨⑩])\.?$/i);
  if (payM) {
    state.steps.push({ action: 'PAY_RESOURCE', amount: CIRCLED_NUMS[payM[1]] ?? 1, ...(optional ? { optional: true } : {}) });
    return;
  }

  // 9. "Choose <target> and add it to your hand." or "Choose <target>." (without inline verb)
  const chooseAndAddM = s.match(/^choose (.+?) and add (?:it|them) to your hand\.?$/i);
  if (chooseAndAddM) {
    const sel = parseTargetSelector(chooseAndAddM[1]);
    state.steps.push({ action: sel.zone === 'TRASH' ? 'ADD_FROM_TRASH_TO_HAND' : 'LOOK_TOP', ...(sel.zone === 'TRASH' ? { target: sel } : { count: 1, revealSearch: true, target: sel }) } as EffectStep);
    return;
  }

  const chooseOnly = s.match(/^(?:all enemy players each |all players each |you and that player each |that player )?chooses? (.+?)\.?$/i);
  if (chooseOnly && !/\b(destroy|deal|rest|set|return|deploy|add|recover|gains?|gets?|as their attack target)\b/i.test(chooseOnly[1])) {
    const sel = parseTargetSelector(chooseOnly[1]);
    if (/^all enemy players/i.test(s)) sel.owner = 'ENEMY';
    state.chosenTarget = sel;
    return;
  }

  const resolveTarget = (phrase: string): TargetSelector => {
    const p = phrase.trim();
    if (/^(it|they|them|that unit|that enemy unit|that card|those units|that unit\/base)$/i.test(p) && state.chosenTarget) {
      return state.chosenTarget;
    }
    if (/^this unit$/i.test(p)) return { owner: 'SELF', self: true, cardType: 'UNIT' };
    return parseTargetSelector(p);
  };

  // 10. Draw / Discard
  const drawScaleM = s.match(/^draw a number of cards equal to (.+?)\.?$/i);
  if (drawScaleM) {
    state.steps.push({
      action: 'DRAW',
      count: 1,
      scaleBy: parseScaleMetric(drawScaleM[1]),
      ...(optional ? { optional: true } : {}),
    });
    return;
  }
  const drawM = s.match(/^(?:(you and .*?|all players|they) )?draw (\d+)(?: cards?)?\.?$/i);
  if (drawM) {
    const who = drawM[1]?.toLowerCase() ?? '';
    state.steps.push({
      action: 'DRAW',
      count: parseInt(drawM[2], 10),
      bothPlayers: /you and|all players/.test(who),
      ...(who.includes('all players') ? { targetOwner: 'ALL_PLAYERS' as const } : who === 'they' ? { targetOwner: 'ENEMY' as const } : {}),
      ...(optional ? { optional: true } : {}),
    });
    return;
  }

  const discScaleM = s.match(/^discard the same number of cards you drew with this effect\.?$/i);
  if (discScaleM) {
    state.steps.push({ action: 'DISCARD', count: 1, scaleBy: { metric: 'DRAWN_COUNT' } });
    return;
  }
  const discM = s.match(/^(?:(they|that enemy player|that player|all players)\s+)?(?:may\s+)?discards?\s+(?:(\d+)|(.+?))(?:\s+cards?)?\.?$/i);
  if (discM) {
    const who = discM[1]?.toLowerCase() ?? '';
    const n = discM[2] ? parseInt(discM[2], 10) : 1;
    const isMay = /\bmay\b/i.test(s);
    state.steps.push({
      action: 'DISCARD',
      count: n,
      ...(who ? { targetOwner: who === 'all players' ? 'ALL_PLAYERS' : 'ENEMY' } : {}),
      ...(discM[3] ? { target: parseTargetSelector(discM[3]) } : {}),
      ...(optional || isMay ? { optional: true } : {}),
    });
    return;
  }

  // 11. Look at top N / Reveal from hand / Reveal top N
  const lookM = s.match(/^(?:all players each )?look at the top (\d+|) ?cards? of (?:your|their) deck/i);
  if (lookM) {
    const count = lookM[1] ? parseInt(lookM[1], 10) : 1;
    const traits = extractAllTraits(s);
    const revTargetM = s.match(/reveal (.+?) among them/i);
    state.steps.push({
      action: 'LOOK_TOP',
      count,
      revealSearch: /reveal|add|deploy/i.test(s),
      trashRest: /into your trash/i.test(s),
      ...(traits[0] ? { trait: traits[0] } : {}),
      ...(revTargetM ? { target: parseTargetSelector(revTargetM[1]) } : {}),
      ...( /bottom of your deck/i.test(s) ? { remainderPosition: 'BOTTOM' as const } : /top or bottom/i.test(s) ? { remainderPosition: 'TOP' as const } : {}),
    });
    return;
  }
  const revTopM = s.match(/^reveal the top (\d+) cards? of your deck/i);
  if (revTopM) {
    state.steps.push({ action: 'REVEAL_TOP', count: parseInt(revTopM[1], 10) });
    return;
  }
  const revHandM = s.match(/^reveal (.+?from your hand)\.?$/i);
  if (revHandM) {
    state.steps.push({ action: 'REVEAL_FROM_HAND', target: parseTargetSelector(revHandM[1]) });
    return;
  }

  // 12. Shields
  if (/add (\d+) of your shields to your hand/i.test(s)) {
    const m = s.match(/add (\d+)/i);
    state.steps.push({ action: 'ADD_SHIELD_TO_HAND', count: m ? parseInt(m[1], 10) : 1 });
    return;
  }

  // 13. Deploy from trash / hand / deck / among them / token / EX Base
  if (/^pay its cost to deploy it\.?$/i.test(s) && state.chosenTarget) {
    state.steps.push({ action: 'DEPLOY_FROM_TRASH', free: false, target: state.chosenTarget });
    return;
  }
  if (/^deploy (it|them)(?: rested)?\.?$/i.test(s) && state.chosenTarget) {
    state.steps.push({
      action: state.chosenTarget.zone === 'TRASH' ? 'DEPLOY_FROM_TRASH' : 'DEPLOY_TOKEN',
      free: true,
      rested: /rested/i.test(s),
      target: state.chosenTarget,
    } as EffectStep);
    return;
  }
  const deployHandM = s.match(/^deploy (.+?from your hand)\.?$/i);
  if (deployHandM) {
    state.steps.push({ action: 'DEPLOY_FROM_HAND', free: true, target: parseTargetSelector(deployHandM[1]) });
    return;
  }
  const deployAmongM = s.match(/^deploy (.+?among them)\.?$/i);
  if (deployAmongM) {
    state.steps.push({ action: 'DEPLOY_FROM_TOP_DECK', target: parseTargetSelector(deployAmongM[1]) });
    return;
  }
  if (/^deploy 1 EX Base\.?$/i.test(s)) {
    state.steps.push({ action: 'DEPLOY_TOKEN', count: 1, ap: 0, hp: 3, name: 'EX Base', baseToken: true, exBase: true });
    return;
  }
  const tokM = s.match(/(?:the destroyed unit'?s owner\s+)?deploys? (\d+) .*?\b(unit|base) tokens?\b/i);
  if (tokM) {
    const apM2 = s.match(/AP(\d+)/i);
    const hpM2 = s.match(/HP(\d+)/i);
    const nameM = s.match(/\[([^\]]+)\]/);
    const traits = extractAllTraits(s);
    state.steps.push({
      action: 'DEPLOY_TOKEN',
      count: parseInt(tokM[1], 10),
      ap: apM2 ? parseInt(apM2[1], 10) : tokM[2].toLowerCase() === 'base' ? 0 : 2,
      hp: hpM2 ? parseInt(hpM2[1], 10) : tokM[2].toLowerCase() === 'base' ? 5 : 2,
      ...(nameM ? { name: nameM[1] } : {}),
      ...(traits.length > 0 ? { traits } : {}),
      ...(tokM[2].toLowerCase() === 'base' ? { baseToken: true } : {}),
      ...(/destroyed unit'?s owner/i.test(s) ? { owner: 'DESTROYED_OWNER' as const } : {}),
    });
    return;
  }

  // 14. Pair from hand / trash
  const pairHandM = s.match(/^pair (.+?) with (.+?)\.?$/i);
  if (pairHandM) {
    const pilotSel = /^(it|that card)$/i.test(pairHandM[1].trim())
      ? { owner: 'SELF' as const, cardType: 'COMMAND' as const, zone: 'TRASH' as const }
      : parseTargetSelector(pairHandM[1]);
    const unitSel = parseTargetSelector(pairHandM[2]);
    if (/from your trash/i.test(s)) {
      state.steps.push({ action: 'PAIR_SELF_FROM_TRASH', target: { ...unitSel, owner: 'SELF', cardType: 'UNIT', zone: 'BATTLE_AREA' } });
    } else {
      state.steps.push({ action: 'PAIR_FROM_HAND', pilotFilter: pilotSel, target: unitSel });
    }
    return;
  }

  // 15. Add to hand from trash / deck
  const addTrashM = s.match(/^add (.+?from your trash) to your hand\.?$/i);
  if (addTrashM) {
    state.steps.push({ action: 'ADD_FROM_TRASH_TO_HAND', target: parseTargetSelector(addTrashM[1]) });
    return;
  }
  const addFromDeckM = s.match(/^add (.+?placed from your deck with this effect) to your hand\.?$/i);
  if (addFromDeckM) {
    state.steps.push({ action: 'LOOK_TOP', count: 1, revealSearch: true, target: parseTargetSelector(addFromDeckM[1]) });
    return;
  }
  if (/^add (it|them) (?:from your trash )?to your hand\.?$/i.test(s)) {
    if (state.chosenTarget?.zone === 'TRASH' || /from your trash/i.test(s)) {
      state.steps.push({ action: 'ADD_FROM_TRASH_TO_HAND', target: state.chosenTarget ?? { owner: 'SELF', cardType: 'CARD', zone: 'TRASH', count: 1 } });
    } else {
      state.steps.push({ action: 'LOOK_TOP', count: 1, revealSearch: true });
    }
    return;
  }

  // 16. Destroy / Deal damage
  const destM = s.match(/^destroy (.+?)(?: if .+)?\.?$/i);
  if (destM) {
    state.steps.push({ action: 'DESTROY', target: resolveTarget(destM[1]) });
    return;
  }
  const dmgScaleM = s.match(/^deal (?:an amount of )?damage (?:to (.+?) )?equal to (.+?)(?: to (.+?))?\.?$/i);
  if (dmgScaleM && (dmgScaleM[1] || dmgScaleM[3])) {
    state.steps.push({
      action: 'DEAL_DAMAGE',
      amount: 1,
      scaleBy: parseScaleMetric(dmgScaleM[2]),
      target: resolveTarget(dmgScaleM[3] ?? dmgScaleM[1]),
    });
    return;
  }
  const dmgM = s.match(/^deal (\d+) damage to (.+?)\.?$/i);
  if (dmgM) {
    state.steps.push({ action: 'DEAL_DAMAGE', amount: parseInt(dmgM[1], 10), target: resolveTarget(dmgM[2]) });
    return;
  }

  // 17. Modify AP / HP (fixed & scaling) & Grant Keyword (fixed & scaling) & Grant Trait
  const apScaleM = s.match(/^(?:during [^,]+,\s*)?(increase|reduce)\s+(.+?)'?s?\s+AP\s+(?:during [^ ]+ [^ ]+\s+)?by an amount equal to (.+?)(?:\s+(during this turn|during this battle))?\.?$/i);
  if (apScaleM) {
    const sign = apScaleM[1].toLowerCase() === 'increase' ? 1 : -1;
    const dur = parseDuration(s);
    state.steps.push({
      action: 'MODIFY_AP',
      delta: sign,
      scaleBy: parseScaleMetric(apScaleM[3]),
      ...(dur ? { duration: dur } : {}),
      target: resolveTarget(apScaleM[2].replace(/'s?$/, '')),
    });
    return;
  }
  const apM = s.match(/^(.+?)\s+gets?\s+AP\s*([+-]\d+)(.*)$/i);
  if (apM) {
    state.steps.push({
      action: 'MODIFY_AP',
      delta: parseInt(apM[2], 10),
      duration: parseDuration(apM[3]),
      target: resolveTarget(apM[1]),
    });
    return;
  }
  const hpM = s.match(/^(.+?)\s+gets?\s+HP\s*([+-]\d+)(.*)$/i);
  if (hpM) {
    state.steps.push({
      action: 'MODIFY_HP',
      delta: parseInt(hpM[2], 10),
      duration: parseDuration(hpM[3]),
      target: resolveTarget(hpM[1]),
    });
    return;
  }
  const kwScaleM = s.match(/^(?:during [^,]+,\s*)?(.+?)\s+gains the same number of\s*<([^>]+)>\s+as (.+?)\.?$/i);
  if (kwScaleM) {
    const kw = parseKeywordToken(kwScaleM[2]);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        scaleBy: parseScaleMetric(kwScaleM[3]),
        duration: parseDuration(s),
        target: resolveTarget(kwScaleM[1]),
      });
      return;
    }
  }
  const kwGrantM = s.match(/^(.+?)\s+(?:gains?|gets?)\s*<([^>]+)>(.*)$/i);
  if (kwGrantM) {
    const kw = parseKeywordToken(kwGrantM[2]);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        duration: parseDuration(kwGrantM[3]),
        target: resolveTarget(kwGrantM[1]),
      });
      return;
    }
  }
  const traitGrantM = s.match(/^(.+?)\s+gains?\s+(\([^)]+\))\.?$/i);
  if (traitGrantM) {
    state.steps.push({
      action: 'GRANT_TRAIT',
      traits: extractAllTraits(traitGrantM[2]),
      target: resolveTarget(traitGrantM[1]),
    });
    return;
  }

  // 18. Recover HP
  const recM = s.match(/^(.+?)\s+recovers?\s+(\d+)\s+HP\.?$/i);
  if (recM) {
    state.steps.push({
      action: 'RECOVER_HP',
      amount: parseInt(recM[2], 10),
      target: resolveTarget(recM[1]),
    });
    return;
  }

  // 19. Rest / Set active / Freeze / Return to hand or deck / Exile
  const restM = s.match(/^rest (.+?)\.?$/i);
  if (restM) {
    state.steps.push({ action: 'REST', target: resolveTarget(restM[1]) });
    return;
  }
  const actM = s.match(/^set (.+?) as active\.?$/i);
  if (actM) {
    state.steps.push({ action: 'SET_ACTIVE', target: resolveTarget(actM[1]) });
    return;
  }
  if (/won'\s*t be set as active/i.test(s)) {
    state.steps.push({ action: 'FREEZE', target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 } });
    return;
  }
  const retHandM = s.match(/^return (.+?) to (?:its|their|your) (?:owners?'?s?\s*)?hands?\.?$/i);
  if (retHandM) {
    state.steps.push({ action: 'BOUNCE', target: resolveTarget(retHandM[1]) });
    return;
  }
  const retDeckM = s.match(/^(?:they\s+)?return (?:it|them|any remaining card|(.+?)) to (?:(?:the (top|bottom|top or bottom) of )?(?:its|your|their) (?:owners?'?s? )?deck(?: and shuffle it)?|the top of your deck or place (?:it|them) into your trash)\.?$/i);
  if (retDeckM) {
    const tgt = retDeckM[1] ? resolveTarget(retDeckM[1]) : state.chosenTarget ?? { owner: 'SELF', cardType: 'CARD', zone: 'DECK', count: 1 };
    const pos = retDeckM[2]?.toUpperCase().includes('BOTTOM') ? 'BOTTOM' : 'TOP';
    state.steps.push({
      action: 'RETURN_TO_DECK',
      position: /shuffle/i.test(s) ? 'SHUFFLE' : pos,
      ...( /shuffle/i.test(s) ? { shuffle: true } : {} ),
      target: tgt,
    });
    return;
  }
  if (/reveal .+? among them and (?:add (?:it|them) to your hand|return (?:it|them) to the top of your deck)/i.test(s)) {
    const traits = extractAllTraits(s);
    state.steps.push({
      action: 'LOOK_TOP',
      count: 1,
      revealSearch: true,
      ...(traits[0] ? { trait: traits[0] } : {}),
      ...( /return .* top/i.test(s) ? { remainderPosition: 'TOP' as const } : {} ),
    });
    return;
  }
  const exileM = s.match(/^exile (.+?) from the game\.?$/i);
  if (exileM) {
    state.steps.push({ action: 'EXILE', target: resolveTarget(exileM[1]) });
    return;
  }

  // 20. Resource ramp & Cost / Lv reduction
  const resM = s.match(/place (\d+) (?:rested |active )?(EX )?resources?/i);
  if (resM) {
    state.steps.push({
      action: 'ADD_RESOURCE',
      count: parseInt(resM[1], 10),
      ex: Boolean(resM[2]),
      rested: /rested/i.test(s),
    });
    return;
  }
  const costRedHandM = s.match(/this card in your (hand|trash) gets Lv\.\s*-(\d+) and cost\s*-(\d+)(?:\s+for each (.+))?/i);
  if (costRedHandM) {
    state.steps.push({
      action: 'COST_REDUCTION',
      lvDelta: -parseInt(costRedHandM[2], 10),
      amount: parseInt(costRedHandM[3], 10),
      zone: costRedHandM[1].toUpperCase() as 'HAND' | 'TRASH',
      ...(costRedHandM[4] ? { perTarget: parseScaleMetric(costRedHandM[4]) } : {}),
    });
    return;
  }
  const playAsM = s.match(/play (?:this card|it) as if it has (\d+) (?:Lv\. and cost|cost)/i);
  if (playAsM) {
    const n = parseInt(playAsM[1], 10);
    state.steps.push({
      action: 'COST_REDUCTION',
      amount: 0,
      exactCost: n,
      ...( /Lv\. and cost/i.test(s) ? { exactLv: n } : {} ),
    });
    return;
  }
  const costRedM = s.match(/(?:reduce the cost|gets? cost\s*-(\d+)|it gets cost\s*-(\d+))/i);
  if (costRedM) {
    state.steps.push({ action: 'COST_REDUCTION', amount: parseInt(costRedM[1] ?? costRedM[2] ?? '1', 10) });
    return;
  }

  // 21. Battle damage redirection, damage dealt modifier, damage proof
  const redirDmgM = s.match(/^(?:during [^,]+,\s*)?battle damage (.+?) would receive is dealt to (.+?) instead\.?$/i);
  if (redirDmgM) {
    state.steps.push({
      action: 'REDIRECT_BATTLE_DAMAGE',
      fromTarget: resolveTarget(redirDmgM[1]),
      toTarget: resolveTarget(redirDmgM[2]),
      duration: parseDuration(s),
    });
    return;
  }
  const modDmgDealtM = s.match(/^increase the damage dealt by (\d+)\.?$/i);
  if (modDmgDealtM) {
    state.steps.push({ action: 'MODIFY_DAMAGE_DEALT', delta: parseInt(modDmgDealtM[1], 10) });
    return;
  }
  if (/reduce (?:it|the next damage.*|.*damage.*) by (\d+)|doesn't receive that damage|take no damage|can'?t receive (?:battle |effect |\d+ or less )?.*damage|cannot be damaged|cannot be destroyed|can'?t be destroyed|cannot be chosen|can'?t activate <Blocker>|change .* attack target|AP can'?t be reduced/i.test(s)) {
    const amtM = s.match(/reduce (?:it|the next damage.*|.*damage.*) by (\d+)/i);
    const maxDmgM = s.match(/(\d+) or less enemy (?:effect |battle )?damage/i);
    state.steps.push({
      action: 'DAMAGE_PROOF',
      summary: s,
      ...(amtM ? { amount: parseInt(amtM[1], 10) } : {}),
      ...(maxDmgM ? { maxDamage: parseInt(maxDmgM[1], 10) } : {}),
      damageType: /battle damage/i.test(s) ? 'BATTLE' : /effect damage/i.test(s) ? 'EFFECT' : 'ANY',
      duration: parseDuration(s),
      ...(state.chosenTarget ? { target: state.chosenTarget } : {}),
    });
    return;
  }

  // 22. Forced battle damage step
  const battleStepBetweenM = s.match(/^begin a battle between them and only perform the damage step\.?$/i);
  if (battleStepBetweenM) {
    state.steps.push({
      action: 'FORCE_BATTLE_DAMAGE_STEP',
      attacker: { owner: 'SELF', cardType: 'UNIT', count: 1 },
      defender: { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
    });
    return;
  }
  const battleStepM = s.match(/begin a battle between (.+?) and (.+?) and only perform the damage step/i);
  if (battleStepM) {
    state.steps.push({
      action: 'FORCE_BATTLE_DAMAGE_STEP',
      attacker: resolveTarget(battleStepM[1]),
      defender: resolveTarget(battleStepM[2]),
    });
    return;
  }

  // 23. Attack target redirection & restrictions
  const mustAtkM = s.match(/^(?:during [^,]+,\s*)?(all )?(enemy units.*) (?:must )?choose (.+?) as their attack target(?:\s+if possible)?(?:\s+when attacking)?\.?$/i);
  if (mustAtkM) {
    state.steps.push({
      action: 'REDIRECT_ATTACK_TARGET',
      rule: 'MUST_ATTACK_TARGET',
      attackerFilter: parseTargetSelector(`${mustAtkM[1] ?? ''}${mustAtkM[2]}`),
      target: resolveTarget(mustAtkM[3]),
      duration: parseDuration(s),
    });
    return;
  }
  const cantChooseAtkM = s.match(/enemy units can'?t choose (.+?) as their attack target/i);
  if (cantChooseAtkM) {
    state.steps.push({
      action: 'REDIRECT_ATTACK_TARGET',
      rule: 'CANT_CHOOSE_TARGET',
      target: resolveTarget(cantChooseAtkM[1]),
      duration: parseDuration(s),
    });
    return;
  }
  if (/can'?t choose the same enemy player/i.test(s)) {
    state.steps.push({
      action: 'REDIRECT_ATTACK_TARGET',
      rule: 'CANT_CHOOSE_SAME_PLAYER',
      target: { owner: 'ENEMY', cardType: 'CARD', count: 1 },
      duration: parseDuration(s),
    });
    return;
  }
  if (/can'?t be paired with a pilot or attack/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    state.steps.push({ action: 'CANT_ATTACK', target: { owner: 'SELF', self: true, cardType: 'UNIT' } });
    return;
  }
  if (/can'?t be set as active or paired with a pilot/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_SET_ACTIVE', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return;
  }
  if (/can'?t be paired with a pilot/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return;
  }
  if (/can'?t be set as active by enemy effects/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_SET_ACTIVE', target: { owner: 'ENEMY', cardType: 'UNIT', count: 'ALL' }, summary: s });
    return;
  }
  if (/may attack on the turn it is deployed/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CAN_ATTACK_TURN_DEPLOYED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return;
  }
  if (/can only attack during a turn when/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'ONLY_ATTACK_WHEN_DEPLOYED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return;
  }
  if (/are deployed rested/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'DEPLOYED_RESTED', target: parseTargetSelector(s), summary: s });
    return;
  }
  if (/rest this base instead/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'INSTEAD_REST_TARGET', target: { owner: 'SELF', self: true, cardType: 'BASE' }, summary: s });
    return;
  }

  // 24. Can't attack / Allow attacking active units / Pair from trash
  if (/can'?t attack|can'?t choose the enemy player as its attack target/i.test(s)) {
    state.steps.push({
      action: 'CANT_ATTACK',
      duration: parseDuration(s),
      target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
    });
    return;
  }
  if (/may choose (?:an? )?(?:damaged )?(?:active|rested) enemy unit/i.test(s)) {
    state.steps.push({
      action: 'ALLOW_ATTACK_ACTIVE',
      target: state.chosenTarget?.owner === 'SELF' ? state.chosenTarget : parseTargetSelector(s),
    });
    return;
  }
  if (/pair this card from your trash/i.test(s)) {
    const sel = parseTargetSelector(s);
    state.steps.push({
      action: 'PAIR_SELF_FROM_TRASH',
      target: { ...sel, owner: 'SELF', cardType: 'UNIT', zone: 'BATTLE_AREA' },
    });
    return;
  }

  // 25. Count units
  const countUnitsM = s.match(/^count up the number of (.+?)(?:, plus this unit)?\.?$/i);
  if (countUnitsM) {
    state.steps.push({
      action: 'COUNT_UNITS',
      target: parseTargetSelector(countUnitsM[1]),
      ...( /plus this unit/i.test(s) ? { plusSelf: true } : {} ),
    });
    return;
  }

  // 26. Trash / mill
  if (/place (?:the top |the remaining )?(?:\d+ )?cards?.*into your trash/i.test(s)) {
    const m = s.match(/(\d+)/);
    state.steps.push({ action: 'MILL', count: m ? parseInt(m[1], 10) : 1 });
    return;
  }

  // 27. Compound "Choose X and <action>" or "A and B"
  if (/\bChoose\b/i.test(s) && /\.\s*/.test(s) === false) {
    const parts = s.split(/\s+and\s+/i);
    if (parts.length > 1) {
      for (const p of parts) parseSentenceSteps(p, state);
      return;
    }
  }

  // 28. Trailing comma lead-in (e.g. "If this effect ...") fallback strip ONLY for already-typed events
  const mIfThen = s.match(/^(?:If this effect [^,]+|On the turn [^,]+),\s*(.+)$/i);
  if (mIfThen) {
    parseSentenceSteps(mIfThen[1], state);
    return;
  }

  state.residual.push(sent);
}

function buildLinkRequirement(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>,
  timings: EffectTiming[],
  extraAliases: string[],
  pilotModeNames: string[]
): LinkRequirement | undefined {
  if (!timings.includes('WHEN_LINKED') && !timings.includes('DURING_LINK')) return undefined;

  if (card.type === 'UNIT' && card.link) {
    const names = [...card.link.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
    const traits = extractAllTraits(card.link);
    return {
      role: 'UNIT_REQUIRES_PILOT',
      names,
      traits,
      raw: card.link,
    };
  }

  if (card.type === 'PILOT' || pilotModeNames.length > 0) {
    const names = [...new Set([
      ...(card.type === 'PILOT' ? [card.name] : []),
      ...pilotModeNames,
      ...extraAliases,
    ])];
    return {
      role: 'PILOT_MATCHING_UNIT',
      names,
      traits: card.traits ?? [],
      raw: names.map((n) => `[${n}]`).join(' / ') || card.traits.map((t) => `(${t})`).join(' / '),
    };
  }

  return undefined;
}

function splitSentencesSmart(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    buf += ch;
    if (!inQuotes && ch === '.') {
      const next = text[i + 1];
      const remAfter = text.slice(i + 1).trimStart();
      const isLvAbbrev = /\bLv\.$/.test(buf) && !/^(?:Deal|Destroy|Return|Draw|Rest|Set|Choose|It|They)\b/.test(remAfter);
      if (!isLvAbbrev && (next === undefined || /\s/.test(next))) {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
  }
  const rem = buf.trim();
  if (rem) out.push(rem);
  return out;
}

function compileSingleClauseLine(
  line: string,
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>,
  extraAliases: string[] = [],
  pilotModeNames: string[] = [],
  depth = 0
): EffectClause {
  let rest = line.trim();
  const timings = new Set<EffectTiming>();
  const meta: { oncePerTurn: boolean; pairFilter?: EffectClause['pairFilter']; devCost?: number; isPilotTag?: boolean } = {
    oncePerTurn: false,
  };

  // 1. Leading 【...】 headers
  while (true) {
    const m = rest.match(/^(?:\/\s*)?(【[^】]+】)\s*/);
    if (!m) break;
    parseHeaderTag(m[1], timings, meta);
    rest = rest.slice(m[0].length).trim();
  }

  // 2. Leading innate <Keyword> or [Keyword] tokens
  const lineKeywords: KeywordAbility[] = [];
  while (true) {
    const m = rest.match(/^(?:<([^>]+)>|\[([^\]]+)\])\s*/);
    if (!m) break;
    const kw = parseKeywordToken(m[1] ?? m[2]);
    if (!kw) break;
    lineKeywords.push(kw);
    rest = rest.slice(m[0].length).trim();
  }

  if (!rest) {
    const tList = [...timings];
    return {
      raw: line,
      timings: tList.length > 0 ? tList : ['CONTINUOUS'],
      oncePerTurn: meta.oncePerTurn,
      pairFilter: meta.pairFilter,
      linkRequirement: buildLinkRequirement(card, tList, extraAliases, pilotModeNames),
      steps: lineKeywords.map((kw) => ({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      })),
      unparsedResidual: '',
    };
  }

  // 3. Optional activation cost on fullwidth ： or ASCII : (only for actual cost prefixes, not "following effect:")
  let cost: ActivationCost | undefined;
  const costSepMatch = rest.match(/^([^:：\n]{1,65}?)[：:]\s*(.+)$/);
  if (
    costSepMatch &&
    !/following effect$/i.test(costSepMatch[1].trim()) &&
    (/[①②③④⑤⑥⑦⑧⑨⑩]|\brest this\b|\bdestroy this\b|\bdiscard\b|\bexile\b|\breturn this\b/i.test(costSepMatch[1]))
  ) {
    cost = parseCost(costSepMatch[1].trim());
    rest = costSepMatch[2].trim();
  }

  // 4. Development condition block
  let condition: EffectCondition | undefined;
  const devBody = rest.match(/^You may exile the specified number of .*?activate the following effect:\s*(.+)$/i);
  if (devBody) {
    condition = { kind: 'DEVELOPMENT_EXILE', count: meta.devCost ?? 1 };
    rest = devBody[1].trim();
  }

  // 5. Timing & turn-guard headers before the main sentence
  let triggerEvent: TriggerEvent | undefined;

  const endTurnCondM = rest.match(/^At the end of (?:your|the|a) turn\s+(?:when|where)\s+([^,]+),\s*(.+)$/i);
  if (endTurnCondM) {
    timings.add('END_OF_TURN');
    condition = combineConditions(condition, parseCondition(endTurnCondM[1]));
    rest = endTurnCondM[2].trim();
  } else if (/^At the end of (?:your|the|a) turn,\s*/i.test(rest)) {
    timings.add('END_OF_TURN');
    rest = rest.replace(/^At the end of (?:your|the|a) turn,\s*/i, '');
  } else if (/^At the start of your opponent'?s turn,\s*/i.test(rest)) {
    timings.add('START_OF_OPPONENT_TURN');
    rest = rest.replace(/^At the start of your opponent'?s turn,\s*/i, '');
  } else if (/^During your turn,\s*/i.test(rest)) {
    condition = combineConditions(condition, { kind: 'IS_YOUR_TURN' });
    rest = rest.replace(/^During your turn,\s*/i, '');
  } else if (/^During your opponent'?s turn,\s*/i.test(rest)) {
    condition = combineConditions(condition, { kind: 'IS_OPPONENT_TURN' });
    rest = rest.replace(/^During your opponent'?s turn,\s*/i, '');
  }

  // Check if rest starts with "When ..." (prose trigger)
  const leadingWhen = parseLeadingWhenTrigger(rest);
  if (leadingWhen) {
    triggerEvent = leadingWhen.triggerEvent;
    timings.add(triggerEvent.kind);
    if (leadingWhen.extraCondition) {
      condition = combineConditions(condition, leadingWhen.extraCondition);
    }
    rest = leadingWhen.restBody;
  } else if (/^When playing this card(?: from your hand)?,\s*/i.test(rest)) {
    timings.add('WHEN_PLAYING');
    rest = rest.replace(/^When playing this card(?: from your hand)?,\s*/i, '');
  }

  if (timings.size === 0) timings.add('CONTINUOUS');

  // 6. Split sentences and extract leading If/While condition (unless this is a whole-sentence conditional grant or "following effect:")
  const parseState: {
    chosenTarget?: TargetSelector;
    steps: EffectStep[];
    residual: string[];
    card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>;
    depth: number;
  } = {
    steps: lineKeywords.map((kw) => ({
      action: 'GRANT_KEYWORD',
      keyword: kw,
      target: { owner: 'SELF', self: true, cardType: 'UNIT' },
    })),
    residual: [],
    card,
    depth,
  };

  if (/gains the following effect/i.test(rest)) {
    parseSentenceSteps(rest, parseState);
  } else {
    const rawSentences = splitSentencesSmart(rest);
    // Merge "If you do / If you placed ..., choose X." with its immediate follow-up anaphoric sentence ("Return it...", "Deal ... to it.")
    const sentences: string[] = [];
    for (let i = 0; i < rawSentences.length; i++) {
      const cur = rawSentences[i];
      const nxt = rawSentences[i + 1];
      if (
        nxt &&
        /^(?:If you do|If (?:you|they) (?:don't )?(?:placed?|draw|discard|increase)[^,]+|Then, if [^,]+|If [^,]+),\s*(?:all enemy players each |all players each |that player )?chooses?\b/i.test(cur) &&
        !/\b(?:destroy|deal|rest|set|return|deploy|add|recover|gains?|gets?)\b/i.test(cur) &&
        !/^(?:If|Then)\b/i.test(nxt)
      ) {
        // Keep conditional prefix and merge the target-choice sentence with its resolution verb
        const commaIdx = cur.indexOf(',');
        const condPrefix = cur.slice(0, commaIdx + 1);
        const chooseBody = cur.slice(commaIdx + 1).trim();
        // Parse chooseBody first to set chosenTarget, OR push a combined sentence where parseSentenceSteps handles choose + action
        sentences.push(`${condPrefix} ${chooseBody} ${nxt}`);
        i++;
      } else {
        sentences.push(cur);
      }
    }

    sentences.forEach((sent, idx) => {
      let body = sent;
      if (idx === 0) {
        const condM = body.match(/^((?:If|While)\s+[^,]+),\s*(.+)$/i);
        if (condM) {
          if (/at the start of your opponent'?s turn/i.test(condM[1])) {
            timings.delete('CONTINUOUS');
            timings.add('START_OF_OPPONENT_TURN');
          }
          const parsedCond = parseCondition(condM[1]);
          condition = combineConditions(condition, parsedCond);
          body = condM[2].trim();
          if (/^(?:during this turn|during this battle),\s*(?:when|if)\s+/i.test(body)) {
            parseMultiSentenceSteps(body, parseState);
            return;
          }
          const whenInside = parseLeadingWhenTrigger(body);
          if (whenInside) {
            triggerEvent = whenInside.triggerEvent;
            timings.delete('CONTINUOUS');
            timings.add(triggerEvent.kind);
            if (whenInside.extraCondition) {
              condition = combineConditions(condition, whenInside.extraCondition);
            }
            body = whenInside.restBody;
          }
          parseMultiSentenceSteps(body, parseState);
          return;
        }
      }
      parseSentenceSteps(body, parseState);
    });
  }

  const tList = [...timings];
  const linkRequirement = buildLinkRequirement(card, tList, extraAliases, pilotModeNames);

  return {
    raw: line,
    timings: tList,
    oncePerTurn: meta.oncePerTurn,
    ...(triggerEvent ? { triggerEvent } : {}),
    ...(meta.pairFilter ? { pairFilter: meta.pairFilter } : {}),
    ...(linkRequirement ? { linkRequirement } : {}),
    ...(cost ? { cost } : {}),
    ...(condition ? { condition } : {}),
    steps: parseState.steps,
    unparsedResidual: parseState.residual.join(' '),
  };
}

/** Parses raw card.effect into innately granted Keyword Abilities and fail-closed Effect Clauses. */
export function parseCardEffects(
  card: Pick<GundamCardPrint, 'cardNo' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'type' | 'name' | 'traits' | 'link'>>
): ParsedCardEffects {
  const fullCard: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link' | 'effect'> = {
    cardNo: card.cardNo,
    type: card.type ?? 'UNIT',
    name: card.name ?? '',
    traits: card.traits ?? [],
    link: card.link ?? '',
    effect: card.effect ?? '',
  };

  const rawEffect = fullCard.effect || '';
  if (!rawEffect.trim() || rawEffect.trim() === '-') {
    return { cardNo: fullCard.cardNo, keywords: [], clauses: [] };
  }

  const cleaned = stripReminderText(rawEffect);
  const rawLines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Merge bullet lines (■...) or immediate sub-lines following "...following effect:" or "■..." modal options
  const mergedLines: string[] = [];
  let activeModalHeader: string | null = null;
  for (const line of rawLines) {
    const prev = mergedLines[mergedLines.length - 1] ?? '';
    if (/choose 1 of the following effects and activate it[:：]$/i.test(line)) {
      const hdrM = line.match(/^((?:【[^】]+】(?:\s*\/\s*【[^】]+】)?\s*)+)/);
      activeModalHeader = hdrM ? `${hdrM[1].trim()} ` : '';
      continue;
    }
    if (activeModalHeader && line.startsWith('■')) {
      mergedLines.push(`${activeModalHeader}${line.slice(1).trim()}`);
      continue;
    }
    activeModalHeader = null;
    if (
      mergedLines.length > 0 &&
      /following effect[^:：]*[:：]$/i.test(prev)
    ) {
      mergedLines[mergedLines.length - 1] = `${prev} ${line.replace(/^■\s*/, '').trim()}`;
    } else {
      mergedLines.push(line.replace(/^■\s*/, ''));
    }
  }

  // First pass: extract card-level name aliases and 【Pilot】[Name] modes so Link clauses on the same card know them
  const extraAliases: string[] = [];
  const pilotModeNames: string[] = [];
  for (const line of mergedLines) {
    const aliasM = line.match(/This card'?s name is also treated as \[([^\]]+)\]/i);
    if (aliasM) extraAliases.push(aliasM[1].trim());
    const pilotM = line.match(/^【Pilot】\s*\[([^\]]+)\]/i);
    if (pilotM) pilotModeNames.push(pilotM[1].trim());
  }

  const keywords: KeywordAbility[] = [];
  const clauses: EffectClause[] = [];

  for (const line of mergedLines) {
    // Check if pure innate keyword line (no 【...】 header, only <Keyword> or [Keyword] tokens)
    if (!/^【/.test(line)) {
      let rem = line;
      const lineKws: KeywordAbility[] = [];
      while (true) {
        const m = rem.match(/^(?:<([^>]+)>|\[([^\]]+)\])\s*/);
        if (!m) break;
        const kw = parseKeywordToken(m[1] ?? m[2]);
        if (!kw) break;
        lineKws.push(kw);
        rem = rem.slice(m[0].length).trim();
      }
      if (lineKws.length > 0 && !rem) {
        keywords.push(...lineKws);
        continue;
      }
    }

    clauses.push(compileSingleClauseLine(line, fullCard, extraAliases, pilotModeNames));
  }

  return { cardNo: fullCard.cardNo, keywords, clauses };
}

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

function collectNestedConditions(cond: EffectCondition | undefined, out: EffectCondition[]) {
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

export interface EffectPrerequisite {
  kind: 'TRAIT' | 'COLOR' | 'CARD_TYPE' | 'NAME' | 'LINK';
  trait?: string;
  color?: CardColor;
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'CARD';
  nameContains?: string;
  anyNames?: string[];
  anyTraits?: string[];
  minCopies: 4 | 8;
  primaryClause: boolean;
  reason: string;
}

function isNonFunctionalTag(clause: EffectClause): boolean {
  return clause.steps.length === 0 && !clause.condition && !clause.pairFilter && !clause.linkRequirement;
}

/** Extracts deck-composition Effect Prerequisites (4 copies for single-target/pair/link, 8 for density/search/mill-scale). */
export function extractEffectPrerequisites(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'name' | 'traits' | 'link'>>,
  parsed = parseCardEffects(card)
): EffectPrerequisite[] {
  const functionalClauses = parsed.clauses.filter((c) => !isNonFunctionalTag(c));
  const hasInnateKeyword = parsed.keywords.length > 0;
  const collected = new Map<string, EffectPrerequisite>();

  const perClause = functionalClauses.map((clause) => {
    const isBurstOnly = clause.timings.length === 1 && clause.timings[0] === 'BURST';
    const clausePrereqs: Omit<EffectPrerequisite, 'primaryClause'>[] = [];
    let hasUnrestrictedStep = false;

    // 1. Pair filter on header e.g. 【During Pair･(Coordinator) Pilot】 or 【When Paired･Purple Pilot】
    if (clause.pairFilter && (clause.pairFilter.trait || clause.pairFilter.color)) {
      const parts = [clause.pairFilter.color, clause.pairFilter.trait ? `(${clause.pairFilter.trait})` : undefined, 'Pilot'].filter(Boolean);
      clausePrereqs.push({
        kind: clause.pairFilter.trait ? 'TRAIT' : 'COLOR',
        trait: clause.pairFilter.trait,
        color: clause.pairFilter.color,
        cardType: 'PILOT',
        minCopies: 4,
        reason: `Requires ${parts.join(' ')}`,
      });
    }

    // 1b. Structured Link requirement on Link-gated clauses (secondary unless the card has no non-link payoff)
    if (clause.linkRequirement) {
      const lr = clause.linkRequirement;
      if (lr.role === 'UNIT_REQUIRES_PILOT' && (lr.names.length > 0 || lr.traits.length > 0)) {
        clausePrereqs.push({
          kind: 'LINK',
          cardType: 'PILOT',
          ...(lr.names.length > 0 ? { anyNames: lr.names } : {}),
          ...(lr.traits.length > 0 ? { anyTraits: lr.traits } : {}),
          minCopies: 4,
          reason: `Link requires ${lr.raw}`,
        });
      } else if (lr.role === 'PILOT_MATCHING_UNIT' && (lr.names.length > 0 || lr.traits.length > 0)) {
        clausePrereqs.push({
          kind: 'LINK',
          cardType: 'UNIT',
          ...(lr.names.length > 0 ? { anyNames: lr.names } : {}),
          ...(lr.traits.length > 0 ? { anyTraits: lr.traits } : {}),
          minCopies: 4,
          reason: `Links with Unit matching ${lr.raw}`,
        });
      }
    }

    // 2. Clause conditions (recursive across ALL_OF / ANY_OF / NOT)
    const conds: EffectCondition[] = [];
    collectNestedConditions(clause.condition, conds);
    for (const cond of conds) {
      if (cond.kind === 'TRASH_COUNT_AT_LEAST' && cond.owner !== 'ENEMY' && (cond.trait || cond.traits?.length || cond.color || cond.cardType)) {
        const trait = cond.trait ?? cond.traits?.[0];
        const ct = cond.cardType === 'UNIT' || cond.cardType === 'PILOT' || cond.cardType === 'BASE' || cond.cardType === 'COMMAND' ? cond.cardType : undefined;
        const label = [cond.color, trait ? `(${trait})` : undefined, ct].filter(Boolean).join(' ');
        clausePrereqs.push({
          kind: trait ? 'TRAIT' : cond.color ? 'COLOR' : 'CARD_TYPE',
          trait,
          ...(cond.traits && cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          color: cond.color,
          cardType: ct,
          minCopies: 8,
          reason: `Requires ${cond.count}+ ${label} cards in trash`,
        });
      } else if (cond.kind === 'UNIT_TRAIT_IS') {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.trait,
          cardType: 'UNIT',
          minCopies: 4,
          reason: `Requires (${cond.trait}) Unit`,
        });
      } else if (cond.kind === 'BOARD_CARD_COUNT' && cond.owner === 'SELF' && (cond.traits?.length || cond.nameContains)) {
        const ct = cond.cardType === 'UNIT_TOKEN' ? 'UNIT' : cond.cardType;
        if (cond.traits?.length) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait: cond.traits[0],
            ...(cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
            cardType: ct,
            minCopies: 4,
            reason: `Requires (${cond.traits[0]})`,
          });
        } else if (cond.nameContains) {
          clausePrereqs.push({
            kind: 'NAME',
            nameContains: cond.nameContains,
            cardType: ct,
            minCopies: 4,
            reason: `Requires "${cond.nameContains}" ${ct}`,
          });
        }
      } else if (cond.kind === 'SELF_STATE' && cond.traits?.length) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.traits[0],
          ...(cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          cardType: 'UNIT',
          minCopies: 4,
          reason: `Requires (${cond.traits[0]}) Unit`,
        });
      } else if (cond.kind === 'TURN_HISTORY' && cond.traits?.length) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.traits[0],
          ...(cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          minCopies: 4,
          reason: `Requires (${cond.traits[0]})`,
        });
      } else if (cond.kind === 'RAW_CONDITION') {
        const traitM = cond.text.match(/\(([^)]+)\)/);
        if (traitM) {
          const trait = traitM[1].trim();
          clausePrereqs.push({
            kind: 'TRAIT',
            trait,
            cardType: /\bunit\b/i.test(cond.text) ? 'UNIT' : /\bpilot\b/i.test(cond.text) ? 'PILOT' : undefined,
            minCopies: 4,
            reason: `Requires (${trait})`,
          });
        }
      }
    }

    // 3. Clause steps (including nested IF_CONDITION / IF_PREVIOUS_SUCCEEDED / GRANT_CLAUSE)
    const stepHasGate = Boolean(clause.pairFilter || (clause.condition && clausePrereqs.some((p) => p.kind !== 'LINK')));
    for (const step of flattenEffectSteps(clause.steps)) {
      if (step.action === 'LOOK_TOP' && step.trait) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: step.trait,
          minCopies: 8,
          reason: `Searches (${step.trait}) cards`,
        });
      } else if ('target' in step && step.target && step.target.owner === 'SELF' && (step.target.trait || step.target.nameContains)) {
        const t = step.target;
        const isTrashDensity = step.action === 'DEPLOY_FROM_TRASH' || step.action === 'ADD_FROM_TRASH_TO_HAND';
        const minCopies: 4 | 8 = isTrashDensity && t.trait ? 8 : 4;
        const ct =
          t.cardType === 'UNIT' || t.cardType === 'PILOT' || t.cardType === 'BASE' || t.cardType === 'COMMAND'
            ? t.cardType
            : undefined;
        if (t.trait) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait: t.trait,
            ...(t.traits && t.traits.length > 1 ? { anyTraits: t.traits } : {}),
            cardType: ct,
            minCopies,
            reason: `Requires (${t.trait})${ct ? ` ${ct}` : ''} target`,
          });
        } else if (t.nameContains) {
          clausePrereqs.push({
            kind: 'NAME',
            nameContains: t.nameContains,
            cardType: ct,
            minCopies,
            reason: `Requires "${t.nameContains}"${ct ? ` ${ct}` : ''}`,
          });
        }
      } else if (
        !stepHasGate &&
        step.action !== 'ACTIVATE_MAIN_EFFECT' &&
        step.action !== 'GRANT_PILOT_MODE' &&
        step.action !== 'NAME_ALIAS'
      ) {
        hasUnrestrictedStep = true;
      }
    }

    // 4. Residual & scaling trait fallback (also inspects scaleBy on typed steps)
    for (const step of flattenEffectSteps(clause.steps)) {
      if ('scaleBy' in step && step.scaleBy?.traits?.length && (step.scaleBy.metric === 'TRASH_COUNT' || step.scaleBy.metric === 'AFFECTED_COUNT')) {
        const trait = step.scaleBy.traits[0];
        if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === trait.toLowerCase())) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait,
            minCopies: 8,
            reason: `Scales damage/effect with (${trait}) density`,
          });
        }
      }
    }

    const scaleTargetText = clause.unparsedResidual || clause.raw;
    const scaleMatch = scaleTargetText.match(/equal to the number of (?:friendly )?\(([^)]+)\)/i);
    if (scaleMatch) {
      const trait = scaleMatch[1].trim();
      clausePrereqs.push({
        kind: 'TRAIT',
        trait,
        minCopies: 8,
        reason: `Scales damage/effect with (${trait}) density`,
      });
    }
    const friendlyMatch = clause.raw.match(
      /(?:friendly|of your|have a)\s+(?:other\s+|rested\s+|active\s+)?\(([^)]+)\)\s*(?:Link\s+)?(Units?|Pilots?|Bases?|Commands?|cards?)/i
    );
    if (friendlyMatch) {
      const fTrait = friendlyMatch[1].trim();
      if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === fTrait.toLowerCase())) {
        const typeRaw = friendlyMatch[2].toUpperCase().replace(/S$/, '');
        const ct =
          typeRaw === 'UNIT' || typeRaw === 'PILOT' || typeRaw === 'BASE' || typeRaw === 'COMMAND'
            ? typeRaw
            : undefined;
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: fTrait,
          cardType: ct,
          minCopies: 4,
          reason: `Requires (${fTrait})${ct ? ` ${ct}` : ''} target`,
        });
      }
    }

    const isIdentityTagOnly =
      clause.steps.length > 0 &&
      clause.steps.every((s) => s.action === 'GRANT_PILOT_MODE' || s.action === 'NAME_ALIAS');

    return { isBurstOnly, isIdentityTagOnly, clausePrereqs, hasUnrestrictedStep };
  });

  const nonBurstClauses = perClause.filter((c) => !c.isBurstOnly && !c.isIdentityTagOnly);
  const hasUnrestrictedActiveClause = nonBurstClauses.some((c) => c.hasUnrestrictedStep || c.clausePrereqs.length === 0);

  for (const c of perClause) {
    const isPrimaryBase = !hasInnateKeyword && !c.isBurstOnly && !c.isIdentityTagOnly && !c.hasUnrestrictedStep && !hasUnrestrictedActiveClause;
    for (const p of c.clausePrereqs) {
      // Link prerequisites are always secondary synergy requirements (Link Units/Pilots remain playable standalone)
      const isPrimary = p.kind === 'LINK' ? false : isPrimaryBase;
      const key = `${p.kind}|${p.trait ?? ''}|${p.color ?? ''}|${p.cardType ?? ''}|${p.nameContains ?? ''}|${(p.anyNames ?? []).join(',')}`;
      const prev = collected.get(key);
      if (!prev) {
        collected.set(key, { ...p, primaryClause: isPrimary });
      } else if (isPrimary && !prev.primaryClause) {
        collected.set(key, { ...p, primaryClause: true });
      } else if (isPrimary === prev.primaryClause) {
        prev.minCopies = prev.minCopies === 8 || p.minCopies === 8 ? 8 : 4;
      }
    }
  }

  return [...collected.values()];
}

export function compileCardEffect(
  card: Pick<GundamCardPrint, 'cardNo' | 'printId' | 'name' | 'type' | 'color' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'traits' | 'link'>>
): CompiledCardEffect {
  const parsed = parseCardEffects(card);
  const cfg = parseCardAbilities(card, parsed.clauses);
  return {
    cardNo: card.cardNo,
    sourcePrintId: card.printId,
    name: card.name,
    type: card.type,
    color: card.color,
    keywords: parsed.keywords,
    clauses: parsed.clauses,
    abilities: cfg.abilities,
    synergy: extractSynergyProfile(card, parsed),
    prerequisites: extractEffectPrerequisites(card, parsed),
  };
}
