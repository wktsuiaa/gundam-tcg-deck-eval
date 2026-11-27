import { type CstNode } from 'chevrotain';
import type {
  ActivationCost,
  EffectCondition,
  EffectTiming,
  LinkRequirement,
  TargetSelector,
  TriggerEvent,
} from '../effect-parser.ts';
import type {
  EffectClauseAst,
  ReplacementEffectAst,
  ReplacementEventKind,
  ReplacementOutcome,
} from './ast.ts';
import { extractHeaderMeta, liftContinuousModifier, lowerLeadCondition } from './lift-modifiers.ts';
import { combineConditions, lowerConditionTokens } from './lower-conditions.ts';
import {
  lowerDuration,
  lowerTargetSelector,
  lowerTriggerEventFromTokens,
} from './lower-selectors.ts';
import { lowerSentenceNodes } from './lower-sentences.ts';
import { type LoweringState } from './lower-steps-basic.ts';
import { NumberTok, VDestroy, VDiscard, VExile, VRest, VReturn } from './tokens.ts';
import {
  findWordSeq,
  flattenCstTokens,
  hasAnyWord,
  hasWordSeq,
  parseIntTok,
  parseResCostValue,
} from './token-utils.ts';

export { liftContinuousModifier };

function lowerCostNode(costNode: CstNode | undefined): ActivationCost | undefined {
  if (!costNode) return undefined;
  const toks = flattenCstTokens(costNode);
  if (toks.length === 0) return undefined;

  const cost: ActivationCost = {};
  const itemNodes = (costNode.children.costItem ?? []) as CstNode[];
  for (const item of itemNodes) {
    const itoks = flattenCstTokens(item);
    for (const t of itoks) {
      const resVal = parseResCostValue(t);
      if (resVal !== undefined) cost.resourceCost = resVal;
    }
    const head = itoks[0];
    if (!head) continue;
    if (head.tokenType === VRest && (hasWordSeq(itoks, ['this', 'unit']) || hasWordSeq(itoks, ['this', 'base']))) {
      cost.restSelf = true;
    } else if (head.tokenType === VDestroy && hasWordSeq(itoks, ['this', 'unit'])) {
      cost.destroySelf = true;
    } else if (head.tokenType === VReturn && hasWordSeq(itoks, ['this', 'unit']) && hasAnyWord(itoks, ['deck', 'bottom'])) {
      cost.returnSelfToDeckBottom = true;
    } else if (head.tokenType === VDiscard) {
      cost.discardCount = parseIntTok(itoks.find((t) => t.tokenType === NumberTok)) ?? 1;
    } else if (head.tokenType === VExile) {
      cost.exileFromTrashCount = parseIntTok(itoks.find((t) => t.tokenType === NumberTok)) ?? 1;
      cost.exileFilter = lowerTargetSelector(itoks.slice(1));
    }
  }
  return cost;
}

