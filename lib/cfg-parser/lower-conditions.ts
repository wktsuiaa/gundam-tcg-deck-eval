import { type IToken } from 'chevrotain';
import type { EffectCondition } from '../effect-parser.ts';
import { KeywordTag, LvPrefix, NumberTok, ParenToken, TimingTag } from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractKeywordsFromTokens,
  hasAnyWord,
  hasWordSeq,
  parseColorToken,
  parseIntTok,
  parseLvConstraintFromTokens,
  parseResCostValue,
} from './token-utils.ts';

import { parseBoardFilterCondition, parseTrashAtLeast } from './lower-condition-filters.ts';

export function lowerSingleCondition(rawToks: IToken[]): EffectCondition | undefined {
  let toks = rawToks;
  const firstLow = toks[0]?.image.toLowerCase();
  if (firstLow === 'if' || firstLow === 'while') toks = toks.slice(1);
  if (toks.length === 0) return undefined;

  if (hasWordSeq(toks, ['you', 'deploy', 'this', 'unit', 'from', 'your', 'trash'])) {
    return { kind: 'DEPLOYED_FROM_ZONE', zone: 'trash' };
  }
  if (hasWordSeq(toks, ['you', 'deploy', 'this', 'unit', 'from', 'your', 'hand'])) {
    return { kind: 'DEPLOYED_FROM_ZONE', zone: 'hand' };
  }
  if (hasWordSeq(toks, ['it', 'is', 'your', 'turn'])) return { kind: 'IS_YOUR_TURN' };
  if (hasWordSeq(toks, ['it', 'is', 'your', "opponent's", 'turn'])) return { kind: 'IS_OPPONENT_TURN' };
  if (hasWordSeq(toks, ['ex', 'resource', 'to', 'play', 'this', 'card'])) {
    return { kind: 'EX_RESOURCE_USED_TO_PLAY' };
  }

  if (
    hasWordSeq(toks, ['friendly', 'base', 'in', 'play']) ||
    hasWordSeq(toks, ['friendly', 'base', 'is', 'in', 'play']) ||
    hasWordSeq(toks, ['there', 'is', 'a', 'friendly', 'base', 'in', 'play'])
  ) {
    return { kind: 'FRIENDLY_BASE_IN_PLAY' };
  }
  if (hasWordSeq(toks, ['friendly']) && hasWordSeq(toks, ['base']) && hasWordSeq(toks, ['in', 'play'])) {
    const col = parseColorToken(toks);
    const traits = extractAllTraitsFromTokens(toks);
    if (col.color) return { kind: 'FRIENDLY_BASE_IN_PLAY', color: col.color };
    if (traits.length > 0) return { kind: 'FRIENDLY_BASE_IN_PLAY', trait: traits[0] };
  }

  const trashCond = parseTrashAtLeast(toks);
  if (trashCond) return trashCond;

  if (hasWordSeq(toks, ['this', 'unit', 'has']) && hasAnyWord(toks, ['ap']) && hasWordSeq(toks, ['or', 'more', 'ap'])) {
    const n = parseIntTok(toks.find((t) => t.tokenType === NumberTok));
    if (n !== undefined) return { kind: 'SELF_AP_AT_LEAST', minAp: n };
  }

  if (hasWordSeq(toks, ['this', 'is', 'a']) && hasAnyWord(toks, ['unit']) && toks.some((t) => t.tokenType === ParenToken)) {
    const traits = extractAllTraitsFromTokens(toks);
    if (traits.length > 0) {
      return {
        kind: 'UNIT_TRAIT_IS',
        trait: traits[0],
        ...(traits.length > 1 ? { traits } : {}),
      };
    }
  }

  if (hasWordSeq(toks, ['this', 'unit', 'is', 'rested'])) return { kind: 'SELF_RESTED' };
  if (hasWordSeq(toks, ['destroyed', 'with', 'battle', 'damage']) && !hasWordSeq(toks, ['friendly', 'unit', 'paired'])) {
    return { kind: 'DESTROYED_BY_BATTLE' };
  }

  if (hasWordSeq(toks, ['you', 'are']) && toks.some((t) => t.tokenType === LvPrefix)) {
    const lv = parseLvConstraintFromTokens(toks);
    if (lv.lvMin !== undefined) return { kind: 'PLAYER_LV_AT_LEAST', minLv: lv.lvMin };
  }

  if (hasWordSeq(toks, ['enemy', 'players']) && hasWordSeq(toks, ['or', 'more'])) {
    const n = parseIntTok(toks.find((t) => t.tokenType === NumberTok));
    if (n !== undefined) return { kind: 'ENEMY_PLAYER_COUNT_AT_LEAST', count: n };
  }

  if (hasWordSeq(toks, ['in', 'your', 'hand']) || hasWordSeq(toks, ['in', 'their', 'hand'])) {
    const isEnemy = hasWordSeq(toks, ['in', 'their', 'hand']);
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i].tokenType !== NumberTok) continue;
      const n = parseIntTok(toks[i]);
      const dir = toks[i + 2]?.image.toLowerCase();
      if (n !== undefined && toks[i + 1]?.image.toLowerCase() === 'or' && (dir === 'more' || dir === 'less')) {
        return {
          kind: 'HAND_COUNT',
          owner: isEnemy ? 'ENEMY' : 'SELF',
          ...(dir === 'more' ? { min: n } : { max: n }),
        };
      }
    }
  }

  if (hasAnyWord(toks, ['shield', 'shields'])) {
    const owner: 'SELF' | 'ENEMY' | 'ANY' = hasWordSeq(toks, ['a', 'player'])
      ? 'ANY'
      : hasAnyWord(toks, ['enemy'])
      ? 'ENEMY'
      : 'SELF';
    if (hasWordSeq(toks, ['any', 'shields'])) return { kind: 'SHIELD_COUNT', owner, min: 1 };
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i].tokenType !== NumberTok) continue;
      const n = parseIntTok(toks[i]);
      const dir = toks[i + 2]?.image.toLowerCase();
      if (n !== undefined && toks[i + 1]?.image.toLowerCase() === 'or' && (dir === 'more' || dir === 'less')) {
        return {
          kind: 'SHIELD_COUNT',
          owner,
          ...(dir === 'more' ? { min: n } : { max: n }),
        };
      }
    }
  }

  if (hasWordSeq(toks, ['ex', 'resource']) || hasWordSeq(toks, ['ex', 'resources'])) {
    const isEnemy = hasAnyWord(toks, ['opponent', "opponent's"]);
    const isZero = hasAnyWord(toks, ['no']);
    return {
      kind: 'RESOURCE_COUNT',
      owner: isEnemy ? 'ENEMY' : 'SELF',
      ex: true,
      ...(isZero ? { min: 0, max: 0 } : { min: 1 }),
    };
  }

  // Turn history predicates
  if (hasWordSeq(toks, ['activated']) && hasWordSeq(toks, ['command', "card's"])) {
    return { kind: 'TURN_HISTORY', event: 'ACTIVATED_COMMAND', traits: extractAllTraitsFromTokens(toks) };
  }
  if (hasWordSeq(toks, ['one', 'of', 'your', 'units', 'has', 'been', 'destroyed'])) {
    return { kind: 'TURN_HISTORY', event: 'UNIT_DESTROYED_BY_EFFECT', traits: extractAllTraitsFromTokens(toks) };
  }
  if (hasWordSeq(toks, ['you', 'have', 'paid'])) {
    const costTok = toks.find((t) => parseResCostValue(t) !== undefined);
    const minCost = costTok ? parseResCostValue(costTok) ?? 1 : 1;
    const traits = extractAllTraitsFromTokens(toks);
    return {
      kind: 'TURN_HISTORY',
      event: 'PAID_EFFECT_COST_AT_LEAST',
      minCost,
      ...(traits.length > 0 ? { traits } : {}),
      ...(hasAnyWord(toks, ['other']) ? { other: true } : {}),
    };
  }
  if (hasWordSeq(toks, ['drawn', 'with', 'an', 'effect'])) {
    return { kind: 'TURN_HISTORY', event: 'DRAWN_BY_EFFECT' };
  }
  if (hasWordSeq(toks, ['no', 'enemy', 'units', 'have', 'attacked'])) {
    return { kind: 'TURN_HISTORY', event: 'NO_ENEMY_ATTACKED' };
  }
  if (hasWordSeq(toks, ['friendly', 'unit', 'paired', 'with', 'a', 'pilot', 'has', 'destroyed'])) {
    return { kind: 'TURN_HISTORY', event: 'PAIRED_UNIT_DESTROYED_ENEMY_BY_BATTLE' };
  }
  if (hasWordSeq(toks, ['not', 'set', 'one', 'of', 'your', 'resources', 'as', 'active'])) {
    return { kind: 'NOT', condition: { kind: 'TURN_HISTORY', event: 'SET_RESOURCE_ACTIVE_BY_EFFECT' } };
  }

  // Self state predicates
  if (hasWordSeq(toks, ['a', 'pilot', 'is', 'not', 'paired', 'with', 'this', 'unit'])) {
    return { kind: 'SELF_STATE', paired: false };
  }
  if (
    hasWordSeq(toks, ['it', 'is', 'paired', 'with', 'a', 'pilot']) ||
    hasWordSeq(toks, ['this', 'unit', 'is', 'paired', 'with', 'a', 'pilot'])
  ) {
    const lv = parseLvConstraintFromTokens(toks);
    return {
      kind: 'SELF_STATE',
      paired: true,
      ...(lv.lvMax !== undefined ? { pairedPilotLvMax: lv.lvMax } : {}),
    };
  }
  if (hasWordSeq(toks, ['this', 'unit', 'is', 'damaged']) || hasWordSeq(toks, ['this', 'is', 'damaged'])) {
    const lv = parseLvConstraintFromTokens(toks);
    return {
      kind: 'SELF_STATE',
      damaged: true,
      ...(lv.lvMax !== undefined ? { lvMax: lv.lvMax } : {}),
    };
  }
  if (hasWordSeq(toks, ['this', 'unit', 'has']) && toks.some((t) => t.tokenType === KeywordTag)) {
    const kws = extractKeywordsFromTokens(toks);
    if (kws.length > 0) return { kind: 'SELF_STATE', keyword: kws[0].name };
  }
  if (hasWordSeq(toks, ['it', 'has']) && toks.some((t) => t.tokenType === KeywordTag)) {
    const kws = extractKeywordsFromTokens(toks);
    if (kws.length > 0) return { kind: 'SELF_STATE', keyword: kws[0].name };
  }
  if (hasWordSeq(toks, ['this', 'unit', 'has']) && hasAnyWord(toks, ['hp'])) {
    const n = parseIntTok(toks.find((t) => t.tokenType === NumberTok));
    if (n !== undefined) return { kind: 'SELF_STATE', hpMin: n, hpMax: n };
  }
  if (
    (toks[0]?.image.toLowerCase() === 'this' || toks[0]?.image.toLowerCase() === 'it') &&
    hasAnyWord(toks, ['is']) &&
    !hasWordSeq(toks, ['in', 'play']) &&
    (hasAnyWord(toks, ['unit']) || parseColorToken(toks).color !== undefined || toks.some((t) => t.tokenType === ParenToken))
  ) {
    const col = parseColorToken(toks);
    const traits = extractAllTraitsFromTokens(toks);
    const isLink = hasWordSeq(toks, ['link', 'unit']);
    return {
      kind: 'SELF_STATE',
      ...(col.color ? { color: col.color } : {}),
      ...(traits.length > 0 ? { traits } : {}),
      ...(isLink ? { linked: true } : {}),
    };
  }
  if (hasWordSeq(toks, ['this', 'unit', 'is', 'destroyed', 'by'])) {
    return {
      kind: 'SELF_STATE',
      destroyedBy: {
        owner: hasAnyWord(toks, ['enemy']) ? 'ENEMY' : 'SELF',
        traits: extractAllTraitsFromTokens(toks),
        cardEffect: true,
      },
    };
  }
  if (hasWordSeq(toks, ['is', 'attacking'])) {
    const tgt = hasWordSeq(toks, ['damaged', 'enemy', 'unit'])
      ? 'DAMAGED_ENEMY_UNIT'
      : hasWordSeq(toks, ['enemy', 'player'])
      ? 'ENEMY_PLAYER'
      : 'ENEMY_UNIT';
    return { kind: 'SELF_STATE', attackingTarget: tgt };
  }
  if (hasWordSeq(toks, ['this', 'unit', 'is', 'battling'])) {
    const kws = extractKeywordsFromTokens(toks);
    const lv = parseLvConstraintFromTokens(toks);
    const hasDestroyed =
      toks.some((t) => t.tokenType === TimingTag && t.image === '【Destroyed】') &&
      hasAnyWord(toks, ['effect']);
    return {
      kind: 'SELF_STATE',
      battlingEnemy: {
        ...(kws.length > 0 ? { keyword: kws[0].name } : {}),
        ...(lv.lvMax !== undefined ? { lvMax: lv.lvMax } : {}),
        ...(hasAnyWord(toks, ['damaged']) ? { damaged: true } : {}),
        ...(hasDestroyed ? { hasDestroyedEffect: true } : {}),
      },
    };
  }

  // Fallback structured board filter (no RAW_CONDITION!)
  if (
    hasAnyWord(toks, ['unit', 'units', 'pilot', 'pilots', 'base', 'bases', 'token', 'tokens']) &&
    (hasWordSeq(toks, ['in', 'play']) ||
      hasWordSeq(toks, ['you', 'have']) ||
      hasWordSeq(toks, ['there', 'is']) ||
      hasWordSeq(toks, ['there', 'are']) ||
      hasWordSeq(toks, ['at', 'the', 'start']))
  ) {
    // Legacy UNIT_COUNT_AT_LEAST check for simple "N or more [friendly/enemy] Units are in play"
    if (
      !toks.some((t) => t.tokenType === ParenToken || t.tokenType === KeywordTag || t.tokenType === LvPrefix) &&
      !hasAnyWord(toks, ['rested', 'link', 'token', 'tokens', 'ap'])
    ) {
      const bf = parseBoardFilterCondition(toks);
      if (bf.kind === 'BOARD_CARD_COUNT' && bf.cardType === 'UNIT' && bf.min !== undefined && bf.max === undefined) {
        return { kind: 'UNIT_COUNT_AT_LEAST', owner: bf.owner, count: bf.min };
      }
      return bf;
    }
    return parseBoardFilterCondition(toks);
  }

  return undefined;
}

