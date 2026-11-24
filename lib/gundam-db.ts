import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type {
  CardColor,
  CardFaq,
  CatalogPayload,
  GundamCardPrint,
  GundamPackage,
  RulesPayload,
} from '@/types/gundam';
import {
  getEffectSetPrefix,
  type CompiledCardEffect,
  type EffectShardFile,
} from '@/lib/effect-parser';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const COLLECTIONS_DIR = path.resolve(DATA_DIR, 'collections');
const EFFECTS_DIR = path.resolve(DATA_DIR, 'effects');
const PACKAGES_FILE = path.resolve(DATA_DIR, 'packages.json');
const RULES_FILE = path.resolve(DATA_DIR, 'rules.json');
const DB_FILE = path.resolve(DATA_DIR, 'gundam.db');

export const DEFAULT_RULES_PAYLOAD: RulesPayload = {
  syncedAt: new Date(0).toISOString(),
  source: 'https://www.gundam-gcg.com/asia-en/rules/',
  faqSource: 'https://www.gundam-gcg.com/asia-en/rules/faqs/',
  deckConstruction: {
    mainDeckSize: 50,
    resourceDeckSize: 10,
    maxColors: 2,
    maxCopiesPerCardNo: 4,
    allowedMainTypes: ['UNIT', 'PILOT', 'COMMAND', 'BASE'],
    allowedResourceTypes: ['RESOURCE'],
    startingHandSize: 5,
    startingShieldCount: 6,
    turnPhases: [
      { phase: 'Start Phase', summary: 'Set all rested cards active and draw 1 card.' },
      { phase: 'Resource Phase', summary: 'Place 1 Resource from your Resource Deck into your Resource Area (Going 2nd starts with 1 EX Resource).' },
      { phase: 'Main Phase', summary: 'Deploy Units/Bases, pair Pilots to trigger Link effects, play Commands, and declare attacks.' },
      { phase: 'Action Step', summary: 'Defending player may activate <Blocker> or Action Commands during combat.' },
      { phase: 'End Phase', summary: 'Resolve end-of-turn abilities such as <Repair X>.' },
    ],
  },
  documents: [],
  sections: [],
  generalFaqs: [],
  cardFaqs: {},
};

export function resolveSafeCollectionPath(code: string): string {
  const sanitized = code.replace(/[^A-Za-z0-9_-]/g, '_');
  const resolved = path.resolve(COLLECTIONS_DIR, `${sanitized}.json`);
  if (!resolved.startsWith(COLLECTIONS_DIR + path.sep)) {
    throw new Error(`Unsafe collection shard path: ${code}`);
  }
  return resolved;
}

let dbInstance: Database.Database | null = null;

