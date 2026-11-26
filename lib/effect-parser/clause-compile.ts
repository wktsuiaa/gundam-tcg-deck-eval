import type { GundamCardPrint } from '@/types/gundam';
import { combineConditions, parseCondition } from './conditions.ts';
import { parseMultiSentenceSteps, parseSentenceSteps } from './sentence-steps.ts';
import { extractAllTraits, parseCost, parseHeaderTag, parseKeywordToken, stripReminderText } from './text-utils.ts';
import { parseLeadingWhenTrigger } from './triggers.ts';
import { type ActivationCost, type EffectClause, type EffectCondition, type EffectStep, type EffectTiming, type KeywordAbility, type LinkRequirement, type ParsedCardEffects, type TargetSelector, type TriggerEvent } from './types.ts';

export function buildLinkRequirement(
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

export function splitSentencesSmart(text: string): string[] {
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

export function compileSingleClauseLine(
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
