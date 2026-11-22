import fs from 'node:fs/promises';
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
  buildCatalogPayloadFromShards,
  DEFAULT_RULES_PAYLOAD,
  ensureHydratedCatalogFromDb,
  getDb,
  isDataDirectoryWritable,
  sortCards,
  writeCatalogToSqlite,
  writeSplitJsonShards,
} from '@/lib/gundam-db';

const BASE_URL = 'https://www.gundam-gcg.com/asia-en/cards/';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const RULES_FILE = path.resolve(DATA_DIR, 'rules.json');

let memoryCache: CatalogPayload | null = null;

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanHtmlText(raw: string): string {
  const withLines = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const decoded = decodeHtmlEntities(withLines);
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function classifyPackage(name: string): string {
  if (name.includes('[GD')) return 'Booster Pack';
  if (name.includes('[ST')) return 'Starter Deck';
  if (name.includes('[EB') || name.includes('[SC') || name.toUpperCase().includes('LIMITED')) {
    return 'Special / Extra Set';
  }
  if (name.includes('Promotion')) return 'Promotion';
  if (name.includes('Basic')) return 'Basic Cards';
  return 'Other Product';
}

function parseNum(val: string | undefined): number | null {
  if (!val || val === '-') return null;
  const m = val.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function parseTraits(raw: string | undefined): string[] {
  if (!raw || raw === '-') return [];
  const matches = [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim()).filter(Boolean);
  if (matches.length > 0) return matches;
  return raw
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '-');
}

async function fetchHtml(url: string, retries = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GundamCardAtlas/1.0)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

function printIdBase(printId: string): string {
  return printId.split('_')[0];
}

function parseDetailHtml(printId: string, dhtml: string): GundamCardPrint {
  const extractOne = (regex: RegExp) => {
    const m = dhtml.match(regex);
    return m ? cleanHtmlText(m[1]) : '';
  };

  const cardNo = extractOne(/<div class="cardNo">\s*([\s\S]*?)\s*<\/div>/) || printIdBase(printId);
  const rarity = extractOne(/<div class="rarity">\s*([\s\S]*?)\s*<\/div>/).replace(/\s+/g, '') || 'C';
  const blockIcon = extractOne(/<div class="blockIcon">\s*([\s\S]*?)\s*<\/div>/) || '1';
  const name = extractOne(/<h1 class="cardName">\s*([\s\S]*?)\s*<\/h1>/) || cardNo;

  const imgMatch = dhtml.match(/<div class="cardImage">\s*<img[^>]*src\s*=\s*"([^"]+)"/);
  let imagePath = '';
  if (imgMatch) {
    const rawSrc = imgMatch[1].split('?')[0].trim();
    imagePath = rawSrc.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
  }
  if (!imagePath) {
    imagePath = `jp/images/cards/card/${printId}.webp`;
  }

  const fields: Record<string, string> = {};
  const fieldRegex =
    /<dt class="dataTit">\s*([\s\S]*?)\s*<\/dt>\s*<dd[^>]*class="dataTxt[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/dd>/g;
  for (const m of dhtml.matchAll(fieldRegex)) {
    fields[cleanHtmlText(m[1])] = cleanHtmlText(m[2]);
  }

  const effect = extractOne(
    /<div class="cardDataRow overview">\s*<div[^>]*class="dataTxt[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/div>\s*<\/div>/
  );

  const faqs: CardFaq[] = [];
  const qaIdx = dhtml.indexOf('class="cardQaCol"');
  if (qaIdx !== -1) {
    const qaHtml = dhtml.slice(qaIdx);
    const qaRegex = /class="qaTit"[^>]*>([\s\S]*?)<\/div>[\s\S]*?class="qaTxt"[^>]*>([\s\S]*?)<\/div>/g;
    for (const m of qaHtml.matchAll(qaRegex)) {
      const q = cleanHtmlText(m[1]);
      const a = cleanHtmlText(m[2]);
      if (q && a) faqs.push({ q, a });
    }
  }

  const colorRaw = fields['COLOR'];
  const color = (colorRaw && colorRaw !== '-' ? colorRaw : 'Colorless') as CardColor;
  const zoneRaw = fields['Zone'];
  const zones =
    !zoneRaw || zoneRaw === '-'
      ? []
      : zoneRaw
          .split(/\s+/)
          .map((z) => z.trim())
          .filter(Boolean);
  const linkRaw = fields['Link'];
  const sourceRaw = fields['Source Title'];

  return {
    printId,
    cardNo,
    name,
    rarity,
    blockIcon,
    lv: parseNum(fields['Lv.']),
    cost: parseNum(fields['COST']),
    color,
    type: fields['TYPE'] || 'UNIT',
    effect,
    zones,
    traits: parseTraits(fields['Trait']),
    link: !linkRaw || linkRaw === '-' ? '' : linkRaw,
    apRaw: fields['AP'] || '-',
    hpRaw: fields['HP'] || '-',
    ap: parseNum(fields['AP']),
    hp: parseNum(fields['HP']),
    sourceTitle: !sourceRaw || sourceRaw === '-' ? '' : sourceRaw,
    whereToGet: fields['Where to get it'] || '',
    imagePath,
    isParallel: printId.includes('_') || rarity.includes('+'),
    faqs,
    packageIds: [],
    packageNames: [],
    packageCodes: [],
  };
}

