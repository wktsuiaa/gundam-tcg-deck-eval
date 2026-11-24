# 0002. Trigger-Condition Separation and Lossless Effect AST with Escape Hatches

Status: accepted

## Context

`RAW_CONDITION` and `unparsedResidual` previously absorbed reactive inline triggers (`GD06-001`, `GD06-002`), compound conditions (`GD06-003`), **Link Requirements**, exact `HP` bounds (`GD06-009`), modal bullets, and multi-sentence `If you do, ...` branches.

## Decision

1. Separate `triggerEvent?: TriggerEvent` (and reactive `EffectTiming` variants) cleanly from state-check **Guard Conditions** (`EffectClause.condition`) by parsing turn/phase guards first and extracting inline `When ...` / `Whenever ...` events via `parseLeadingWhenTrigger`.
2. Attach structured `LinkRequirement` objects directly onto every `WHEN_LINKED` and `DURING_LINK` clause (`UNIT_REQUIRES_PILOT` / `PILOT_MATCHING_UNIT`) and emit non-blocking (`primaryClause: false`) `LINK` **Effect Prerequisites**.
3. Model the full `1,290`-card corpus (`1,392` clauses) with recursive `EffectCondition` / `EffectStep` variants and `ScaleMetric` while keeping `RAW_CONDITION` and `unparsedResidual` in the TypeScript types and JSON Schema strictly as fail-closed escape hatches for future upstream catalog syncs, enforcing `0` occurrences across committed shards in CI.

## Considered Options

- **Delete `RAW_CONDITION` and `unparsedResidual` from the schema**: Rejected because weekly CI catalog syncs (`scripts/sync_catalog.py`) can ingest newly released card prose before compiler updates land; retaining fail-closed escape hatches prevents broken builds while flagging unmodeled prose cleanly in the sandbox (`"Manual resolution required: ..."`).
- **Keep reactive triggers inside `CONTINUOUS` + `condition`**: Rejected because continuous state evaluation cannot distinguish single-event triggers (`WHEN_ATTACKED`, `WHEN_DESTROY_BY_BATTLE`) or enforce `oncePerTurn` boundaries accurately.

## Consequences

- Committed `data/effects/*.json` shards achieve `100.0%` structured AST coverage (`0` `RAW_CONDITION`, `0` `unparsedResidual`) and every Link-gated clause carries explicit `linkRequirement` data.
- `lib/sandbox-engine.ts` executes modeled triggers/guards directly and fails closed with `"Manual resolution required: ..."` on unsimulated typed AST steps or conditions (such as `EXILE` + `IF_PREVIOUS_SUCCEEDED` on `GD06-002` Clause 2) without blocking compilation.
