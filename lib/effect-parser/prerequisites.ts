import type { CardColor, GundamCardPrint } from '@/types/gundam';
import { parseCardEffects } from './clause-compile.ts';
import { collectNestedConditions, flattenEffectSteps } from './synergy.ts';
import { type EffectClause, type EffectCondition } from './types.ts';

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

export function isNonFunctionalTag(clause: EffectClause): boolean {
  return clause.steps.length === 0 && !clause.condition && !clause.pairFilter && !clause.linkRequirement;
}

/** Extracts deck-composition Effect Prerequisites (4 copies for single-target/pair/link, 8 for density/search/mill-scale). */
export function extractEffectPrerequisites(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'name' | 'traits' | 'link'>>,
  parsed = parseCardEffects(card)
): EffectPrerequisite[] {
  const functionalClauses = parsed.clauses.filter((c) => !isNonFunctionalTag(c));
  const hasInnateKeyword = parsed.keywords.length > 0;
  const collected = new Map<string, EffectPrerequisite>();

  const perClause = functionalClauses.map((clause) => {
    const isBurstOnly = clause.timings.length === 1 && clause.timings[0] === 'BURST';
    const clausePrereqs: Omit<EffectPrerequisite, 'primaryClause'>[] = [];
    let hasUnrestrictedStep = false;

    // 1. Pair filter on header e.g. 【During Pair･(Coordinator) Pilot】 or 【When Paired･Purple Pilot】
    if (clause.pairFilter && (clause.pairFilter.trait || clause.pairFilter.color)) {
      const parts = [clause.pairFilter.color, clause.pairFilter.trait ? `(${clause.pairFilter.trait})` : undefined, 'Pilot'].filter(Boolean);
      clausePrereqs.push({
        kind: clause.pairFilter.trait ? 'TRAIT' : 'COLOR',
        trait: clause.pairFilter.trait,
        color: clause.pairFilter.color,
        cardType: 'PILOT',
        minCopies: 4,
        reason: `Requires ${parts.join(' ')}`,
      });
    }

    // 1b. Structured Link requirement on Link-gated clauses (secondary unless the card has no non-link payoff)
    if (clause.linkRequirement) {
      const lr = clause.linkRequirement;
      if (lr.role === 'UNIT_REQUIRES_PILOT' && (lr.names.length > 0 || lr.traits.length > 0)) {
        clausePrereqs.push({
          kind: 'LINK',
          cardType: 'PILOT',
          ...(lr.names.length > 0 ? { anyNames: lr.names } : {}),
          ...(lr.traits.length > 0 ? { anyTraits: lr.traits } : {}),
          minCopies: 4,
          reason: `Link requires ${lr.raw}`,
        });
      } else if (lr.role === 'PILOT_MATCHING_UNIT' && (lr.names.length > 0 || lr.traits.length > 0)) {
        clausePrereqs.push({
          kind: 'LINK',
          cardType: 'UNIT',
          ...(lr.names.length > 0 ? { anyNames: lr.names } : {}),
          ...(lr.traits.length > 0 ? { anyTraits: lr.traits } : {}),
          minCopies: 4,
          reason: `Links with Unit matching ${lr.raw}`,
        });
      }
    }

    // 2. Clause conditions (recursive across ALL_OF / ANY_OF / NOT)
    const conds: EffectCondition[] = [];
    collectNestedConditions(clause.condition, conds);
    for (const cond of conds) {
      if (cond.kind === 'TRASH_COUNT_AT_LEAST' && cond.owner !== 'ENEMY' && (cond.trait || cond.traits?.length || cond.color || cond.cardType)) {
        const trait = cond.trait ?? cond.traits?.[0];
        const ct = cond.cardType === 'UNIT' || cond.cardType === 'PILOT' || cond.cardType === 'BASE' || cond.cardType === 'COMMAND' ? cond.cardType : undefined;
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
      } else if (cond.kind === 'RAW_CONDITION') {
        const traitM = cond.text.match(/\(([^)]+)\)/);
        if (traitM) {
          const trait = traitM[1].trim();
          clausePrereqs.push({
            kind: 'TRAIT',
            trait,
            cardType: /\bunit\b/i.test(cond.text) ? 'UNIT' : /\bpilot\b/i.test(cond.text) ? 'PILOT' : undefined,
            minCopies: 4,
            reason: `Requires (${trait})`,
          });
        }
      }
    }

    // 3. Clause steps (including nested IF_CONDITION / IF_PREVIOUS_SUCCEEDED / GRANT_CLAUSE)
    const stepHasGate = Boolean(clause.pairFilter || (clause.condition && clausePrereqs.some((p) => p.kind !== 'LINK')));
    for (const step of flattenEffectSteps(clause.steps)) {
      if (step.action === 'LOOK_TOP' && step.trait) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: step.trait,
          minCopies: 8,
          reason: `Searches (${step.trait}) cards`,
        });
      } else if ('target' in step && step.target && step.target.owner === 'SELF' && (step.target.trait || step.target.nameContains)) {
        const t = step.target;
        const isTrashDensity = step.action === 'DEPLOY_FROM_TRASH' || step.action === 'ADD_FROM_TRASH_TO_HAND';
        const minCopies: 4 | 8 = isTrashDensity && t.trait ? 8 : 4;
        const ct =
          t.cardType === 'UNIT' || t.cardType === 'PILOT' || t.cardType === 'BASE' || t.cardType === 'COMMAND'
            ? t.cardType
            : undefined;
        if (t.trait) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait: t.trait,
            ...(t.traits && t.traits.length > 1 ? { anyTraits: t.traits } : {}),
            cardType: ct,
            minCopies,
            reason: `Requires (${t.trait})${ct ? ` ${ct}` : ''} target`,
          });
        } else if (t.nameContains) {
          clausePrereqs.push({
            kind: 'NAME',
            nameContains: t.nameContains,
            cardType: ct,
            minCopies,
            reason: `Requires "${t.nameContains}"${ct ? ` ${ct}` : ''}`,
          });
        }
      } else if (
        !stepHasGate &&
        step.action !== 'ACTIVATE_MAIN_EFFECT' &&
        step.action !== 'GRANT_PILOT_MODE' &&
        step.action !== 'NAME_ALIAS'
      ) {
        hasUnrestrictedStep = true;
      }
    }

    // 4. Residual & scaling trait fallback (also inspects scaleBy on typed steps)
    for (const step of flattenEffectSteps(clause.steps)) {
      if ('scaleBy' in step && step.scaleBy?.traits?.length && (step.scaleBy.metric === 'TRASH_COUNT' || step.scaleBy.metric === 'AFFECTED_COUNT')) {
        const trait = step.scaleBy.traits[0];
        if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === trait.toLowerCase())) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait,
            minCopies: 8,
            reason: `Scales damage/effect with (${trait}) density`,
          });
        }
      }
    }

    const scaleTargetText = clause.unparsedResidual || clause.raw;
    const scaleMatch = scaleTargetText.match(/equal to the number of (?:friendly )?\(([^)]+)\)/i);
    if (scaleMatch) {
      const trait = scaleMatch[1].trim();
      clausePrereqs.push({
        kind: 'TRAIT',
        trait,
        minCopies: 8,
        reason: `Scales damage/effect with (${trait}) density`,
      });
    }
    const friendlyMatch = clause.raw.match(
      /(?:friendly|of your|have a)\s+(?:other\s+|rested\s+|active\s+)?\(([^)]+)\)\s*(?:Link\s+)?(Units?|Pilots?|Bases?|Commands?|cards?)/i
    );
    if (friendlyMatch) {
      const fTrait = friendlyMatch[1].trim();
      if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === fTrait.toLowerCase())) {
        const typeRaw = friendlyMatch[2].toUpperCase().replace(/S$/, '');
        const ct =
          typeRaw === 'UNIT' || typeRaw === 'PILOT' || typeRaw === 'BASE' || typeRaw === 'COMMAND'
            ? typeRaw
            : undefined;
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: fTrait,
          cardType: ct,
          minCopies: 4,
          reason: `Requires (${fTrait})${ct ? ` ${ct}` : ''} target`,
        });
      }
    }

    const isIdentityTagOnly =
      clause.steps.length > 0 &&
      clause.steps.every((s) => s.action === 'GRANT_PILOT_MODE' || s.action === 'NAME_ALIAS');

    return { isBurstOnly, isIdentityTagOnly, clausePrereqs, hasUnrestrictedStep };
  });

  const nonBurstClauses = perClause.filter((c) => !c.isBurstOnly && !c.isIdentityTagOnly);
  const hasUnrestrictedActiveClause = nonBurstClauses.some((c) => c.hasUnrestrictedStep || c.clausePrereqs.length === 0);

  for (const c of perClause) {
    const isPrimaryBase = !hasInnateKeyword && !c.isBurstOnly && !c.isIdentityTagOnly && !c.hasUnrestrictedStep && !hasUnrestrictedActiveClause;
    for (const p of c.clausePrereqs) {
      // Link prerequisites are always secondary synergy requirements (Link Units/Pilots remain playable standalone)
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
