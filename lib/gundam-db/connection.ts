import fsSync from 'node:fs';
import path from 'node:path';
import type { RulesPayload } from '@/types/gundam';

export interface SqliteStatement {
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
  run: (...args: unknown[]) => { changes: number };
}

export interface SqliteDatabase {
  pragma: (_sql: string) => void;
  exec: (_sql: string) => void;
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  prepare: (_sql: string) => SqliteStatement;
}

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

export let dbInstance: SqliteDatabase | null = null;

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

export function getDb(dbPath = DB_FILE): SqliteDatabase {
  if (dbInstance && dbPath === DB_FILE) return dbInstance;
  // MOCKED — better-sqlite3 stripped; catalog falls back to JSON shards
  const mockDb: SqliteDatabase = {
    pragma: () => {},
    exec: () => {},
    transaction: (fn) => fn,
    prepare: () => ({
      get: () => null,
      all: () => [],
      run: () => ({ changes: 0 }),
    }),
  };

  if (dbPath === DB_FILE) {
    dbInstance = mockDb;
  }
  return mockDb;
}
