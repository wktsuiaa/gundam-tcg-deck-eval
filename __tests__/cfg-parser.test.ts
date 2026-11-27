import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint } from '@/types/gundam';
import {
  CUSTOM_HOOK_REGISTRY,
  normalizeCardEffectText,
  parseCardAbilities,
} from '@/lib/cfg-parser';
import { compileCardEffect } from '@/lib/effect-parser';

function loadCorpus(): Map<string, GundamCardPrint> {
  const dir = path.join(process.cwd(), 'data', 'collections');
  const byCardNo = new Map<string, GundamCardPrint>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const card of (raw.cards ?? []) as GundamCardPrint[]) {
      const prev = byCardNo.get(card.cardNo);
      if (!prev || (prev.isParallel && !card.isParallel)) {
        byCardNo.set(card.cardNo, card);
      }
    }
  }
  return byCardNo;
}

describe('Seam 1: Chevrotain CFG Parser & CST Lowering', () => {
  const corpus = loadCorpus();

  it('normalizes reminder text, modal ■ headers, and full-width glyphs deterministically', () => {
    const gd06114 = corpus.get('GD06-114');
    expect(gd06114).toBeDefined();
    const normalized = normalizeCardEffectText(gd06114!.effect);
    expect(normalized.toLowerCase()).not.toContain('choose 1 of the following effects');
    expect(normalized).toContain('【Action】');

    const st01015 = corpus.get('ST01-015')!;
    const normBase = normalizeCardEffectText(st01015.effect);
    expect(normBase).toContain('<COST_SEP>');
    expect(normBase).toContain('<RES_COST:2>');
    expect(normBase).toContain('((White Base Team)<DOT>AP3<DOT>HP3)');
  });

  it('classifies reactive triggers and Layer-2 continuous keyword grants cleanly (GD06-001)', () => {
    const res = parseCardAbilities(corpus.get('GD06-001')!);
    expect(res.errors).toEqual([]);
    expect(res.abilities).toHaveLength(2);

    expect(res.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      clauseIndex: 0,
      timings: ['WHEN_ATTACKED'],
      oncePerTurn: true,
    });
    expect(res.abilities[1]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex: 1,
      layer: 2,
      requiresPair: true,
      modifier: {
        type: 'GRANT_KEYWORD',
        keyword: { name: 'High-Maneuver', value: null },
      },
    });
  });

  it('elevates event-level "would ... instead" clauses to structured ReplacementEffectAst (GD05-124, GD03-079, ST14-006)', () => {
    const gd05124 = parseCardAbilities(corpus.get('GD05-124')!);
    expect(gd05124.errors).toEqual([]);
    const rep05124 = gd05124.abilities.find((a) => a.kind === 'REPLACEMENT_EFFECT');
    expect(rep05124).toMatchObject({
      kind: 'REPLACEMENT_EFFECT',
      intercepts: 'WOULD_REST',
      optional: true,
      subject: { owner: 'SELF', cardType: 'BASE', self: true },
      outcome: { kind: 'REST_OTHER', target: { owner: 'SELF', cardType: 'BASE', self: true } },
      maxPerEventInstance: 1,
    });

    const gd03079 = parseCardAbilities(corpus.get('GD03-079')!);
    expect(gd03079.errors).toEqual([]);
    expect(gd03079.abilities[0]).toMatchObject({
      kind: 'REPLACEMENT_EFFECT',
      intercepts: 'WOULD_REST',
      optional: true,
      outcome: { kind: 'REST_OTHER' },
      maxPerEventInstance: 1,
    });

    const st14006 = parseCardAbilities(corpus.get('ST14-006')!);
    expect(st14006.errors).toEqual([]);
    const rep14006 = st14006.abilities.find((a) => a.kind === 'REPLACEMENT_EFFECT');
    expect(rep14006).toMatchObject({
      kind: 'REPLACEMENT_EFFECT',
      scope: 'PAIRED',
      oncePerTurn: true,
      intercepts: 'WOULD_TAKE_DAMAGE',
      sourceFilter: { owner: 'ENEMY', cardType: 'UNIT', apMaxRef: 'SELF_AP' },
      outcome: { kind: 'PREVENT_DAMAGE', damageType: 'BATTLE' },
      maxPerEventInstance: 1,
    });
  });

  it('lowers complex prohibitions, redirects, and token exclusions to structured Layer-4 ASTs', () => {
    const gd02129 = parseCardAbilities(corpus.get('GD02-129')!);
    expect(gd02129.abilities[2]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      layer: 4,
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_RECEIVE_EFFECT_DAMAGE',
        target: { owner: 'SELF', self: true, cardType: 'BASE' },
        sourceFilter: { owner: 'ENEMY' },
      },
    });

    const gd05123 = parseCardAbilities(corpus.get('GD05-123')!);
    expect(gd05123.abilities[2]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      condition: { kind: 'IS_OPPONENT_TURN' },
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_RECEIVE_EFFECT_DAMAGE',
        target: { owner: 'SELF', cardType: 'UNIT', trait: 'Orb' },
        sourceFilter: { owner: 'ENEMY' },
        damageMax: 2,
      },
    });

    const st11002 = parseCardAbilities(corpus.get('ST11-002')!);
    expect(st11002.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      condition: {
        kind: 'ALL_OF',
        conditions: [{ kind: 'IS_OPPONENT_TURN' }, { kind: 'SELF_RESTED' }],
      },
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_RECEIVE_EFFECT_DAMAGE',
        target: { owner: 'SELF', cardType: 'UNIT', trait: 'Marine', hpMax: 2 },
        sourceFilter: { owner: 'ENEMY' },
      },
    });

    const gd01090 = parseCardAbilities(corpus.get('GD01-090')!);
    expect(gd01090.abilities[1]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_REDUCE_AP',
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
        sourceFilter: { owner: 'ENEMY' },
      },
    });

    const st11001 = parseCardAbilities(corpus.get('ST11-001')!);
    expect(st11001.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'REDIRECT_ATTACK_TARGET',
        rule: 'CANT_CHOOSE_TARGET',
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    });

    const st11014 = parseCardAbilities(corpus.get('ST11-014')!);
    expect(st11014.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      steps: [
        {
          action: 'REDIRECT_ATTACK_TARGET',
          rule: 'CANT_CHOOSE_TARGET',
          duration: 'THIS_TURN',
        },
      ],
    });

    const st07015 = parseCardAbilities(corpus.get('ST07-015')!);
    expect(st07015.abilities[2]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_RECEIVE_DAMAGE',
        target: { owner: 'SELF', self: true, cardType: 'BASE' },
        sourceFilter: { owner: 'ENEMY', cardType: 'UNIT', lvMax: 3, excludeToken: true },
      },
    });

    const gd04022 = parseCardAbilities(corpus.get('GD04-022')!);
    expect(gd04022.abilities[1]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'RESTRICTION',
        rule: 'DEPLOYED_RESTED',
        target: { owner: 'ANY', cardType: 'UNIT', lvMax: 3, excludeToken: true },
      },
    });

    const t014 = parseCardAbilities({
      cardNo: 'T-014',
      effect: "This Unit can't be set as active or paired with a Pilot.",
    });
    expect(t014.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_SET_ACTIVE',
        additionalRules: ['CANT_BE_PAIRED'],
      },
    });

    const t029 = parseCardAbilities({
      cardNo: 'T-029',
      effect: "This Unit can't be paired with a Pilot or attack.",
    });
    expect(t029.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'PROHIBITION',
        rule: 'CANT_BE_PAIRED',
        additionalRules: ['CANT_ATTACK'],
      },
    });
  });

  it('lowers GD03-120 grant-clause reactive trigger without RAW_CONDITION, and handles instead upgrades & CustomHook v2', () => {
    const gd03120 = parseCardAbilities(corpus.get('GD03-120')!);
    expect(gd03120.errors).toEqual([]);
    expect(gd03120.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['MAIN'],
      steps: [
        {
          action: 'GRANT_CLAUSE',
          duration: 'THIS_TURN',
          clause: {
            timings: ['WHEN_DESTROY_BY_BATTLE'],
            steps: expect.arrayContaining([
              expect.objectContaining({ action: 'SET_ACTIVE' }),
              expect.objectContaining({ action: 'CANT_ATTACK', duration: 'THIS_TURN' }),
            ]),
          },
        },
      ],
    });

    const gd03109 = parseCardAbilities(corpus.get('GD03-109')!);
    expect(gd03109.errors).toEqual([]);
    const cl03109 = gd03109.abilities[1];
    expect(cl03109?.kind).toBe('EFFECT_CLAUSE');
    if (cl03109?.kind === 'EFFECT_CLAUSE') {
      expect(cl03109.steps.some((s) => s.action === 'IF_CONDITION' && s.replacesPrevious === true)).toBe(true);
    }

    const gd06050 = parseCardAbilities(corpus.get('GD06-050')!);
    const dep06050 = gd06050.abilities[1];
    expect(dep06050?.kind).toBe('EFFECT_CLAUSE');
    if (dep06050?.kind === 'EFFECT_CLAUSE') {
      expect(dep06050.steps.some((s) => s.action === 'IF_CONDITION' && s.replacesPrevious === true)).toBe(true);
    }

    const st12012 = parseCardAbilities(corpus.get('ST12-012')!);
    const link12012 = st12012.abilities[2];
    expect(link12012?.kind).toBe('EFFECT_CLAUSE');
    if (link12012?.kind === 'EFFECT_CLAUSE') {
      expect(link12012.steps.some((s) => s.action === 'IF_CONDITION' && s.replacesPrevious === true)).toBe(true);
    }

    const st01015 = parseCardAbilities(corpus.get('ST01-015')!);
    expect(st01015.errors).toEqual([]);
    const hook = st01015.abilities.find((a) => a.kind === 'CUSTOM_HOOK');
    expect(hook).toMatchObject({
      kind: 'CUSTOM_HOOK',
      hookId: 'ST01-015#2',
      version: 2,
      timings: ['ACTIVATE_MAIN'],
      cost: { resourceCost: 2 },
      steps: [expect.objectContaining({ action: 'DEPLOY_TOKEN', count: 1 })],
    });
    if (hook && hook.kind === 'CUSTOM_HOOK') {
      expect(CUSTOM_HOOK_REGISTRY[hook.hookId]).toBeDefined();
    }
  });

  it('lowers lexer failures to explicit DIAGNOSTIC nodes instead of dropping the line', () => {
    const res = parseCardAbilities({ cardNo: 'X-1', effect: '】【 ???' });
    expect(res.errors).toHaveLength(1);
    expect(res.abilities).toEqual([
      expect.objectContaining({ kind: 'DIAGNOSTIC', code: 'LEX_ERROR', clauseIndex: 0, raw: expect.any(String) }),
    ]);
  });

  it('achieves 100% Chevrotain CFG coverage across all 1,290+ unique cards with 0 errors and 0 unregistered CustomHooks', () => {
    expect(corpus.size).toBeGreaterThanOrEqual(1290);
    const allErrors: string[] = [];
    const unregisteredHooks: string[] = [];

    for (const card of corpus.values()) {
      const res = parseCardAbilities(card);
      allErrors.push(...res.errors);
      for (const ab of res.abilities) {
        if (ab.kind === 'DIAGNOSTIC') allErrors.push(ab.message);
        if (ab.kind === 'CUSTOM_HOOK' && !CUSTOM_HOOK_REGISTRY[ab.hookId]) {
          unregisteredHooks.push(ab.hookId);
        }
      }
    }

    expect(allErrors).toEqual([]);
    expect(unregisteredHooks).toEqual([]);
  });

  it('attaches typed abilities on compileCardEffect and avoids false replacement/continuous classifications', () => {
    const compiled = compileCardEffect(corpus.get('GD05-124')!);
    expect(compiled.abilities.length).toBeGreaterThanOrEqual(3);
    expect(compiled.abilities.some((a) => a.kind === 'REPLACEMENT_EFFECT')).toBe(true);

    // Triggered/activated "would ... instead" clauses remain EFFECT_CLAUSE
    for (const no of ['GD04-087', 'GD04-095', 'GD06-018']) {
      const ab = parseCardAbilities(corpus.get(no)!);
      expect(ab.abilities.some((a) => a.kind === 'REPLACEMENT_EFFECT')).toBe(false);
    }

    // Untagged one-shot temporary AP deduction + conditional Destroy stays EFFECT_CLAUSE
    const spell = compileCardEffect({
      printId: 'TST-095',
      cardNo: 'TST-095',
      name: 'Test Spell',
      type: 'COMMAND',
      color: 'Blue',
      ap: null,
      effect: 'Choose 1 enemy Unit. It gets AP-3 until end of turn. Destroy it if AP is 0.',
    });
    expect(spell.abilities[0]?.kind).toBe('EFFECT_CLAUSE');
    if (spell.abilities[0]?.kind === 'EFFECT_CLAUSE') {
      expect(spell.abilities[0].steps.map((s) => s.action)).toEqual(['MODIFY_AP', 'DESTROY']);
    }
  });
});
