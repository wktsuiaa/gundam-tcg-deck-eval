import fs from 'node:fs/promises';
import path from 'node:path';
import type { GundamCardPrint } from '../types/gundam.ts';
import {
  compileCardEffect,
  getEffectSetPrefix,
  type CompiledCardEffect,
  type EffectShardFile,
} from '../lib/effect-parser.ts';

const ROOT_DIR = process.cwd();
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const COLLECTIONS_DIR = path.resolve(DATA_DIR, 'collections');
const EFFECTS_DIR = path.resolve(DATA_DIR, 'effects');

function compareCardNo(a: string, b: string): number {
  const mA = a.match(/^([A-Z]+)(\d*)-(\d+)$/);
  const mB = b.match(/^([A-Z]+)(\d*)-(\d+)$/);
  if (mA && mB) {
    if (mA[1] !== mB[1]) return mA[1].localeCompare(mB[1]);
    const setA = mA[2] ? parseInt(mA[2], 10) : 0;
    const setB = mB[2] ? parseInt(mB[2], 10) : 0;
    if (setA !== setB) return setA - setB;
    return parseInt(mA[3], 10) - parseInt(mB[3], 10);
  }
  return a.localeCompare(b);
}

function pickCanonicalPrint(a: GundamCardPrint, b: GundamCardPrint): GundamCardPrint {
  if (a.isParallel !== b.isParallel) return a.isParallel ? b : a;
  return a.printId.localeCompare(b.printId) <= 0 ? a : b;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const files = (await fs.readdir(COLLECTIONS_DIR)).filter((f) => f.endsWith('.json')).sort();

  const canonicalByCardNo = new Map<string, GundamCardPrint>();
  for (const file of files) {
    const raw = JSON.parse(await fs.readFile(path.join(COLLECTIONS_DIR, file), 'utf-8')) as {
      cards?: GundamCardPrint[];
    };
    for (const card of raw.cards ?? []) {
      const prev = canonicalByCardNo.get(card.cardNo);
      canonicalByCardNo.set(card.cardNo, prev ? pickCanonicalPrint(prev, card) : card);
    }
  }

  const byPrefix = new Map<string, Map<string, CompiledCardEffect>>();
  let totalClauses = 0;
  let fullClauses = 0;

  for (const cardNo of [...canonicalByCardNo.keys()].sort(compareCardNo)) {
    const card = canonicalByCardNo.get(cardNo)!;
    const compiled = compileCardEffect(card);
    for (const clause of compiled.clauses) {
      totalClauses += 1;
      if (clause.unparsedResidual === '') fullClauses += 1;
    }

    const prefix = getEffectSetPrefix(cardNo);
    const group = byPrefix.get(prefix) ?? new Map<string, CompiledCardEffect>();
    group.set(cardNo, compiled);
    byPrefix.set(prefix, group);
  }

  if (checkOnly) {
    let staleCount = 0;
    for (const [prefix, group] of byPrefix.entries()) {
      const shardPath = path.join(EFFECTS_DIR, `${prefix}.json`);
      const expected: EffectShardFile = {
        schemaVersion: 1,
        setPrefix: prefix,
        cardCount: group.size,
        effects: Object.fromEntries([...group.entries()]),
      };
      const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
      const actualText = await fs.readFile(shardPath, 'utf-8').catch(() => '');
      if (actualText !== expectedText) {
        console.error(`Out-of-date effect shard: ${path.relative(ROOT_DIR, shardPath)}`);
        staleCount += 1;
      }
    }
    if (staleCount > 0) {
      process.exitCode = 1;
      return;
    }
    console.log(
      `Effect shards up to date (${byPrefix.size} shards, ${canonicalByCardNo.size} cards, ${fullClauses}/${totalClauses} full clauses).`
    );
    return;
  }

  await fs.mkdir(EFFECTS_DIR, { recursive: true });
  const existingFiles = new Set((await fs.readdir(EFFECTS_DIR)).filter((f) => f.endsWith('.json')));
  const expectedFiles = new Set<string>();

  for (const [prefix, group] of [...byPrefix.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fileName = `${prefix}.json`;
    expectedFiles.add(fileName);
    const shardPath = path.resolve(EFFECTS_DIR, fileName);
    if (!shardPath.startsWith(EFFECTS_DIR + path.sep)) {
      throw new Error(`Unsafe effect shard path: ${prefix}`);
    }
    const shard: EffectShardFile = {
      schemaVersion: 1,
      setPrefix: prefix,
      cardCount: group.size,
      effects: Object.fromEntries([...group.entries()]),
    };
    await fs.writeFile(shardPath, `${JSON.stringify(shard, null, 2)}\n`, 'utf-8');
  }

  for (const staleFile of existingFiles) {
    if (!expectedFiles.has(staleFile)) {
      await fs.unlink(path.join(EFFECTS_DIR, staleFile));
    }
  }

  const pct = ((fullClauses / Math.max(1, totalClauses)) * 100).toFixed(1);
  console.log(
    `Compiled ${canonicalByCardNo.size} unique cards into ${byPrefix.size} Effect Shards under data/effects/ (${fullClauses}/${totalClauses} = ${pct}% full clause coverage).`
  );
}

main().catch((err) => {
  console.error('Failed to compile card effects:', err);
  process.exitCode = 1;
});
