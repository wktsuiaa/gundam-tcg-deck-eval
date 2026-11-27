import { type CstNode, type IToken, type TokenType } from 'chevrotain';
import type { CardColor } from '@/types/gundam';
import type { EffectTiming, KeywordAbility, PairFilter } from '../effect-parser.ts';
import { KEYWORD_NAMES } from './normalize.ts';
import {
  BracketName,
  ColorTok,
  KeywordTag,
  LvPrefix,
  NonColorTok,
  NumberTok,
  ParenToken,
  QuotedStr,
  ResCostTag,
  StatModTok,
} from './tokens.ts';

export function flattenCstTokens(node: CstNode | IToken | undefined): IToken[] {
  if (!node) return [];
  if ('image' in node && 'tokenType' in node) return [node];
  const out: IToken[] = [];
  const children = (node as CstNode).children;
  for (const key of Object.keys(children)) {
    for (const item of children[key]) {
      if ('image' in item && 'tokenType' in item) {
        out.push(item as IToken);
      } else if ('children' in item) {
        out.push(...flattenCstTokens(item as CstNode));
      }
    }
  }
  out.sort((a, b) => a.startOffset - b.startOffset);
  return out;
}

export function findWordSeq(toks: IToken[], seq: string[], start = 0): number {
  if (seq.length === 0) return -1;
  outer: for (let i = start; i + seq.length <= toks.length; i += 1) {
    for (let j = 0; j < seq.length; j += 1) {
      if (toks[i + j].image.toLowerCase() !== seq[j].toLowerCase()) continue outer;
    }
    return i;
  }
  return -1;
}

export function hasWordSeq(toks: IToken[], seq: string[]): boolean {
  return findWordSeq(toks, seq) >= 0;
}

export function hasAnyWord(toks: IToken[], words: string[]): boolean {
  const set = new Set(words.map((w) => w.toLowerCase()));
  return toks.some((t) => set.has(t.image.toLowerCase()));
}

