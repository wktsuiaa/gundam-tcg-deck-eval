import { type CstNode, type IToken } from 'chevrotain';
import type { GundamCardPrint } from '../../types/gundam.ts';
import type {
  EffectStep,
  EffectTiming,
  KeywordAbility,
  LinkRequirement,
} from '../effect-parser.ts';
import { type AbilityAst, CUSTOM_HOOK_REGISTRY, type CfgParseResult } from './ast.ts';
import { GundamLexer, clauseParser } from './grammar.ts';
import { liftContinuousModifier, liftEffectClause, liftReplacementEffect } from './lift.ts';
import { normalizeCardEffectText } from './normalize.ts';
import {
  extractBracketAndParenFromCardLink,
  extractBrackets,
  flattenCstTokens,
  hasWordSeq,
  parseKeywordFromTag,
} from './token-utils.ts';

function buildCardLinkRequirement(
  card: Pick<GundamCardPrint, 'cardNo' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'type' | 'name' | 'traits' | 'link'>>,
  timings: EffectTiming[],
  extraAliases: string[],
  pilotModeNames: string[]
): LinkRequirement | undefined {
  if (!timings.includes('WHEN_LINKED') && !timings.includes('DURING_LINK')) return undefined;

  if (card.type === 'UNIT' && card.link) {
    const { names, traits } = extractBracketAndParenFromCardLink(card.link);
    return {
      role: 'UNIT_REQUIRES_PILOT',
      names,
      traits,
      raw: card.link,
    };
  }

  if (card.type === 'PILOT' || pilotModeNames.length > 0) {
    const names = [
      ...new Set([
        ...(card.type === 'PILOT' && card.name ? [card.name] : []),
        ...pilotModeNames,
        ...extraAliases,
      ]),
    ];
    const traits = card.traits ?? [];
    return {
      role: 'PILOT_MATCHING_UNIT',
      names,
      traits,
      raw: names.map((n) => `[${n}]`).join(' / ') || traits.map((t) => `(${t})`).join(' / '),
    };
  }

  return undefined;
}

