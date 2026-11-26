import type { CardColor } from '@/types/gundam';
import { CIRCLED_NUMS, extractAllTraits, parseColorWord, parseKeywordToken } from './text-utils.ts';
import { type EffectCondition, type KeywordName } from './types.ts';

export function parseBoardFilterFromText(c: string): {
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

export function parseSingleCondition(rawCond: string): EffectCondition {
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

export function parseCondition(condText: string): EffectCondition {
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

export function combineConditions(a: EffectCondition | undefined, b: EffectCondition | undefined): EffectCondition | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.kind === 'ALL_OF' && b.kind === 'ALL_OF') {
    return { kind: 'ALL_OF', conditions: [...a.conditions, ...b.conditions] };
  }
  if (a.kind === 'ALL_OF') return { kind: 'ALL_OF', conditions: [...a.conditions, b] };
  if (b.kind === 'ALL_OF') return { kind: 'ALL_OF', conditions: [a, ...b.conditions] };
  return { kind: 'ALL_OF', conditions: [a, b] };
}