export function liftReplacementEffect(
  clauseIndex: number,
  raw: string,
  cst: CstNode
): ReplacementEffectAst {
  const ch = cst.children;
  const { timings, meta } = extractHeaderMeta((ch.timingPrefix ?? []) as CstNode[]);
  const scope: ReplacementEffectAst['scope'] = timings.has('DURING_LINK')
    ? 'LINKED'
    : timings.has('DURING_PAIR')
    ? 'PAIRED'
    : 'ACTIVE_ZONE';

  const turnPhaseNode = ch.turnPhaseLead?.[0] as CstNode | undefined;
  const whenNode = ch.whenTriggerClause?.[0] as CstNode | undefined;
  const condFromTurn = lowerLeadCondition(turnPhaseNode, undefined, timings);

  const whenToks = whenNode ? flattenCstTokens(whenNode) : [];
  const sentToks = ((ch.sentenceUnit ?? []) as CstNode[]).flatMap((sn) => flattenCstTokens(sn));
  const fullEventToks = [...whenToks, ...sentToks];

  const intercepts: ReplacementEventKind =
    hasAnyWord(fullEventToks, ['receive']) && hasAnyWord(fullEventToks, ['damage'])
      ? 'WOULD_TAKE_DAMAGE'
      : hasAnyWord(fullEventToks, ['rest'])
      ? 'WOULD_REST'
      : hasWordSeq(fullEventToks, ['would', 'be', 'destroyed'])
      ? 'WOULD_BE_DESTROYED'
      : 'WOULD_MOVE_ZONE';

  const duration = lowerDuration(fullEventToks) ?? 'CONTINUOUS';
  const optional = hasWordSeq(sentToks, ['you', 'may']);

  let subject: TargetSelector = { owner: 'SELF', self: true, cardType: 'UNIT' };
  let sourceFilter: TargetSelector | undefined;
  let outcome: ReplacementOutcome;

  if (intercepts === 'WOULD_TAKE_DAMAGE') {
    const damageType: 'BATTLE' | 'EFFECT' | 'ANY' = hasWordSeq(whenToks, ['battle', 'damage'])
      ? 'BATTLE'
      : hasWordSeq(whenToks, ['effect', 'damage'])
      ? 'EFFECT'
      : 'ANY';
    const fromIdx = findWordSeq(whenToks, ['from']);
    if (fromIdx >= 0) {
      sourceFilter = lowerTargetSelector(whenToks.slice(fromIdx + 1));
    }
    outcome = { kind: 'PREVENT_DAMAGE', damageType };
  } else if (intercepts === 'WOULD_REST') {
    // e.g. GD05-124 "you may rest this Base instead", GD03-079 "you may rest this Unit instead"
    const isBase = hasWordSeq(sentToks, ['this', 'base']);
    const target: TargetSelector = isBase
      ? { owner: 'SELF', self: true, cardType: 'BASE' }
      : { owner: 'SELF', self: true, cardType: 'UNIT' };
    subject = target;
    outcome = { kind: 'REST_OTHER', target };
  } else if (intercepts === 'WOULD_BE_DESTROYED') {
    outcome = { kind: 'PREVENT_DESTROY', target: subject };
  } else {
    outcome = { kind: 'PREVENT_MOVE', target: subject };
  }

  return {
    kind: 'REPLACEMENT_EFFECT',
    clauseIndex,
    raw,
    scope,
    intercepts,
    subject,
    ...(sourceFilter ? { sourceFilter } : {}),
    ...(meta.pairFilter ? { pairFilter: meta.pairFilter } : {}),
    ...(meta.oncePerTurn ? { oncePerTurn: true } : {}),
    ...(condFromTurn ? { condition: condFromTurn } : {}),
    optional,
    duration,
    outcome,
    maxPerEventInstance: 1,
  };
}

export function liftEffectClause(
  clauseIndex: number,
  raw: string,
  cst: CstNode,
  buildLinkReqFn: (timings: EffectTiming[]) => LinkRequirement | undefined
): EffectClauseAst {
  const ch = cst.children;
  const { timings, meta } = extractHeaderMeta((ch.timingPrefix ?? []) as CstNode[]);
  const cost = lowerCostNode(ch.costPrefix?.[0] as CstNode | undefined);
  let condition: EffectCondition | undefined = ch.devPrologue
    ? { kind: 'DEVELOPMENT_EXILE', count: meta.devCost ?? 1 }
    : undefined;

  condition = combineConditions(
    condition,
    lowerLeadCondition(ch.turnPhaseLead?.[0] as CstNode | undefined, undefined, timings)
  );

  let triggerEvent: TriggerEvent | undefined;
  const whenNode = ch.whenTriggerClause?.[0] as CstNode | undefined;
  if (whenNode) {
    const whenToks = flattenCstTokens(whenNode);
    const guardToks = ch.guardCondition ? flattenCstTokens(ch.guardCondition[0] as CstNode) : undefined;
    const trig = lowerTriggerEventFromTokens(whenToks, guardToks, lowerConditionTokens);
    triggerEvent = trig.triggerEvent;
    timings.add(triggerEvent.kind);
    condition = combineConditions(condition, trig.extraCondition);
  } else if (ch.guardCondition) {
    condition = combineConditions(condition, lowerLeadCondition(undefined, ch.guardCondition[0] as CstNode, timings));
  }

  if (timings.size === 0) timings.add('CONTINUOUS');
  const tList = [...timings];
  const linkRequirement = buildLinkReqFn(tList);

  const state: LoweringState = { depth: 0 };
  const sentNodes = (ch.sentenceUnit ?? []) as CstNode[];
  const lowered = lowerSentenceNodes(sentNodes, state, buildLinkReqFn);

  return {
    kind: 'EFFECT_CLAUSE',
    clauseIndex,
    raw,
    timings: tList,
    oncePerTurn: meta.oncePerTurn,
    ...(triggerEvent ? { triggerEvent } : {}),
    ...(meta.pairFilter ? { pairFilter: meta.pairFilter } : {}),
    ...(linkRequirement ? { linkRequirement } : {}),
    ...(cost ? { cost } : {}),
    ...(condition ? { condition } : {}),
    steps: lowered.steps,
  };
}
