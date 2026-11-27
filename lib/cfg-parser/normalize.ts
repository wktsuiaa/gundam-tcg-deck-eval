import type { KeywordName } from '../effect-parser.ts';

export const CIRCLED_TO_INT: Record<string, number> = {
  '①': 1,
  '②': 2,
  '③': 3,
  '④': 4,
  '⑤': 5,
  '⑥': 6,
  '⑦': 7,
  '⑧': 8,
  '⑨': 9,
  '⑩': 10,
};

export const KEYWORD_NAMES: Record<string, KeywordName> = {
  repair: 'Repair',
  breach: 'Breach',
  support: 'Support',
  blocker: 'Blocker',
  'first strike': 'First Strike',
  'high-maneuver': 'High-Maneuver',
  suppression: 'Suppression',
};

export function stripReminderParentheticals(text: string): string {
  // Remove sentence-like rules reminders while preserving (Trait) and ((Trait)･AP3･HP3) tokens.
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') depth -= 1;
        j += 1;
      }
      const inner = text.slice(i + 1, j - 1);
      const isReminder =
        depth === 0 &&
        (/\s/.test(inner.trim()) &&
          (/^(When|This|Damage|All|Choose|Discard|If|Once|During|At|You|It|Only|A |An |The |While|Each|Units|Battle|Pairs|Tokens|Add|Place|Return|Rest|Destroy|Exile|Look|Reveal|Reduce|Increase|Deploy|Play|Pay|Before|After)/i.test(
            inner.trim()
          ) ||
            /\.$/.test(inner.trim())));
      if (isReminder) {
        i = j;
        continue;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

export function normalizeGlyphs(line: string): string {
  let out = line.replace(/：/g, '<COST_SEP>').replace(/･/g, '<DOT>').replace(/・/g, '<DOT>');
  for (const [glyph, num] of Object.entries(CIRCLED_TO_INT)) {
    out = out.replaceAll(glyph, `<RES_COST:${num}>`);
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

export function normalizeCardEffectText(rawEffect: string): string {
  if (!rawEffect || !rawEffect.trim() || rawEffect.trim() === '-') return '';
  const stripped = stripReminderParentheticals(rawEffect);
  const rawLines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const normalizedLines: string[] = [];
  let activeModalPrefix = '';
  let pendingFollowUpPrefix = '';
  let previousRawWasFollowingGrant = false;

  for (const rawLine of rawLines) {
    // Modal boilerplate line e.g. "【Action】When playing this card, choose 1 of the following effects and activate it："
    // or "【Deploy・Development 1】You may exile ... If you do, activate the following effect:"
    const modalIntroMatch = rawLine.match(
      /^((?:【[^】]+】(?:\s*\/\s*【[^】]+】)*)+)\s*(?:When playing this card,\s*choose 1 of the following effects and activate it[:：]|.*activate the following effect[:：])\s*$/i
    );
    if (modalIntroMatch) {
      const headers = modalIntroMatch[1];
      if (/Development\s+\d+/i.test(headers)) {
        const bodyPrefix = rawLine
          .slice(headers.length)
          .replace(/activate the following effect[:：]\s*$/i, '')
          .trim();
        activeModalPrefix = `${headers} ${bodyPrefix}`.trim();
        pendingFollowUpPrefix = activeModalPrefix;
      } else {
        activeModalPrefix = headers;
        pendingFollowUpPrefix = '';
      }
      previousRawWasFollowingGrant = false;
      continue;
    }

    if (previousRawWasFollowingGrant && normalizedLines.length > 0) {
      const subBody = rawLine.replace(/^■\s*/, '').trim();
      normalizedLines[normalizedLines.length - 1] = normalizeGlyphs(
        `${normalizedLines[normalizedLines.length - 1]} ${subBody}`
      );
      previousRawWasFollowingGrant = /following effect[^:：]*[:：]$/i.test(rawLine);
      continue;
    }

    if (/^■/.test(rawLine)) {
      const optionBody = rawLine.replace(/^■\s*/, '').trim();
      const combined = activeModalPrefix ? `${activeModalPrefix} ${optionBody}`.trim() : optionBody;
      pendingFollowUpPrefix = '';
      previousRawWasFollowingGrant = false;
      normalizedLines.push(normalizeGlyphs(combined));
      continue;
    }

    if (pendingFollowUpPrefix && !/^【/.test(rawLine)) {
      const combined = `${pendingFollowUpPrefix} ${rawLine}`.trim();
      pendingFollowUpPrefix = '';
      activeModalPrefix = '';
      previousRawWasFollowingGrant = false;
      normalizedLines.push(normalizeGlyphs(combined));
      continue;
    }

    activeModalPrefix = '';
    pendingFollowUpPrefix = '';
    previousRawWasFollowingGrant = /following effect[^:：]*[:：]$/i.test(rawLine);
    normalizedLines.push(normalizeGlyphs(rawLine));
  }

  return normalizedLines.join('\n');
}

export function getEffectSetPrefix(cardNo: string): string {
  const m = cardNo.match(/^([A-Za-z0-9]+)-/);
  const raw = m ? m[1] : 'MISC';
  return raw.replace(/[^A-Za-z0-9_-]/g, '_') || 'MISC';
}

