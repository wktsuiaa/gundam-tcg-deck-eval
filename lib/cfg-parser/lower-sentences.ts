import { type CstNode, type IToken } from 'chevrotain';
import type {
  EffectClause,
  EffectCondition,
  EffectStep,
  EffectTiming,
  LinkRequirement,
} from '../effect-parser.ts';
import { lowerConditionTokens } from './lower-conditions.ts';
import { consumeLookTopFollowUps, findTrailingLookTop } from './lower-looktop.ts';
import {
  lowerDuration,
  lowerTargetSelector,
  lowerTriggerEventFromTokens,
} from './lower-selectors.ts';
import { lowerBasicSentenceTokens, resolveSubjectTokens, type LoweringState } from './lower-steps-basic.ts';
import { Comma, Colon, CostSep, KwInstead, KwWhen, Period, TimingTag } from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractKeywordsFromTokens,
  findWordSeq,
  flattenCstTokens,
  hasAnyWord,
  hasWordSeq,
  parseIntTok,
  parseLvConstraintFromTokens,
  parseTimingTagString,
} from './token-utils.ts';

function lowerIfPreviousSucceeded(
  condToks: IToken[],
  thenToks: IToken[],
  state: LoweringState
): Extract<EffectStep, { action: 'IF_PREVIOUS_SUCCEEDED' }> | null {
  const low = condToks.map((t) => t.image.toLowerCase());
  const negated =
    hasWordSeq(condToks, ["you", "didn't"]) ||
    hasWordSeq(condToks, ["you", "don't"]) ||
    hasWordSeq(condToks, ['it', 'is', 'not']);

  const isPrevTrigger =
    hasWordSeq(condToks, ['if', 'you', 'do']) ||
    hasWordSeq(condToks, ['if', 'you', 'draw']) ||
    hasWordSeq(condToks, ['if', 'you', 'drew']) ||
    hasWordSeq(condToks, ['if', 'you', 'discard']) ||
    hasWordSeq(condToks, ['if', 'you', 'discarded']) ||
    hasWordSeq(condToks, ['if', 'you', 'place']) ||
    hasWordSeq(condToks, ['if', 'you', 'placed']) ||
    hasWordSeq(condToks, ['if', 'you', 'increase']) ||
    hasWordSeq(condToks, ['if', 'you', 'exile']) ||
    hasWordSeq(condToks, ['if', 'you', 'destroy']) ||
    hasWordSeq(condToks, ['if', 'you', 'destroyed']) ||
    hasWordSeq(condToks, ['if', 'a', 'unit', 'is', 'destroyed']) ||
    hasWordSeq(condToks, ['if', 'an', 'enemy', 'unit', 'is', 'destroyed']) ||
    hasWordSeq(condToks, ['if', 'they', 'don\'t']);

  if (!isPrevTrigger) return null;

  const lv = parseLvConstraintFromTokens(condToks);
  const traits = extractAllTraitsFromTokens(condToks);
  const drawAccepted = low.includes('draw') || low.includes('drew');
  const placedFromDeck = low.includes('place') || low.includes('placed');
  const filter = {
    ...(lv.lvMin !== undefined ? { lvMin: lv.lvMin } : {}),
    ...(traits.length > 0 ? { traits } : {}),
    ...(drawAccepted ? { drawAccepted: true } : {}),
    ...(placedFromDeck ? { placedFromDeck: true } : {}),
  };

  // Check if thenToks starts with "Choose X ... <rest>" where rest may sit inside follow-up sentences handled later
  const thenSteps = lowerBasicSentenceTokens(thenToks, state);
  return {
    action: 'IF_PREVIOUS_SUCCEEDED',
    ...(negated ? { negated: true } : {}),
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
    thenSteps,
  };
}

