import type { CardColor, GundamCardPrint } from '@/types/gundam';
import {
  type AbilityAst,
  type CfgParseResult,
  getAbilitySteps,
  getAbilityTimings,
  parseCardAbilities,
} from '../cfg-parser.ts';
import { collectNestedConditions, flattenEffectSteps } from './synergy.ts';
import { type EffectCondition, type TargetSelector } from './types.ts';

export interface EffectPrerequisite {
  kind: 'TRAIT' | 'COLOR' | 'CARD_TYPE' | 'NAME' | 'LINK';
  trait?: string;
  color?: CardColor;
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'CARD';
  nameContains?: string;
  anyNames?: string[];
  anyTraits?: string[];
  minCopies: 4 | 8;
  primaryClause: boolean;
  reason: string;
}

export function isNonFunctionalAbility(ab: AbilityAst): boolean {
  if (ab.kind === 'DIAGNOSTIC') return true;
  if (ab.kind !== 'EFFECT_CLAUSE') return false;
  return ab.steps.length === 0 && !ab.condition && !ab.pairFilter && !ab.linkRequirement;
}

function pushSelectorPrerequisites(
  t: TargetSelector,
  minCopies: 4 | 8,
  out: Omit<EffectPrerequisite, 'primaryClause'>[]
) {
  if (t.owner !== 'SELF') return;
  const trait = t.trait ?? t.traits?.[0];
  const ct =
    t.cardType === 'UNIT' || t.cardType === 'PILOT' || t.cardType === 'BASE' || t.cardType === 'COMMAND'
      ? t.cardType
      : undefined;
  if (trait) {
    out.push({
      kind: 'TRAIT',
      trait,
      ...(t.traits && t.traits.length > 1 ? { anyTraits: t.traits } : {}),
      cardType: ct,
      minCopies,
      reason: `Requires (${trait})${ct ? ` ${ct}` : ''} target`,
    });
  } else if (t.nameContains) {
    out.push({
      kind: 'NAME',
      nameContains: t.nameContains,
      cardType: ct,
      minCopies,
      reason: `Requires "${t.nameContains}"${ct ? ` ${ct}` : ''}`,
    });
  }
}

