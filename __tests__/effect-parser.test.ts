import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint } from '@/types/gundam';
import { parseCardAbilities, type AbilityAst } from '@/lib/cfg-parser';
import {
  compileCardEffect,
  extractEffectPrerequisites,
  getEffectSetPrefix,
  type CompiledCardEffect,
  type EffectShardFile,
  type EffectStep,
} from '@/lib/effect-parser';

function loadCorpus(): Map<string, GundamCardPrint> {
  const dir = path.join(process.cwd(), 'data', 'collections');
  const byCardNo = new Map<string, GundamCardPrint>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const card of (raw.cards ?? []) as GundamCardPrint[]) {
      if (!card.isParallel && !byCardNo.has(card.cardNo)) {
        byCardNo.set(card.cardNo, card);
      }
    }
  }
  return byCardNo;
}

describe('Seam 1: Schema v2 CST Lowering & Compiler Pipeline', () => {
  const corpus = loadCorpus();

  it('parses ST09-006 Sword Impulse Gundam with trash-deploy gate and Lv<=3 destroy target', () => {
    const parsed = parseCardAbilities(corpus.get('ST09-006')!);

    expect(parsed.keywords).toEqual([]);
    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['DEPLOY'],
      condition: { kind: 'DEPLOYED_FROM_ZONE', zone: 'trash' },
      steps: [
        {
          action: 'DESTROY',
          target: { owner: 'ENEMY', cardType: 'UNIT', count: 1, lvMax: 3 },
        },
      ],
    });
  });

  it('parses ST09-001 Impulse Gundam Activate-Main cost and Lv.4+ Impulse trash deploy', () => {
    const parsed = parseCardAbilities(corpus.get('ST09-001')!);

    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['ACTIVATE_MAIN'],
      cost: { resourceCost: 2, returnSelfToDeckBottom: true },
      steps: [
        {
          action: 'DEPLOY_FROM_TRASH',
          free: true,
          target: {
            owner: 'SELF',
            cardType: 'UNIT',
            count: 1,
            lvMin: 4,
            nameContains: 'Impulse Gundam',
          },
        },
      ],
    });
  });

  it('parses ST09-003 Saviour Gundam <Breach 3> and symmetrical AoE damage', () => {
    const parsed = parseCardAbilities(corpus.get('ST09-003')!);

    expect(parsed.keywords).toEqual([{ name: 'Breach', value: 3 }]);
    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['WHEN_LINKED'],
      condition: { kind: 'TRASH_COUNT_AT_LEAST', count: 5, color: 'Purple' },
      steps: [
        {
          action: 'DEAL_DAMAGE',
          amount: 2,
          target: { owner: 'ANY', cardType: 'UNIT', count: 'ALL', apMax: 5 },
        },
      ],
    });
  });

  it('parses ST09-004 Freedom Gundam <Blocker> and conditional <Suppression> with Base check', () => {
    const parsed = parseCardAbilities(corpus.get('ST09-004')!);

    expect(parsed.keywords).toEqual([{ name: 'Blocker', value: null }]);
    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      condition: { kind: 'FRIENDLY_BASE_IN_PLAY' },
      modifier: {
        type: 'GRANT_KEYWORD',
        keyword: { name: 'Suppression', value: null },
        target: { owner: 'SELF', self: true },
      },
    });
  });

  it('separates 【Burst】Add this card to your hand from 【Attack】AP-2 on ST04-010 Kira Yamato', () => {
    const parsed = parseCardAbilities(corpus.get('ST04-010')!);

    expect(parsed.abilities).toHaveLength(2);
    expect(parsed.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['BURST'],
      steps: [{ action: 'ADD_SELF_TO_HAND' }],
    });
    expect(parsed.abilities[1]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['ATTACK'],
      steps: [
        {
          action: 'MODIFY_AP',
          delta: -2,
          duration: 'THIS_BATTLE',
          target: { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
        },
      ],
    });
  });

  it('handles GD01-054 continuous AP-threshold keyword and GD06-050 conditional multi-target upgrade', () => {
    const duel = parseCardAbilities(corpus.get('GD01-054')!);
    expect(duel.abilities).toHaveLength(1);
    expect(duel.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      condition: { kind: 'SELF_AP_AT_LEAST', minAp: 5 },
      modifier: { type: 'GRANT_KEYWORD', keyword: { name: 'Breach', value: 3 } },
    });

    const legend = parseCardAbilities(corpus.get('GD06-050')!);
    const deployClause = legend.abilities.find((a) => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('DEPLOY'));
    expect(deployClause).toBeDefined();
    if (deployClause?.kind === 'EFFECT_CLAUSE') {
      expect(deployClause.steps.some((s) => s.action === 'DESTROY')).toBe(true);
    }
  });

  it('parses GD05-112 and GD05-113 self-pairing as PAIR_SELF_FROM_TRASH with (MF) Effect Prerequisite and primaryClause=true', () => {
    const gd112 = corpus.get('GD05-112')!;
    const parsed112 = parseCardAbilities(gd112);
    expect(parsed112.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      steps: [
        {
          action: 'GRANT_KEYWORD',
          keyword: { name: 'Breach', value: 3 },
          duration: 'THIS_TURN',
          target: { owner: 'SELF', cardType: 'UNIT', count: 1, trait: 'MF' },
        },
        {
          action: 'PAIR_SELF_FROM_TRASH',
          target: { owner: 'SELF', cardType: 'UNIT', count: 1, trait: 'MF', zone: 'BATTLE_AREA' },
        },
      ],
    });

    const prereq112 = extractEffectPrerequisites(gd112);
    expect(prereq112.some((p) => p.trait === 'MF' && p.primaryClause && p.minCopies === 4)).toBe(true);

    const prereq121 = extractEffectPrerequisites(corpus.get('GD05-121')!);
    expect(prereq121.some((p) => p.trait === 'MF' && !p.primaryClause)).toBe(true);

    const prereq4116 = extractEffectPrerequisites(corpus.get('GD04-116')!);
    expect(prereq4116.some((p) => p.trait === 'Minerva Squad' && p.minCopies === 8)).toBe(true);
  });

  it('parses GD06-001, GD06-002, GD06-003, and GD06-009 with exact triggers, conditions, and 1 HP selector', () => {
    const gd001 = parseCardAbilities(corpus.get('GD06-001')!);
    expect(gd001.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['WHEN_ATTACKED'],
      oncePerTurn: true,
      triggerEvent: { kind: 'WHEN_ATTACKED', actor: 'SELF' },
      steps: [{ action: 'DRAW', count: 1 }],
    });

    const gd002 = parseCardAbilities(corpus.get('GD06-002')!);
    expect(gd002.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['WHEN_DESTROY_BY_BATTLE'],
      oncePerTurn: true,
      triggerEvent: {
        kind: 'WHEN_DESTROY_BY_BATTLE',
        actor: 'SELF',
        targetKind: 'ANY_ENEMY_CARD',
        damageType: 'BATTLE',
      },
      condition: { kind: 'IS_YOUR_TURN' },
      steps: [
        {
          action: 'RECOVER_HP',
          amount: 3,
          target: { owner: 'SELF', cardType: 'UNIT', count: 1, trait: 'Orb' },
        },
      ],
    });
    expect(gd002.abilities[1]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      steps: [
        { action: 'EXILE', target: { owner: 'SELF', cardType: 'UNIT', count: 3, zone: 'TRASH' } },
        {
          action: 'IF_PREVIOUS_SUCCEEDED',
          thenSteps: [
            { action: 'BOUNCE', target: { owner: 'ENEMY', cardType: 'UNIT', count: 1, state: 'ACTIVE' } },
          ],
        },
      ],
    });

    const gd003 = parseCardAbilities(corpus.get('GD06-003')!);
    expect(gd003.abilities[0]).toMatchObject({
      kind: 'CONTINUOUS_MODIFIER',
      modifier: {
        type: 'MODIFY_STAT',
        stat: 'AP',
        delta: 1,
        scaleBy: { metric: 'HAND_COUNT', owner: 'SELF' },
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    });
    expect(gd003.abilities[1]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['ATTACK'],
      condition: {
        kind: 'ALL_OF',
        conditions: [
          { kind: 'BOARD_CARD_COUNT', owner: 'SELF', cardType: 'UNIT', min: 1, other: true, traits: ['Alphacide'] },
          { kind: 'HAND_COUNT', owner: 'SELF', max: 5 },
        ],
      },
      steps: [{ action: 'DRAW', count: 1 }],
    });

    const gd009 = parseCardAbilities(corpus.get('GD06-009')!);
    expect(gd009.abilities[0]).toMatchObject({
      kind: 'EFFECT_CLAUSE',
      timings: ['DEPLOY'],
      steps: [
        {
          action: 'BOUNCE',
          target: { owner: 'ENEMY', cardType: 'UNIT', count: 1, hpMin: 1, hpMax: 1 },
        },
      ],
    });
  });

  it('extracts structured linkRequirement, GRANT_PILOT_MODE, NAME_ALIAS, and secondary LINK prerequisites', () => {
    const st09003 = compileCardEffect(corpus.get('ST09-003')!);
    expect(st09003.abilities[0]?.kind === 'EFFECT_CLAUSE' ? st09003.abilities[0].linkRequirement : undefined).toEqual({
      role: 'UNIT_REQUIRES_PILOT',
      names: ['Athrun Zala'],
      traits: [],
      raw: '[Athrun Zala]',
    });
    expect(
      st09003.prerequisites.some((p) => p.kind === 'LINK' && p.cardType === 'PILOT' && p.anyNames?.includes('Athrun Zala') && !p.primaryClause)
    ).toBe(true);

    const gd01088 = compileCardEffect(corpus.get('GD01-088')!);
    const linkClause = gd01088.abilities.find((c) => c.kind === 'EFFECT_CLAUSE' && c.timings.includes('WHEN_LINKED'));
    expect(linkClause?.kind === 'EFFECT_CLAUSE' ? linkClause.linkRequirement : undefined).toMatchObject({
      role: 'PILOT_MATCHING_UNIT',
      names: ['Banagher Links'],
    });
    expect(
      gd01088.prerequisites.some((p) => p.kind === 'LINK' && p.cardType === 'UNIT' && p.anyNames?.includes('Banagher Links') && !p.primaryClause)
    ).toBe(true);

    const eb01076 = compileCardEffect(corpus.get('EB01-076')!);
    expect(
      eb01076.abilities.some((a) => a.kind === 'CONTINUOUS_MODIFIER' && a.modifier.type === 'GRANT_PILOT_MODE' && a.modifier.pilotName === 'Lowe Guele')
    ).toBe(true);

    const gd02098 = compileCardEffect(corpus.get('GD02-098')!);
    expect(
      gd02098.abilities.some((a) => a.kind === 'CONTINUOUS_MODIFIER' && a.modifier.type === 'NAME_ALIAS' && a.modifier.alias === 'Char Aznable')
    ).toBe(true);
  });

  it('recursively audits all AbilityAst nodes with 0 DIAGNOSTICs, 0 banned raw fields, 0 reminder leaks, and 100% link coverage', () => {
    let totalAbilities = 0;
    let diagnostics = 0;
    let bannedFields = 0;
    let missingLinkReq = 0;
    let missingHpExact = 0;
    let reminderLeaks = 0;

    const visitSteps = (steps: EffectStep[]) => {
      for (const s of steps) {
        const rec = s as Record<string, unknown>;
        if ('summary' in rec) bannedFields++;
        if (s.action === 'IF_CONDITION') {
          visitSteps(s.thenSteps);
          if (s.elseSteps) visitSteps(s.elseSteps);
        } else if (s.action === 'IF_PREVIOUS_SUCCEEDED') {
          visitSteps(s.thenSteps);
        } else if (s.action === 'GRANT_CLAUSE') {
          if ((s.clause.timings.includes('WHEN_LINKED') || s.clause.timings.includes('DURING_LINK')) && !s.clause.linkRequirement) {
            missingLinkReq++;
          }
          visitSteps(s.clause.steps);
        }
      }
    };

    const visitAbility = (ab: AbilityAst) => {
      totalAbilities++;
      const rec = ab as unknown as Record<string, unknown>;
      if ('insteadUpgrade' in rec || 'replacementSummary' in rec || 'unparsedResidual' in rec) {
        bannedFields++;
      }
      if (ab.kind === 'DIAGNOSTIC') {
        diagnostics++;
        return;
      }
      if (ab.kind === 'EFFECT_CLAUSE') {
        if ((ab.timings.includes('WHEN_LINKED') || ab.timings.includes('DURING_LINK')) && !ab.linkRequirement) {
          missingLinkReq++;
        }
        visitSteps(ab.steps);
      } else if (ab.kind === 'REPLACEMENT_EFFECT') {
        if (ab.steps) visitSteps(ab.steps);
        if (ab.outcome.steps) visitSteps(ab.outcome.steps);
      } else if (ab.kind === 'CUSTOM_HOOK') {
        visitSteps(ab.steps);
      } else if (ab.kind === 'CONTINUOUS_MODIFIER') {
        const modRec = ab.modifier as Record<string, unknown>;
        if (modRec.type === 'STATIC_PERMISSION' || 'summary' in modRec) bannedFields++;
      }

      if (/with \d+ HP\b(?!\s+or)/i.test(ab.raw) && !JSON.stringify(ab).includes('hpMin')) {
        missingHpExact++;
      }
      const abText = JSON.stringify(ab);
      if (abText.includes('change the attack target') || abText.includes('first card in that opponent')) {
        reminderLeaks++;
      }
    };

    for (const card of corpus.values()) {
      const compiled = compileCardEffect(card);
      expect('clauses' in compiled).toBe(false);
      for (const ab of compiled.abilities) {
        visitAbility(ab);
      }
    }

    expect(reminderLeaks).toBe(0);
    expect(totalAbilities).toBeGreaterThan(1000);
    expect(diagnostics).toBe(0);
    expect(bannedFields).toBe(0);
    expect(missingLinkReq).toBe(0);
    expect(missingHpExact).toBe(0);
  });

  it('keeps pre-compiled Effect Shards under data/effects/ complete and in sync with data/collections/ (schemaVersion 2)', () => {
    const effectsDir = path.join(process.cwd(), 'data', 'effects');
    const compiledByNo = new Map<string, CompiledCardEffect>();
    for (const file of fs.readdirSync(effectsDir).filter((f) => f.endsWith('.json')).sort()) {
      const shard = JSON.parse(fs.readFileSync(path.join(effectsDir, file), 'utf8')) as EffectShardFile;
      expect(shard.schemaVersion).toBe(2);
      expect(shard.cardCount).toBe(Object.keys(shard.effects).length);
      for (const [cardNo, eff] of Object.entries(shard.effects)) {
        expect(getEffectSetPrefix(cardNo)).toBe(shard.setPrefix);
        compiledByNo.set(cardNo, eff);
      }
    }

    for (const [cardNo, card] of corpus.entries()) {
      expect(compiledByNo.get(cardNo)).toEqual(compileCardEffect(card));
    }
  });

  it('classifies RESOURCE_RAMP, RESOURCE_ACTIVATE, PLAYER_LV_UP, and AP_REDUCTION synergies without false Pilot AP_THRESHOLD_5', () => {
    const st14011 = compileCardEffect(corpus.get('ST14-011')!);
    expect(st14011.synergy.enables).toContain('AP_REDUCTION');
    expect(st14011.synergy.enables).not.toContain('AP_THRESHOLD_5');

    const st14012 = compileCardEffect(corpus.get('ST14-012')!);
    expect(st14012.synergy.requires).toContain('AP_REDUCTION');
    expect(st14012.synergy.enables).not.toContain('AP_THRESHOLD_5');

    const st14015 = compileCardEffect(corpus.get('ST14-015')!);
    expect(st14015.synergy.enables).toEqual(
      expect.arrayContaining(['RESOURCE_RAMP', 'PLAYER_LV_UP', 'RESOURCE_ACTIVATE'])
    );
    expect(st14015.synergy.requires).toContain('RESOURCE_ACTIVATE');

    const st14009 = compileCardEffect(corpus.get('ST14-009')!);
    expect(st14009.synergy.enables).toContain('RESOURCE_RAMP');
    expect(st14009.synergy.enables).not.toContain('PLAYER_LV_UP');

    const gd02026 = compileCardEffect(corpus.get('GD02-026')!);
    expect(gd02026.synergy.requires).toContain('PLAYER_LV_UP');

    const gd04085 = compileCardEffect(corpus.get('GD04-085')!);
    expect(gd04085.synergy.requires).toContain('RESOURCE_RAMP');
  });
});
