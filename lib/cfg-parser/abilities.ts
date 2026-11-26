import { type CstNode, type IToken } from 'chevrotain';
import type { GundamCardPrint } from '../../types/gundam.ts';
import type { EffectClause, EffectStep, EffectTiming, KeywordAbility } from '../effect-parser.ts';
import { type AbilityAst, CUSTOM_HOOK_REGISTRY, type CfgParseResult } from './ast.ts';
import { GundamLexer, clauseParser } from './grammar.ts';
import { liftContinuousModifier, liftReplacementEffect, parseKeywordTag } from './lift.ts';
import { normalizeCardEffectText } from './normalize.ts';

export function parseCardAbilities(
  card: Pick<GundamCardPrint, 'cardNo' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'traits' | 'link'>>,
  legacyClauses: EffectClause[]
): CfgParseResult {
  const normalized = normalizeCardEffectText(card.effect ?? '');
  if (!normalized) {
    return { cardNo: card.cardNo, keywords: [], abilities: [], errors: [] };
  }

  const lines = normalized.split(/\n+/).filter(Boolean);
  const keywords: KeywordAbility[] = [];
  const abilities: AbilityAst[] = [];
  const errors: string[] = [];

  let clauseIdx = 0;

  for (const line of lines) {
    const lexed = GundamLexer.tokenize(line);
    if (lexed.errors.length > 0) {
      const message = `[${card.cardNo}#${clauseIdx}] Lex error: ${lexed.errors.map((e) => e.message).join('; ')}`;
      errors.push(message);
      abilities.push({ kind: 'DIAGNOSTIC', clauseIndex: clauseIdx, code: 'LEX_ERROR', message, raw: line });
      clauseIdx += 1;
      continue;
    }

    clauseParser.input = lexed.tokens;
    const cst: CstNode = clauseParser.clauseLine();
    if (clauseParser.errors.length > 0) {
      const message = `[${card.cardNo}#${clauseIdx}] Parse error: ${clauseParser.errors.map((e) => e.message).join('; ')}`;
      errors.push(message);
      abilities.push({ kind: 'DIAGNOSTIC', clauseIndex: clauseIdx, code: 'PARSE_ERROR', message, raw: line });
      clauseIdx += 1;
      continue;
    }

    if (cst.children.keywordOnlyUnit) {
      const kwNode = cst.children.keywordOnlyUnit[0] as CstNode;
      for (const tok of [
        ...((kwNode.children.KeywordTag ?? []) as IToken[]),
        ...((kwNode.children.BracketName ?? []) as IToken[]),
      ]) {
        const parsedKw = parseKeywordTag(tok.image);
        if (parsedKw) keywords.push(parsedKw);
      }
      continue;
    }

    const currentIdx = clauseIdx;
    clauseIdx += 1;

    const hookId = `${card.cardNo}#${currentIdx}`;
    const registeredHook = CUSTOM_HOOK_REGISTRY[hookId];
    if (registeredHook) {
      abilities.push({
        kind: 'CUSTOM_HOOK',
        clauseIndex: currentIdx,
        hookId: registeredHook.hookId,
        version: registeredHook.version,
        raw: line,
        prerequisites: registeredHook.prerequisites ?? [],
      });
      continue;
    }

    const legacyClause = legacyClauses[currentIdx];

    if (cst.children.replacementUnit) {
      abilities.push(liftReplacementEffect(currentIdx, line, legacyClause));
      continue;
    }

    if (cst.children.continuousUnit) {
      abilities.push(liftContinuousModifier(currentIdx, line, legacyClause));
      continue;
    }

    // Triggered / Activated Effect Clause: lowered from the effect-parser's typed clause for this line.
    if (!legacyClause) {
      const message = `[${card.cardNo}#${currentIdx}] No lowered clause available for this line.`;
      errors.push(message);
      abilities.push({ kind: 'DIAGNOSTIC', clauseIndex: currentIdx, code: 'NO_LOWERING', message, raw: line });
      continue;
    }
    if (legacyClause.unparsedResidual) {
      abilities.push({
        kind: 'DIAGNOSTIC',
        clauseIndex: currentIdx,
        code: 'UNPARSED_RESIDUAL',
        message: `[${card.cardNo}#${currentIdx}] Unparsed residual text: ${legacyClause.unparsedResidual}`,
        raw: legacyClause.unparsedResidual,
      });
    }
    const insteadMatch = line.match(/\bIf\s+([^,]+),\s*(.+?\binstead)\.?$/i);
    abilities.push({
      kind: 'EFFECT_CLAUSE',
      clauseIndex: currentIdx,
      raw: legacyClause.raw,
      timings: legacyClause.timings,
      oncePerTurn: /【Once per Turn】/.test(line) || legacyClause.oncePerTurn,
      ...(legacyClause.triggerEvent ? { triggerEvent: legacyClause.triggerEvent } : {}),
      ...(legacyClause.pairFilter ? { pairFilter: legacyClause.pairFilter } : {}),
      ...(legacyClause.linkRequirement ? { linkRequirement: legacyClause.linkRequirement } : {}),
      ...(legacyClause.cost ? { cost: legacyClause.cost } : {}),
      ...(legacyClause.condition ? { condition: legacyClause.condition } : {}),
      steps: legacyClause.steps,
      ...(insteadMatch ? { insteadUpgrade: { rawUpgrade: insteadMatch[2].trim() } } : {}),
    });
  }

  return {
    cardNo: card.cardNo,
    keywords,
    abilities,
    errors,
  };
}

