# Testing Flow & Verification

## Automated Test Suite (`Vitest`)

Run the full automated suite with:

```bash
npm test
```

### Coverage Map (`__tests__/`)

1. **`__tests__/deck-engine.test.ts`**:
   - Strict `<number> <cardNo>` parser & exporter (verifies `4x` syntax, comments, and trailing card names are rejected, while `RESOURCE` cards auto-route to the Resource Deck).
   - Effect Style classification (`detectEffectStyles`).
   - Verification that `sourceTitle` (Series) has **zero** impact on card coherence or fit scores.
   - Strategy generation under hard constraints (`maxCopiesPerCard`, `maxCost`, `rarityCap`, `Any (Auto Best 2)` colors) producing tournament-legal 50+10 decks.
   - Constraint infeasibility guard when pool size cannot reach 50 cards.
   - Turn 1–6+ Best/Worst Action generation and Turn-by-Turn Win-Chance sensitivity across Turn Order and Opening Hand Quality settings.
2. **`__tests__/gundam-db.test.ts`**:
   - Loads `data/packages.json` and all 26 `data/collections/*.json` shards.
   - Verifies strict `printId` deduplication and automatic SQLite hydration (`ensureHydratedCatalogFromDb`) including synced `RulesPayload`.
   - Verifies path-traversal sanitization (`resolveSafeCollectionPath`) and graceful fallback to split JSON shards when the SQLite path is read-only or unwritable.
3. **`__tests__/sandbox-engine.test.ts`**:
   - Initializes a 2-deck Sandbox match (5-card hands, 6 Shields, Turn 1 active side).
   - Verifies reactive Top 3 Best-Move Advisor ranking (`evaluateSandboxBestMoves`).
   - Verifies turn handover, resource progression, card draw, and `stepSandboxBot` execution.

## Build & Lint Verification

```bash
npm run lint
npm run build
```

## Sync Script Dry-Runs

To test the CI scrapers locally:

```bash
python3 scripts/sync_rules.py
python3 scripts/sync_catalog.py
```

Both scripts update the files under `data/` deterministically and maintain idempotency across runs.