export function stripParens(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && ((t[0] === '(' && t[t.length - 1] === ')') || (t[0] === '[' && t[t.length - 1] === ']') || (t[0] === '"' && t[t.length - 1] === '"') || (t[0] === '<' && t[t.length - 1] === '>'))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function extractTraitsFromParenString(inner: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < inner.length && depth > 0) {
        if (inner[j] === '(') depth += 1;
        else if (inner[j] === ')') depth -= 1;
        j += 1;
      }
      if (depth === 0) {
        const sub = inner.slice(i + 1, j - 1).trim();
        if (sub) out.push(sub);
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

export function extractAllTraitsFromTokens(toks: IToken[]): string[] {
  const out: string[] = [];
  for (const t of toks) {
    if (t.tokenType !== ParenToken) continue;
    const inner = stripParens(t.image);
    if (!inner || inner.includes('<DOT>')) {
      for (const nested of extractTraitsFromParenString(inner)) {
        out.push(nested);
      }
      continue;
    }
    if (inner.includes('(')) {
      for (const nested of extractTraitsFromParenString(inner)) {
        out.push(nested);
      }
      continue;
    }
    out.push(inner);
  }
  return out;
}

export function extractBrackets(toks: IToken[]): string[] {
  return toks.filter((t) => t.tokenType === BracketName).map((t) => stripParens(t.image));
}

export function extractQuotes(toks: IToken[]): string[] {
  return toks.filter((t) => t.tokenType === QuotedStr).map((t) => stripParens(t.image));
}

export function parseKeywordFromTag(raw: string): KeywordAbility | null {
  const inner = stripParens(raw);
  if (!inner) return null;
  const parts = inner.split(/\s+/);
  const last = parts[parts.length - 1];
  const isDigits = last.length > 0 && [...last].every((ch) => ch >= '0' && ch <= '9');
  const nameRaw = isDigits && parts.length > 1 ? parts.slice(0, -1).join(' ') : inner;
  const canonical = KEYWORD_NAMES[nameRaw.toLowerCase()];
  if (!canonical) return null;
  return { name: canonical, value: isDigits && parts.length > 1 ? Number.parseInt(last, 10) : null };
}

export function extractKeywordsFromTokens(toks: IToken[]): KeywordAbility[] {
  const out: KeywordAbility[] = [];
  for (const t of toks) {
    if (t.tokenType === KeywordTag || t.tokenType === BracketName) {
      const kw = parseKeywordFromTag(t.image);
      if (kw) out.push(kw);
    }
  }
  return out;
}

const COLOR_MAP: Record<string, CardColor> = {
  blue: 'Blue',
  green: 'Green',
  red: 'Red',
  purple: 'Purple',
  white: 'White',
  colorless: 'Colorless',
};

export function parseColorToken(toks: IToken[]): { color?: CardColor; notColor?: CardColor } {
  for (const t of toks) {
    if (t.tokenType === NonColorTok) {
      const key = t.image.toLowerCase().slice('non-'.length);
      return { notColor: COLOR_MAP[key] };
    }
    if (t.tokenType === ColorTok) {
      return { color: COLOR_MAP[t.image.toLowerCase()] };
    }
  }
  return {};
}

export function parseColorText(word: string | undefined): CardColor | undefined {
  if (!word) return undefined;
  return COLOR_MAP[word.trim().toLowerCase()];
}

export function parseIntTok(tok: IToken | undefined): number | undefined {
  if (!tok || tok.tokenType !== NumberTok) return undefined;
  const n = Number.parseInt(tok.image, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function parseResCostValue(tok: IToken): number | undefined {
  if (tok.tokenType !== ResCostTag) return undefined;
  const colon = tok.image.indexOf(':');
  const end = tok.image.indexOf('>');
  if (colon < 0 || end < 0) return undefined;
  const n = Number.parseInt(tok.image.slice(colon + 1, end), 10);
  return Number.isNaN(n) ? undefined : n;
}

export function parseStatModToken(tok: IToken): { stat: 'AP' | 'HP'; delta: number } | null {
  if (tok.tokenType !== StatModTok) return null;
  const upper = tok.image.toUpperCase();
  const stat: 'AP' | 'HP' = upper.startsWith('AP') ? 'AP' : 'HP';
  const rest = upper.slice(2).trim();
  const delta = Number.parseInt(rest, 10);
  if (Number.isNaN(delta)) return null;
  return { stat, delta };
}

export function parseLvConstraintFromTokens(toks: IToken[]): {
  lvMin?: number;
  lvMax?: number;
  lvExact?: number;
} {
  for (let i = 0; i < toks.length; i += 1) {
    if (toks[i].tokenType !== LvPrefix) continue;
    const num = parseIntTok(toks[i + 1]);
    if (num === undefined) continue;
    const w1 = toks[i + 2]?.image.toLowerCase();
    const w2 = toks[i + 3]?.image.toLowerCase();
    if (w1 === 'or' && w2 === 'lower') return { lvMax: num };
    if (w1 === 'or' && w2 === 'higher') return { lvMin: num };
    if (w1 === 'or' && w2 === 'less') return { lvMax: num };
    if (w1 === 'or' && w2 === 'more') return { lvMin: num };
    const prev1 = toks[i - 1]?.image.toLowerCase();
    const prev2 = toks[i - 2]?.image.toLowerCase();
    if (prev2 === 'that' && (prev1 === 'is' || prev1 === 'are')) {
      return { lvExact: num };
    }
    return { lvExact: num };
  }
  return {};
}

export function splitTokensBy(toks: IToken[], sepType: TokenType): IToken[][] {
  const parts: IToken[][] = [];
  let cur: IToken[] = [];
  for (const t of toks) {
    if (t.tokenType === sepType) {
      if (cur.length > 0) parts.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) parts.push(cur);
  return parts;
}

export function parseTimingTagString(
  rawTag: string,
  timings: Set<EffectTiming>,
  meta: { oncePerTurn: boolean; pairFilter?: PairFilter; devCost?: number; isPilotTag?: boolean }
): void {
  const inner =
    rawTag.startsWith('【') && rawTag.endsWith('】') ? rawTag.slice(1, -1).trim() : rawTag.trim();
  const segments = inner.split('<DOT>').map((s) => s.trim()).filter(Boolean);

  // Compound Activate･Main / Activate･Action check before per-segment loop
  let startIdx = 0;
  if (segments.length >= 2 && segments[0].toLowerCase() === 'activate') {
    const second = segments[1].toLowerCase();
    if (second === 'main') {
      timings.add('ACTIVATE_MAIN');
      startIdx = 2;
    } else if (second === 'action') {
      timings.add('ACTIVATE_ACTION');
      startIdx = 2;
    }
  } else if (inner.toLowerCase() === 'activate main') {
    timings.add('ACTIVATE_MAIN');
    return;
  } else if (inner.toLowerCase() === 'activate action') {
    timings.add('ACTIVATE_ACTION');
    return;
  }

  for (const seg of segments.slice(startIdx)) {
    const low = seg.toLowerCase();
    if (low === 'deploy') timings.add('DEPLOY');
    else if (low === 'attack') timings.add('ATTACK');
    else if (low === 'destroyed') timings.add('DESTROYED');
    else if (low === 'when paired') timings.add('WHEN_PAIRED');
    else if (low === 'when linked') timings.add('WHEN_LINKED');
    else if (low === 'during pair') timings.add('DURING_PAIR');
    else if (low === 'during link') timings.add('DURING_LINK');
    else if (low === 'burst') timings.add('BURST');
    else if (low === 'main') timings.add('MAIN');
    else if (low === 'action') timings.add('ACTION');
    else if (low === 'once per turn') meta.oncePerTurn = true;
    else if (low === 'pilot') meta.isPilotTag = true;
    else if (low.startsWith('development ')) {
      const val = Number.parseInt(low.slice('development '.length).trim(), 10);
      if (!Number.isNaN(val)) meta.devCost = val;
    } else if (seg.endsWith(' Pilot')) {
      const body = seg.slice(0, -' Pilot'.length).trim();
      const filter: PairFilter = meta.pairFilter ?? {};
      const traits = extractTraitsFromParenString(body);
      if (traits.length > 0) filter.trait = traits[0];
      const colWord = body.split(/\s+/).find((w) => COLOR_MAP[w.toLowerCase()]);
      if (colWord) filter.color = COLOR_MAP[colWord.toLowerCase()];
      const lvIdx = body.indexOf('Lv.');
      if (lvIdx >= 0) {
        const afterLv = body.slice(lvIdx + 3).trim();
        const lvNum = Number.parseInt(afterLv, 10);
        if (!Number.isNaN(lvNum)) {
          if (afterLv.toLowerCase().includes('higher')) filter.lvMin = lvNum;
          else if (afterLv.toLowerCase().includes('lower')) filter.lvMax = lvNum;
        }
      }
      meta.pairFilter = filter;
    }
  }
}

export function extractBracketAndParenFromCardLink(linkText: string): {
  names: string[];
  traits: string[];
} {
  const names: string[] = [];
  const traits: string[] = extractTraitsFromParenString(linkText);
  let i = 0;
  while (i < linkText.length) {
    if (linkText[i] === '[') {
      const close = linkText.indexOf(']', i + 1);
      if (close > i) {
        const n = linkText.slice(i + 1, close).trim();
        if (n) names.push(n);
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }
  return { names, traits };
}