const CONJUNCTION_STARTERS = new Set(['you', 'there', 'it', 'no', 'this', 'a', 'an', 'friendly', 'enemy', 'another']);

export function lowerConditionTokens(rawToks: IToken[]): EffectCondition | undefined {
  let toks = rawToks;
  const first = toks[0]?.image.toLowerCase();
  if (first === 'if' || first === 'while') toks = toks.slice(1);
  if (toks.length === 0) return undefined;

  // Handle "it is your turn a friendly ..." (GD02-128 missing "and")
  if (
    toks.length > 4 &&
    toks[0].image.toLowerCase() === 'it' &&
    toks[1].image.toLowerCase() === 'is' &&
    toks[2].image.toLowerCase() === 'your' &&
    toks[3].image.toLowerCase() === 'turn'
  ) {
    const rest = toks.slice(4);
    const subStart = rest[0]?.image.toLowerCase() === 'and' ? rest.slice(1) : rest;
    const right = lowerSingleCondition(subStart);
    if (right) return { kind: 'ALL_OF', conditions: [{ kind: 'IS_YOUR_TURN' }, right] };
    return { kind: 'IS_YOUR_TURN' };
  }

  // Split compound "A and B" when B starts a distinct predicate
  const parts: IToken[][] = [];
  let start = 0;
  for (let i = 0; i < toks.length - 1; i += 1) {
    if (toks[i].image.toLowerCase() === 'and') {
      const nextWord = toks[i + 1].image.toLowerCase();
      if (CONJUNCTION_STARTERS.has(nextWord) || toks[i + 1].tokenType === NumberTok) {
        parts.push(toks.slice(start, i));
        start = i + 1;
      }
    }
  }
  parts.push(toks.slice(start));

  if (parts.length > 1) {
    const conds = parts.map(lowerSingleCondition).filter((c): c is EffectCondition => Boolean(c));
    if (conds.length > 1) return { kind: 'ALL_OF', conditions: conds };
    if (conds.length === 1) return conds[0];
  }

  return lowerSingleCondition(toks);
}

export function combineConditions(
  a: EffectCondition | undefined,
  b: EffectCondition | undefined
): EffectCondition | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.kind === 'ALL_OF' && b.kind === 'ALL_OF') {
    return { kind: 'ALL_OF', conditions: [...a.conditions, ...b.conditions] };
  }
  if (a.kind === 'ALL_OF') return { kind: 'ALL_OF', conditions: [...a.conditions, b] };
  if (b.kind === 'ALL_OF') return { kind: 'ALL_OF', conditions: [a, ...b.conditions] };
  return { kind: 'ALL_OF', conditions: [a, b] };
}
