// Dumps deck-evaluation output for the starter decks and a generated deck, for before/after diffs.
// Usage: npx vite-node -c vitest.config.mts scripts/eval_snapshot.ts > out.json
import fs from 'node:fs';
import path from 'node:path';
import type { GundamCardPrint } from '@/types/gundam';
import type { CompiledCardEffect, EffectShardFile } from '@/lib/effect-parser';
import {
  analyzeDeck,
  buildStarterDeckFromCatalog,
  DEFAULT_BLUEPRINT,
  generateStrategyDeck,
  resolveCardMap,
  STARTER_PRESETS,
} from '@/lib/deck-engine';

const dataDir = path.join(process.cwd(), 'data');
const effects = new Map<string, CompiledCardEffect>();
const effectsDir = path.join(dataDir, 'effects');
for (const f of fs.readdirSync(effectsDir).filter((x) => x.endsWith('.json')).sort()) {
  const shard = JSON.parse(fs.readFileSync(path.join(effectsDir, f), 'utf8')) as EffectShardFile;
  for (const [no, eff] of Object.entries(shard.effects ?? {})) effects.set(no, eff);
}
const cards: GundamCardPrint[] = [];
const colDir = path.join(dataDir, 'collections');
for (const f of fs.readdirSync(colDir).filter((x) => x.endsWith('.json')).sort()) {
  const raw = JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf8'));
  for (const c of raw.cards ?? []) cards.push({ ...c, compiledEffect: effects.get(c.cardNo) });
}
const { byPrintId, byCardNo } = resolveCardMap(cards);

const out: Record<string, unknown> = {};
for (const p of STARTER_PRESETS) {
  const deck = buildStarterDeckFromCatalog(p.code, cards);
  const a = analyzeDeck(deck, byPrintId, byCardNo);
  out[p.code] = { hexagon: a.hexagon, pacing: a.pacing, styles: a.styles, strengths: a.strengths, weaknesses: a.weaknesses, matchups: a.matchups.map((m) => [m.opponentName, m.difficultyScore, m.verdict]) };
}
const gen = generateStrategyDeck(cards, DEFAULT_BLUEPRINT);
out.generated = { cards: gen.mainDeck.map((e) => `${e.cardNo}x${e.qty}`).sort() };
console.log(JSON.stringify(out, null, 1));