function buildInlineGrantClause(
  timings: EffectTiming[],
  triggerToks: IToken[] | undefined,
  bodySentences: IToken[][],
  state: LoweringState,
  buildLinkReqFn?: (timings: EffectTiming[]) => LinkRequirement | undefined
): EffectClause {
  const triggerParsed = triggerToks
    ? lowerTriggerEventFromTokens(triggerToks, undefined, lowerConditionTokens)
    : undefined;
  const allTimings = new Set<EffectTiming>(timings);
  if (triggerParsed) allTimings.add(triggerParsed.triggerEvent.kind);
  const tList = [...allTimings];
  const resolvedTimings: EffectTiming[] = tList.length > 0 ? tList : ['CONTINUOUS'];
  const linkReq = buildLinkReqFn?.(resolvedTimings);

  const steps: EffectStep[] = [];
  for (const sToks of bodySentences) {
    steps.push(...lowerSentenceTokenSlice(sToks, state, steps));
  }
  const raw = [
    ...(triggerToks ? [triggerToks.map((t) => t.image).join(' ') + ','] : []),
    ...bodySentences.map((s) => s.map((t) => t.image).join(' ')),
  ].join(' ');

  return {
    raw,
    timings: resolvedTimings,
    oncePerTurn: false,
    ...(triggerParsed ? { triggerEvent: triggerParsed.triggerEvent } : {}),
    ...(triggerParsed?.extraCondition ? { condition: triggerParsed.extraCondition } : {}),
    ...(linkReq ? { linkRequirement: linkReq } : {}),
    steps,
  };
}

function lowerSentenceTokenSlice(
  sentToks: IToken[],
  state: LoweringState,
  _priorSteps: EffectStep[]
): EffectStep[] {
  if (sentToks.length === 0) return [];
  return lowerBasicSentenceTokens(sentToks, state);
}

