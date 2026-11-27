import { type CstNode, type IToken } from 'chevrotain';
import type {
  EffectCondition,
  EffectDuration,
  EffectTiming,
  PairFilter,
  TargetSelector,
} from '../effect-parser.ts';
import type { ContinuousModifierAst, ProhibitionRule } from './ast.ts';
import { combineConditions, lowerConditionTokens } from './lower-conditions.ts';
import { lowerDuration, lowerScaleMetric, lowerTargetSelector } from './lower-selectors.ts';
import {
  LvPrefix,
  NumberTok,
  StatModTok,
  TimingTag,
  VGains,
  VGets,
  VIncrease,
  VReduce,
} from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractBrackets,
  extractKeywordsFromTokens,
  findWordSeq,
  flattenCstTokens,
  hasAnyWord,
  hasWordSeq,
  parseIntTok,
  parseStatModToken,
  parseTimingTagString,
} from './token-utils.ts';

export function extractHeaderMeta(timingNodes: CstNode[]) {
  const timings = new Set<EffectTiming>();
  const meta: {
    oncePerTurn: boolean;
    pairFilter?: PairFilter;
    devCost?: number;
    isPilotTag?: boolean;
  } = { oncePerTurn: false };

  for (const n of timingNodes) {
    for (const t of flattenCstTokens(n)) {
      if (t.tokenType === TimingTag) parseTimingTagString(t.image, timings, meta);
    }
  }
  return { timings, meta };
}

export function lowerLeadCondition(
  turnPhaseNode: CstNode | undefined,
  guardNode: CstNode | undefined,
  timings: Set<EffectTiming>
): EffectCondition | undefined {
  let cond: EffectCondition | undefined;
  if (turnPhaseNode) {
    const tpToks = flattenCstTokens(turnPhaseNode);
    if (hasWordSeq(tpToks, ['at', 'the', 'end'])) {
      timings.add('END_OF_TURN');
      const condStart = tpToks.findIndex((t) => ['when', 'where'].includes(t.image.toLowerCase()));
      if (condStart >= 0) {
        cond = combineConditions(cond, lowerConditionTokens(tpToks.slice(condStart + 1)));
      }
    } else if (hasWordSeq(tpToks, ['at', 'the', 'start', 'of', 'your', "opponent's"])) {
      timings.add('START_OF_OPPONENT_TURN');
    } else if (hasWordSeq(tpToks, ['during', 'your', 'turn'])) {
      cond = combineConditions(cond, { kind: 'IS_YOUR_TURN' });
    } else if (hasWordSeq(tpToks, ['during', 'your', "opponent's", 'turn'])) {
      cond = combineConditions(cond, { kind: 'IS_OPPONENT_TURN' });
    }
  }
  if (guardNode) {
    const gToks = flattenCstTokens(guardNode);
    if (hasWordSeq(gToks, ['at', 'the', 'start', 'of', 'your', "opponent's", 'turn'])) {
      timings.delete('CONTINUOUS');
      timings.add('START_OF_OPPONENT_TURN');
    }
    const condExprNode = guardNode.children.conditionExpr?.[0] as CstNode | undefined;
    const cToks = condExprNode ? flattenCstTokens(condExprNode) : gToks;
    cond = combineConditions(cond, lowerConditionTokens(cToks));
  }
  return cond;
}

function detectAllProhibitionRules(toks: IToken[], subjToks: IToken[] = []): ProhibitionRule[] {
  const rules: ProhibitionRule[] = [];
  if (hasWordSeq(toks, ['receive', 'battle', 'damage']) || (hasAnyWord(toks, ['receive']) && hasWordSeq(toks, ['battle', 'damage']))) {
    rules.push('CANT_RECEIVE_BATTLE_DAMAGE');
  } else if (hasAnyWord(toks, ['receive']) && hasWordSeq(toks, ['effect', 'damage'])) {
    rules.push('CANT_RECEIVE_EFFECT_DAMAGE');
  } else if (hasAnyWord(toks, ['receive']) && hasAnyWord(toks, ['damage'])) {
    rules.push('CANT_RECEIVE_DAMAGE');
  }
  if ((hasWordSeq(toks, ['ap']) || hasWordSeq(subjToks, ['ap'])) && hasAnyWord(toks, ['reduced', 'reduce'])) {
    rules.push('CANT_REDUCE_AP');
  }
  if (hasWordSeq(toks, ['choose', 'the', 'enemy', 'player'])) rules.push('CANT_CHOOSE_ENEMY_PLAYER');
  if (hasWordSeq(toks, ['be', 'chosen'])) rules.push('CANT_BE_CHOSEN');
  if (hasWordSeq(toks, ['activate']) && toks.some((t) => t.image === '<Blocker>')) rules.push('CANT_ACTIVATE_BLOCKER');
  if (hasWordSeq(toks, ['be', 'blocked'])) rules.push('CANT_BLOCK');
  if (hasWordSeq(toks, ['set', 'as', 'active']) || hasWordSeq(toks, ['be', 'set', 'as', 'active'])) rules.push('CANT_SET_ACTIVE');
  if (hasWordSeq(toks, ['be', 'rested'])) rules.push('CANT_BE_RESTED');
  if (hasWordSeq(toks, ['be', 'paired']) || hasWordSeq(toks, ['paired', 'with'])) rules.push('CANT_BE_PAIRED');
  if (hasWordSeq(toks, ['be', 'destroyed'])) rules.push('CANT_BE_DESTROYED');

  if (hasAnyWord(toks, ['attack']) && !hasWordSeq(toks, ['attack', 'target'])) {
    rules.push('CANT_ATTACK');
  }
  if (rules.length === 0) rules.push('CANT_DEPLOY');
  return rules;
}

