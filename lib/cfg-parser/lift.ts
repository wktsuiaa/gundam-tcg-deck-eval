import type { EffectClause, EffectDuration, KeywordAbility, ScaleMetric } from '../effect-parser.ts';
import type { ContinuousModifierAst, ProhibitionRule, ReplacementEffectAst, ReplacementEventKind } from './ast.ts';
import { KEYWORD_NAMES } from './normalize.ts';

export function parseKeywordTag(raw: string): KeywordAbility | null {
  const inner = raw.replace(/^<|>$|^\[|\]$/g, '').trim();
  const m = inner.match(/^([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s*(\d+)?$/);
  if (!m) return null;
  const canonical = KEYWORD_NAMES[m[1].toLowerCase()];
  if (!canonical) return null;
  return { name: canonical, value: m[2] ? parseInt(m[2], 10) : null };
}

export function detectProhibitionRule(text: string): ProhibitionRule {
  if (/can't receive battle damage/i.test(text)) return 'CANT_RECEIVE_BATTLE_DAMAGE';
  if (/can't receive effect damage/i.test(text)) return 'CANT_RECEIVE_EFFECT_DAMAGE';
  if (/can't receive damage/i.test(text)) return 'CANT_RECEIVE_DAMAGE';
  if (/can't choose the enemy player/i.test(text)) return 'CANT_CHOOSE_ENEMY_PLAYER';
  if (/can't be chosen/i.test(text)) return 'CANT_BE_CHOSEN';
  if (/can't activate <Blocker>/i.test(text)) return 'CANT_ACTIVATE_BLOCKER';
  if (/can't be blocked/i.test(text)) return 'CANT_BLOCK';
  if (/can't attack/i.test(text)) return 'CANT_ATTACK';
  if (/can't be set as active|can't set .* active/i.test(text)) return 'CANT_SET_ACTIVE';
  if (/can't be rested/i.test(text)) return 'CANT_BE_RESTED';
  if (/can't be paired/i.test(text)) return 'CANT_BE_PAIRED';
  if (/can't be destroyed/i.test(text)) return 'CANT_BE_DESTROYED';
  return 'CANT_DEPLOY';
}

export function detectReplacementIntercept(text: string): ReplacementEventKind {
  if (/would receive .*damage/i.test(text)) return 'WOULD_TAKE_DAMAGE';
  if (/would rest|When you rest .* instead/i.test(text)) return 'WOULD_REST';
  if (/would be destroyed/i.test(text)) return 'WOULD_BE_DESTROYED';
  return 'WOULD_MOVE_ZONE';
}

export function liftContinuousModifier(
  clauseIndex: number,
  raw: string,
  legacyClause: EffectClause | undefined
): ContinuousModifierAst {
  const requiresPair =
    /【During Pair/i.test(raw) || (legacyClause?.timings.includes('DURING_PAIR') ?? false);
  const requiresLink = legacyClause?.linkRequirement;
  const pairFilter = legacyClause?.pairFilter;
  const oncePerTurn = /【Once per Turn】/.test(raw) || (legacyClause?.oncePerTurn ?? false);
  const condition = legacyClause?.condition;
  const duration: EffectDuration | undefined = /during this battle/i.test(raw)
    ? 'THIS_BATTLE'
    : /during this turn/i.test(raw)
    ? 'THIS_TURN'
    : 'CONTINUOUS';

  const sharedMeta = {
    ...(requiresPair ? { requiresPair } : {}),
    ...(requiresLink ? { requiresLink } : {}),
    ...(pairFilter ? { pairFilter } : {}),
    ...(oncePerTurn ? { oncePerTurn } : {}),
    ...(condition ? { condition } : {}),
  };

  // Layer 4: "can't" / "cannot" prohibitions
  if (/\b(?:can't|cannot)\b/i.test(raw)) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 4,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'PROHIBITION',
        rule: detectProhibitionRule(raw),
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    };
  }

  // Layer 2: Name alias & Command Pilot mode
  const aliasMatch = raw.match(/name is also treated as \[([^\]]+)\]/i);
  if (aliasMatch) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'ANY',
      modifier: { type: 'NAME_ALIAS', alias: aliasMatch[1].trim() },
    };
  }

  const pilotModeMatch = raw.match(/^【Pilot】\[([^\]]+)\]/i);
  if (pilotModeMatch) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'HAND',
      modifier: { type: 'GRANT_PILOT_MODE', pilotName: pilotModeMatch[1].trim() },
    };
  }

  // Layer 2: Keyword or Trait grants
  const legacyKw = legacyClause?.steps.find((s) => s.action === 'GRANT_KEYWORD');
  if (legacyKw && legacyKw.action === 'GRANT_KEYWORD') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'GRANT_KEYWORD',
        keyword: legacyKw.keyword,
        ...(legacyKw.scaleBy ? { scaleBy: legacyKw.scaleBy } : {}),
        target: legacyKw.target,
      },
    };
  }

  const kwMatch = raw.match(/\bgains?\b[^.]*?(<[^<>]+>)/i);
  const kwParsed = kwMatch ? parseKeywordTag(kwMatch[1]) : null;
  if (kwParsed) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'GRANT_KEYWORD',
        keyword: kwParsed,
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    };
  }

  const legacyTrait = legacyClause?.steps.find((s) => s.action === 'GRANT_TRAIT');
  if (legacyTrait && legacyTrait.action === 'GRANT_TRAIT') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'GRANT_TRAIT',
        traits: legacyTrait.traits,
        target: legacyTrait.target,
      },
    };
  }

  // Layer 3: Stat adjustments & cost reduction (from legacyClause or direct clause patterns)
  const legacyModAp = legacyClause?.steps.find((s) => s.action === 'MODIFY_AP');
  if (legacyModAp && legacyModAp.action === 'MODIFY_AP') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'MODIFY_STAT',
        stat: 'AP',
        delta: legacyModAp.delta,
        ...(legacyModAp.scaleBy ? { scaleBy: legacyModAp.scaleBy } : {}),
        target: legacyModAp.target,
      },
    };
  }

  const statDirect = raw.match(/(Increase|Reduce)\s+.*?(AP|HP)\s+by\s+(\d+|an amount equal to.+)/i) ??
    raw.match(/\bgets\s+(AP|HP)([+-]\d+)/i);
  if (statDirect) {
    const isAp = /AP/i.test(statDirect[2] ?? statDirect[1]);
    const stat: 'AP' | 'HP' = isAp ? 'AP' : 'HP';
    const numMatch = (statDirect[3] ?? statDirect[2] ?? '').match(/[+-]?\d+/);
    const sign = /^Reduce/i.test(statDirect[1]) ? -1 : 1;
    const delta = numMatch ? sign * Math.abs(parseInt(numMatch[0], 10)) : sign;
    const scaleBy: ScaleMetric | undefined = /number of cards in your hand/i.test(raw)
      ? { metric: 'HAND_COUNT', owner: 'SELF' }
      : /number of .*cards in your trash/i.test(raw)
      ? { metric: 'TRASH_COUNT', owner: 'SELF' }
      : undefined;
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'MODIFY_STAT',
        stat,
        delta,
        ...(scaleBy ? { scaleBy } : {}),
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    };
  }

  const legacyCostRed = legacyClause?.steps.find((s) => s.action === 'COST_REDUCTION');
  if (legacyCostRed && legacyCostRed.action === 'COST_REDUCTION') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: legacyCostRed.zone === 'TRASH' ? 'TRASH' : 'HAND',
      ...(condition ? { condition } : {}),
      ...(pairFilter ? { pairFilter } : {}),
      modifier: {
        type: 'COST_REDUCTION',
        amount: legacyCostRed.amount,
        ...(legacyCostRed.lvDelta ? { lvDelta: legacyCostRed.lvDelta } : {}),
        target: { owner: 'SELF', self: true },
      },
    };
  }

  const costDirect = raw.match(/Reduce the cost of .*? by (\d+)/i);
  if (costDirect) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'HAND',
      ...(condition ? { condition } : {}),
      modifier: {
        type: 'COST_REDUCTION',
        amount: parseInt(costDirect[1], 10),
        target: { owner: 'SELF', self: true },
      },
    };
  }

  const legacyHp = legacyClause?.steps.find((s) => s.action === 'MODIFY_HP');
  if (legacyHp && legacyHp.action === 'MODIFY_HP') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'MODIFY_STAT',
        stat: 'HP',
        delta: legacyHp.delta,
        ...(legacyHp.scaleBy ? { scaleBy: legacyHp.scaleBy } : {}),
        target: legacyHp.target,
      },
    };
  }

  const legacyAllowActive = legacyClause?.steps.find((s) => s.action === 'ALLOW_ATTACK_ACTIVE');
  if (legacyAllowActive && legacyAllowActive.action === 'ALLOW_ATTACK_ACTIVE') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'ALLOW_ATTACK_ACTIVE',
        target: legacyAllowActive.target,
      },
    };
  }

  const legacyFreeze = legacyClause?.steps.find((s) => s.action === 'FREEZE');
  if (legacyFreeze && legacyFreeze.action === 'FREEZE') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 4,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'FREEZE_AURA',
        target: legacyFreeze.target,
      },
    };
  }

  const legacyRedirect = legacyClause?.steps.find((s) => s.action === 'REDIRECT_ATTACK_TARGET');
  if (legacyRedirect && legacyRedirect.action === 'REDIRECT_ATTACK_TARGET') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 4,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'REDIRECT_ATTACK_TARGET',
        rule: legacyRedirect.rule,
        target: legacyRedirect.target,
      },
    };
  }

  const legacyRestriction = legacyClause?.steps.find((s) => s.action === 'RESTRICTION');
  if (legacyRestriction && legacyRestriction.action === 'RESTRICTION') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 4,
      activeIn: 'BATTLE_AREA',
      ...sharedMeta,
      duration,
      modifier: {
        type: 'RESTRICTION',
        rule: legacyRestriction.rule,
        target: legacyRestriction.target,
        summary: legacyRestriction.summary,
      },
    };
  }

  return {
    kind: 'CONTINUOUS_MODIFIER',
    clauseIndex,
    raw,
    layer: 2,
    activeIn: 'BATTLE_AREA',
    ...sharedMeta,
    duration,
    modifier: {
      type: 'STATIC_PERMISSION',
      summary: raw,
      target: { owner: 'SELF', self: true, cardType: 'UNIT' },
    },
  };
}

