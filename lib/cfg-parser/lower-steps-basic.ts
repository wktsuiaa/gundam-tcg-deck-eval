import { type IToken } from 'chevrotain';
import type {
  EffectStep,
  KeywordAbility,
  ScaleMetric,
  TargetSelector,
} from '../effect-parser.ts';
import { lowerDuration, lowerScaleMetric, lowerTargetSelector } from './lower-selectors.ts';
import {
  type LoweringState,
  SELF_UNIT_TARGET,
  lowerVerbActionSentence,
  resolveSubjectTokens,
} from './lower-steps-actions.ts';
import {
  BracketName,
  Comma,
  KeywordTag,
  LvPrefix,
  NumberTok,
  StatModTok,
  VBegin,
  VChange,
  VChoose,
  VDeal,
  VDestroy,
  VDraw,
  VExile,
  VGains,
  VGets,
  VIncrease,
  VReduce,
  VRest,
  VReturn,
  VSet,
} from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractKeywordsFromTokens,
  findWordSeq,
  hasAnyWord,
  hasWordSeq,
  parseIntTok,
  parseKeywordFromTag,
  parseStatModToken,
  splitTokensBy,
} from './token-utils.ts';

export { type LoweringState, resolveSubjectTokens };

function splitDamageSourceFilter(toks: IToken[]): {
  damageType: 'BATTLE' | 'EFFECT' | 'ANY';
  sourceFilter?: TargetSelector;
} {
  const damageType: 'BATTLE' | 'EFFECT' | 'ANY' = hasWordSeq(toks, ['battle', 'damage'])
    ? 'BATTLE'
    : hasWordSeq(toks, ['effect', 'damage'])
    ? 'EFFECT'
    : 'ANY';

  const fromIdx = findWordSeq(toks, ['from']);
  if (fromIdx >= 0) {
    return { damageType, sourceFilter: lowerTargetSelector(toks.slice(fromIdx + 1)) };
  }
  if (hasAnyWord(toks, ['enemy', 'opponent', "opponent's"])) {
    return { damageType, sourceFilter: { owner: 'ENEMY' } };
  }
  return { damageType };
}

