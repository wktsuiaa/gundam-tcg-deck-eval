import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint } from '@/types/gundam';
import {
  CUSTOM_HOOK_REGISTRY,
  normalizeCardEffectText,
  parseCardAbilities as lowerAbilities,
} from '@/lib/cfg-parser';
import { compileCardEffect, parseCardEffects } from '@/lib/effect-parser';

type CardText = Parameters<typeof lowerAbilities>[0];
const parseCardAbilities = (card: CardText) => lowerAbilities(card, parseCardEffects(card).clauses);

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

describe('Seam 1: Chevrotain CFG Parser & Structural Normalizer', () => {
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

  it('elevates event-level "would ... instead" clauses to first-class ReplacementEffectAst (GD05-124, GD03-079, ST14-006)', () => {
    const gd05124 = parseCardAbilities(corpus.get('GD05-124')!);
    expect(gd05124.errors).toEqual([]);
    const rep05124 = gd05124.abilities.find((a) => a.kind === 'REPLACEMENT_EFFECT');
    expect(rep05124).toMatchObject({
      kind: 'REPLACEMENT_EFFECT',
      intercepts: 'WOULD_REST',
      optional: true,
      maxPerEventInstance: 1,
    });

    const gd03079 = parseCardAbilities(corpus.get('GD03-079')!);
    expect(gd03079.errors).toEqual([]);
    expect(gd03079.abilities[0]).toMatchObject({
      kind: 'REPLACEMENT_EFFECT',
      intercepts: 'WOULD_REST',
      optional: true,
      maxPerEventInstance: 1,
    });

    const st14006 = parseCardAbilities(corpus.get('ST14-006')!);
    expect(st14006.errors).toEqual([]);
    const rep14006 = st14006.abilities.find((a) => a.kind === 'REPLACEMENT_EFFECT');
    expect(rep14006).toMatchObject({
      kind: 'REPLACEMENT_EFFECT',
      intercepts: 'WOULD_TAKE_DAMAGE',
      maxPerEventInstance: 1,
    });
  });

  it('assigns continuous modifiers to Layer 2 (traits/keywords/identity), Layer 3 (AP/HP/cost), and Layer 4 ("cant")', () => {
    const gd01091 = parseCardAbilities(corpus.get('GD01-091')!);
    expect(gd01091.errors).toEqual([]);
    const cantMod = gd01091.abilities.find((a) => a.kind === 'CONTINUOUS_MODIFIER');
    expect(cantMod).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      layer: 4,
      modifier: { type: 'PROHIBITION', rule: 'CANT_RECEIVE_BATTLE_DAMAGE' },
    });

    const gd06003 = parseCardAbilities(corpus.get('GD06-003')!);
    expect(gd06003.errors).toEqual([]);
    expect(gd06003.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      layer: 3,
      modifier: { type: 'MODIFY_STAT', stat: 'AP' },
    });

    const st12012 = parseCardAbilities(corpus.get('ST12-012')!);
    expect(st12012.errors).toEqual([]);
    expect(st12012.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      layer: 2,
      modifier: { type: 'NAME_ALIAS', alias: 'Marida Cruz' },
    });
  });

  it('handles conditional "instead" upgrades inside EFFECT_CLAUSE (GD03-109) and long-tail CustomHook registration (ST01-015)', () => {
    const gd03109 = parseCardAbilities(corpus.get('GD03-109')!);
    expect(gd03109.errors).toEqual([]);
    expect(gd03109.abilities.some((a) => a.kind === 'EFFECT_CLAUSE')).toBe(true);

    const st01015 = parseCardAbilities(corpus.get('ST01-015')!);
    expect(st01015.errors).toEqual([]);
    const hook = st01015.abilities.find((a) => a.kind === 'CUSTOM_HOOK');
    expect(hook).toBeDefined();
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

  it('achieves 100% Chevrotain CFG coverage across all 1,290+ unique cards with 0 unregistered CustomHooks', () => {
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
