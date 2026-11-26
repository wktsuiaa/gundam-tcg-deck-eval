import { parseCondition } from './conditions.ts';
import { parseDuration, parseTargetSelector } from './selectors.ts';
import { type SentenceContext, parseMultiSentenceSteps, parseSubClause } from './sentence-steps.ts';
import { extractAllTraits } from './text-utils.ts';
import { type EffectStep } from './types.ts';

export function parseConditionalSentence(ctx: SentenceContext): boolean {
  const { s, state, depth } = ctx;
  // 1. "If you do, <rest>" / "If you placed/draw/discard/increase..., <rest>" / "If they don't discard with this effect, <rest>"
  const ifYouDoM = s.match(/^If you do,\s*(.+)$/i);
  if (ifYouDoM) {
    const sub = { chosenTarget: state.chosenTarget, steps: [] as EffectStep[], residual: [] as string[], card: state.card, depth };
    parseMultiSentenceSteps(ifYouDoM[1], sub);
    if (sub.residual.length === 0) {
      if (sub.chosenTarget) state.chosenTarget = sub.chosenTarget;
      if (sub.steps.length > 0) {
        state.steps.push({ action: 'IF_PREVIOUS_SUCCEEDED', thenSteps: sub.steps });
      }
      return true;
    }
  }

  const ifFilterM = s.match(
    /^If (?:(you|they) )?(don'?t\s+)?(?:placed?|draw|discard|increase)\s*(.+?)\s*with this effect,\s*(.+)$/i
  );
  if (ifFilterM) {
    const negated = Boolean(ifFilterM[2]);
    const mid = ifFilterM[3].trim();
    const sub = { chosenTarget: state.chosenTarget, steps: [] as EffectStep[], residual: [] as string[], card: state.card, depth };
    parseMultiSentenceSteps(ifFilterM[4], sub);
    if (sub.residual.length === 0) {
      if (sub.chosenTarget) state.chosenTarget = sub.chosenTarget;
      const lvMinM = mid.match(/Lv\.(\d+)\s+or\s+higher/i);
      const traits = extractAllTraits(mid);
      const numM = mid.match(/\b(\d+)\b/);
      if (sub.steps.length > 0) {
        state.steps.push({
          action: 'IF_PREVIOUS_SUCCEEDED',
          ...(negated ? { negated: true } : {}),
          filter: {
            ...(numM && !lvMinM ? { count: parseInt(numM[1], 10) } : {}),
            ...(lvMinM ? { lvMin: parseInt(lvMinM[1], 10) } : {}),
            ...(traits.length > 0 ? { traits } : {}),
            ...( /\bdraw\b/i.test(s) ? { drawAccepted: true } : {} ),
            ...( /command/i.test(mid) ? { cardType: 'COMMAND' } : /unit/i.test(mid) ? { cardType: 'UNIT' } : {} ),
          },
          thenSteps: sub.steps,
        });
      }
      return true;
    }
  }

  // 2. "gains the following effect during this turn: <sub-clause>"
  const grantFollowingM = depth < 2 ? s.match(/^(.+?)\s+gains the following effect([^:：]*)[:：]\s*(.+)$/i) : null;
  if (grantFollowingM) {
    const tgt = /^(it|they|them)$/i.test(grantFollowingM[1].trim()) && state.chosenTarget
      ? state.chosenTarget
      : parseTargetSelector(grantFollowingM[1]);
    const subClause = parseSubClause(grantFollowingM[3].trim(), state.card, depth + 1);
    if (!subClause.unparsedResidual) {
      state.steps.push({
        action: 'GRANT_CLAUSE',
        duration: parseDuration(grantFollowingM[2]) ?? 'THIS_TURN',
        target: tgt,
        clause: subClause,
      });
      return true;
    }
  }

  // 3. "During this turn/battle, when/if <event>, <action>" or "When this effect destroys ..., <action>"
  const inlineSubClauseM = depth < 2
    ? s.match(
        /^(?:During this turn,\s*(?:when|if)\s+.+|During this battle,\s*when\s+.+|When (?:it|this effect) (?:destroys|deals)\s+.+|At the end of (?:the|a) turn\s+(?:when|where)\s+.+)$/i
      )
    : null;
  if (inlineSubClauseM) {
    const dur = parseDuration(s) ?? 'THIS_TURN';
    const strippedDur = s.replace(/^(?:During this turn|During this battle),\s*/i, '');
    if (strippedDur !== s || /^At the end of (?:the|a) turn\s+(?:when|where)\s+/i.test(s) || /^When (?:it|this effect) (?:destroys|deals)\s+/i.test(s)) {
      const subClause = parseSubClause(strippedDur, state.card, depth + 1);
      if (!subClause.unparsedResidual) {
        state.steps.push({
          action: 'GRANT_CLAUSE',
          duration: dur,
          target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
          clause: subClause,
        });
        return true;
      }
    }
  }

  // 4. Mid-clause conditional "If it is <top-deck filter>, ..." or "If <cond>, <body ...> instead" or "If <cond>, <steps>"
  const ifTopMatchM = s.match(/^If it is (.+?),\s*(?:you|they) may reveal (?:it|them) and add (?:it|them) to (?:your|their) hand\.?$/i);
  if (ifTopMatchM) {
    const filterTxt = ifTopMatchM[1].trim();
    const traits = extractAllTraits(filterTxt);
    const lvMinM = filterTxt.match(/Lv\.(\d+)\s+or\s+higher/i);
    const isUnit = /\bunit card\b/i.test(filterTxt);
    state.steps.push({
      action: 'IF_PREVIOUS_SUCCEEDED',
      filter: {
        ...(lvMinM ? { lvMin: parseInt(lvMinM[1], 10) } : {}),
        ...(traits.length > 0 ? { traits } : {}),
        ...(isUnit ? { cardType: 'UNIT' } : {}),
        placedFromDeck: true,
      },
      thenSteps: [
        {
          action: 'LOOK_TOP',
          count: 1,
          revealSearch: true,
          target: parseTargetSelector(filterTxt),
        },
      ],
    });
    return true;
  }

  const midCondM = s.match(/^(If\s+[^,]+),\s*(.+)$/i);
  if (midCondM) {
    const cond = parseCondition(midCondM[1]);
    const restText = midCondM[2].trim();
    const isInstead = /\binstead\b/i.test(restText);
    const cleanedRest = restText.replace(/\s+instead\.?$/i, '').replace(/\.$/, '').trim();

    if (cond.kind !== 'RAW_CONDITION') {
      const sub = { chosenTarget: state.chosenTarget, steps: [] as EffectStep[], residual: [] as string[], card: state.card, depth };
      if (/^AP\s*([+-]\d+)$/i.test(cleanedRest)) {
        const d = parseInt(cleanedRest.match(/([+-]\d+)/)![1], 10);
        sub.steps.push({
          action: 'MODIFY_AP',
          delta: d,
          duration: 'THIS_TURN',
          target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
        });
      } else if (/^reduce by (\d+)$/i.test(cleanedRest)) {
        const amt = parseInt(cleanedRest.match(/(\d+)/)![1], 10);
        sub.steps.push({
          action: 'DAMAGE_PROOF',
          amount: amt,
          summary: cleanedRest,
          target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
        });
      } else if (/^deal (\d+) damage$/i.test(cleanedRest)) {
        const amt = parseInt(cleanedRest.match(/(\d+)/)![1], 10);
        sub.steps.push({
          action: 'DEAL_DAMAGE',
          amount: amt,
          target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
        });
      } else if (/^(?:you may\s+)?deploy it as an \(AP(\d+)[･・]HP(\d+)\) Unit$/i.test(cleanedRest)) {
        const mTok = cleanedRest.match(/AP(\d+)[･・]HP(\d+)/i)!;
        sub.steps.push({
          action: 'DEPLOY_TOKEN',
          count: 1,
          ap: parseInt(mTok[1], 10),
          hp: parseInt(mTok[2], 10),
        });
      } else if (/^add the card to your hand instead of returning it to your deck\.?$/i.test(restText)) {
        sub.steps.push({
          action: 'LOOK_TOP',
          count: 1,
          revealSearch: true,
        });
      } else {
        parseMultiSentenceSteps(cleanedRest, sub);
        if (sub.chosenTarget && sub.steps.length === 0) {
          const prev = state.steps[state.steps.length - 1];
          if (prev && 'target' in prev) {
            sub.steps.push({ ...prev, target: sub.chosenTarget } as EffectStep);
          } else {
            sub.steps.push({ action: 'DESTROY', target: sub.chosenTarget });
          }
        }
      }

      if (sub.residual.length === 0 && sub.steps.length > 0) {
        if (sub.chosenTarget) state.chosenTarget = sub.chosenTarget;
        state.steps.push({
          action: 'IF_CONDITION',
          condition: cond,
          thenSteps: sub.steps,
          ...(isInstead ? { replacesPrevious: true } : {}),
        });
        return true;
      }
    }
  }
  return false;
}