export function lowerSentenceNodes(
  sentenceNodes: CstNode[],
  state: LoweringState,
  buildLinkReqFn?: (timings: EffectTiming[]) => LinkRequirement | undefined
): { steps: EffectStep[]; inlineCondition?: EffectCondition; modalGroup?: string } {
  const steps: EffectStep[] = [];

  // Flatten each sentence CST node to check cross-sentence idioms cleanly:
  // e.g. "If you deploy ..., choose 1 enemy Unit." + "Destroy it." (merge Choose + anaphoric follow-up)
  let i = 0;
  while (i < sentenceNodes.length) {
    const node = sentenceNodes[i];
    const ch = node.children;

    // 1. Grant effect sentence: "... gains the following effect [during this turn/battle] (:|<COST_SEP>) <body...>"
    if (ch.grantEffectSentence) {
      const gNode = ch.grantEffectSentence[0] as CstNode;
      const gCh = gNode.children;
      const allG = flattenCstTokens(gNode);
      const sepIdx = allG.findIndex((t) => t.tokenType === CostSep || t.tokenType === Colon);
      const headToks = sepIdx >= 0 ? allG.slice(0, sepIdx) : allG;
      const gainsIdx = findWordSeq(headToks, ['gains']);
      const subjToks = gainsIdx > 0 ? headToks.slice(0, gainsIdx) : headToks;
      const target = resolveSubjectTokens(subjToks, state);
      const duration = lowerDuration(headToks) ?? 'THIS_TURN';

      const subTimings = new Set<EffectTiming>();
      const meta = { oncePerTurn: false };
      for (const tp of (gCh.timingPrefix ?? []) as CstNode[]) {
        for (const t of flattenCstTokens(tp)) {
          if (t.tokenType === TimingTag) parseTimingTagString(t.image, subTimings, meta);
        }
      }
      if (gCh.turnPhaseLead) {
        const tpToks = flattenCstTokens(gCh.turnPhaseLead[0] as CstNode);
        if (hasWordSeq(tpToks, ['at', 'the', 'end'])) subTimings.add('END_OF_TURN');
        else if (hasWordSeq(tpToks, ['at', 'the', 'start'])) subTimings.add('START_OF_OPPONENT_TURN');
      }
      const triggerToks = gCh.whenTriggerClause
        ? flattenCstTokens(gCh.whenTriggerClause[0] as CstNode)
        : undefined;
      const bodyNodes = (gCh.simpleSentenceUnit ?? []) as CstNode[];
      const bodySentences = bodyNodes.map((bn) => flattenCstTokens(bn));
      const subState: LoweringState = { depth: state.depth + 1 };
      const clause = buildInlineGrantClause([...subTimings], triggerToks, bodySentences, subState, buildLinkReqFn);
      steps.push({ action: 'GRANT_CLAUSE', clause, duration, target });
      i += 1;
      continue;
    }

    // 2. Duration lead sentence ("During this turn/battle, when/if ...")
    if (ch.durationLeadSentence) {
      const dNode = ch.durationLeadSentence[0] as CstNode;
      const dCh = dNode.children;
      const allD = flattenCstTokens(dNode);
      const commaIdx = allD.findIndex((t) => t.tokenType === Comma);
      const leadToks = commaIdx >= 0 ? allD.slice(0, commaIdx) : allD;
      const duration = lowerDuration(leadToks) ?? 'THIS_TURN';

      if (dCh.whenTriggerSentence) {
        const wNode = dCh.whenTriggerSentence[0] as CstNode;
        const whenToks = flattenCstTokens(wNode.children.whenTriggerClause[0] as CstNode);
        const bodyToks = flattenCstTokens(wNode).slice(whenToks.length);
        // Check if this is "when <target> receives ... damage ..., reduce it by N" (DAMAGE_PROOF)
        if (hasAnyWord(whenToks, ['receive', 'receives']) && hasAnyWord(whenToks, ['damage']) && hasWordSeq(bodyToks, ['reduce'])) {
          const trg = lowerTriggerEventFromTokens(whenToks, undefined, lowerConditionTokens);
          const dmgSteps = lowerBasicSentenceTokens(bodyToks, state);
          for (const ds of dmgSteps) {
            if (ds.action === 'DAMAGE_PROOF') {
              ds.duration = duration;
              ds.damageType = trg.triggerEvent.damageType ?? 'ANY';
              ds.target = trg.triggerEvent.targetKind === 'SHIELD'
                ? { owner: 'SELF', cardType: 'SHIELD', count: 1 }
                : state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' };
              if (!ds.sourceFilter) {
                const fromIdx = findWordSeq(whenToks, ['from']);
                if (fromIdx >= 0) {
                  ds.sourceFilter = lowerTargetSelector(whenToks.slice(fromIdx + 1));
                } else if (hasAnyWord(whenToks, ['enemy', 'opponent'])) {
                  ds.sourceFilter = { owner: 'ENEMY' };
                }
              }
            }
          }
          steps.push(...dmgSteps);
          i += 1;
          continue;
        }

        // Otherwise reactive triggered grant clause ("During this turn, when a friendly ... destroys ..., <body + followups>")
        const subState: LoweringState = { chosenTarget: state.chosenTarget, depth: state.depth + 1 };
        const initSteps = lowerBasicSentenceTokens(bodyToks, subState);
        const lookStep = findTrailingLookTop(initSteps);
        if (lookStep) {
          const { extraSteps, nextIdx, consumedRaw } = consumeLookTopFollowUps(lookStep, sentenceNodes, i + 1);
          const triggerParsed = lowerTriggerEventFromTokens(whenToks, undefined, lowerConditionTokens);
          const resolvedTimings: EffectTiming[] = [triggerParsed.triggerEvent.kind];
          const linkReq = buildLinkReqFn?.(resolvedTimings);
          const clause: EffectClause = {
            raw: [whenToks.map((t) => t.image).join(' ') + ',', bodyToks.map((t) => t.image).join(' '), ...consumedRaw].join(' '),
            timings: resolvedTimings,
            oncePerTurn: false,
            triggerEvent: triggerParsed.triggerEvent,
            ...(triggerParsed.extraCondition ? { condition: triggerParsed.extraCondition } : {}),
            ...(linkReq ? { linkRequirement: linkReq } : {}),
            steps: [...initSteps, ...extraSteps],
          };
          steps.push({
            action: 'GRANT_CLAUSE',
            clause,
            duration,
            target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
          });
          i = nextIdx;
          continue;
        }

        const followToksList: IToken[][] = [bodyToks];
        while (i + 1 < sentenceNodes.length) {
          const nextToks = flattenCstTokens(sentenceNodes[i + 1]);
          // Attach anaphoric follow-ups ("Set it as active", "It can't attack during this turn")
          const firstN = nextToks[0]?.image.toLowerCase();
          if (
            firstN === 'set' ||
            firstN === 'it' ||
            firstN === 'they' ||
            hasWordSeq(nextToks, ['destroy', 'it']) ||
            hasWordSeq(nextToks, ['deal'])
          ) {
            followToksList.push(nextToks);
            i += 1;
          } else {
            break;
          }
        }
        const clause = buildInlineGrantClause([], whenToks, followToksList, { chosenTarget: state.chosenTarget, depth: state.depth + 1 }, buildLinkReqFn);
        steps.push({
          action: 'GRANT_CLAUSE',
          clause,
          duration,
          target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
        });
        i += 1;
        continue;
      }

      if (dCh.conditionalSentence) {
        // E.g. GD03-120: "During this turn, if a friendly ... destroys an enemy Unit with battle damage, choose ... Set it as active. It can't attack..."
        const cNode = dCh.conditionalSentence[0] as CstNode;
        const cCondToks = flattenCstTokens(cNode.children.conditionExpr?.[0] as CstNode);
        const allC = flattenCstTokens(cNode);
        const comma2Idx = allC.findIndex((t) => t.tokenType === Comma);
        const bodyToks = comma2Idx >= 0 ? allC.slice(comma2Idx + 1) : allC;
        if (hasAnyWord(cCondToks, ['destroy', 'destroys', 'destroyed']) && hasWordSeq(cCondToks, ['battle', 'damage'])) {
          const trigToks = cCondToks;
          const followToksList: IToken[][] = [bodyToks];
          while (i + 1 < sentenceNodes.length) {
            const nextToks = flattenCstTokens(sentenceNodes[i + 1]);
            followToksList.push(nextToks);
            i += 1;
          }
          const subState: LoweringState = { chosenTarget: state.chosenTarget, depth: state.depth + 1 };
          const clause = buildInlineGrantClause([], trigToks, followToksList, subState, buildLinkReqFn);
          steps.push({
            action: 'GRANT_CLAUSE',
            clause,
            duration,
            target: { owner: 'SELF', self: true, cardType: 'UNIT' },
          });
          i += 1;
          continue;
        }
      }

      // Simple duration lead ("During this turn, this Unit gets AP+2 and ...")
      const bodyToks = commaIdx >= 0 ? allD.slice(commaIdx + 1) : allD;
      const andIdx = findWordSeq(bodyToks, ['and']);
      if (andIdx > 0 && hasAnyWord(bodyToks.slice(andIdx), ['if'])) {
        const part1 = bodyToks.slice(0, andIdx);
        const part2 = bodyToks.slice(andIdx + 1);
        const p1Steps = lowerBasicSentenceTokens([...leadToks, ...part1], state);
        steps.push(...p1Steps);
        const commaP2 = part2.findIndex((t) => t.tokenType === Comma);
        if (commaP2 > 0) {
          const cond = lowerConditionTokens(part2.slice(0, commaP2));
          const thenSteps = lowerBasicSentenceTokens(part2.slice(commaP2 + 1), state);
          if (cond) {
            steps.push({ action: 'IF_CONDITION', condition: cond, thenSteps });
            i += 1;
            continue;
          }
        }
      }
      steps.push(...lowerBasicSentenceTokens(allD, state));
      i += 1;
      continue;
    }

    // 3. WhenTrigger sentence (e.g. "When it destroys an enemy Unit with battle damage during this turn, draw 1.")
    if (ch.whenTriggerSentence) {
      const wNode = ch.whenTriggerSentence[0] as CstNode;
      const whenToks = flattenCstTokens(wNode.children.whenTriggerClause[0] as CstNode);
      const bodyToks = flattenCstTokens(wNode).slice(whenToks.length);
      const duration = lowerDuration(whenToks) ?? 'THIS_TURN';
      const subState: LoweringState = { chosenTarget: state.chosenTarget, depth: state.depth + 1 };
      const clause = buildInlineGrantClause([], whenToks, [bodyToks], subState, buildLinkReqFn);
      const lookStep = findTrailingLookTop(clause.steps);
      let nextIdx = i + 1;
      if (lookStep) {
        const res = consumeLookTopFollowUps(lookStep, sentenceNodes, i + 1);
        clause.steps.push(...res.extraSteps);
        if (res.consumedRaw.length > 0) {
          clause.raw = [clause.raw, ...res.consumedRaw].join(' ');
        }
        nextIdx = res.nextIdx;
      }
      steps.push({
        action: 'GRANT_CLAUSE',
        clause,
        duration,
        target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
      });
      i = nextIdx;
      continue;
    }

    // 4. Conditional sentence ("If X, action." or "If X, action instead.")
    if (ch.conditionalSentence) {
      const cNode = ch.conditionalSentence[0] as CstNode;
      const leadCondTok = (cNode.children.KwIf?.[0] ?? cNode.children.KwWhile?.[0]) as IToken | undefined;
      const exprToks = flattenCstTokens(cNode.children.conditionExpr?.[0] as CstNode);
      const condToks = leadCondTok ? [leadCondTok, ...exprToks] : exprToks;
      const allC = flattenCstTokens(cNode);
      const condEndOffset = exprToks.length > 0 ? exprToks[exprToks.length - 1].endOffset ?? 0 : 0;
      const commaTok = (cNode.children.Comma ?? []).find(
        (t) => (t as IToken).startOffset > condEndOffset
      ) as IToken | undefined;
      const splitOffset = commaTok?.endOffset ?? condEndOffset;
      const cleanBody = allC.filter((t) => t.startOffset > splitOffset);
      const isInstead = cleanBody.some((t) => t.tokenType === KwInstead);

      // Check IF_PREVIOUS_SUCCEEDED first
      const ifPrev = lowerIfPreviousSucceeded(condToks, cleanBody, state);
      if (ifPrev) {
        // Merge if body is ONLY "Choose X" and next sentence acts on "it"
        if (ifPrev.thenSteps.length === 0 && i + 1 < sentenceNodes.length && state.chosenTarget) {
          const nextToks = flattenCstTokens(sentenceNodes[i + 1]);
          ifPrev.thenSteps.push(...lowerBasicSentenceTokens(nextToks, state));
          i += 1;
        }
        let nextIdx = i + 1;
        const lookStep = findTrailingLookTop(ifPrev.thenSteps);
        if (lookStep) {
          const res = consumeLookTopFollowUps(lookStep, sentenceNodes, nextIdx);
          ifPrev.thenSteps.push(...res.extraSteps);
          nextIdx = res.nextIdx;
        }
        steps.push(ifPrev);
        i = nextIdx;
        continue;
      }

      // General conditional sentence -> IF_CONDITION
      const cond = lowerConditionTokens(condToks);
      let thenSteps = lowerBasicSentenceTokens(cleanBody, state);
      // Wait: if cleanBody is only "choose 1 ... instead" (ST02-016 / GD01-122 / etc.) or "AP-6 instead" (GD06-121), thenSteps handles it; if cleanBody ONLY set chosenTarget, merge next sentence!
      if (thenSteps.length === 0 && state.chosenTarget) {
        const lastAction = [...steps].reverse().find((s) => s.action !== 'IF_CONDITION');
        if (lastAction && 'target' in lastAction && lastAction.target) {
          thenSteps = [{ ...lastAction, target: state.chosenTarget } as EffectStep];
        } else if (i + 1 < sentenceNodes.length) {
          const nextToks = flattenCstTokens(sentenceNodes[i + 1]);
          thenSteps = lowerBasicSentenceTokens(nextToks, state);
          i += 1;
        }
      }
      let nextIdx = i + 1;
      const lookStep = findTrailingLookTop(thenSteps);
      if (lookStep) {
        const res = consumeLookTopFollowUps(lookStep, sentenceNodes, nextIdx);
        thenSteps.push(...res.extraSteps);
        nextIdx = res.nextIdx;
      }
      if (cond) {
        steps.push({
          action: 'IF_CONDITION',
          condition: cond,
          thenSteps,
          ...(isInstead && priorHasSteps(steps) ? { replacesPrevious: true } : {}),
        });
      } else {
        steps.push(...thenSteps);
      }
      i = nextIdx;
      continue;
    }

    // 5. Imperative or Subject-Predicate sentence
    const sToks = flattenCstTokens(node);
    const sSteps = lowerBasicSentenceTokens(sToks, state);
    let nextIdx = i + 1;
    const lookStep = findTrailingLookTop(sSteps);
    if (lookStep) {
      const res = consumeLookTopFollowUps(lookStep, sentenceNodes, nextIdx);
      sSteps.push(...res.extraSteps);
      nextIdx = res.nextIdx;
    }
    steps.push(...sSteps);
    i = nextIdx;
  }

  return { steps };
}

function priorHasSteps(steps: EffectStep[]): boolean {
  return steps.length > 0;
}

// Keep unused imports clean
void Period;
void KwWhen;
void extractKeywordsFromTokens;
void parseIntTok;
