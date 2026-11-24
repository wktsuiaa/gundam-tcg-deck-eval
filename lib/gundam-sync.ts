import type { CatalogPayload } from '@/types/gundam';
import {
  buildCatalogPayloadFromShards,
  DEFAULT_RULES_PAYLOAD,
  ensureHydratedCatalogFromDb,
} from '@/lib/gundam-db';

const BASE_URL = 'https://www.gundam-gcg.com/asia-en/cards/';

let memoryCache: CatalogPayload | null = null;

export async function getCatalog(): Promise<CatalogPayload> {
  if (memoryCache) return memoryCache;
  try {
    const payload = await ensureHydratedCatalogFromDb();
    memoryCache = payload;
    return payload;
  } catch (err) {
    console.warn('Catalog DB hydration failed, falling back to JSON shards:', err);
    try {
      const payload = await buildCatalogPayloadFromShards();
      memoryCache = payload;
      return payload;
    } catch (shardErr) {
      console.error('Failed to read catalog JSON shards:', shardErr);
      return {
        syncedAt: new Date().toISOString(),
        source: BASE_URL,
        totalPrints: 0,
        packages: [],
        cards: [],
        rules: DEFAULT_RULES_PAYLOAD,
      };
    }
  }
}