export function isDataDirectoryWritable(dirPath = DATA_DIR): boolean {
  try {
    fsSync.mkdirSync(dirPath, { recursive: true });
    fsSync.accessSync(dirPath, fsSync.constants.W_OK);
    const probe = path.join(dirPath, `.write-probe-${process.pid}-${Date.now()}`);
    fsSync.writeFileSync(probe, '');
    fsSync.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function getDb(dbPath = DB_FILE): Database.Database {
  if (dbInstance && dbPath === DB_FILE) return dbInstance;
  fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      card_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cards (
      print_id TEXT PRIMARY KEY,
      card_no TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      block_icon TEXT NOT NULL,
      lv INTEGER,
      cost INTEGER,
      color TEXT NOT NULL,
      type TEXT NOT NULL,
      effect TEXT NOT NULL,
      zones_json TEXT NOT NULL,
      traits_json TEXT NOT NULL,
      link TEXT NOT NULL,
      ap_raw TEXT NOT NULL,
      hp_raw TEXT NOT NULL,
      ap INTEGER,
      hp INTEGER,
      source_title TEXT NOT NULL,
      where_to_get TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_parallel INTEGER NOT NULL DEFAULT 0,
      faqs_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_card_no ON cards(card_no);
    CREATE INDEX IF NOT EXISTS idx_cards_color ON cards(color);
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);

    CREATE TABLE IF NOT EXISTS card_packages (
      print_id TEXT NOT NULL,
      package_id TEXT NOT NULL,
      PRIMARY KEY (print_id, package_id),
      FOREIGN KEY (print_id) REFERENCES cards(print_id) ON DELETE CASCADE,
      FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rules_store (
      key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_effects (
      card_no TEXT PRIMARY KEY,
      set_prefix TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  if (dbPath === DB_FILE) {
    dbInstance = db;
  }
  return db;
}

export function writeCatalogToSqlite(
  db: Database.Database,
  packages: GundamPackage[],
  cards: GundamCardPrint[],
  syncedAt: string,
  source: string,
  rules?: RulesPayload,
  effectsByCardNo?: Map<string, CompiledCardEffect>
): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM card_packages').run();
    db.prepare('DELETE FROM cards').run();
    db.prepare('DELETE FROM packages').run();
    db.prepare('DELETE FROM card_effects').run();

    const insertPkg = db.prepare(`
      INSERT INTO packages (id, code, name, category, card_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const p of packages) {
      insertPkg.run(p.id, p.code, p.name, p.category, p.cardCount);
    }

    const insertCard = db.prepare(`
      INSERT INTO cards (
        print_id, card_no, name, rarity, block_icon, lv, cost, color, type, effect,
        zones_json, traits_json, link, ap_raw, hp_raw, ap, hp, source_title,
        where_to_get, image_path, is_parallel, faqs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertJoin = db.prepare(`
      INSERT OR IGNORE INTO card_packages (print_id, package_id) VALUES (?, ?)
    `);

    const pkgIdSet = new Set(packages.map((p) => p.id));
    for (const c of cards) {
      insertCard.run(
        c.printId,
        c.cardNo,
        c.name,
        c.rarity,
        c.blockIcon,
        c.lv,
        c.cost,
        c.color,
        c.type,
        c.effect,
        JSON.stringify(c.zones ?? []),
        JSON.stringify(c.traits ?? []),
        c.link ?? '',
        c.apRaw ?? '-',
        c.hpRaw ?? '-',
        c.ap,
        c.hp,
        c.sourceTitle ?? '',
        c.whereToGet ?? '',
        c.imagePath ?? '',
        c.isParallel ? 1 : 0,
        JSON.stringify(c.faqs ?? [])
      );
      for (const pid of c.packageIds ?? []) {
        if (pkgIdSet.has(pid)) {
          insertJoin.run(c.printId, pid);
        }
      }
    }

    if (effectsByCardNo) {
      const insertEffect = db.prepare(`
        INSERT INTO card_effects (card_no, set_prefix, payload_json) VALUES (?, ?, ?)
      `);
      for (const [cardNo, eff] of effectsByCardNo.entries()) {
        insertEffect.run(cardNo, getEffectSetPrefix(cardNo), JSON.stringify(eff));
      }
    }

    const upsertMeta = db.prepare(`
      INSERT INTO catalog_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    upsertMeta.run('syncedAt', syncedAt);
    upsertMeta.run('source', source);

    if (rules) {
      db.prepare(`
        INSERT INTO rules_store (key, payload_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
      `).run('official_rules', JSON.stringify(rules), rules.syncedAt);
    }
  });

  tx();
}

export function readCatalogFromSqlite(db: Database.Database): CatalogPayload | null {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM cards').get() as { cnt: number };
  if (!countRow || countRow.cnt === 0) return null;

  const packages = db
    .prepare('SELECT id, code, name, category, card_count as cardCount FROM packages')
    .all() as GundamPackage[];
  const pkgById = new Map(packages.map((p) => [p.id, p]));

  const joins = db.prepare('SELECT print_id, package_id FROM card_packages').all() as {
    print_id: string;
    package_id: string;
  }[];
  const pkgsByPrint = new Map<string, GundamPackage[]>();
  for (const row of joins) {
    const pkg = pkgById.get(row.package_id);
    if (!pkg) continue;
    const arr = pkgsByPrint.get(row.print_id) ?? [];
    arr.push(pkg);
    pkgsByPrint.set(row.print_id, arr);
  }

  const cardRows = db.prepare('SELECT * FROM cards').all() as {
    print_id: string;
    card_no: string;
    name: string;
    rarity: string;
    block_icon: string;
    lv: number | null;
    cost: number | null;
    color: string;
    type: string;
    effect: string;
    zones_json: string;
    traits_json: string;
    link: string;
    ap_raw: string;
    hp_raw: string;
    ap: number | null;
    hp: number | null;
    source_title: string;
    where_to_get: string;
    image_path: string;
    is_parallel: number;
    faqs_json: string;
  }[];

  const effectRows = db
    .prepare('SELECT card_no, payload_json FROM card_effects')
    .all() as { card_no: string; payload_json: string }[];
  const effectsByCardNo = new Map<string, CompiledCardEffect>();
  for (const row of effectRows) {
    effectsByCardNo.set(row.card_no, JSON.parse(row.payload_json) as CompiledCardEffect);
  }

  const cards: GundamCardPrint[] = cardRows.map((r) => {
    const memberPkgs = pkgsByPrint.get(r.print_id) ?? [];
    const compiledEffect = effectsByCardNo.get(r.card_no);
    return {
      printId: r.print_id,
      cardNo: r.card_no,
      name: r.name,
      rarity: r.rarity,
      blockIcon: r.block_icon,
      lv: r.lv,
      cost: r.cost,
      color: r.color as CardColor,
      type: r.type,
      effect: r.effect,
      zones: JSON.parse(r.zones_json) as string[],
      traits: JSON.parse(r.traits_json) as string[],
      link: r.link,
      apRaw: r.ap_raw,
      hpRaw: r.hp_raw,
      ap: r.ap,
      hp: r.hp,
      sourceTitle: r.source_title,
      whereToGet: r.where_to_get,
      imagePath: r.image_path,
      isParallel: Boolean(r.is_parallel),
      faqs: JSON.parse(r.faqs_json) as CardFaq[],
      packageIds: memberPkgs.map((p) => p.id),
      packageNames: memberPkgs.map((p) => p.name),
      packageCodes: memberPkgs.map((p) => p.code),
      ...(compiledEffect ? { compiledEffect } : {}),
    };
  });

  const metaRows = db.prepare('SELECT key, value FROM catalog_meta').all() as {
    key: string;
    value: string;
  }[];
  const metaMap = new Map(metaRows.map((m) => [m.key, m.value]));

  const rulesRow = db
    .prepare('SELECT payload_json FROM rules_store WHERE key = ?')
    .get('official_rules') as { payload_json: string } | undefined;

  return {
    syncedAt: metaMap.get('syncedAt') ?? new Date().toISOString(),
    source: metaMap.get('source') ?? 'https://www.gundam-gcg.com/asia-en/cards/',
    totalPrints: cards.length,
    packages,
    cards,
    rules: rulesRow ? (JSON.parse(rulesRow.payload_json) as RulesPayload) : DEFAULT_RULES_PAYLOAD,
  };
}

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

async function getLatestShardMtimeMs(): Promise<number> {
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
    const effectsCountRow = db.prepare('SELECT COUNT(*) as cnt FROM card_effects').get() as { cnt: number };
    const existing = readCatalogFromSqlite(db);

    if (
      existing &&
      existing.cards.length > 0 &&
      effectsCountRow.cnt > 0 &&
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
