import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GundamCardPrint, RulesPayload } from '@/types/gundam';
import { compileCardEffect } from '@/lib/effect-parser';
import {
  verifyPlayLine,
  type ChainMatchState,
  type ChainUnitInstance,
  type ChainWitness,
  type IllegalChainReason,
  type PlayerAction,
} from '@/lib/chain-verifier';

interface CardSpec {
  corpusCardNo?: string;
  cardNo?: string;
  name?: string;
  type?: string;
  lv?: number;
  cost?: number;
  ap?: number;
  hp?: number;
  effect?: string;
  traits?: string[];
  damage?: number;
  rested?: boolean;
  cantBlock?: boolean;
  pilotCorpusCardNo?: string;
  pilot?: CardSpec;
}

interface RulingScenario {
  id: string;
  faqRef: { kind: 'GENERAL' | 'CARD'; cardNo?: string; questionPrefix: string };
  setup: {
    turn: number;
    attacker?: CardSpec;
    activeHand?: CardSpec[];
    activeTrash?: CardSpec[];
    activeDeck?: CardSpec[];
    activeShields?: CardSpec[];
    defenderUnits?: CardSpec[];
    defenderHand?: CardSpec[];
    defenderHandCount?: number;
    defenderBase?: CardSpec;
    defenderShields?: CardSpec[];
  };
  playLine: PlayerAction[];
  witness: ChainWitness;
  expected: {
    legal: boolean;
    reason?: IllegalChainReason;
    attackerDamage?: number;
    defenderUnitCount?: number;
    defenderShieldCount?: number;
    activeHandCount?: number;
    activeShieldCount?: number;
    defenderHandCardNos?: string[];
    triggerOrderIncludes?: string[];
  };
}

function loadResources() {
  const rules = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data', 'rules.json'), 'utf8')
  ) as RulesPayload;
  const colDir = path.join(process.cwd(), 'data', 'collections');
  const effDir = path.join(process.cwd(), 'data', 'effects');
  const effects = new Map<string, ReturnType<typeof compileCardEffect>>();
  for (const f of fs.readdirSync(effDir).filter((x) => x.endsWith('.json'))) {
    const shard = JSON.parse(fs.readFileSync(path.join(effDir, f), 'utf8'));
    for (const [k, v] of Object.entries(shard.effects ?? {})) {
      effects.set(k, v as ReturnType<typeof compileCardEffect>);
    }
  }
  const corpus = new Map<string, GundamCardPrint>();
  for (const f of fs.readdirSync(colDir).filter((x) => x.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf8'));
    for (const c of (raw.cards ?? []) as GundamCardPrint[]) {
      const prev = corpus.get(c.cardNo);
      if (!prev || (prev.isParallel && !c.isParallel)) {
        corpus.set(c.cardNo, { ...c, compiledEffect: effects.get(c.cardNo) });
      }
    }
  }
  const fixture = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data', 'rulings-tests', 'official-rulings.json'), 'utf8')
  ) as { scenarios: RulingScenario[] };
  return { rules, corpus, scenarios: fixture.scenarios };
}

function materializeCard(spec: CardSpec, corpus: Map<string, GundamCardPrint>): GundamCardPrint {
  if (spec.corpusCardNo) {
    const found = corpus.get(spec.corpusCardNo);
    if (!found) throw new Error(`Missing corpus card ${spec.corpusCardNo}`);
    return found;
  }
  const base: GundamCardPrint = {
    printId: spec.cardNo ?? 'TST',
    cardNo: spec.cardNo ?? 'TST',
    name: spec.name ?? spec.cardNo ?? 'Test Card',
    rarity: 'C',
    blockIcon: '1',
    lv: spec.lv ?? 1,
    cost: spec.cost ?? 1,
    color: 'Blue',
    type: spec.type ?? 'UNIT',
    effect: spec.effect ?? '',
    zones: ['Space'],
    traits: spec.traits ?? [],
    link: '',
    apRaw: String(spec.ap ?? 2),
    hpRaw: String(spec.hp ?? 2),
    ap: spec.ap ?? 2,
    hp: spec.hp ?? 2,
    sourceTitle: '',
    whereToGet: '',
    imagePath: '',
    isParallel: false,
    faqs: [],
    packageIds: [],
    packageNames: [],
    packageCodes: [],
  };
  return { ...base, compiledEffect: compileCardEffect(base) };
}

function materializeUnit(
  id: string,
  spec: CardSpec,
  corpus: Map<string, GundamCardPrint>
): ChainUnitInstance {
  return {
    instanceId: id,
    card: materializeCard(spec, corpus),
    pairedPilot: spec.pilot
      ? materializeCard(spec.pilot, corpus)
      : spec.pilotCorpusCardNo
      ? corpus.get(spec.pilotCorpusCardNo)
      : undefined,
    rested: Boolean(spec.rested),
    damage: spec.damage ?? 0,
    deployedTurn: 1,
    temporaryModifiers: spec.cantBlock
      ? [{ id: `${id}-cantblk`, layer: 4, rule: 'CANT_ACTIVATE_BLOCKER', duration: 'THIS_TURN' }]
      : [],
    triggeredOnceThisTurn: [],
  };
}