/** Extracts deck-composition Effect Prerequisites strictly from structured AbilityAst nodes. */
export function extractEffectPrerequisites(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'name' | 'traits' | 'link'>>,
  parsed: Pick<CfgParseResult, 'keywords' | 'abilities'> = parseCardAbilities(card)
): EffectPrerequisite[] {
  const functionalAbilities = parsed.abilities.filter((ab) => !isNonFunctionalAbility(ab));
  const hasInnateKeyword = parsed.keywords.length > 0;
  const collected = new Map<string, EffectPrerequisite>();

  const perAbility = functionalAbilities.map((ab) => {
    const timings = getAbilityTimings(ab);
    const steps = getAbilitySteps(ab);
    const flatSteps = flattenEffectSteps(steps);
    const isBurstOnly = timings.length === 1 && timings[0] === 'BURST';
    const clausePrereqs: Omit<EffectPrerequisite, 'primaryClause'>[] = [];
    let hasUnrestrictedStep = false;

    if (ab.kind === 'CUSTOM_HOOK' && ab.prerequisites.length > 0) {
      for (const p of ab.prerequisites) {
        clausePrereqs.push({
          kind: p.kind,
          ...(p.trait ? { trait: p.trait } : {}),
          ...(p.color ? { color: p.color } : {}),
          ...(p.cardType ? { cardType: p.cardType } : {}),
          ...(p.nameContains ? { nameContains: p.nameContains } : {}),
          ...(p.anyNames ? { anyNames: p.anyNames } : {}),
          ...(p.anyTraits ? { anyTraits: p.anyTraits } : {}),
          minCopies: p.minCopies,
          reason: p.reason,
        });
      }
    }

    // 1. Pair filter on header e.g. 【During Pair･(Coordinator) Pilot】 or 【When Paired･Purple Pilot】
    const pairFilter = 'pairFilter' in ab ? ab.pairFilter : undefined;
    if (pairFilter && (pairFilter.trait || pairFilter.color)) {
      const parts = [pairFilter.color, pairFilter.trait ? `(${pairFilter.trait})` : undefined, 'Pilot'].filter(Boolean);
      clausePrereqs.push({
        kind: pairFilter.trait ? 'TRAIT' : 'COLOR',
        trait: pairFilter.trait,
        color: pairFilter.color,
        cardType: 'PILOT',
        minCopies: 4,
        reason: `Requires ${parts.join(' ')}`,
      });
    }

    // 1b. Structured Link requirement on Link-gated abilities (secondary unless card has no non-link payoff)
    const linkReq =
      ab.kind === 'EFFECT_CLAUSE'
        ? ab.linkRequirement
        : ab.kind === 'CONTINUOUS_MODIFIER'
        ? ab.requiresLink
        : undefined;
    if (linkReq) {
      if (linkReq.role === 'UNIT_REQUIRES_PILOT' && (linkReq.names.length > 0 || linkReq.traits.length > 0)) {
        clausePrereqs.push({
          kind: 'LINK',
          cardType: 'PILOT',
          ...(linkReq.names.length > 0 ? { anyNames: linkReq.names } : {}),
          ...(linkReq.traits.length > 0 ? { anyTraits: linkReq.traits } : {}),
          minCopies: 4,
          reason: `Link requires ${linkReq.raw}`,
        });
      } else if (linkReq.role === 'PILOT_MATCHING_UNIT' && (linkReq.names.length > 0 || linkReq.traits.length > 0)) {
        clausePrereqs.push({
          kind: 'LINK',
          cardType: 'UNIT',
          ...(linkReq.names.length > 0 ? { anyNames: linkReq.names } : {}),
          ...(linkReq.traits.length > 0 ? { anyTraits: linkReq.traits } : {}),
          minCopies: 4,
          reason: `Links with Unit matching ${linkReq.raw}`,
        });
      }
    }

    // 2. Ability & nested IF_CONDITION / GRANT_CLAUSE conditions
    const conds: EffectCondition[] = [];
    if ('condition' in ab && ab.condition) {
      collectNestedConditions(ab.condition, conds);
    }
    for (const step of flatSteps) {
      if (step.action === 'IF_CONDITION') collectNestedConditions(step.condition, conds);
      if (step.action === 'GRANT_CLAUSE') collectNestedConditions(step.clause.condition, conds);
    }

    for (const cond of conds) {
      if (
        cond.kind === 'TRASH_COUNT_AT_LEAST' &&
        cond.owner !== 'ENEMY' &&
        (cond.trait || cond.traits?.length || cond.color || cond.cardType)
      ) {
        const trait = cond.trait ?? cond.traits?.[0];
        const ct =
          cond.cardType === 'UNIT' || cond.cardType === 'PILOT' || cond.cardType === 'BASE' || cond.cardType === 'COMMAND'
            ? cond.cardType
            : undefined;
        const label = [cond.color, trait ? `(${trait})` : undefined, ct].filter(Boolean).join(' ');
        clausePrereqs.push({
          kind: trait ? 'TRAIT' : cond.color ? 'COLOR' : 'CARD_TYPE',
          trait,
          ...(cond.traits && cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          color: cond.color,
          cardType: ct,
          minCopies: 8,
          reason: `Requires ${cond.count}+ ${label} cards in trash`,
        });
      } else if (cond.kind === 'UNIT_TRAIT_IS') {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.trait,
          ...(cond.traits && cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          cardType: 'UNIT',
          minCopies: 4,
          reason: `Requires (${cond.trait}) Unit`,
        });
      } else if (cond.kind === 'BOARD_CARD_COUNT' && cond.owner === 'SELF' && (cond.traits?.length || cond.nameContains)) {
        const ct = cond.cardType === 'UNIT_TOKEN' ? 'UNIT' : cond.cardType;
        if (cond.traits?.length) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait: cond.traits[0],
            ...(cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
            cardType: ct,
            minCopies: 4,
            reason: `Requires (${cond.traits[0]})`,
          });
        } else if (cond.nameContains) {
          clausePrereqs.push({
            kind: 'NAME',
            nameContains: cond.nameContains,
            cardType: ct,
            minCopies: 4,
            reason: `Requires "${cond.nameContains}" ${ct}`,
          });
        }
      } else if (cond.kind === 'SELF_STATE' && cond.traits?.length) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.traits[0],
          ...(cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          cardType: 'UNIT',
          minCopies: 4,
          reason: `Requires (${cond.traits[0]}) Unit`,
        });
      } else if (cond.kind === 'TURN_HISTORY' && cond.traits?.length) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.traits[0],
          ...(cond.traits.length > 1 ? { anyTraits: cond.traits } : {}),
          minCopies: 4,
          reason: `Requires (${cond.traits[0]})`,
        });
      } else if (cond.kind === 'FRIENDLY_BASE_IN_PLAY' && (cond.trait || cond.color)) {
        clausePrereqs.push({
          kind: cond.trait ? 'TRAIT' : 'COLOR',
          ...(cond.trait ? { trait: cond.trait } : {}),
          ...(cond.color ? { color: cond.color } : {}),
          cardType: 'BASE',
          minCopies: 4,
          reason: `Requires friendly ${cond.trait ? `(${cond.trait}) ` : cond.color ? `${cond.color} ` : ''}Base`,
        });
      }
    }

    // 3. Trigger actorFilter / targetFilter when owner === 'SELF'
    if (ab.kind === 'EFFECT_CLAUSE' && ab.triggerEvent) {
      if (ab.triggerEvent.actorFilter) pushSelectorPrerequisites(ab.triggerEvent.actorFilter, 4, clausePrereqs);
      if (ab.triggerEvent.targetFilter) pushSelectorPrerequisites(ab.triggerEvent.targetFilter, 4, clausePrereqs);
    }

    // 4. Ability steps (including nested IF_CONDITION / IF_PREVIOUS_SUCCEEDED / GRANT_CLAUSE)
    const abCondition = 'condition' in ab ? ab.condition : undefined;
    const stepHasGate = Boolean(pairFilter || (abCondition && clausePrereqs.some((p) => p.kind !== 'LINK')));
    for (const step of flatSteps) {
      const lookTrait = step.action === 'LOOK_TOP' ? step.trait ?? step.target?.trait ?? step.target?.traits?.[0] : undefined;
      if (step.action === 'LOOK_TOP' && lookTrait) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: lookTrait,
          minCopies: 8,
          reason: `Searches (${lookTrait}) cards`,
        });
      } else if (
        'target' in step &&
        step.target &&
        step.target.owner === 'SELF' &&
        (step.target.trait || step.target.traits?.length || step.target.nameContains)
      ) {
        const isTrashDensity = step.action === 'DEPLOY_FROM_TRASH' || step.action === 'ADD_FROM_TRASH_TO_HAND';
        const minCopies: 4 | 8 = isTrashDensity && (step.target.trait || step.target.traits?.length) ? 8 : 4;
        pushSelectorPrerequisites(step.target, minCopies, clausePrereqs);
      } else if (
        !stepHasGate &&
        step.action !== 'ACTIVATE_MAIN_EFFECT' &&
        step.action !== 'GRANT_PILOT_MODE' &&
        step.action !== 'NAME_ALIAS'
      ) {
        hasUnrestrictedStep = true;
      }

      if ('sourceFilter' in step && step.sourceFilter) {
        pushSelectorPrerequisites(step.sourceFilter, 4, clausePrereqs);
      }
      if ('scaleBy' in step && step.scaleBy?.traits?.length) {
        if (
          step.scaleBy.metric === 'TRASH_COUNT' ||
          step.scaleBy.metric === 'AFFECTED_COUNT' ||
          step.scaleBy.metric === 'BOARD_UNIT_COUNT'
        ) {
          const trait = step.scaleBy.traits[0];
          if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === trait.toLowerCase())) {
            clausePrereqs.push({
              kind: 'TRAIT',
              trait,
              ...(step.scaleBy.traits.length > 1 ? { anyTraits: step.scaleBy.traits } : {}),
              minCopies: 8,
              reason: `Scales damage/effect with (${trait}) density`,
            });
          }
        }
      }
    }

    // 5. ContinuousModifier perTarget scaling & sourceFilter
    if (ab.kind === 'CONTINUOUS_MODIFIER') {
      if (ab.modifier.type === 'COST_REDUCTION' && ab.modifier.perTarget?.traits?.length) {
        const trait = ab.modifier.perTarget.traits[0];
        if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === trait.toLowerCase())) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait,
            ...(ab.modifier.perTarget.traits.length > 1 ? { anyTraits: ab.modifier.perTarget.traits } : {}),
            minCopies: 8,
            reason: `Scales cost reduction with (${trait}) density`,
          });
        }
      }
      if ('target' in ab.modifier && ab.modifier.target.owner === 'SELF') {
        pushSelectorPrerequisites(ab.modifier.target, 4, clausePrereqs);
      }
    }

    const isIdentityTagOnly =
      steps.length > 0 && steps.every((s) => s.action === 'GRANT_PILOT_MODE' || s.action === 'NAME_ALIAS');

    return { isBurstOnly, isIdentityTagOnly, clausePrereqs, hasUnrestrictedStep };
  });

  const nonBurstAbilities = perAbility.filter((c) => !c.isBurstOnly && !c.isIdentityTagOnly);
  const hasUnrestrictedActiveAbility = nonBurstAbilities.some((c) => c.hasUnrestrictedStep || c.clausePrereqs.length === 0);

  for (const c of perAbility) {
    const isPrimaryBase =
      !hasInnateKeyword && !c.isBurstOnly && !c.isIdentityTagOnly && !c.hasUnrestrictedStep && !hasUnrestrictedActiveAbility;
    for (const p of c.clausePrereqs) {
      const isPrimary = p.kind === 'LINK' ? false : isPrimaryBase;
      const key = `${p.kind}|${p.trait ?? ''}|${p.color ?? ''}|${p.cardType ?? ''}|${p.nameContains ?? ''}|${(p.anyNames ?? []).join(',')}`;
      const prev = collected.get(key);
      if (!prev) {
        collected.set(key, { ...p, primaryClause: isPrimary });
      } else if (isPrimary && !prev.primaryClause) {
        collected.set(key, { ...p, primaryClause: true });
      } else if (isPrimary === prev.primaryClause) {
        prev.minCopies = prev.minCopies === 8 || p.minCopies === 8 ? 8 : 4;
      }
    }
  }

  return [...collected.values()];
}