export function getAbilityTimings(ab: AbilityAst): EffectTiming[] {
  switch (ab.kind) {
    case 'EFFECT_CLAUSE':
      return ab.timings;
    case 'CONTINUOUS_MODIFIER': {
      const timings: EffectTiming[] = [];
      if (ab.requiresPair) timings.push('DURING_PAIR');
      if (ab.requiresLink) timings.push('DURING_LINK');
      timings.push('CONTINUOUS');
      return timings;
    }
    case 'REPLACEMENT_EFFECT': {
      const timings: EffectTiming[] = [];
      if (ab.scope === 'PAIRED') timings.push('DURING_PAIR');
      if (ab.scope === 'LINKED') timings.push('DURING_LINK');
      timings.push('CONTINUOUS');
      return timings;
    }
    case 'CUSTOM_HOOK':
      return ab.hookId === 'ST01-015#2' ? ['ACTIVATE_MAIN'] : ['CONTINUOUS'];
    case 'DIAGNOSTIC':
      return [];
  }
}

export function getAbilitySteps(ab: AbilityAst): EffectStep[] {
  switch (ab.kind) {
    case 'EFFECT_CLAUSE':
      return ab.steps;
    case 'REPLACEMENT_EFFECT':
      if (ab.steps?.length) return ab.steps;
      if (ab.intercepts === 'WOULD_TAKE_DAMAGE') {
        return [{ action: 'DAMAGE_PROOF', summary: ab.replacementSummary, duration: ab.duration, target: ab.subject }];
      }
      if (ab.intercepts === 'WOULD_REST') {
        return [{ action: 'REST', target: ab.subject }];
      }
      return [];
    case 'CONTINUOUS_MODIFIER': {
      const m = ab.modifier;
      switch (m.type) {
        case 'MODIFY_STAT':
          return [
            m.stat === 'AP'
              ? { action: 'MODIFY_AP', delta: m.delta, ...(m.scaleBy ? { scaleBy: m.scaleBy } : {}), duration: ab.duration, target: m.target }
              : { action: 'MODIFY_HP', delta: m.delta, ...(m.scaleBy ? { scaleBy: m.scaleBy } : {}), duration: ab.duration, target: m.target },
          ];
        case 'COST_REDUCTION':
          return [
            {
              action: 'COST_REDUCTION',
              amount: m.amount,
              ...(m.lvDelta !== undefined ? { lvDelta: m.lvDelta } : {}),
              ...(ab.activeIn === 'TRASH' ? { zone: 'TRASH' as const } : { zone: 'HAND' as const }),
            },
          ];
        case 'GRANT_KEYWORD':
          return [
            {
              action: 'GRANT_KEYWORD',
              keyword: m.keyword,
              ...(m.scaleBy ? { scaleBy: m.scaleBy } : {}),
              duration: ab.duration,
              target: m.target,
            },
          ];
        case 'GRANT_TRAIT':
          return [{ action: 'GRANT_TRAIT', traits: m.traits, duration: ab.duration, target: m.target }];
        case 'NAME_ALIAS':
          return [{ action: 'NAME_ALIAS', alias: m.alias }];
        case 'GRANT_PILOT_MODE':
          return [{ action: 'GRANT_PILOT_MODE', pilotName: m.pilotName }];
        case 'PROHIBITION':
          if (m.rule === 'CANT_ATTACK') {
            return [{ action: 'CANT_ATTACK', duration: ab.duration, target: m.target }];
          }
          if (
            m.rule === 'CANT_RECEIVE_BATTLE_DAMAGE' ||
            m.rule === 'CANT_RECEIVE_EFFECT_DAMAGE' ||
            m.rule === 'CANT_RECEIVE_DAMAGE' ||
            m.rule === 'CANT_BE_DESTROYED' ||
            m.rule === 'CANT_BE_CHOSEN'
          ) {
            return [{ action: 'DAMAGE_PROOF', summary: ab.raw, duration: ab.duration, target: m.target }];
          }
          return [];
        case 'ALLOW_ATTACK_ACTIVE':
          return [{ action: 'ALLOW_ATTACK_ACTIVE', target: m.target }];
        case 'FREEZE_AURA':
          return [{ action: 'FREEZE', target: m.target }];
        case 'RESTRICTION':
          return [];
        case 'REDIRECT_ATTACK_TARGET':
          return [];
        case 'STATIC_PERMISSION':
          return [];
      }
    }
    case 'CUSTOM_HOOK':
      return ab.hookId === 'ST01-015#2'
        ? [{ action: 'DEPLOY_TOKEN', count: 1, name: 'White Base Token' }]
        : [];
    case 'DIAGNOSTIC':
      return [];
  }
}
