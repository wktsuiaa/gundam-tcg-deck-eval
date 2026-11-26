import fs from 'node:fs/promises';
import path from 'node:path';
import type { CatalogPayload } from '@/types/gundam';
import { DATA_DIR, DB_FILE, getDb, isDataDirectoryWritable } from './connection';
import { buildCatalogPayloadFromShards, getLatestShardMtimeMs, readCompiledEffectsFromShards, readSplitJsonCatalog } from './shards';
import { readCatalogFromSqlite, writeCatalogToSqlite } from './sqlite-catalog';

export async function ensureHydratedCatalogFromDb(dbPath = DB_FILE): Promise<CatalogPayload> {
  const targetDir = path.dirname(dbPath);
  if (!isDataDirectoryWritable(targetDir)) {
    return buildCatalogPayloadFromShards(DATA_DIR);
  }

  try {
    const db = getDb(dbPath);
    let dbMtime = 0;
    try {
      const st = await fs.stat(dbPath);
      dbMtime = st.mtimeMs;
    } catch {
      dbMtime = 0;
    }

    const shardMtime = await getLatestShardMtimeMs();
    const effectsCountRow = db.prepare('SELECT COUNT(*) as cnt FROM card_effects').get() as { cnt: number } | null | undefined;
    const existing = readCatalogFromSqlite(db);

    if (
      existing &&
      existing.cards.length > 0 &&
      (effectsCountRow?.cnt ?? 0) > 0 &&
      dbMtime >= shardMtime
    ) {
      return existing;
    }

    const [split, effectsByCardNo] = await Promise.all([
      readSplitJsonCatalog(DATA_DIR),
      readCompiledEffectsFromShards(DATA_DIR),
    ]);
    if (split.cards.length > 0) {
      writeCatalogToSqlite(
        db,
        split.packages,
        split.cards,
        split.syncedAt,
        split.source,
        split.rules,
        effectsByCardNo
      );
    }

    return (
      readCatalogFromSqlite(db) ?? {
        syncedAt: split.syncedAt,
        source: split.source,
        totalPrints: split.cards.length,
        packages: split.packages,
        cards: split.cards.map((c) => {
          const compiledEffect = effectsByCardNo.get(c.cardNo);
          return compiledEffect ? { ...c, compiledEffect } : c;
        }),
        rules: split.rules,
      }
    );
  } catch (err) {
    console.warn('SQLite unavailable or read-only, serving catalog directly from JSON shards:', err);
    return buildCatalogPayloadFromShards(DATA_DIR);
  }
}