export function liftReplacementEffect(
  clauseIndex: number,
  raw: string,
  legacyClause: EffectClause | undefined
): ReplacementEffectAst {
  const scope: ReplacementEffectAst['scope'] = /【During Link】/i.test(raw)
    ? 'LINKED'
    : /【During Pair/i.test(raw)
    ? 'PAIRED'
    : 'ACTIVE_ZONE';

  return {
    kind: 'REPLACEMENT_EFFECT',
    clauseIndex,
    raw,
    scope,
    intercepts: detectReplacementIntercept(raw),
    subject: { owner: 'SELF', self: true, cardType: 'UNIT' },
    ...(legacyClause?.pairFilter ? { pairFilter: legacyClause.pairFilter } : {}),
    ...(legacyClause?.condition ? { condition: legacyClause.condition } : {}),
    optional: /\byou may\b/i.test(raw),
    duration: /during this battle/i.test(raw)
      ? 'THIS_BATTLE'
      : /during this turn/i.test(raw)
      ? 'THIS_TURN'
      : 'CONTINUOUS',
    ...(legacyClause?.steps?.length ? { steps: legacyClause.steps } : {}),
    replacementSummary: raw,
    maxPerEventInstance: 1,
  };
}

// ---------------------------------------------------------------------------
// 5. Public Seam 1 Entry Point: parseCardAbilities(card, loweredClauses)
// ---------------------------------------------------------------------------
