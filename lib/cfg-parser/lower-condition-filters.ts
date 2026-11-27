import { type IToken } from 'chevrotain';
import type { EffectCondition } from '../effect-parser.ts';
import { LvPrefix, NumberTok, TimingTag } from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractKeywordsFromTokens,
  extractQuotes,
  findWordSeq,
  hasAnyWord,
  hasWordSeq,
  parseColorToken,
  parseIntTok,
  parseLvConstraintFromTokens,
} from './token-utils.ts';

export function parseTrashAtLeast(toks: IToken[]): EffectCondition | undefined {
  const inTrashIdx =
    findWordSeq(toks, ['in', 'your', 'trash']) >= 0
      ? findWordSeq(toks, ['in', 'your', 'trash'])
      : findWordSeq(toks, ['in', 'their', 'trash']);
  if (inTrashIdx < 0) return undefined;

  const isEnemy = findWordSeq(toks, ['in', 'their', 'trash']) >= 0;
  let numVal: number | undefined;
  let isOrLess = false;
  for (let i = 0; i < toks.length; i += 1) {
    if (toks[i].tokenType !== NumberTok) continue;
    const w1 = toks[i + 1]?.image.toLowerCase();
    const w2 = toks[i + 2]?.image.toLowerCase();
    if (w1 === 'or' && (w2 === 'more' || w2 === 'less')) {
      numVal = parseIntTok(toks[i]);
      isOrLess = w2 === 'less';
      break;
    }
  }
  if (numVal === undefined) return undefined;

  const traits = extractAllTraitsFromTokens(toks);
  const col = parseColorToken(toks);
  const quotes = extractQuotes(toks);
  let cardType: string | undefined;
  if (hasWordSeq(toks, ['unit', 'cards']) || hasWordSeq(toks, ['unit', 'card'])) cardType = 'UNIT';
  else if (hasWordSeq(toks, ['pilot', 'cards']) || hasWordSeq(toks, ['pilot', 'card'])) cardType = 'PILOT';
  else if (hasWordSeq(toks, ['base', 'cards']) || hasWordSeq(toks, ['base', 'card'])) cardType = 'BASE';
  else if (hasWordSeq(toks, ['command', 'cards']) || hasWordSeq(toks, ['command', 'card'])) cardType = 'COMMAND';

  const baseCond: EffectCondition = {
    kind: 'TRASH_COUNT_AT_LEAST',
    count: isOrLess ? numVal + 1 : numVal,
    ...(isEnemy ? { owner: 'ENEMY' } : {}),
    ...(col.color ? { color: col.color } : {}),
    ...(traits.length === 1 ? { trait: traits[0] } : {}),
    ...(traits.length > 0 ? { traits } : {}),
    ...(cardType ? { cardType } : {}),
    ...(quotes.length > 0 ? { nameContains: quotes[0] } : {}),
  };

  return isOrLess ? { kind: 'NOT', condition: baseCond } : baseCond;
}

