import Database from 'better-sqlite3';
import fsSync from 'node:fs';
import path from 'node:path';
import type { RulesPayload } from '@/types/gundam';

export const DATA_DIR = path.resolve(process.cwd(), 'data');

export const COLLECTIONS_DIR = path.resolve(DATA_DIR, 'collections');

export const EFFECTS_DIR = path.resolve(DATA_DIR, 'effects');

export const PACKAGES_FILE = path.resolve(DATA_DIR, 'packages.json');

export const RULES_FILE = path.resolve(DATA_DIR, 'rules.json');

export const DB_FILE = path.resolve(DATA_DIR, 'gundam.db');

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

export let dbInstance: Database.Database | null = null;

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
