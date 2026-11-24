# Testing Flow & Verification

## Automated Test Suite (`Vitest`)

Run the full automated suite with:

```bash
npm test
```

### Coverage Map (`__tests__/`)

1. **`__tests__/deck-engine.test.ts`**:
   - Strict `<number> <cardNo>` parser & exporter (verifies `4x` syntax, comments, and trailing card names are rejected, while `RESOURCE` cards auto-route to the Resource Deck).
   - Effect Style classification (`detectEffectStyles`), parsed `ST09-006` conditional discount, and `ST04-010` / `<Blocker>` false-positive guards.
   - Verification that `sourceTitle` (Series) has **zero** impact on card coherence or fit scores.
   - Strategy generation under hard constraints (`maxCopiesPerCard`, `maxCost`, `rarityCap`, `Any (Auto Best 2)` colors) producing tournament-legal 50+10 decks.
   - Constraint infeasibility guard when pool size cannot reach 50 cards.
   - Full-catalog **Effect Prerequisite** & 3-pass Deck Builder audit on `Purple/Red + Midrange Tempo + ZAFT + Destroy & Trash Recursion` (verifying `GD05-112` / `GD05-113` / `GD06-116` / `GD05-115` exclusion, `GD04-116` self-mill synergy, and `>= minCopies` prerequisite satisfaction).
   - Turn 1–6+ Best/Worst Action generation and Turn-by-Turn Win-Chance sensitivity across Turn Order and Opening Hand Quality settings.
2. **`__tests__/effect-parser.test.ts`**:
   - Typed `EffectClause` parsing (`ST09-006`, `ST09-001`, `ST09-003`, `ST09-004`, `ST04-010`, `GD01-054`, `GD06-050`, `GD05-112`, `GD05-113`, `GD05-121`, `GD04-116`) including `PAIR_SELF_FROM_TRASH` and `extractEffectPrerequisites`.
   - Full 1,290-card corpus invariant audit (zero crashes, zero reminder-text leaks, >=80% full clause parse coverage) plus **Effect Shard** completeness and freshness check against `data/effects/*.json`.
3. **`__tests__/gundam-db.test.ts`**:
   - Loads `data/packages.json`, all 26 `data/collections/*.json` shards, and all 28 `data/effects/*.json` **Effect Shards**.
   - Verifies strict `printId` deduplication and automatic SQLite hydration (`ensureHydratedCatalogFromDb`) including `card_effects` and synced `RulesPayload`.
   - Verifies path-traversal sanitization (`resolveSafeCollectionPath`) and graceful fallback to split JSON shards when the SQLite path is read-only or unwritable.
4. **`__tests__/sandbox-engine.test.ts`**:
   - Initializes a 2-deck Sandbox match (5-card hands, 6 Shields, Turn 1 active side).
   - Verifies reactive Top 3 Best-Move Advisor ranking (`evaluateSandboxBestMoves`), turn handover, and `stepSandboxBot` execution.
   - Verifies fail-closed **Effect Clause** execution (`ST09-006` hand vs. trash deploy, `ST09-001` → `ST09-006` chain, `ST09-003` symmetrical AoE, `ST09-004` conditional `<Suppression>`, `ST09-009` target filter, `GD05-112` `PAIR_SELF_FROM_TRASH` gating onto `(MF)` Units, and `"Manual resolution required"` fail-closed logs).
5. **`__tests__/data-schemas.test.ts`**:
   - Validates `data/packages.json`, `data/rules.json`, all 26 `data/collections/*.json` shards, and all 28 `data/effects/*.json` **Effect Shards** against the Draft 2020-12 JSON Schemas in `docs/schemas/*.schema.json`.
   - Verifies negative contract mutations (wrong `schemaVersion`, unexpected properties, unknown `EffectStep.action` / `EffectCondition.kind`, invalid `RawCardPrint.type`) are rejected.

## Build & Lint Verification

```bash
npm run compile:effects
npm test
npm run lint
npm run build
```

## Sync & Compile Script Dry-Runs

To test the CI scrapers and **Effect Shard** compiler locally:

```bash
python3 scripts/sync_rules.py
python3 scripts/sync_catalog.py
npm run compile:effects
```

All three scripts update the files under `data/` deterministically and maintain idempotency across runs (`node --experimental-strip-types scripts/compile_effects.ts --check` verifies shard freshness without writing).
