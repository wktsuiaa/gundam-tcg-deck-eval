import { extractAllTraits, parseColorWord, parseKeywordToken } from './text-utils.ts';
import { type EffectDuration, type ScaleMetric, type TargetSelector } from './types.ts';

export function parseTargetSelector(phrase: string): TargetSelector {
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

export function parseDuration(s: string): EffectDuration | undefined {
  if (/during this battle/i.test(s)) return 'THIS_BATTLE';
  if (/during this turn|until the end of this turn|until end of turn|this turn/i.test(s)) return 'THIS_TURN';
  if (/opponent'?s next turn/i.test(s)) return 'NEXT_TURN';
  return undefined;
}

export function parseScaleMetric(phrase: string): ScaleMetric | undefined {
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