export function parseCardAbilities(
  card: Pick<GundamCardPrint, 'cardNo' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'type' | 'name' | 'traits' | 'link'>>
): CfgParseResult {
  const normalized = normalizeCardEffectText(card.effect ?? '');
  if (!normalized) {
    return { cardNo: card.cardNo, keywords: [], abilities: [], errors: [] };
  }

  const lines = normalized.split(/\n+/).filter(Boolean);
  const keywords: KeywordAbility[] = [];
  const abilities: AbilityAst[] = [];
  const errors: string[] = [];

  // Pass 1: Lex & Parse CST for all lines, collecting identity aliases & 【Pilot】[Name] modes from CST
  const extraAliases: string[] = [];
  const pilotModeNames: string[] = [];

  interface ParsedLine {
    line: string;
    cst?: CstNode;
    diag?: AbilityAst;
  }

  const parsedLines: ParsedLine[] = [];
  let preIdx = 0;

  for (const line of lines) {
    const lexed = GundamLexer.tokenize(line);
    if (lexed.errors.length > 0) {
      const message = `[${card.cardNo}#${preIdx}] Lex error: ${lexed.errors.map((e) => e.message).join('; ')}`;
      errors.push(message);
      parsedLines.push({
        line,
        diag: { kind: 'DIAGNOSTIC', clauseIndex: preIdx, code: 'LEX_ERROR', message, raw: line },
      });
      preIdx += 1;
      continue;
    }

    clauseParser.input = lexed.tokens;
    const cst: CstNode = clauseParser.clauseLine();
    if (clauseParser.errors.length > 0) {
      const message = `[${card.cardNo}#${preIdx}] Parse error: ${clauseParser.errors.map((e) => e.message).join('; ')}`;
      errors.push(message);
      parsedLines.push({
        line,
        diag: { kind: 'DIAGNOSTIC', clauseIndex: preIdx, code: 'PARSE_ERROR', message, raw: line },
      });
      preIdx += 1;
      continue;
    }

    if (cst.children.continuousUnit) {
      const contNode = cst.children.continuousUnit[0] as CstNode;
      const toks = flattenCstTokens(contNode);
      if (toks[0]?.image === '【Pilot】') {
        pilotModeNames.push(...extractBrackets(toks));
      } else if (hasWordSeq(toks, ['name', 'is', 'also', 'treated', 'as'])) {
        extraAliases.push(...extractBrackets(toks));
      }
    }

    if (!cst.children.keywordOnlyUnit) preIdx += 1;
    parsedLines.push({ line, cst });
  }

  // Pass 2: Lower CST nodes directly into typed AbilityAst nodes
  let clauseIdx = 0;
  for (const item of parsedLines) {
    if (item.diag) {
      abilities.push({ ...item.diag, clauseIndex: clauseIdx });
      clauseIdx += 1;
      continue;
    }

    const cst = item.cst!;
    if (cst.children.keywordOnlyUnit) {
      const kwNode = cst.children.keywordOnlyUnit[0] as CstNode;
      for (const tok of [
        ...((kwNode.children.KeywordTag ?? []) as IToken[]),
        ...((kwNode.children.BracketName ?? []) as IToken[]),
      ]) {
        const parsedKw = parseKeywordFromTag(tok.image);
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
        raw: item.line,
        timings: registeredHook.timings,
        ...(registeredHook.cost ? { cost: registeredHook.cost } : {}),
        steps: registeredHook.steps,
        prerequisites: registeredHook.prerequisites ?? [],
      });
      continue;
    }

    if (cst.children.replacementUnit) {
      abilities.push(liftReplacementEffect(currentIdx, item.line, cst.children.replacementUnit[0] as CstNode));
      continue;
    }

    if (cst.children.continuousUnit) {
      const contAst = liftContinuousModifier(currentIdx, item.line, cst.children.continuousUnit[0] as CstNode);
      if (contAst.requiresLink === undefined) {
        const contToks = flattenCstTokens(cst.children.continuousUnit[0] as CstNode);
        const hasDuringLink = contToks.some((t) => t.image === '【During Link】');
        if (hasDuringLink) {
          contAst.requiresLink = buildCardLinkRequirement(card, ['DURING_LINK'], extraAliases, pilotModeNames);
        }
      }
      abilities.push(contAst);
      continue;
    }

    const effectNode = cst.children.effectClauseUnit?.[0] as CstNode | undefined;
    if (!effectNode) {
      const message = `[${card.cardNo}#${currentIdx}] Missing effectClauseUnit in CST.`;
      errors.push(message);
      abilities.push({ kind: 'DIAGNOSTIC', clauseIndex: currentIdx, code: 'NO_LOWERING', message, raw: item.line });
      continue;
    }

    abilities.push(
      liftEffectClause(currentIdx, item.line, effectNode, (timings) =>
        buildCardLinkRequirement(card, timings, extraAliases, pilotModeNames)
      )
    );
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
      return ab.timings;
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
      if (ab.outcome.kind === 'PREVENT_DAMAGE') {
        return [
          {
            action: 'DAMAGE_PROOF',
            damageType: ab.outcome.damageType ?? 'ANY',
            duration: ab.duration,
            target: ab.subject,
            ...(ab.sourceFilter ? { sourceFilter: ab.sourceFilter } : {}),
          },
        ];
      }
      if (ab.outcome.kind === 'REST_OTHER') {
        return [{ action: 'REST', target: ab.outcome.target ?? ab.subject }];
      }
      return ab.outcome.steps ?? [];
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
              ...(m.perTarget ? { perTarget: m.perTarget } : {}),
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
            m.rule === 'CANT_RECEIVE_DAMAGE'
          ) {
            return [
              {
                action: 'DAMAGE_PROOF',
                ...(m.damageMax !== undefined ? { maxDamage: m.damageMax } : {}),
                damageType:
                  m.rule === 'CANT_RECEIVE_BATTLE_DAMAGE'
                    ? 'BATTLE'
                    : m.rule === 'CANT_RECEIVE_EFFECT_DAMAGE'
                    ? 'EFFECT'
                    : 'ANY',
                duration: ab.duration,
                target: m.target,
                ...(m.sourceFilter ? { sourceFilter: m.sourceFilter } : {}),
              },
            ];
          }
          if (
            m.rule === 'CANT_SET_ACTIVE' ||
            m.rule === 'CANT_BE_RESTED' ||
            m.rule === 'CANT_BE_PAIRED' ||
            m.rule === 'CANT_ACTIVATE_BLOCKER' ||
            m.rule === 'CANT_BE_DESTROYED' ||
            m.rule === 'CANT_BE_CHOSEN' ||
            m.rule === 'CANT_BLOCK'
          ) {
            return [
              {
                action: 'RESTRICTION',
                rule: m.rule,
                target: m.target,
                ...(m.sourceFilter ? { sourceFilter: m.sourceFilter } : {}),
                duration: ab.duration,
              },
            ];
          }
          return [];
        case 'ALLOW_ATTACK_ACTIVE':
          return [{ action: 'ALLOW_ATTACK_ACTIVE', target: m.target }];
        case 'FREEZE_AURA':
          return [{ action: 'FREEZE', target: m.target }];
        case 'RESTRICTION':
          return [
            {
              action: 'RESTRICTION',
              rule: m.rule as Extract<EffectStep, { action: 'RESTRICTION' }>['rule'],
              target: m.target,
              ...(m.sourceFilter ? { sourceFilter: m.sourceFilter } : {}),
              duration: ab.duration,
            },
          ];
        case 'REDIRECT_ATTACK_TARGET':
          return [
            {
              action: 'REDIRECT_ATTACK_TARGET',
              rule: m.rule,
              target: m.target,
              ...(m.attackerFilter ? { attackerFilter: m.attackerFilter } : {}),
              duration: ab.duration,
            },
          ];
      }
    }
    case 'CUSTOM_HOOK':
      return ab.steps;
    case 'DIAGNOSTIC':
      return [];
  }
}
