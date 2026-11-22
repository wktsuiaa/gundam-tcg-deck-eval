import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureHydratedCatalogFromDb,
  getDb,
  readSplitJsonCatalog,
  resolveSafeCollectionPath,
} from '@/lib/gundam-db';

describe('Split Collection Shards & SQLite DB Hydration', () => {
  it('loads all packages and deduplicated cards from data/collections/*.json into SQLite', async () => {
    const split = await readSplitJsonCatalog();

    expect(split.packages.length).toBeGreaterThanOrEqual(20);
    expect(split.cards.length).toBeGreaterThan(1500);

    // Ensure printIds are deduplicated across shards
    const ids = new Set(split.cards.map((c) => c.printId));
    expect(ids.size).toBe(split.cards.length);

    // Ensure hydration returns a populated CatalogPayload with synced RulesPayload
    const db = getDb();
    expect(db).toBeTruthy();

    const catalog = await ensureHydratedCatalogFromDb();
    expect(catalog.totalPrints).toBe(split.cards.length);
    expect(catalog.packages.length).toBe(split.packages.length);
    expect(catalog.rules?.deckConstruction.mainDeckSize).toBe(50);
    expect(catalog.rules?.deckConstruction.resourceDeckSize).toBe(10);
  });

  it('sanitizes collection shard paths safely inside data/collections/', () => {
    const safe = resolveSafeCollectionPath('../../etc/passwd');
    expect(path.dirname(safe).endsWith(`${path.sep}data${path.sep}collections`)).toBe(true);
    expect(path.basename(safe)).toBe('______etc_passwd.json');
  });

  it('falls back to split JSON shards when the SQLite path is read-only or unwritable', async () => {
    const split = await readSplitJsonCatalog();
    // Point dbPath inside an existing regular file so directory creation / SQLite open fails like a read-only FS
    const unwritableDbPath = path.resolve(process.cwd(), 'package.json', 'gundam.db');
    const catalog = await ensureHydratedCatalogFromDb(unwritableDbPath);

    expect(catalog.totalPrints).toBe(split.cards.length);
    expect(catalog.packages.length).toBe(split.packages.length);
    expect(catalog.rules?.deckConstruction.mainDeckSize).toBe(50);
  });
});
