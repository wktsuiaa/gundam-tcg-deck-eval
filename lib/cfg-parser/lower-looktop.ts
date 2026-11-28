import { type CstNode } from 'chevrotain';
import type { EffectStep, TargetSelector } from '../effect-parser.ts';
import { lowerTargetSelector } from './lower-selectors.ts';
import { Comma, VDeploy, VPair, VReveal } from './tokens.ts';
import { findWordSeq, flattenCstTokens, hasAnyWord, hasWordSeq } from './token-utils.ts';

export type LookTopStep = Extract<EffectStep, { action: 'LOOK_TOP' }>;

export function findTrailingLookTop(steps: EffectStep[]): LookTopStep | undefined {
  const last = steps[steps.length - 1];
  return last?.action === 'LOOK_TOP' ? last : undefined;
}

export function consumeLookTopFollowUps(
  lookStep: LookTopStep,
  sentenceNodes: CstNode[],
  startIdx: number
): { extraSteps: EffectStep[]; nextIdx: number; consumedRaw: string[] } {
  const extraSteps: EffectStep[] = [];
  const consumedRaw: string[] = [];
  let idx = startIdx;

  while (idx < sentenceNodes.length) {
    const nextNode = sentenceNodes[idx];
    const nToks = flattenCstTokens(nextNode);

    if (
      hasWordSeq(nToks, ['if', 'it', 'is']) &&
      hasAnyWord(nToks, ['reveal']) &&
      (hasWordSeq(nToks, ['add', 'it', 'to', 'your', 'hand']) || hasWordSeq(nToks, ['add', 'them', 'to', 'your', 'hand']))
    ) {
      const isIdx = findWordSeq(nToks, ['if', 'it', 'is']);
      const commaIdx = nToks.findIndex((t, p) => p > isIdx + 2 && t.tokenType === Comma);
      const filterToks = commaIdx > isIdx + 2 ? nToks.slice(isIdx + 3, commaIdx) : nToks.slice(isIdx + 3);
      const sel = lowerTargetSelector(filterToks);
      if (sel.owner === 'ANY') sel.owner = 'SELF';
      sel.zone = 'DECK';
      lookStep.revealSearch = true;
      lookStep.target = sel;
      if (sel.trait) lookStep.trait = sel.trait;
      consumedRaw.push(nToks.map((t) => t.image).join(' '));
      idx += 1;
      continue;
    }

    if (
      hasAnyWord(nToks, ['reveal']) &&
      hasWordSeq(nToks, ['among', 'them']) &&
      (hasWordSeq(nToks, ['add', 'it', 'to', 'your', 'hand']) || hasWordSeq(nToks, ['add', 'them', 'to', 'your', 'hand']))
    ) {
      const revIdx = nToks.findIndex((t) => t.tokenType === VReveal);
      const amongIdx = findWordSeq(nToks, ['among', 'them'], revIdx + 1);
      const filterToks = nToks.slice(revIdx + 1, amongIdx);
      const sel = lowerTargetSelector(filterToks);
      if (sel.owner === 'ANY') sel.owner = 'SELF';
      sel.zone = 'DECK';
      lookStep.revealSearch = true;
      lookStep.target = sel;
      if (sel.trait) lookStep.trait = sel.trait;
      consumedRaw.push(nToks.map((t) => t.image).join(' '));
      idx += 1;
      continue;
    }

    if (hasWordSeq(nToks, ['among', 'them']) && nToks.some((t) => t.tokenType === VDeploy)) {
      const depIdx = nToks.findIndex((t) => t.tokenType === VDeploy);
      const amongIdx = findWordSeq(nToks, ['among', 'them'], depIdx + 1);
      const filterToks = nToks.slice(depIdx + 1, amongIdx);
      const sel = lowerTargetSelector(filterToks);
      if (sel.owner === 'ANY') sel.owner = 'SELF';
      sel.zone = 'DECK';
      if (sel.trait && !lookStep.trait) lookStep.trait = sel.trait;
      extraSteps.push({ action: 'DEPLOY_FROM_TOP_DECK', target: sel });
      consumedRaw.push(nToks.map((t) => t.image).join(' '));
      idx += 1;
      continue;
    }

    if (hasWordSeq(nToks, ['among', 'them']) && nToks.some((t) => t.tokenType === VPair)) {
      const pairIdx = nToks.findIndex((t) => t.tokenType === VPair);
      const amongIdx = findWordSeq(nToks, ['among', 'them'], pairIdx + 1);
      const filterToks = nToks.slice(pairIdx + 1, amongIdx);
      const pilotSel = lowerTargetSelector(filterToks);
      if (pilotSel.owner === 'ANY') pilotSel.owner = 'SELF';
      pilotSel.zone = 'DECK';
      if (pilotSel.trait && !lookStep.trait) lookStep.trait = pilotSel.trait;
      const withIdx = findWordSeq(nToks, ['with'], amongIdx + 2);
      const unitTarget: TargetSelector =
        withIdx >= 0 ? lowerTargetSelector(nToks.slice(withIdx + 1)) : { owner: 'SELF', self: true, cardType: 'UNIT' };
      extraSteps.push({ action: 'PAIR_FROM_HAND', target: unitTarget, pilotFilter: pilotSel });
      consumedRaw.push(nToks.map((t) => t.image).join(' '));
      idx += 1;
      continue;
    }

    if (
      !nextNode.children.conditionalSentence &&
      !hasAnyWord(nToks, ['if']) &&
      (hasWordSeq(nToks, ['remaining', 'card']) ||
        hasWordSeq(nToks, ['remaining', 'cards']) ||
        hasWordSeq(nToks, ['return', 'it', 'to']))
    ) {
      const topIdx = findWordSeq(nToks, ['top']);
      const trashIdx = findWordSeq(nToks, ['trash']);
      if (topIdx >= 0 && (trashIdx < 0 || topIdx < trashIdx)) {
        lookStep.remainderPosition = 'TOP';
      } else if (trashIdx >= 0) {
        lookStep.trashRest = true;
        lookStep.remainderPosition = 'TRASH';
      } else {
        lookStep.remainderPosition = 'BOTTOM';
      }
      consumedRaw.push(nToks.map((t) => t.image).join(' '));
      idx += 1;
      continue;
    }

    break;
  }

  return { extraSteps, nextIdx: idx, consumedRaw };
}
