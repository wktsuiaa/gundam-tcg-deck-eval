import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint } from '@/types/gundam';
import {
  compileCardEffect,
  extractEffectPrerequisites,
  getEffectSetPrefix,
  parseCardEffects,
  type CompiledCardEffect,
  type EffectShardFile,
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

describe('Seam 1: parseCardEffects (Fail-Closed Effect Clause IR)', () => {
  const corpus = loadCorpus();

  it('parses ST09-006 Sword Impulse Gundam with trash-deploy gate and Lv<=3 destroy target', () => {
    const card = corpus.get('ST09-006')!;
    const parsed = parseCardEffects(card);

    expect(parsed.keywords).toEqual([]);
    expect(parsed.clauses).toHaveLength(1);
    const clause = parsed.clauses[0];
    expect(clause.timings).toEqual(['DEPLOY']);
    expect(clause.condition).toEqual({ kind: 'DEPLOYED_FROM_ZONE', zone: 'trash' });
    expect(clause.unparsedResidual).toBe('');
    expect(clause.steps).toEqual([
      {
        action: 'DESTROY',
        target: {
          owner: 'ENEMY',
          cardType: 'UNIT',
          count: 1,
          lvMax: 3,
        },
      },
    ]);
  });

  it('parses ST09-001 Impulse Gundam Activate-Main cost and Lv.4+ Impulse trash deploy', () => {
    const card = corpus.get('ST09-001')!;
    const parsed = parseCardEffects(card);

    expect(parsed.clauses).toHaveLength(1);
    const clause = parsed.clauses[0];
    expect(clause.timings).toEqual(['ACTIVATE_MAIN']);
    expect(clause.cost?.resourceCost).toBe(2);
    expect(clause.cost?.returnSelfToDeckBottom).toBe(true);
    expect(clause.unparsedResidual).toBe('');
    expect(clause.steps[0]).toMatchObject({
      action: 'DEPLOY_FROM_TRASH',
      free: true,
      target: {
        owner: 'SELF',
        cardType: 'UNIT',
        count: 1,
        lvMin: 4,
        nameContains: 'Impulse Gundam',
      },
    });
  });

  it('parses ST09-003 Saviour Gundam <Breach 3> without reminder leak and symmetrical AoE damage', () => {
    const card = corpus.get('ST09-003')!;
    const parsed = parseCardEffects(card);

    expect(parsed.keywords).toEqual([{ name: 'Breach', value: 3 }]);
    expect(parsed.clauses).toHaveLength(1);
    const clause = parsed.clauses[0];
    expect(clause.timings).toEqual(['WHEN_LINKED']);
    expect(clause.condition).toEqual({ kind: 'TRASH_COUNT_AT_LEAST', count: 5, color: 'Purple' });
    expect(clause.unparsedResidual).toBe('');
    expect(clause.steps).toEqual([
      {
        action: 'DEAL_DAMAGE',
        amount: 2,
        target: {
          owner: 'ANY',
          cardType: 'UNIT',
          count: 'ALL',
          apMax: 5,
        },
      },
    ]);
  });

  it('parses ST09-004 Freedom Gundam <Blocker> and conditional <Suppression> with Base check', () => {
    const card = corpus.get('ST09-004')!;
    const parsed = parseCardEffects(card);

    expect(parsed.keywords).toEqual([{ name: 'Blocker', value: null }]);
    expect(parsed.clauses).toHaveLength(1);
    expect(parsed.clauses[0]).toMatchObject({
      timings: ['CONTINUOUS'],
      condition: { kind: 'FRIENDLY_BASE_IN_PLAY' },
      unparsedResidual: '',
      steps: [{ action: 'GRANT_KEYWORD', keyword: { name: 'Suppression', value: null }, target: { owner: 'SELF', self: true } }],
    });
  });

  it('separates 【Burst】Add this card to your hand from 【Attack】AP-2 on ST04-010 Kira Yamato', () => {
    const card = corpus.get('ST04-010')!;
    const parsed = parseCardEffects(card);

    expect(parsed.clauses).toHaveLength(2);
    expect(parsed.clauses[0]).toMatchObject({
      timings: ['BURST'],
      unparsedResidual: '',
      steps: [{ action: 'ADD_SELF_TO_HAND' }],
    });
    expect(parsed.clauses[1]).toMatchObject({
      timings: ['ATTACK'],
      unparsedResidual: '',
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
    const duel = parseCardEffects(corpus.get('GD01-054')!);
    expect(duel.clauses).toHaveLength(1);
    expect(duel.clauses[0]).toMatchObject({
      timings: ['CONTINUOUS'],
      condition: { kind: 'SELF_AP_AT_LEAST', minAp: 5 },
      unparsedResidual: '',
      steps: [{ action: 'GRANT_KEYWORD', keyword: { name: 'Breach', value: 3 } }],
    });

    const legend = parseCardEffects(corpus.get('GD06-050')!);
    const deployClause = legend.clauses.find((c) => c.timings.includes('DEPLOY'));
    expect(deployClause).toBeDefined();
    expect(deployClause!.steps.some((s) => s.action === 'DESTROY')).toBe(true);
  });

  it('parses GD05-112 and GD05-113 self-pairing as PAIR_SELF_FROM_TRASH with (MF) Effect Prerequisite and primaryClause=true', () => {
    const gd112 = corpus.get('GD05-112')!;
    const parsed112 = parseCardEffects(gd112);
    expect(parsed112.clauses[0].steps).toEqual([
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
    ]);

    const prereq112 = extractEffectPrerequisites(gd112);
    expect(prereq112.some((p) => p.trait === 'MF' && p.primaryClause && p.minCopies === 4)).toBe(true);

    // GD05-121 has a generic AP-2 main step + (MF) secondary self-pair -> primaryClause=false
    const prereq121 = extractEffectPrerequisites(corpus.get('GD05-121')!);
    expect(prereq121.some((p) => p.trait === 'MF' && !p.primaryClause)).toBe(true);

    // GD04-116 scales damage off milled (Minerva Squad) cards -> density threshold 8
    const prereq4116 = extractEffectPrerequisites(corpus.get('GD04-116')!);
    expect(prereq4116.some((p) => p.trait === 'Minerva Squad' && p.minCopies === 8)).toBe(true);
  });

  it('parses GD06-001, GD06-002, GD06-003, and GD06-009 with exact triggers, conditions, and 1 HP selector', () => {
    const gd001 = parseCardEffects(corpus.get('GD06-001')!);
    expect(gd001.clauses[0]).toMatchObject({
      timings: ['WHEN_ATTACKED'],
      oncePerTurn: true,
      triggerEvent: { kind: 'WHEN_ATTACKED', actor: 'SELF' },
      steps: [{ action: 'DRAW', count: 1 }],
      unparsedResidual: '',
    });

    const gd002 = parseCardEffects(corpus.get('GD06-002')!);
    expect(gd002.clauses[0]).toMatchObject({
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
      unparsedResidual: '',
    });
    expect(gd002.clauses[1].steps).toEqual([
      { action: 'EXILE', target: { owner: 'SELF', cardType: 'UNIT', count: 3, zone: 'TRASH' } },
      {
        action: 'IF_PREVIOUS_SUCCEEDED',
        thenSteps: [
          { action: 'BOUNCE', target: { owner: 'ENEMY', cardType: 'UNIT', count: 1, state: 'ACTIVE' } },
        ],
      },
    ]);

    const gd003 = parseCardEffects(corpus.get('GD06-003')!);
    expect(gd003.clauses[0]).toMatchObject({
      timings: ['CONTINUOUS'],
      steps: [
        {
          action: 'MODIFY_AP',
          delta: 1,
          scaleBy: { metric: 'HAND_COUNT', owner: 'SELF' },
          target: { owner: 'SELF', self: true, cardType: 'UNIT' },
        },
      ],
      unparsedResidual: '',
    });
    expect(gd003.clauses[1]).toMatchObject({
      timings: ['ATTACK'],
      condition: {
        kind: 'ALL_OF',
        conditions: [
          { kind: 'BOARD_CARD_COUNT', owner: 'SELF', cardType: 'UNIT', min: 1, other: true, traits: ['Alphacide'] },
          { kind: 'HAND_COUNT', owner: 'SELF', max: 5 },
        ],
      },
      steps: [{ action: 'DRAW', count: 1 }],
      unparsedResidual: '',
    });

    const gd009 = parseCardEffects(corpus.get('GD06-009')!);
    expect(gd009.clauses[0]).toMatchObject({
      timings: ['DEPLOY'],
      steps: [
        {
          action: 'BOUNCE',
          target: { owner: 'ENEMY', cardType: 'UNIT', count: 1, hpMin: 1, hpMax: 1 },
        },
      ],
      unparsedResidual: '',
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

  it('audits all unique cards with zero crashes, zero reminder leaks, zero RAW_CONDITIONs, zero residuals, and 100% link coverage', () => {
    let totalClauses = 0;
    let fullyParsedClauses = 0;
    let rawConditions = 0;
    let missingLinkReq = 0;
    let missingHpExact = 0;
    let reminderLeaks = 0;

    const countRaw = (cond: ReturnType<typeof parseCardEffects>['clauses'][number]['condition']): number => {
      if (!cond) return 0;
      if (cond.kind === 'RAW_CONDITION') return 1;
      if (cond.kind === 'ALL_OF' || cond.kind === 'ANY_OF') {
        return cond.conditions.reduce((s, c) => s + countRaw(c), 0);
      }
      if (cond.kind === 'NOT') return countRaw(cond.condition);
      return 0;
    };

    for (const card of corpus.values()) {
      const parsed = parseCardEffects(card);
      for (const clause of parsed.clauses) {
        totalClauses++;
        if (clause.unparsedResidual === '') fullyParsedClauses++;
        rawConditions += countRaw(clause.condition);
        if ((clause.timings.includes('WHEN_LINKED') || clause.timings.includes('DURING_LINK')) && !clause.linkRequirement) {
          missingLinkReq++;
        }
        if (/with \d+ HP\b(?!\s+or)/i.test(clause.raw) && !JSON.stringify(clause).includes('hpMin')) {
          missingHpExact++;
        }
        const stepsText = JSON.stringify(clause.steps);
        if (stepsText.includes('change the attack target') || stepsText.includes('first card in that opponent')) {
          reminderLeaks++;
        }
      }
    }

    expect(reminderLeaks).toBe(0);
    expect(totalClauses).toBeGreaterThan(1000);
    expect(rawConditions).toBe(0);
    expect(fullyParsedClauses).toBe(totalClauses);
    expect(missingLinkReq).toBe(0);
    expect(missingHpExact).toBe(0);
  });

  it('keeps pre-compiled Effect Shards under data/effects/ complete and in sync with data/collections/', () => {
    const effectsDir = path.join(process.cwd(), 'data', 'effects');
    const compiledByNo = new Map<string, CompiledCardEffect>();
    for (const file of fs.readdirSync(effectsDir).filter((f) => f.endsWith('.json')).sort()) {
      const shard = JSON.parse(fs.readFileSync(path.join(effectsDir, file), 'utf8')) as EffectShardFile;
      expect(shard.schemaVersion).toBe(1);
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
});
