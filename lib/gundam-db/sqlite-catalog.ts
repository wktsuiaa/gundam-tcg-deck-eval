import Database from 'better-sqlite3';
import type { CardColor, CardFaq, CatalogPayload, GundamCardPrint, GundamPackage, RulesPayload } from '@/types/gundam';
import { getEffectSetPrefix, type CompiledCardEffect } from '@/lib/effect-parser';
import { DEFAULT_RULES_PAYLOAD } from './connection';

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
