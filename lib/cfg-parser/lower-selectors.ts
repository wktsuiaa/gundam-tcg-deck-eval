import { type IToken } from 'chevrotain';
import type {
  EffectCondition,
  TargetSelector,
  TriggerEvent,
} from '../effect-parser.ts';
import {
  LvPrefix,
  NumberTok,
  TimingTag,
} from './tokens.ts';
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

function lowerBoardOwner(toks: IToken[]): TargetSelector['owner'] {
  if (hasAnyWord(toks, ['enemy', 'opponent', "opponent's"])) return 'ENEMY';
  if (hasAnyWord(toks, ['friendly', 'your', 'this', 'my'])) return 'SELF';
  return 'ANY';
}

export function lowerTargetSelector(rawToks: IToken[]): TargetSelector {
  // Trim trailing "from your/any player's trash/hand" for owner check if "any player's" is at end
  const anyPlayerTrashIdx = findWordSeq(rawToks, ['any', "player's"]);
  const mainToks = anyPlayerTrashIdx >= 0 ? rawToks.slice(0, anyPlayerTrashIdx) : rawToks;

  const sel: TargetSelector = {
    owner: lowerBoardOwner(mainToks),
  };

  if (hasWordSeq(rawToks, ['belonging', 'to', 'each', 'enemy', 'player'])) {
    sel.owner = 'ENEMY';
    sel.countRef = 'ENEMY_PLAYERS';
  } else if (
    rawToks.length >= 2 &&
    rawToks[0].image.toLowerCase() === 'all' &&
    rawToks[1].image.toLowerCase() === 'players'
  ) {
    sel.owner = 'ALL_PLAYERS';
  }

  const isThisUnit =
    hasWordSeq(rawToks, ['this', 'unit']) ||
    hasWordSeq(rawToks, ['this', "unit's"]) ||
    hasWordSeq(rawToks, ['this', 'rested', 'unit']) ||
    hasWordSeq(rawToks, ['this', 'active', 'unit']) ||
    hasWordSeq(rawToks, ['this', 'base']);

  if (
    hasWordSeq(rawToks, ['this', "unit's", 'paired', 'pilot']) ||
    hasWordSeq(rawToks, ['card', 'paired', 'with', 'this', 'unit'])
  ) {
    sel.owner = 'SELF';
    sel.self = true;
    sel.cardType = 'PILOT';
  } else if (hasWordSeq(rawToks, ['this', 'base'])) {
    sel.owner = 'SELF';
    sel.self = true;
    sel.cardType = 'BASE';
  } else if (isThisUnit) {
    sel.owner = 'SELF';
    sel.self = true;
    sel.cardType = 'UNIT';
  } else if (hasWordSeq(rawToks, ['other', 'than', 'unit', 'tokens']) || hasWordSeq(rawToks, ['other', 'than', 'unit', 'token'])) {
    sel.excludeToken = true;
    sel.cardType = 'UNIT';
  } else if (hasWordSeq(rawToks, ['unit', 'tokens']) || hasWordSeq(rawToks, ['unit', 'token'])) {
    sel.cardType = 'UNIT_TOKEN';
    sel.token = true;
  } else if (hasAnyWord(rawToks, ['base', 'bases'])) {
    sel.cardType = 'BASE';
  } else if (hasAnyWord(rawToks, ['shield', 'shields'])) {
    sel.cardType = 'SHIELD';
  } else if (hasWordSeq(rawToks, ['ex', 'resource']) || hasWordSeq(rawToks, ['ex', 'resources'])) {
    sel.cardType = 'EX_RESOURCE';
  } else if (hasAnyWord(rawToks, ['resource', 'resources'])) {
    sel.cardType = 'RESOURCE';
  } else if (
    hasWordSeq(rawToks, ['with', 'no', 'paired', 'pilot']) ||
    hasWordSeq(rawToks, ['paired', 'with'])
  ) {
    sel.cardType = 'UNIT';
  } else if (hasAnyWord(rawToks, ['pilot', 'pilots'])) {
    sel.cardType = 'PILOT';
  } else if (hasAnyWord(rawToks, ['command', 'commands'])) {
    sel.cardType = 'COMMAND';
  } else if (hasAnyWord(rawToks, ['unit', 'units'])) {
    sel.cardType = 'UNIT';
  } else if (hasAnyWord(rawToks, ['card', 'cards'])) {
    sel.cardType = 'CARD';
  }

  // Count expression
  if (hasAnyWord(mainToks, ['all']) && !hasWordSeq(mainToks, ['all', 'players'])) {
    sel.count = 'ALL';
  } else if (hasWordSeq(mainToks, ['equal', 'to', 'the', 'number', 'of', 'enemy', 'players'])) {
    sel.countRef = 'ENEMY_PLAYERS';
    sel.count = 'UP_TO';
  } else {
    let foundCount = false;
    for (let i = 0; i < mainToks.length; i += 1) {
      if (mainToks[i].tokenType !== NumberTok) continue;
      const n = parseIntTok(mainToks[i]);
      if (n === undefined) continue;
      const prev = mainToks[i - 1];
      const next1 = mainToks[i + 1]?.image.toLowerCase();
      const next2 = mainToks[i + 2]?.image.toLowerCase();
      // Skip numbers belonging to Lv.X, X or more/less AP/HP, X HP, "up to" captured below
      if (prev?.tokenType === LvPrefix) continue;
      if (next1 === 'hp' || next1 === 'ap') continue;
      if (next1 === 'or' && (next2 === 'less' || next2 === 'more' || next2 === 'lower' || next2 === 'higher')) continue;
      if (prev?.image.toLowerCase() === 'to' && mainToks[i - 2]?.tokenType === NumberTok) {
        continue;
      }
      if (next1 === 'to' && mainToks[i + 2]?.tokenType === NumberTok) {
        sel.count = 'UP_TO';
        sel.maxCount = parseIntTok(mainToks[i + 2]);
        foundCount = true;
        break;
      }
      if (prev?.image.toLowerCase() === 'to' && mainToks[i - 2]?.image.toLowerCase() === 'up') {
        sel.count = 'UP_TO';
        sel.maxCount = n;
        foundCount = true;
        break;
      }
      sel.count = n;
      foundCount = true;
      break;
    }
    if (!foundCount && !sel.self) {
      sel.count = 1;
    }
  }

  if (hasAnyWord(mainToks, ['active'])) sel.state = 'ACTIVE';
  else if (hasAnyWord(mainToks, ['rested'])) sel.state = 'RESTED';
  else if (hasAnyWord(mainToks, ['damaged'])) sel.state = 'DAMAGED';

  if (hasAnyWord(mainToks, ['other', 'another']) && !hasWordSeq(mainToks, ['other', 'than'])) {
    sel.other = true;
  }
  if (hasWordSeq(rawToks, ['other', 'than', 'unit', 'tokens']) || hasWordSeq(rawToks, ['other', 'than', 'unit', 'token'])) {
    sel.excludeToken = true;
  }
  if (hasWordSeq(mainToks, ['link', 'unit']) || hasWordSeq(mainToks, ['link', 'units'])) {
    sel.linked = true;
  }
  if (hasWordSeq(mainToks, ['with', 'no', 'paired', 'pilot'])) {
    sel.paired = 'NONE';
  } else if (hasWordSeq(mainToks, ['paired', 'with'])) {
    sel.paired = true;
  }

  const lv = parseLvConstraintFromTokens(mainToks);
  if (lv.lvMax !== undefined) sel.lvMax = lv.lvMax;
  if (lv.lvMin !== undefined) sel.lvMin = lv.lvMin;
  if (lv.lvExact !== undefined) {
    sel.lvMin = lv.lvExact;
    sel.lvMax = lv.lvExact;
  }

  if (hasWordSeq(mainToks, ['whose', 'lv.', 'is', 'equal', 'to', 'or', 'lower', 'than', 'this', 'unit']) ||
      hasWordSeq(mainToks, ['whose', 'lv.', 'is', 'equal', 'to', 'or', 'lower', 'than', 'it'])) {
    sel.lvMaxRef = 'SELF_LV';
  } else if (
    hasWordSeq(mainToks, ['whose', 'lv.', 'is', 'equal', 'to', 'or', 'lower', 'than', 'that', 'number']) ||
    hasWordSeq(mainToks, ['the', 'unit', 'rested', 'with', 'this', 'ability'])
  ) {
    sel.lvMaxRef = 'COUNTED_VALUE';
  }
  if (hasWordSeq(mainToks, ['the', 'lowest', 'lv.'])) sel.lvRank = 'LOWEST';
  if (hasWordSeq(mainToks, ['the', 'highest', 'lv.'])) sel.lvRank = 'HIGHEST';

  // AP and HP filters
  for (let i = 0; i < mainToks.length; i += 1) {
    if (mainToks[i].tokenType !== NumberTok) continue;
    const n = parseIntTok(mainToks[i]);
    if (n === undefined) continue;
    const w1 = mainToks[i + 1]?.image.toLowerCase();
    const w2 = mainToks[i + 2]?.image.toLowerCase();
    const w3 = mainToks[i + 3]?.image.toLowerCase();
    const prev = mainToks[i - 1]?.image.toLowerCase();

    if (w1 === 'or' && w2 === 'less' && w3 === 'ap') sel.apMax = n;
    else if (w1 === 'or' && w2 === 'more' && w3 === 'ap') sel.apMin = n;
    else if (w1 === 'ap' && w2 === 'or' && w3 === 'less') sel.apMax = n;
    else if (w1 === 'ap' && w2 === 'or' && w3 === 'more') sel.apMin = n;
    else if (w1 === 'or' && w2 === 'less' && w3 === 'hp') sel.hpMax = n;
    else if (w1 === 'or' && w2 === 'more' && w3 === 'hp') sel.hpMin = n;
    else if (w1 === 'hp' && w2 === 'or' && w3 === 'less') sel.hpMax = n;
    else if (w1 === 'hp' && w2 === 'or' && w3 === 'more') sel.hpMin = n;
    else if (w1 === 'hp' && prev === 'with' && w2 !== 'or') {
      sel.hpMin = n;
      sel.hpMax = n;
    }
  }
  if (
    hasWordSeq(mainToks, ['ap', 'equal', 'to', 'or', 'less', 'than', 'it']) ||
    hasWordSeq(mainToks, ['ap', 'equal', 'to', 'or', 'less', 'than', 'this', 'unit'])
  ) {
    sel.apMaxRef = 'SELF_AP';
  }
  if (hasWordSeq(mainToks, ['the', 'lowest', 'hp'])) sel.hpRank = 'LOWEST';
  if (hasWordSeq(mainToks, ['the', 'highest', 'hp'])) sel.hpRank = 'HIGHEST';

  const traits = extractAllTraitsFromTokens(mainToks);
  if (traits.length > 0) {
    sel.trait = traits[0];
    if (traits.length > 1) sel.traits = traits;
  }

  const col = parseColorToken(mainToks);
  if (col.color) sel.color = col.color;
  if (col.notColor) sel.notColor = col.notColor;

  const withIdx = findWordSeq(mainToks, ['with']);
  if (withIdx >= 0) {
    const kws = extractKeywordsFromTokens(mainToks.slice(withIdx));
    if (kws.length > 0) sel.keyword = kws[0].name;
  }
  for (let i = 0; i < mainToks.length; i += 1) {
    if (mainToks[i].tokenType === TimingTag && mainToks[i].image === '【Destroyed】' && mainToks[i + 1]?.image.toLowerCase() === 'effect') {
      sel.hasDestroyedEffect = true;
    }
  }

  const quotes = extractQuotes(mainToks);
  if (quotes.length > 0) {
    if (hasWordSeq(mainToks, ['without', mainToks.find((t) => t.image.startsWith('"'))?.image ?? ''])) {
      sel.excludeName = quotes[0];
    } else {
      sel.nameContains = quotes[0];
    }
  }

  if (hasWordSeq(rawToks, ['from', 'your', 'trash']) || hasWordSeq(rawToks, ['in', 'your', 'trash']) ||
      hasWordSeq(rawToks, ['from', 'any', "player's", 'trash']) || hasWordSeq(rawToks, ['in', 'any', "player's", 'trash'])) {
    sel.zone = 'TRASH';
  } else if (hasWordSeq(rawToks, ['from', 'your', 'hand']) || hasWordSeq(rawToks, ['in', 'your', 'hand'])) {
    sel.zone = 'HAND';
  } else if (hasAnyWord(rawToks, ['shield', 'shields'])) {
    sel.zone = 'SHIELD';
  }

  return sel;
}

export { lowerDuration, lowerScaleMetric } from './lower-triggers.ts';
import { lowerTriggerEventFromTokens as lowerTriggerEventImpl } from './lower-triggers.ts';

export function lowerTriggerEventFromTokens(
  triggerToks: IToken[],
  extraCondToks: IToken[] | undefined,
  lowerCondFn: (toks: IToken[]) => EffectCondition | undefined
): { triggerEvent: TriggerEvent; extraCondition?: EffectCondition } {
  return lowerTriggerEventImpl(triggerToks, extraCondToks, lowerCondFn, lowerTargetSelector);
}