async function readRulesFromFile(): Promise<RulesPayload> {
  try {
    const raw = await fs.readFile(RULES_FILE, 'utf-8');
    return JSON.parse(raw) as RulesPayload;
  } catch {
    return DEFAULT_RULES_PAYLOAD;
  }
}

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

export async function syncOfficialCatalog(forceRefreshAll = false): Promise<{
  addedCount: number;
  updatedCount: number;
  persistedToDisk: boolean;
  catalog: CatalogPayload;
}> {
  const existing = await getCatalog();
  const existingMap = new Map<string, GundamCardPrint>(existing.cards.map((c) => [c.printId, c]));
  const rules = await readRulesFromFile();

  const mainHtml = await fetchHtml(BASE_URL);
  const pkgRegex = /data-val="([0-9]+)"[^>]*>\s*([^<]+?)\s*</g;
  const seenPkg = new Set<string>();
  const packages: GundamPackage[] = [];

  for (const m of mainHtml.matchAll(pkgRegex)) {
    const id = m[1];
    if (seenPkg.has(id)) continue;
    seenPkg.add(id);
    const name = decodeHtmlEntities(m[2]).trim();
    const codeMatch = name.match(/\[([A-Z0-9-]+)\]/);
    packages.push({
      id,
      name,
      code: codeMatch ? codeMatch[1] : id,
      category: classifyPackage(name),
      cardCount: 0,
    });
  }

  const printToPkgs = new Map<string, { id: string; name: string; code: string }[]>();

  for (let i = 0; i < packages.length; i += 4) {
    const batch = packages.slice(i, i + 4);
    await Promise.all(
      batch.map(async (pkg) => {
        const phtml = await fetchHtml(`${BASE_URL}index.php?package=${pkg.id}`);
        const seenPid = new Set<string>();
        for (const m of phtml.matchAll(/detail\.php\?detailSearch=([A-Za-z0-9_-]+)/g)) {
          const pid = m[1];
          if (seenPid.has(pid)) continue;
          seenPid.add(pid);
          const arr = printToPkgs.get(pid) ?? [];
          arr.push({ id: pkg.id, name: pkg.name, code: pkg.code });
          printToPkgs.set(pid, arr);
        }
        pkg.cardCount = seenPid.size;
      })
    );
  }

  const allPrintIds = [...printToPkgs.keys()];
  const toFetch = forceRefreshAll
    ? allPrintIds
    : allPrintIds.filter((pid) => !existingMap.has(pid));

  let addedCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < toFetch.length; i += 8) {
    const batch = toFetch.slice(i, i + 8);
    await Promise.all(
      batch.map(async (pid) => {
        try {
          const dhtml = await fetchHtml(`${BASE_URL}detail.php?detailSearch=${pid}`);
          const parsed = parseDetailHtml(pid, dhtml);
          if (parsed.faqs.length === 0 && rules.cardFaqs[parsed.cardNo]) {
            parsed.faqs = rules.cardFaqs[parsed.cardNo];
          }
          if (existingMap.has(pid)) {
            updatedCount += 1;
          } else {
            addedCount += 1;
          }
          existingMap.set(pid, parsed);
        } catch (err) {
          console.error(`Failed to sync card ${pid}:`, err);
        }
      })
    );
  }

  for (const [pid, pkgs] of printToPkgs.entries()) {
    const card = existingMap.get(pid);
    if (card) {
      card.packageIds = pkgs.map((p) => p.id);
      card.packageNames = pkgs.map((p) => p.name);
      card.packageCodes = pkgs.map((p) => p.code);
      if (card.faqs.length === 0 && rules.cardFaqs[card.cardNo]) {
        card.faqs = rules.cardFaqs[card.cardNo];
      }
    }
  }

  const sorted = sortCards([...existingMap.values()]);
  const syncedAt = new Date().toISOString();

  let persistedToDisk = false;
  if (isDataDirectoryWritable()) {
    try {
      await writeSplitJsonShards(packages, sorted, syncedAt, BASE_URL);
      const db = getDb();
      writeCatalogToSqlite(db, packages, sorted, syncedAt, BASE_URL, rules);
      persistedToDisk = true;
    } catch (err) {
      console.warn('Skipping disk persistence during catalog sync (read-only filesystem):', err);
      persistedToDisk = false;
    }
  }

  const payload: CatalogPayload = {
    syncedAt,
    source: BASE_URL,
    totalPrints: sorted.length,
    packages,
    cards: sorted,
    rules,
  };

  memoryCache = payload;
  return { addedCount, updatedCount, persistedToDisk, catalog: payload };
}
