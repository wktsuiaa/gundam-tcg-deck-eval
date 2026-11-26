# Repository Architecture

## Directory Layout

- `app/`: Next.js App Router entry points & server-side API routes.
  - `app/page.tsx`: Server Component calling `getCatalog()` with `revalidate = 3600` (ISR) to pre-render initial catalog & rules payload at build time.
  - `app/api/cards/route.ts`: Read-only catalog endpoint serving hydrated catalog & pre-compiled **Effect Shards**.
  - `app/api/card-image/route.ts`: Card artwork image proxy with path validation.
  - `app/api/exburst/import/route.ts`: Server-side ExBurst deck page fetcher & parser (`https://exburst.dev/gundam/...` allowlisted).
- `components/`: Client UI workspaces and modular components.
  - `GundamAtlasApp.tsx`: Top-level 3-workspace shell (`Catalog`, `Deck Builder`, `Match Sandbox`), `localStorage` deck persistence, and Card Detail Drawer orchestration.
  - `CatalogFilterPanel.tsx` & `CatalogWorkspace.tsx`: Encapsulated multi-select filter sidebar + grid/table catalog viewer.
  - `DeckWorkspace.tsx`: Consolidated `Build & Cards` generator/editor, `Hexagon & Matchups`, `Playbook & Mulligan`, strict/ExBurst import-export modals, and Official Rules trigger.
  - `MatchSandbox.tsx`: Interactive 2-player board with manual controls, auto-step execution, and live Best-Move Advisor.
  - `CardDetailDrawer.tsx`, `CardArtwork.tsx`, `HexagonRadar.tsx`, `RulesModal.tsx`.
- `lib/`: Core TypeScript engines and storage layer.
  - `gundam-db.ts`: `better-sqlite3` database initialization for writable local environments, automatic hydration from split collection and **Effect Shards**, read-only filesystem detection (`isDataDirectoryWritable`) with direct JSON-shard fallback for serverless deployments (e.g. Vercel), parameterized CRUD, and path-confined shard reads/writes.
  - `gundam-sync.ts`: Read-only catalog loader with in-memory `memoryCache` backed by SQLite / bundled JSON shards.
  - `cfg-parser.ts`: Chevrotain lexer + CST parser and **Lowering** into typed `AbilityAst` nodes (`EFFECT_CLAUSE`, `REPLACEMENT_EFFECT`, `CONTINUOUS_MODIFIER`, `CUSTOM_HOOK`, `DIAGNOSTIC`).
  - `effect-parser.ts`: Deterministic offline **Effect Clause** and **Keyword Ability** compiler (`compileCardEffect`) that supplies the typed steps the CST lowering attaches; used by `scripts/compile_effects.ts` and test fixtures.
  - `deck-engine.ts`: Deck validation, Effect Style detection, Trait+Linkage coherence scoring, constraint feasibility & deck generator, Hexagon/Matchup analysis, Turn 1–6+ insights, Turn Win-Chance estimator, and strict `<qty> <cardNo>` serializer/parser consuming `card.compiledEffect`.
  - `sandbox-engine.ts`: 2-deck state machine, Gundam GCG combat/keyword resolution (`<Blocker>`, `<First Strike>`, `<Breach>`, `<Repair>`, `<High-Maneuver>`, `[Link]`), and reactive Best-Move Advisor consuming `card.compiledEffect`.
  - `gundam-keywords.ts`: Keyword glossary, `[Link]` matcher, and color tokens.
- `data/`: Versioned game data shards (explicitly traced into serverless bundles via `outputFileTracingIncludes` in `next.config.ts`).
  - `data/packages.json`: Package metadata (`id`, `name`, `code`, `category`, `cardCount`).
  - `data/collections/<code>.json`: Per-collection raw card print shards (e.g. `GD01.json`, `ST01.json`).
  - `data/effects/<SET>.json`: Per-set-prefix **Effect Shards** storing **Compiled Card Effects** keyed by `cardNo` (e.g. `GD01.json`, `ST09.json`, `R.json`).
  - `data/rules.json`: Synced official deck rules, turn phases, rule PDFs, general FAQs, and per-card FAQ index.
  - `data/gundam.db`: Local SQLite database (git-ignored, auto-rebuilt on writable local startup from JSON shards; skipped on read-only serverless filesystems).
- `scripts/`: Python ingestion scripts (`sync_catalog.py`, `sync_rules.py`), the TypeScript effect compiler (`compile_effects.ts`), and the evaluation snapshot tool (`eval_snapshot.ts`, see [making changes](making-changes.md)).
- `docs/schemas/` & `docs/DATA_SCHEMAS.md`: Machine-readable Draft 2020-12 JSON Schemas (`packages.schema.json`, `collection-shard.schema.json`, `rules.schema.json`, `effect-shard.schema.json`) and technical schema reference.
- `.github/workflows/sync-catalog.yml`: Weekly, push-triggered, and manual CI automation workflow.

