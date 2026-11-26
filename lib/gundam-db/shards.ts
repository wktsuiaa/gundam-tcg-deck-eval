import fs from 'node:fs/promises';
import path from 'node:path';
import type { CatalogPayload, GundamCardPrint, GundamPackage, RulesPayload } from '@/types/gundam';
import { type CompiledCardEffect, type EffectShardFile } from '@/lib/effect-parser';
import { COLLECTIONS_DIR, DATA_DIR, DEFAULT_RULES_PAYLOAD, EFFECTS_DIR, PACKAGES_FILE, RULES_FILE, resolveSafeCollectionPath } from './connection';

export async function readSplitJsonCatalog(
  dataDir = DATA_DIR
): Promise<{
  packages: GundamPackage[];
  cards: GundamCardPrint[];
  syncedAt: string;
  source: string;
  rules: RulesPayload;
}> {
  const pkgPath = path.resolve(dataDir, 'packages.json');
  const colDir = path.resolve(dataDir, 'collections');
  const rulesPath = path.resolve(dataDir, 'rules.json');

  let packages: GundamPackage[] = [];
  try {
    packages = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as GundamPackage[];
  } catch {
    packages = [];
  }

  let rules: RulesPayload = DEFAULT_RULES_PAYLOAD;
  try {
    rules = JSON.parse(await fs.readFile(rulesPath, 'utf-8')) as RulesPayload;
  } catch {
    rules = DEFAULT_RULES_PAYLOAD;
  }

  const cardMap = new Map<string, GundamCardPrint>();
  let latestSync = '';
  let source = 'https://www.gundam-gcg.com/asia-en/cards/';

  for (const pkg of packages) {
    const sanitized = pkg.code.replace(/[^A-Za-z0-9_-]/g, '_');
    const shardPath = path.resolve(colDir, `${sanitized}.json`);
    if (!shardPath.startsWith(colDir + path.sep)) continue;
    try {
      const shard = JSON.parse(await fs.readFile(shardPath, 'utf-8')) as {
        syncedAt?: string;
        source?: string;
        cards?: GundamCardPrint[];
      };
      if (shard.syncedAt && shard.syncedAt > latestSync) latestSync = shard.syncedAt;
      if (shard.source) source = shard.source;
      for (const c of shard.cards ?? []) {
        const existing = cardMap.get(c.printId);
        if (!existing) {
          cardMap.set(c.printId, c);
        } else {
          // Deduplicate prints across shards while merging package membership arrays
          const ids = new Set([...(existing.packageIds ?? []), ...(c.packageIds ?? [])]);
          const names = new Set([...(existing.packageNames ?? []), ...(c.packageNames ?? [])]);
          const codes = new Set([...(existing.packageCodes ?? []), ...(c.packageCodes ?? [])]);
          existing.packageIds = [...ids];
          existing.packageNames = [...names];
          existing.packageCodes = [...codes];
        }
      }
    } catch {
      // ignore missing individual shard
    }
  }

  // Fallback sort by printId
  const cards = sortCards([...cardMap.values()]);

  return {
    packages,
    cards,
    syncedAt: latestSync || rules.syncedAt || new Date().toISOString(),
    source,
    rules,
  };
}

export function sortCards(cards: GundamCardPrint[]): GundamCardPrint[] {
  return [...cards].sort((a, b) => {
    const [baseA, suffixA = ''] = a.printId.split('_');
    const [baseB, suffixB = ''] = b.printId.split('_');
    const mA = baseA.match(/^([A-Z]+)(\d*)-(\d+)$/);
    const mB = baseB.match(/^([A-Z]+)(\d*)-(\d+)$/);
    if (mA && mB) {
      if (mA[1] !== mB[1]) return mA[1].localeCompare(mB[1]);
      const setA = mA[2] ? parseInt(mA[2], 10) : 0;
      const setB = mB[2] ? parseInt(mB[2], 10) : 0;
      if (setA !== setB) return setA - setB;
      const numA = parseInt(mA[3], 10);
      const numB = parseInt(mB[3], 10);
      if (numA !== numB) return numA - numB;
    } else if (baseA !== baseB) {
      return baseA.localeCompare(baseB);
    }
    if (!suffixA && suffixB) return -1;
    if (suffixA && !suffixB) return 1;
    return suffixA.localeCompare(suffixB);
  });
}

export async function readCompiledEffectsFromShards(
  dataDir = DATA_DIR
): Promise<Map<string, CompiledCardEffect>> {
  const effectsDir = path.resolve(dataDir, 'effects');
  const map = new Map<string, CompiledCardEffect>();
  let files: string[] = [];
  try {
    files = (await fs.readdir(effectsDir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return map;
  }

  for (const file of files) {
    const shardPath = path.resolve(effectsDir, file);
    if (!shardPath.startsWith(effectsDir + path.sep)) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(shardPath, 'utf-8')) as EffectShardFile;
      for (const [cardNo, eff] of Object.entries(parsed.effects ?? {})) {
        map.set(cardNo, eff);
      }
    } catch {
      // ignore malformed or missing shard
    }
  }
  return map;
}

export async function getLatestShardMtimeMs(): Promise<number> {
  let latest = 0;
  for (const target of [PACKAGES_FILE, RULES_FILE]) {
    try {
      const st = await fs.stat(target);
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {
      // ignore
    }
  }
  for (const dir of [COLLECTIONS_DIR, EFFECTS_DIR]) {
    try {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const st = await fs.stat(path.join(dir, f));
        if (st.mtimeMs > latest) latest = st.mtimeMs;
      }
    } catch {
      // ignore
    }
  }
  return latest;
}

export async function buildCatalogPayloadFromShards(dataDir = DATA_DIR): Promise<CatalogPayload> {
  const [split, effectsByCardNo] = await Promise.all([
    readSplitJsonCatalog(dataDir),
    readCompiledEffectsFromShards(dataDir),
  ]);
  const cards = split.cards.map((c) => {
    const compiledEffect = effectsByCardNo.get(c.cardNo);
    return compiledEffect ? { ...c, compiledEffect } : c;
  });
  return {
    syncedAt: split.syncedAt,
    source: split.source,
    totalPrints: cards.length,
    packages: split.packages,
    cards,
    rules: split.rules,
  };
}

export async function writeSplitJsonShards(
  packages: GundamPackage[],
  cards: GundamCardPrint[],
  syncedAt: string,
  source: string
): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(COLLECTIONS_DIR, { recursive: true });
  await fs.writeFile(PACKAGES_FILE, JSON.stringify(packages, null, 2), 'utf-8');

  const byPkgId = new Map<string, GundamCardPrint[]>();
  for (const p of packages) byPkgId.set(p.id, []);
  for (const c of cards) {
    for (const pid of c.packageIds ?? []) {
      const arr = byPkgId.get(pid);
      if (arr) arr.push(c);
    }
  }

  for (const pkg of packages) {
    const shardPath = resolveSafeCollectionPath(pkg.code);
    const pkgCards = sortCards(byPkgId.get(pkg.id) ?? []);
    const shard = {
      syncedAt,
      source,
      package: pkg,
      cards: pkgCards,
    };
    await fs.writeFile(shardPath, JSON.stringify(shard), 'utf-8');
  }
}