export function parseBoardFilterCondition(toks: IToken[]): EffectCondition {
  // Strip "at the start of your opponent's turn" before scanning owner
  const startOppIdx = findWordSeq(toks, ['at', 'the', 'start', 'of', 'your', "opponent's", 'turn']);
  const filterToks =
    startOppIdx >= 0
      ? [...toks.slice(0, startOppIdx), ...toks.slice(startOppIdx + 7)]
      : toks;

  const owner: 'SELF' | 'ENEMY' | 'ANY' = hasAnyWord(filterToks, ['enemy', 'opponent', "opponent's"])
    ? 'ENEMY'
    : hasAnyWord(filterToks, ['friendly', 'you', 'your', 'another'])
    ? 'SELF'
    : 'ANY';

  const cardType: 'UNIT' | 'PILOT' | 'BASE' | 'UNIT_TOKEN' =
    hasWordSeq(filterToks, ['unit', 'tokens']) || hasWordSeq(filterToks, ['unit', 'token'])
      ? 'UNIT_TOKEN'
      : hasAnyWord(filterToks, ['base', 'bases'])
      ? 'BASE'
      : hasWordSeq(filterToks, ['paired', 'with', 'a', 'pilot'])
      ? 'UNIT'
      : hasAnyWord(filterToks, ['pilot', 'pilots'])
      ? 'PILOT'
      : 'UNIT';

  let min: number | undefined = 1;
  let max: number | undefined;
  if (hasAnyWord(filterToks, ['no']) && !hasWordSeq(filterToks, ['with', 'no'])) {
    min = 0;
    max = 0;
  } else {
    for (let i = 0; i < filterToks.length; i += 1) {
      if (filterToks[i].tokenType !== NumberTok) continue;
      if (filterToks[i - 1]?.tokenType === LvPrefix) continue;
      const w1 = filterToks[i + 1]?.image.toLowerCase();
      const w2 = filterToks[i + 2]?.image.toLowerCase();
      const w3 = filterToks[i + 3]?.image.toLowerCase();
      if (w1 === 'ap' || w1 === 'hp' || w3 === 'ap' || w3 === 'hp') continue;
      const n = parseIntTok(filterToks[i]);
      if (n === undefined) continue;
      if (w1 === 'to' && filterToks[i + 2]?.tokenType === NumberTok) {
        min = n;
        max = parseIntTok(filterToks[i + 2]);
        break;
      }
      if (w1 === 'or' && w2 === 'more') {
        min = n;
        break;
      }
      if (w1 === 'or' && w2 === 'less') {
        min = undefined;
        max = n;
        break;
      }
      if (filterToks[i - 1]?.image.toLowerCase() === 'only') {
        min = n;
        max = n;
        break;
      }
    }
  }

  const traits = extractAllTraitsFromTokens(filterToks);
  const col = parseColorToken(filterToks);
  const kws = extractKeywordsFromTokens(filterToks);
  const quotes = extractQuotes(filterToks);
  const lv = parseLvConstraintFromTokens(filterToks);
  let apMax: number | undefined;
  let pairedPilotLvMax: number | undefined;

  for (let i = 0; i < filterToks.length; i += 1) {
    if (filterToks[i].tokenType !== NumberTok) continue;
    const n = parseIntTok(filterToks[i]);
    if (n === undefined) continue;
    if (
      filterToks[i + 1]?.image.toLowerCase() === 'or' &&
      filterToks[i + 2]?.image.toLowerCase() === 'less' &&
      filterToks[i + 3]?.image.toLowerCase() === 'ap'
    ) {
      apMax = n;
    }
  }

  const pairedLvIdx = findWordSeq(filterToks, ['paired', 'with', 'a', 'pilot', 'that', 'is']);
  if (pairedLvIdx >= 0) {
    const subLv = parseLvConstraintFromTokens(filterToks.slice(pairedLvIdx));
    if (subLv.lvMax !== undefined) pairedPilotLvMax = subLv.lvMax;
  }

  const hasDestroyed =
    filterToks.some((t) => t.tokenType === TimingTag && t.image === '【Destroyed】') &&
    hasAnyWord(filterToks, ['effect']);

  const boardCond: EffectCondition = {
    kind: 'BOARD_CARD_COUNT',
    owner,
    cardType,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(hasAnyWord(filterToks, ['other', 'another']) ? { other: true } : {}),
    ...(hasAnyWord(filterToks, ['rested']) ? { rested: true } : {}),
    ...(hasWordSeq(filterToks, ['link', 'unit']) || hasWordSeq(filterToks, ['link', 'units'])
      ? { linked: true }
      : {}),
    ...(pairedPilotLvMax !== undefined || hasWordSeq(filterToks, ['paired', 'with'])
      ? { paired: true }
      : {}),
    ...(pairedPilotLvMax !== undefined ? { pairedPilotLvMax } : {}),
    ...(col.color ? { color: col.color } : {}),
    ...(col.notColor ? { notColor: col.notColor } : {}),
    ...(traits.length > 0 ? { traits } : {}),
    ...(kws.length > 0 ? { keyword: kws[0].name } : {}),
    ...(quotes.length > 0 ? { nameContains: quotes[0] } : {}),
    ...(lv.lvMin !== undefined ? { lvMin: lv.lvMin } : {}),
    ...(lv.lvMax !== undefined && pairedPilotLvMax === undefined ? { lvMax: lv.lvMax } : {}),
    ...(apMax !== undefined ? { apMax } : {}),
    ...(hasDestroyed ? { hasDestroyedEffect: true } : {}),
  };

  if (startOppIdx >= 0) {
    return {
      kind: 'ALL_OF',
      conditions: [{ kind: 'PHASE_AT_START_OF_OPPONENT_TURN' }, boardCond],
    };
  }
  return boardCond;
}