function sortRulesByTokenOrder(toks: IToken[], rules: ProhibitionRule[]): ProhibitionRule[] {
  const ruleAnchor = (r: ProhibitionRule): number => {
    switch (r) {
      case 'CANT_SET_ACTIVE':
        return findWordSeq(toks, ['set', 'as', 'active']);
      case 'CANT_BE_PAIRED':
        return toks.findIndex((t) => t.image.toLowerCase() === 'paired');
      case 'CANT_ATTACK':
        return toks.findIndex((t) => t.image.toLowerCase() === 'attack');
      case 'CANT_BE_CHOSEN':
        return findWordSeq(toks, ['be', 'chosen']);
      case 'CANT_BE_RESTED':
        return findWordSeq(toks, ['be', 'rested']);
      case 'CANT_BLOCK':
        return findWordSeq(toks, ['be', 'blocked']);
      case 'CANT_BE_DESTROYED':
        return findWordSeq(toks, ['be', 'destroyed']);
      default:
        return 0;
    }
  };
  return [...rules].sort((a, b) => ruleAnchor(a) - ruleAnchor(b));
}

export function liftContinuousModifier(
  clauseIndex: number,
  raw: string,
  cst: CstNode
): ContinuousModifierAst {
  const ch = cst.children;
  const { timings, meta } = extractHeaderMeta((ch.timingPrefix ?? []) as CstNode[]);
  const requiresPair = timings.has('DURING_PAIR');

  const turnPhaseNode = ch.turnPhaseLead?.[0] as CstNode | undefined;
  const guardNode = ch.guardCondition?.[0] as CstNode | undefined;
  let condition = lowerLeadCondition(turnPhaseNode, guardNode, timings);

  const sentNodes = (ch.continuousSentence ?? []) as CstNode[];
  const allSentToks = sentNodes.flatMap((sn) => flattenCstTokens(sn));

  const trailingWhileIdx = allSentToks.findIndex((t) => t.image.toLowerCase() === 'while');
  const mainToks = trailingWhileIdx >= 0 ? allSentToks.slice(0, trailingWhileIdx) : allSentToks;
  if (trailingWhileIdx >= 0) {
    condition = combineConditions(condition, lowerConditionTokens(allSentToks.slice(trailingWhileIdx)));
  }

  const duration: EffectDuration = lowerDuration(mainToks) ?? 'CONTINUOUS';
  const sharedMeta = {
    ...(requiresPair ? { requiresPair: true } : {}),
    ...(meta.pairFilter ? { pairFilter: meta.pairFilter } : {}),
    ...(meta.oncePerTurn ? { oncePerTurn: true } : {}),
    ...(condition ? { condition } : {}),
    duration,
  };

  if (meta.isPilotTag && mainToks.length > 0 && mainToks[0].image.startsWith('[')) {
    const names = extractBrackets(mainToks);
    if (names.length > 0) {
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 2,
        activeIn: 'HAND',
        modifier: { type: 'GRANT_PILOT_MODE', pilotName: names[0] },
      };
    }
  }

  if (hasWordSeq(mainToks, ['name', 'is', 'also', 'treated', 'as'])) {
    const names = extractBrackets(mainToks);
    if (names.length > 0) {
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 2,
        activeIn: 'ANY',
        modifier: { type: 'NAME_ALIAS', alias: names[0] },
      };
    }
  }

  if (hasWordSeq(mainToks, ['attack', 'target']) && !hasWordSeq(mainToks, ['choose', 'the', 'enemy', 'player'])) {
    const chooseIdx = findWordSeq(mainToks, ['choose']);
    const asIdx = findWordSeq(mainToks, ['as', 'their', 'attack', 'target']);
    const asIdx2 = findWordSeq(mainToks, ['as', 'its', 'attack', 'target']);
    const splitAs = asIdx >= 0 ? asIdx : asIdx2;
    const isCant = hasAnyWord(mainToks, ["can't", 'cannot']);
    if (isCant && chooseIdx >= 0) {
      const attackerToks = mainToks.slice(0, chooseIdx);
      const tgtToks = splitAs > chooseIdx ? mainToks.slice(chooseIdx + 1, splitAs) : mainToks.slice(chooseIdx + 1);
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 4,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'REDIRECT_ATTACK_TARGET',
          rule: 'CANT_CHOOSE_TARGET',
          target: lowerTargetSelector(tgtToks),
          attackerFilter: lowerTargetSelector(attackerToks),
        },
      };
    }
    if (hasWordSeq(mainToks, ['if', 'possible']) || hasAnyWord(mainToks, ['must'])) {
      const attackerToks = chooseIdx > 0 ? mainToks.slice(0, chooseIdx) : [];
      const tgtToks =
        chooseIdx >= 0 && splitAs > chooseIdx ? mainToks.slice(chooseIdx + 1, splitAs) : mainToks;
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 4,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'REDIRECT_ATTACK_TARGET',
          rule: 'MUST_ATTACK_TARGET',
          target: lowerTargetSelector(tgtToks),
          ...(attackerToks.length > 0 ? { attackerFilter: lowerTargetSelector(attackerToks) } : {}),
        },
      };
    }
    if (hasWordSeq(mainToks, ['active', 'enemy', 'unit'])) {
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 2,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'ALLOW_ATTACK_ACTIVE',
          target: { owner: 'SELF', self: true, cardType: 'UNIT' },
        },
      };
    }
  }

  if (hasAnyWord(mainToks, ["can't", 'cannot', "won't"])) {
    const negIdx = mainToks.findIndex((t) => ["can't", 'cannot', "won't"].includes(t.image.toLowerCase()));
    const subjToks = mainToks.slice(0, negIdx);
    const predToks = mainToks.slice(negIdx + 1);

    if (hasWordSeq(mainToks, ["won't", 'be', 'set', 'as', 'active']) && hasAnyWord(subjToks, ['enemy', 'opponent', "opponent's"])) {
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 4,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'FREEZE_AURA',
          target: lowerTargetSelector(subjToks),
        },
      };
    }

    const orderedRules = sortRulesByTokenOrder(predToks, detectAllProhibitionRules(predToks, subjToks));
    const [rule, ...additionalRules] = orderedRules;
    const target = lowerTargetSelector(subjToks.length > 0 ? subjToks : mainToks);

    if (rule === 'CANT_RECEIVE_EFFECT_DAMAGE' || rule === 'CANT_RECEIVE_BATTLE_DAMAGE' || rule === 'CANT_RECEIVE_DAMAGE') {
      let damageMax: number | undefined;
      for (let i = 0; i < predToks.length; i += 1) {
        if (predToks[i].tokenType !== NumberTok || predToks[i - 1]?.tokenType === LvPrefix) continue;
        if (predToks[i + 1]?.image.toLowerCase() === 'or') {
          const tailWords = predToks
            .slice(i + 3, i + 7)
            .map((t) => t.image.toLowerCase());
          const stopIdx = tailWords.findIndex((w) => w === '.' || w === ',');
          const window = stopIdx >= 0 ? tailWords.slice(0, stopIdx) : tailWords;
          if (!window.includes('ap') && !window.includes('hp') && window.includes('damage')) {
            damageMax = parseIntTok(predToks[i]);
            break;
          }
        }
      }
      const fromIdx = findWordSeq(predToks, ['from']);
      const sourceFilter: TargetSelector | undefined =
        fromIdx >= 0
          ? lowerTargetSelector(predToks.slice(fromIdx + 1))
          : hasAnyWord(predToks, ['enemy', 'opponent', "opponent's"])
          ? { owner: 'ENEMY' }
          : undefined;

      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 4,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'PROHIBITION',
          rule,
          target,
          ...(sourceFilter ? { sourceFilter } : {}),
          ...(damageMax !== undefined ? { damageMax } : {}),
          ...(additionalRules.length > 0 ? { additionalRules } : {}),
        },
      };
    }

    const byIdx = findWordSeq(predToks, ['by']);
    const sourceFilter: TargetSelector | undefined =
      byIdx >= 0 && hasAnyWord(predToks.slice(byIdx), ['enemy', 'opponent'])
        ? { owner: 'ENEMY' }
        : hasAnyWord(predToks, ['enemy', 'opponent']) && rule === 'CANT_REDUCE_AP'
        ? { owner: 'ENEMY' }
        : undefined;

    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 4,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      modifier: {
        type: 'PROHIBITION',
        rule,
        target,
        ...(sourceFilter ? { sourceFilter } : {}),
        ...(additionalRules.length > 0 ? { additionalRules } : {}),
      },
    };
  }

  if (hasWordSeq(mainToks, ['cost']) && (mainToks.some((t) => t.tokenType === VReduce) || hasAnyWord(mainToks, ['less', 'reduced']))) {
    const byIdx = findWordSeq(mainToks, ['by']);
    const amt = (byIdx >= 0 ? parseIntTok(mainToks[byIdx + 1]) : undefined) ?? 1;
    const eqIdx = findWordSeq(mainToks, ['equal', 'to']);
    const perTarget = eqIdx >= 0 ? lowerScaleMetric(mainToks.slice(eqIdx)) : undefined;
    const activeIn: ContinuousModifierAst['activeIn'] = hasAnyWord(mainToks, ['trash'])
      ? 'TRASH'
      : 'HAND';
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn,
      ...(condition ? { condition } : {}),
      ...(meta.pairFilter ? { pairFilter: meta.pairFilter } : {}),
      modifier: {
        type: 'COST_REDUCTION',
        amount: amt,
        ...(perTarget ? { perTarget } : {}),
        target: lowerTargetSelector(mainToks),
      },
    };
  }

  if (mainToks.some((t) => t.tokenType === VGains)) {
    const gainIdx = mainToks.findIndex((t) => t.tokenType === VGains);
    const subjToks = mainToks.slice(0, gainIdx);
    const predToks = mainToks.slice(gainIdx + 1);
    const kws = extractKeywordsFromTokens(predToks);
    const traits = extractAllTraitsFromTokens(predToks);
    const eqIdx = findWordSeq(predToks, ['equal', 'to']);
    const scaleBy = eqIdx >= 0 ? lowerScaleMetric(predToks.slice(eqIdx)) : undefined;
    const target = lowerTargetSelector(subjToks.length > 0 ? subjToks : mainToks);
    if (kws.length > 0) {
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 2,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'GRANT_KEYWORD',
          keyword: kws[0],
          ...(scaleBy ? { scaleBy } : {}),
          target,
        },
      };
    }
    if (traits.length > 0) {
      return {
        kind: 'CONTINUOUS_MODIFIER',
        clauseIndex,
        raw,
        layer: 2,
        activeIn: 'BATTLE_AREA',
        ...sharedMeta,
        modifier: {
          type: 'GRANT_TRAIT',
          traits,
          target,
        },
      };
    }
  }

  const statTok = mainToks.find((t) => t.tokenType === StatModTok);
  if (statTok || mainToks.some((t) => t.tokenType === VGets || t.tokenType === VIncrease || t.tokenType === VReduce)) {
    const getsIdx = mainToks.findIndex((t) => t.tokenType === VGets);
    const mod = statTok ? parseStatModToken(statTok) : null;
    const isReduce = mainToks.some((t) => t.tokenType === VReduce);
    const isHp = mod ? mod.stat === 'HP' : hasAnyWord(mainToks, ['hp']) && !hasAnyWord(mainToks, ['ap']);
    const stat: 'AP' | 'HP' = isHp ? 'HP' : 'AP';
    const eqIdx = findWordSeq(mainToks, ['equal', 'to']);
    const scaleBy = eqIdx >= 0 ? lowerScaleMetric(mainToks.slice(eqIdx)) : undefined;
    const byIdx = findWordSeq(mainToks, ['by']);
    const rawNum =
      mod?.delta ??
      (byIdx >= 0 ? parseIntTok(mainToks[byIdx + 1]) : undefined) ??
      parseIntTok(mainToks.find((t) => t.tokenType === NumberTok)) ??
      1;
    const delta = mod ? mod.delta : isReduce ? -Math.abs(rawNum) : Math.abs(rawNum);
    const subjToks = getsIdx > 0 ? mainToks.slice(0, getsIdx) : mainToks;
    const target = lowerTargetSelector(subjToks);
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      modifier: {
        type: 'MODIFY_STAT',
        stat,
        delta,
        ...(scaleBy ? { scaleBy } : {}),
        target,
      },
    };
  }

  const rule = hasWordSeq(mainToks, ['deployed', 'rested'])
    ? 'DEPLOYED_RESTED'
    : hasWordSeq(mainToks, ['turn', 'it', 'is', 'deployed'])
    ? 'CAN_ATTACK_TURN_DEPLOYED'
    : 'RESTRICTION';

  const restIdx = findWordSeq(mainToks, ['are', 'deployed']);
  const subjToks = restIdx > 0 ? mainToks.slice(0, restIdx) : mainToks;
  return {
    kind: 'CONTINUOUS_MODIFIER',
    clauseIndex,
    raw,
    layer: 4,
    activeIn: 'BATTLE_AREA',
    ...sharedMeta,
    modifier: {
      type: 'RESTRICTION',
      rule,
      target: lowerTargetSelector(subjToks),
    },
  };
}