export function lowerBasicSentenceTokens(
  rawToks: IToken[],
  state: LoweringState
): EffectStep[] {
  let toks = rawToks;
  // Strip trailing Period
  while (toks.length > 0 && toks[toks.length - 1].image === '.') {
    toks = toks.slice(0, -1);
  }
  // Strip leading "Then," / "After activating ..., " / "You may"
  if (toks[0]?.image.toLowerCase() === 'then' && toks[1]?.tokenType === Comma) {
    toks = toks.slice(2);
  }
  if (hasWordSeq(toks.slice(0, 3), ['after', 'activating'])) {
    const commaIdx = toks.findIndex((t) => t.tokenType === Comma);
    if (commaIdx >= 0) toks = toks.slice(commaIdx + 1);
  }
  const optional = toks[0]?.image.toLowerCase() === 'you' && toks[1]?.image.toLowerCase() === 'may';
  if (optional) toks = toks.slice(2);
  if (toks.length === 0) return [];

  const duration = lowerDuration(toks);
  const firstTok = toks[0];
  const firstLow = firstTok.image.toLowerCase();

  // 1. Choose <target> ... (possibly followed by ", and <verb> ..." or "and <verb> ..." within same sentence)
  if (firstTok.tokenType === VChoose) {
    const restToks = toks.slice(1);
    // Split on ", and <verb>" or " and <verb>" if second clause performs an action on the chosen target
    const andVerbIdx = restToks.findIndex(
      (t, idx) =>
        idx > 0 &&
        t.image.toLowerCase() === 'and' &&
        (restToks[idx + 1]?.tokenType === VDestroy ||
          restToks[idx + 1]?.tokenType === VDeal ||
          restToks[idx + 1]?.tokenType === VRest ||
          restToks[idx + 1]?.tokenType === VSet ||
          restToks[idx + 1]?.tokenType === VReturn ||
          restToks[idx + 1]?.tokenType === VExile ||
          restToks[idx + 1]?.tokenType === VDraw ||
          restToks[idx + 1]?.tokenType === VBegin ||
          restToks[idx + 1]?.tokenType === VGets ||
          restToks[idx + 1]?.tokenType === VGains)
    );

    if (andVerbIdx >= 0 && hasWordSeq(restToks, ['begin', 'a', 'battle'])) {
      const targetToks = restToks.slice(0, andVerbIdx);
      const parts = splitTokensBy(targetToks, Comma);
      const sel1 = lowerTargetSelector(parts[0] ?? targetToks);
      const sel2 = parts[1] ? lowerTargetSelector(parts[1]) : { owner: 'ENEMY' as const, cardType: 'UNIT' as const, count: 1 };
      state.chosenTarget = sel1;
      return [{ action: 'FORCE_BATTLE_DAMAGE_STEP', attacker: sel1, defender: sel2 }];
    }

    if (andVerbIdx >= 0) {
      const selToks = restToks.slice(0, andVerbIdx);
      state.chosenTarget = lowerTargetSelector(selToks);
      const followToks = restToks.slice(andVerbIdx + 1);
      return lowerBasicSentenceTokens(followToks, state);
    }

    state.chosenTarget = lowerTargetSelector(restToks);
    return [];
  }

  // 2. "During this turn/battle, battle damage <X> would receive is dealt to <Y> instead."
  if (hasWordSeq(toks, ['is', 'dealt', 'to']) && hasAnyWord(toks, ['instead'])) {
    const isDealtIdx = findWordSeq(toks, ['is', 'dealt', 'to']);
    const fromPart = toks.slice(0, isDealtIdx);
    const toPart = toks.slice(isDealtIdx + 3);
    const fromTarget = hasWordSeq(fromPart, ['this', 'unit'])
      ? SELF_UNIT_TARGET
      : state.chosenTarget ?? lowerTargetSelector(fromPart);
    const toTarget = hasWordSeq(toPart, ['this', 'unit'])
      ? SELF_UNIT_TARGET
      : state.chosenTarget ?? lowerTargetSelector(toPart);
    return [
      {
        action: 'REDIRECT_BATTLE_DAMAGE',
        fromTarget,
        toTarget,
        ...(duration ? { duration } : {}),
      },
    ];
  }

  // 3. "During this battle/turn, reduce the next damage it receives by N"
  if (hasWordSeq(toks, ['reduce', 'the', 'next', 'damage']) || (hasWordSeq(toks, ['reduce', 'by']) && hasAnyWord(toks, ['instead']))) {
    const byIdx = findWordSeq(toks, ['by']);
    const amt = byIdx >= 0 ? parseIntTok(toks[byIdx + 1]) : undefined;
    const { damageType, sourceFilter } = splitDamageSourceFilter(toks);
    return [
      {
        action: 'DAMAGE_PROOF',
        ...(amt !== undefined ? { amount: amt } : {}),
        damageType,
        ...(duration ? { duration } : {}),
        target: state.chosenTarget ?? SELF_UNIT_TARGET,
        ...(sourceFilter ? { sourceFilter } : {}),
      },
    ];
  }

  // 4. "Increase/Reduce ... damage ... deals/receives by N"
  if ((firstTok.tokenType === VIncrease || firstTok.tokenType === VReduce) && hasAnyWord(toks, ['damage'])) {
    const byIdx = findWordSeq(toks, ['by']);
    const amt = (byIdx >= 0 ? parseIntTok(toks[byIdx + 1]) : undefined) ?? 1;
    const sign = firstTok.tokenType === VReduce ? -1 : 1;
    if (hasAnyWord(toks, ['receives'])) {
      const { damageType, sourceFilter } = splitDamageSourceFilter(toks);
      return [
        {
          action: 'DAMAGE_PROOF',
          amount: amt,
          damageType,
          ...(duration ? { duration } : {}),
          target: state.chosenTarget ?? SELF_UNIT_TARGET,
          ...(sourceFilter ? { sourceFilter } : {}),
        },
      ];
    }
    return [
      {
        action: 'MODIFY_DAMAGE_DEALT',
        delta: sign * amt,
        ...(duration ? { duration } : {}),
      },
    ];
  }

  // 5. "may choose [an active enemy Unit ...] as its attack target" / "Enemy Units can't choose ..."
  if (hasWordSeq(toks, ['attack', 'target'])) {
    if (toks.some((t) => t.tokenType === VChange)) {
      return [
        {
          action: 'REDIRECT_ATTACK_TARGET',
          rule: 'MUST_ATTACK_TARGET',
          target: state.chosenTarget ?? SELF_UNIT_TARGET,
          ...(duration ? { duration } : {}),
        },
      ];
    }
    if (hasWordSeq(toks, ['same', 'player'])) {
      return [
        {
          action: 'REDIRECT_ATTACK_TARGET',
          rule: 'CANT_CHOOSE_SAME_PLAYER',
          target: state.chosenTarget ?? SELF_UNIT_TARGET,
          ...(duration ? { duration } : {}),
        },
      ];
    }
    if (hasAnyWord(toks, ["can't", 'cannot'])) {
      const chooseIdx = findWordSeq(toks, ['choose']);
      if (hasWordSeq(toks, ['choose', 'the', 'enemy', 'player'])) {
        const subjToks = chooseIdx > 1 ? toks.slice(0, chooseIdx - 1) : [firstTok];
        const target = resolveSubjectTokens(subjToks, state);
        return [
          {
            action: 'RESTRICTION',
            rule: 'CANT_CHOOSE_ENEMY_PLAYER',
            target,
            ...(duration ? { duration } : {}),
          },
        ];
      }
      const attackerFilter = chooseIdx > 0 ? lowerTargetSelector(toks.slice(0, chooseIdx)) : undefined;
      return [
        {
          action: 'REDIRECT_ATTACK_TARGET',
          rule: 'CANT_CHOOSE_TARGET',
          target: state.chosenTarget ?? resolveSubjectTokens(toks.slice(chooseIdx + 1), state),
          ...(attackerFilter ? { attackerFilter } : {}),
          ...(duration ? { duration } : {}),
        },
      ];
    }
    if (hasWordSeq(toks, ['active', 'enemy', 'unit'])) {
      const chooseIdx = findWordSeq(toks, ['choose']);
      const asIdx = findWordSeq(toks, ['as']);
      const targetToks = chooseIdx >= 0 && asIdx > chooseIdx ? toks.slice(chooseIdx + 1, asIdx) : toks;
      return [
        {
          action: 'ALLOW_ATTACK_ACTIVE',
          target: lowerTargetSelector(targetToks),
        },
      ];
    }
  }

  // 6. Prohibitions inside effect clauses ("It can't attack", "can't activate <Blocker>", "can't receive ... damage", "can't be set as active", "won't be set as active")
  if (hasAnyWord(toks, ["can't", 'cannot', "won't"])) {
    const negIdx = toks.findIndex((t) => ["can't", 'cannot', "won't"].includes(t.image.toLowerCase()));
    const subjToks = toks.slice(0, negIdx);
    const predToks = toks.slice(negIdx + 1);
    const target = resolveSubjectTokens(subjToks.length > 0 ? subjToks : [firstTok], state);

    if (hasAnyWord(predToks, ['receive']) && hasAnyWord(predToks, ['damage'])) {
      const { damageType, sourceFilter } = splitDamageSourceFilter(predToks);
      const shieldIdx = findWordSeq(predToks, ['shield']);
      const finalTarget =
        shieldIdx >= 0 ? { owner: 'SELF' as const, cardType: 'SHIELD' as const } : target;
      let maxDamage: number | undefined;
      for (let i = 0; i < predToks.length; i += 1) {
        if (predToks[i].tokenType !== NumberTok) continue;
        if (predToks[i - 1]?.tokenType === LvPrefix) continue;
        if (predToks[i + 1]?.image.toLowerCase() === 'or') {
          const tailWords = predToks
            .slice(i + 3, i + 7)
            .map((t) => t.image.toLowerCase());
          const stopIdx = tailWords.findIndex((w) => w === '.' || w === ',');
          const window = stopIdx >= 0 ? tailWords.slice(0, stopIdx) : tailWords;
          if (!window.includes('ap') && !window.includes('hp') && window.includes('damage')) {
            maxDamage = parseIntTok(predToks[i]);
            break;
          }
        }
      }
      return [
        {
          action: 'DAMAGE_PROOF',
          ...(maxDamage !== undefined ? { maxDamage } : {}),
          damageType,
          ...(duration ? { duration } : {}),
          target: finalTarget,
          ...(sourceFilter ? { sourceFilter } : {}),
        },
      ];
    }
    if (hasWordSeq(predToks, ['activate', '<blocker>']) || hasWordSeq(predToks, ['activate']) && predToks.some((t) => t.image === '<Blocker>')) {
      return [{ action: 'RESTRICTION', rule: 'CANT_ACTIVATE_BLOCKER', target, ...(duration ? { duration } : {}) }];
    }
    if (hasWordSeq(predToks, ['be', 'blocked'])) {
      return [{ action: 'RESTRICTION', rule: 'CANT_BLOCK', target, ...(duration ? { duration } : {}) }];
    }
    if (hasWordSeq(predToks, ['be', 'paired'])) {
      return [{ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target, ...(duration ? { duration } : {}) }];
    }
    if (hasWordSeq(predToks, ['set', 'as', 'active']) || hasWordSeq(predToks, ['set', 'it', 'as', 'active'])) {
      return [{ action: 'RESTRICTION', rule: 'CANT_SET_ACTIVE', target, ...(duration ? { duration } : {}) }];
    }
    if (hasWordSeq(predToks, ['be', 'rested'])) {
      return [{ action: 'RESTRICTION', rule: 'CANT_BE_RESTED', target, ...(duration ? { duration } : {}) }];
    }
    if (hasWordSeq(predToks, ['be', 'destroyed'])) {
      return [{ action: 'RESTRICTION', rule: 'CANT_BE_DESTROYED', target, ...(duration ? { duration } : {}) }];
    }
    if (hasWordSeq(predToks, ['be', 'chosen'])) {
      const { sourceFilter } = splitDamageSourceFilter(predToks);
      return [
        {
          action: 'RESTRICTION',
          rule: 'CANT_BE_CHOSEN',
          target,
          ...(sourceFilter ? { sourceFilter } : {}),
          ...(duration ? { duration } : {}),
        },
      ];
    }
    if (hasAnyWord(predToks, ['attack'])) {
      return [{ action: 'CANT_ATTACK', ...(duration ? { duration } : {}), target }];
    }
  }

  // 7. Stat modifications ("It gets AP+2", "This Unit gets AP+1 and HP+1", "all your Units get AP+2")
  if (toks.some((t) => t.tokenType === VGets || t.tokenType === StatModTok)) {
    const getsIdx = toks.findIndex((t) => t.tokenType === VGets);
    const subjToks = getsIdx > 0 ? toks.slice(0, getsIdx) : [firstTok];
    const target = resolveSubjectTokens(subjToks, state);
    const eqIdx = findWordSeq(toks, ['equal', 'to']);
    const scaleBy: ScaleMetric | undefined = eqIdx >= 0 ? lowerScaleMetric(toks.slice(eqIdx)) : undefined;

    const steps: EffectStep[] = [];
    for (const t of toks) {
      const mod = parseStatModToken(t);
      if (!mod) continue;
      steps.push(
        mod.stat === 'AP'
          ? { action: 'MODIFY_AP', delta: mod.delta, ...(scaleBy ? { scaleBy } : {}), ...(duration ? { duration } : {}), target }
          : { action: 'MODIFY_HP', delta: mod.delta, ...(scaleBy ? { scaleBy } : {}), ...(duration ? { duration } : {}), target }
      );
    }

    // Check trailing "and all <Keywords> on that Unit card" or "and <Keyword>"
    const kws = extractKeywordsFromTokens(toks);
    if (hasWordSeq(toks, ['gains']) || (steps.length > 0 && kws.length > 0)) {
      for (const kw of kws) {
        steps.push({ action: 'GRANT_KEYWORD', keyword: kw, ...(duration ? { duration } : {}), target });
      }
    }
    if (steps.length > 0) return steps;

    // Handle "AP-6" without explicit VGets ("If it has <High-Maneuver>, AP-6 instead.")
    if (hasWordSeq(toks, ['gains']) && kws.length > 0) {
      return kws.map((kw) => ({ action: 'GRANT_KEYWORD', keyword: kw, ...(duration ? { duration } : {}), target }));
    }
  }

  if ((firstTok.tokenType === VIncrease || firstTok.tokenType === VReduce) && hasAnyWord(toks, ['ap', 'hp'])) {
    const isReduce = firstTok.tokenType === VReduce;
    const isHp = hasAnyWord(toks, ['hp']) && !hasAnyWord(toks, ['ap']);
    const byIdx = findWordSeq(toks, ['by']);
    const afterBy = byIdx >= 0 ? toks.slice(byIdx + 1) : toks;
    const eqIdx = findWordSeq(afterBy, ['equal', 'to']);
    const scaleBy = eqIdx >= 0 ? lowerScaleMetric(afterBy.slice(eqIdx)) : undefined;
    const amt = parseIntTok(afterBy.find((t) => t.tokenType === NumberTok)) ?? 1;
    const target = resolveSubjectTokens(toks.slice(1, byIdx >= 0 ? byIdx : undefined), state);
    return [
      isHp
        ? { action: 'MODIFY_HP', delta: isReduce ? -amt : amt, ...(scaleBy ? { scaleBy } : {}), ...(duration ? { duration } : {}), target }
        : { action: 'MODIFY_AP', delta: isReduce ? -amt : amt, ...(scaleBy ? { scaleBy } : {}), ...(duration ? { duration } : {}), target },
    ];
  }

  // 8. Gains <Keyword> / <Trait>
  if (toks.some((t) => t.tokenType === VGains)) {
    const gainIdx = toks.findIndex((t) => t.tokenType === VGains);
    const subjToks = gainIdx > 0 ? toks.slice(0, gainIdx) : [firstTok];
    const target = resolveSubjectTokens(subjToks, state);
    const predToks = toks.slice(gainIdx + 1);
    const kws = extractKeywordsFromTokens(predToks);
    const traits = extractAllTraitsFromTokens(predToks);
    if (kws.length > 0) {
      const eqIdx = findWordSeq(predToks, ['equal', 'to']);
      const scaleBy = eqIdx >= 0 ? lowerScaleMetric(predToks.slice(eqIdx)) : undefined;
      return kws.map((kw) => ({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        ...(scaleBy ? { scaleBy } : {}),
        ...(duration ? { duration } : {}),
        target,
      }));
    }
    if (traits.length > 0) {
      return [{ action: 'GRANT_TRAIT', traits, ...(duration ? { duration } : {}), target }];
    }
  }

  // 9-10. Board & card-flow verb sentences
  const verbSteps = lowerVerbActionSentence(toks, state, optional);
  if (verbSteps) return verbSteps;

  if (hasWordSeq(toks, ['play', 'it', 'as', 'if']) || hasWordSeq(toks, ['play', 'this', 'card', 'as', 'if'])) {
    const num = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 0;
    return [{ action: 'COST_REDUCTION', amount: 0, exactCost: num, exactLv: num, zone: 'HAND' }];
  }

  if (hasWordSeq(toks, ['reduce', 'the', 'cost']) || hasWordSeq(toks, ['cost', 'is', 'reduced'])) {
    const byIdx = findWordSeq(toks, ['by']);
    const amt = (byIdx >= 0 ? parseIntTok(toks[byIdx + 1]) : undefined) ?? 1;
    const zone = hasAnyWord(toks, ['trash']) ? ('TRASH' as const) : ('HAND' as const);
    return [{ action: 'COST_REDUCTION', amount: amt, zone }];
  }

  if (firstLow === 'instead') {
    return lowerBasicSentenceTokens(toks.slice(1), state);
  }

  for (const t of toks) {
    const mod = parseStatModToken(t);
    if (mod) {
      const target = state.chosenTarget ?? SELF_UNIT_TARGET;
      return [
        mod.stat === 'AP'
          ? { action: 'MODIFY_AP', delta: mod.delta, ...(duration ? { duration } : {}), target }
          : { action: 'MODIFY_HP', delta: mod.delta, ...(duration ? { duration } : {}), target },
      ];
    }
  }

  const fallbackKws: KeywordAbility[] = [];
  for (const t of toks) {
    if (t.tokenType === KeywordTag || t.tokenType === BracketName) {
      const kw = parseKeywordFromTag(t.image);
      if (kw) fallbackKws.push(kw);
    }
  }
  if (fallbackKws.length > 0) {
    return fallbackKws.map((kw) => ({
      action: 'GRANT_KEYWORD',
      keyword: kw,
      ...(duration ? { duration } : {}),
      target: state.chosenTarget ?? SELF_UNIT_TARGET,
    }));
  }

  return [];
}