## Effect Lowering Pipeline

```
card.effect (prose)
  → normalizeCardEffectText        strip reminder text, normalize glyphs
  → Chevrotain lexer + CST parser  one CST per effect line
  → Lowering (parseCardAbilities)  CST + typed clauses from parseCardEffects → AbilityAst[]
  → data/effects/<SET>.json        Compiled Card Effect, schema-validated
  → deck-engine / sandbox-engine   read card.compiledEffect only
```

Anything the pipeline cannot lex, parse, or lower becomes a `DIAGNOSTIC` node (`LEX_ERROR`, `PARSE_ERROR`, `NO_LOWERING`, `UNPARSED_RESIDUAL`). Nothing is dropped and nothing is guessed from text at runtime. Decision record: [ADR 0005](adr/0005-ast-lowering-diagnostics-and-attack-ping-axis.md).

## Deck Evaluation Model

- **Hexagon axes**: Aggro, Defense, Attack / Ping, Liquidity, Synergy, Control (`HexagonAxes` in `types/gundam.ts`). Formulas are in [ALGORITHMS.md](ALGORITHMS.md).
- **Strategy Blueprint**: one Build Deck Strategy, up to two Effect Styles, colors, pacing, trait focus, target hexagon, constraints. Persisted decks pass through `normalizeBlueprint` on load, which upgrades older saved names.
- **Style vocabulary** lives in `TACTICAL_STYLE_META` and `EFFECT_STYLE_META` (`lib/deck-engine.ts`); the UI renders from those tables.

## Data Storage & Deduplication Flow

1. **Source of Truth in Git**: Cards are sharded by collection code into `data/collections/<code>.json` alongside `data/packages.json` and `data/rules.json`. **Compiled Card Effects** are stored separately by `cardNo` set prefix in `data/effects/<SET>.json` (**Effect Shards**) so multi-package reprints are compiled once from their canonical non-parallel print.
2. **SQLite Hydration & Read-Only Serverless Fallback (`lib/gundam-db.ts`)**:
   - On writable hosts (local dev/tests), `getCatalog()` → `ensureHydratedCatalogFromDb()` checks `isDataDirectoryWritable()`. If `data/gundam.db` is empty, missing, lacks `card_effects`, or is older than the JSON shards, `readSplitJsonCatalog()` and `readCompiledEffectsFromShards()` load `data/packages.json`, `data/rules.json`, `data/collections/*.json`, and `data/effects/*.json`, deduplicate prints by `printId`, attach `compiledEffect` by `cardNo`, and populate SQLite (`packages`, `cards`, `card_packages`, `card_effects`, `rules_store`, `catalog_meta`).
   - On read-only serverless hosts like Vercel (`/var/task`), `isDataDirectoryWritable()` returns `false` (and any unexpected `SQLITE_CANTOPEN`/`EROFS` error is also caught), so `ensureHydratedCatalogFromDb()` skips SQLite entirely and serves directly from the bundled JSON shards via `buildCatalogPayloadFromShards()` into `memoryCache`.
   - `next.config.ts` sets `outputFileTracingIncludes: { '/*': ['./data/**/*'] }` so Vercel bundles all `data/` collection and effect shards into serverless functions despite dynamic `fs.readFile` paths.
3. **Security Safeguards**:
   - SQLite queries use parameterized statements exclusively.
   - Split shard filenames are sanitized (`[A-Za-z0-9_-]+`) and path-confined to `data/collections/` and `data/effects/`.
   - ExBurst import strictly validates HTTPS URLs whose hostname is `exburst.dev` or `www.exburst.dev` and whose pathname starts with `/gundam`, blocking SSRF targets.

## GitHub Actions CI Automation

`.github/workflows/sync-catalog.yml` (see [data maintenance](data-maintenance.md)) runs every Monday at 03:00 UTC, on `main` pushes touching `data/collections/**`, `lib/effect-parser.ts`, or `scripts/compile_effects.ts`, or manually via `workflow_dispatch`:
1. On schedule/manual dispatch, runs `python3 scripts/sync_rules.py` and `python3 scripts/sync_catalog.py` to update `data/rules.json`, `data/packages.json`, and `data/collections/*.json`.
2. Runs `npm run compile:effects` (`scripts/compile_effects.ts`) to compile canonical card records into `data/effects/<SET>.json` **Effect Shards**.
3. Runs `npm test`, `npm run lint`, and `npm run build` to verify **Effect Shard** completeness, schema/engine invariants, and UI integrity.
4. Commits and pushes any changes under `data/` automatically.
