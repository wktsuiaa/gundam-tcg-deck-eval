# Data Maintenance

## What lives where

| Path | Source | Edited by hand? |
| --- | --- | --- |
| `data/collections/<code>.json`, `data/packages.json`, `data/rules.json` | `scripts/sync_catalog.py`, `scripts/sync_rules.py` | No |
| `data/effects/<SET>.json` | `npm run compile:effects` | No |
| `lib/cfg-parser.ts` `CUSTOM_HOOK_REGISTRY` | people | Yes, for rare one-off clauses |
| `docs/schemas/*.schema.json` | people | Yes, with the shape change that needs it |

## Refresh the catalog

```bash
python3 scripts/sync_rules.py
python3 scripts/sync_catalog.py
npm run compile:effects
npm test && npx tsc --noEmit && npx eslint .
```

CI (`.github/workflows/sync-catalog.yml`) does the same weekly and commits changes under `data/`.

## Recompile effects after a parser change

1. Edit `lib/cfg-parser.ts` or `lib/effect-parser.ts`.
2. Run `npm run compile:effects`. Add `-- --check` to see stale shards without writing.
3. Review `git diff data/effects`. Every changed card should be one you meant to change.
4. Run `npm test`. `__tests__/cfg-parser.test.ts` requires zero lexer and parser errors and zero unregistered hooks; `__tests__/data-schemas.test.ts` validates shards against `docs/schemas/effect-shard.schema.json`.

## Fix a card the parser cannot read

Shards must contain no `DIAGNOSTIC` nodes. When a new card produces one:

| Code | Meaning | Fix |
| --- | --- | --- |
| `LEX_ERROR` | Character the lexer does not know | Extend the lexer in `lib/cfg-parser.ts` |
| `PARSE_ERROR` | Line does not match the grammar | Extend the grammar, or the line is a prose typo upstream; recheck the source |
| `NO_LOWERING` | CST parsed, no typed clause produced | Teach `parseCardEffects` in `lib/effect-parser.ts` the sentence |
| `UNPARSED_RESIDUAL` | Clause lowered but prose was left over | Same as `NO_LOWERING`; the leftover text is in the node's `raw` |

For a true one-off, register a `CUSTOM_HOOK` keyed `<cardNo>#<clauseIndex>` in `CUSTOM_HOOK_REGISTRY`. The sandbox must also handle it or it fails closed with `UNIMPLEMENTED_CUSTOM_HOOK`.

## Change the schema

Update the TypeScript type, the JSON schema in `docs/schemas/`, and [DATA_SCHEMAS.md](DATA_SCHEMAS.md) together, then recompile.
