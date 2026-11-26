import type { GundamCardPrint } from '@/types/gundam';
import { parseBattleSentence, parseFallbackSentence } from './battle-sentences.ts';
import { parseBasicSentence, parseCardFlowSentence } from './card-sentences.ts';
import { compileSingleClauseLine, splitSentencesSmart } from './clause-compile.ts';
import { parseConditionalSentence } from './conditional-sentences.ts';
import { parseTargetSelector } from './selectors.ts';
import { type EffectClause, type EffectStep, type TargetSelector } from './types.ts';
import { parseBoardStateSentence, parseDamageAndStatSentence } from './unit-sentences.ts';

export function parseSubClause(
  rawText: string,
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>,
  depth = 1
): EffectClause {
  return compileSingleClauseLine(rawText, card, [], [], depth);
}

export function parseMultiSentenceSteps(
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

export interface SentenceState {
  chosenTarget?: TargetSelector;
  steps: EffectStep[];
  residual: string[];
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'name' | 'traits' | 'link'>;
  depth?: number;
}

export interface SentenceContext {
  s: string;
  optional: boolean;
  depth: number;
  state: SentenceState;
  resolveTarget: (phrase: string) => TargetSelector;
}

export function stripOptionalPrefix(ctx: SentenceContext): boolean {
  const mayM = ctx.s.match(/^(?:you|they) may\s+(.+)$/i);
  if (mayM) {
    ctx.optional = true;
    ctx.s = mayM[1].trim();
  }

  return false;
}

// Order matters: the first rule that recognises the sentence consumes it.
export const SENTENCE_RULES: Array<(ctx: SentenceContext) => boolean> = [
  parseConditionalSentence,
  stripOptionalPrefix,
  parseBasicSentence,
  parseCardFlowSentence,
  parseDamageAndStatSentence,
  parseBoardStateSentence,
  parseBattleSentence,
  parseFallbackSentence,
];

export function parseSentenceSteps(sent: string, state: SentenceState) {
  const s = sent.replace(/^(?:Then,?\s*|Also,?\s*|After activating this card'?s 【[^】]+】,?\s*)/i, '').trim();
  if (!s) return;

  const ctx: SentenceContext = {
    s,
    optional: false,
    depth: state.depth ?? 0,
    state,
    resolveTarget: (phrase: string): TargetSelector => {
      const p = phrase.trim();
      if (/^(it|they|them|that unit|that enemy unit|that card|those units|that unit\/base)$/i.test(p) && state.chosenTarget) {
        return state.chosenTarget;
      }
      if (/^this unit$/i.test(p)) return { owner: 'SELF', self: true, cardType: 'UNIT' };
      return parseTargetSelector(p);
    },
  };
  for (const rule of SENTENCE_RULES) {
    if (rule(ctx)) return;
  }
  state.residual.push(sent);
}