describe('Seam 3: Official Bandai Q&A Ruling Scenario Suite (data/rules.json)', () => {
  const { rules, corpus, scenarios } = loadResources();

  it('resolves every scenario faqRef verbatim against data/rules.json', () => {
    let generalMatches = 0;
    let cardMatches = 0;

    for (const s of scenarios) {
      if (s.faqRef.kind === 'GENERAL') {
        const hit = rules.generalFaqs.some((f) => f.q.startsWith(s.faqRef.questionPrefix));
        expect(hit, `Missing general FAQ for ${s.id}: ${s.faqRef.questionPrefix}`).toBe(true);
        generalMatches += 1;
      } else {
        const list = rules.cardFaqs[s.faqRef.cardNo ?? ''] ?? [];
        const hit = list.some((f) => f.q.startsWith(s.faqRef.questionPrefix));
        expect(hit, `Missing card FAQ for ${s.id} (${s.faqRef.cardNo})`).toBe(true);
        cardMatches += 1;
      }
    }

    expect(generalMatches).toBeGreaterThanOrEqual(8);
    expect(cardMatches).toBeGreaterThanOrEqual(4);
    expect(rules.generalFaqs.length).toBeGreaterThanOrEqual(100);
    expect(Object.keys(rules.cardFaqs).length).toBeGreaterThanOrEqual(300);
  });

  for (const scenario of scenarios) {
    it(`${scenario.id}: matches Bandai official ruling`, () => {
      const defHand = scenario.setup.defenderHand
        ? scenario.setup.defenderHand.map((c) => materializeCard(c, corpus))
        : Array.from({ length: scenario.setup.defenderHandCount ?? 0 }, (_, i) =>
            materializeCard({ cardNo: `DH-${i}` }, corpus)
          );

      const state: ChainMatchState = {
        turn: scenario.setup.turn,
        phase: 'MAIN',
        activeSide: 'A',
        pendingActionStep: null,
        players: {
          A: {
            hand: (scenario.setup.activeHand ?? []).map((c) => materializeCard(c, corpus)),
            deck: (scenario.setup.activeDeck ?? []).map((c) => materializeCard(c, corpus)),
            trash: (scenario.setup.activeTrash ?? []).map((c) => materializeCard(c, corpus)),
            battleArea: scenario.setup.attacker
              ? [materializeUnit('A-0', scenario.setup.attacker, corpus)]
              : [],
            base: null,
            shields: (scenario.setup.activeShields ?? []).map((c, i) => ({
              id: `A-SH-${i}`,
              card: materializeCard(c, corpus),
            })),
            activeResources: scenario.setup.turn,
            restedResources: 0,
            exResources: 0,
          },
          B: {
            hand: defHand,
            deck: [],
            trash: [],
            battleArea: (scenario.setup.defenderUnits ?? []).map((u, i) =>
              materializeUnit(`B-${i}`, u, corpus)
            ),
            base: scenario.setup.defenderBase
              ? {
                  instanceId: 'B-BASE',
                  card: materializeCard({ ...scenario.setup.defenderBase, type: 'BASE' }, corpus),
                  damage: 0,
                }
              : null,
            shields: (scenario.setup.defenderShields ?? []).map((c, i) => ({
              id: `B-SH-${i}`,
              card: materializeCard(c, corpus),
            })),
            activeResources: scenario.setup.turn,
            restedResources: 0,
            exResources: 0,
          },
        },
      };

      const res = verifyPlayLine({
        mode: { kind: 'CONCRETE_SNAPSHOT', state },
        playLine: scenario.playLine,
        witness: scenario.witness,
      });

      expect(res.legal).toBe(scenario.expected.legal);
      if (!res.legal && scenario.expected.reason) {
        expect(res.reason).toBe(scenario.expected.reason);
      }
      if (res.legal) {
        if (scenario.expected.attackerDamage !== undefined) {
          expect(res.finalState.players.A.battleArea[0]?.damage).toBe(
            scenario.expected.attackerDamage
          );
        }
        if (scenario.expected.defenderUnitCount !== undefined) {
          expect(res.finalState.players.B.battleArea).toHaveLength(
            scenario.expected.defenderUnitCount
          );
        }
        if (scenario.expected.defenderShieldCount !== undefined) {
          expect(res.finalState.players.B.shields).toHaveLength(
            scenario.expected.defenderShieldCount
          );
        }
        if (scenario.expected.activeHandCount !== undefined) {
          expect(res.finalState.players.A.hand).toHaveLength(scenario.expected.activeHandCount);
        }
        if (scenario.expected.activeShieldCount !== undefined) {
          expect(res.finalState.players.A.shields).toHaveLength(
            scenario.expected.activeShieldCount
          );
        }
        if (scenario.expected.defenderHandCardNos !== undefined) {
          expect(res.finalState.players.B.hand.map((c) => c.cardNo)).toEqual(
            scenario.expected.defenderHandCardNos
          );
        }
        if (scenario.expected.triggerOrderIncludes !== undefined) {
          const triggers = res.trace.filter((t) => t.kind === 'TRIGGER').map((t) => t.detail);
          scenario.expected.triggerOrderIncludes.forEach((substr, idx) => {
            expect(triggers[idx]).toContain(substr);
          });
        }
      }
    });
  }
});
