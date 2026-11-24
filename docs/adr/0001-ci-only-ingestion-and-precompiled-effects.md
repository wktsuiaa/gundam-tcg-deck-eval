# 0001. CI-Only Catalog Ingestion and Pre-Compiled Effect Shards

Status: accepted

## Context

Previously, card catalog syncing could be triggered at runtime via `POST /api/cards/sync` (`syncOfficialCatalog`), and `parseCardEffects`, `extractSynergyProfile`, and `extractEffectPrerequisites` in `lib/effect-parser.ts` ran synchronously in memory on every deck analysis, recommendation loop, and sandbox action. On read-only serverless hosts runtime sync was session-only, and tight scoring loops repeatedly re-parsed identical raw prose.

## Decision

Remove the runtime **Sync Cards** feature (`POST /api/cards/sync`, `syncOfficialCatalog`, and the header UI trigger) and move both catalog ingestion and **Effect Clause** compilation into an automated GitHub Actions pipeline (`.github/workflows/sync-catalog.yml`). Keep raw scraped shards under `data/collections/*.json` untouched, compile canonical non-parallel card records offline via `scripts/compile_effects.ts` into set-prefix **Effect Shards** under `data/effects/<SET>.json` keyed by `cardNo`, hydrate them into SQLite (`card_effects`) and `memoryCache` at startup, and read `card.compiledEffect` exclusively at runtime.

## Considered Options

- **Embed compiled fields directly inside `data/collections/*.json`**: Rejected because weekly catalog scrapes overwrite collection shards and multi-package reprints would duplicate identical **Compiled Card Effects**.
- **Keep runtime compilation with memoization and live Sync Cards fallback**: Rejected to keep runtime free of regex compilation and unverified live-scraped card state.

## Consequences

- Runtime engines (`lib/deck-engine.ts` and `lib/sandbox-engine.ts`) never call `parseCardEffects` on catalog cards and fail closed to empty clauses/keywords if `compiledEffect` is missing.
- CI enforces that every unique `cardNo` in `data/collections/*.json` has an up-to-date **Compiled Card Effect** in `data/effects/*.json`.
- Between scheduled weekly CI runs, ingesting new card releases requires running `workflow_dispatch` (or running the sync/compile scripts locally).
- Unit tests constructing synthetic in-memory cards attach `compiledEffect` via `compileCardEffect` in test fixtures.
