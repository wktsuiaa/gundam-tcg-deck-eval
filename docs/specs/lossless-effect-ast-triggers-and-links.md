# Spec: Lossless Effect Clause AST, Trigger-Condition Separation, and Link Requirements

## Problem Statement

After initial **Effect Clause** compilation (`docs/specs/effect-clause-compiler-and-sandbox.md`), four structural gaps remained across the `1,290`-card catalog:

1. **Inline Trigger / Guard Conflation (`GD06-001`, `GD06-002`)**: Clauses starting with `【Once per Turn】When this Unit is attacked, ...` or `During your turn, when this Unit destroys an enemy card with battle damage, ...` lacked bracketed timing headers, fell into `CONTINUOUS`, and trapped reactive triggers inside `RAW_CONDITION` strings (`80` `"when"`-containing clauses misclassified as `CONTINUOUS`).
2. **Unparsed Residuals & `RAW_CONDITION` Holes (`265` residuals, `164` `RAW_CONDITION`s)**: Compound conditions (`and`/`or`/negations, hand/shield/resource/board counts, turn-history checks), dynamic scaling (`GD06-003`), exact `HP` selectors (`GD06-009`), control flow (`If you do, ...`), modal `■` bullets after `【Action】`/`【Main】`, **Command Pilot** modes (`【Pilot】[Name]`), and name aliases fell into `unparsedResidual` or `RAW_CONDITION`.
3. **Missing Link Metadata on Link-Gated Clauses**: `WHEN_LINKED` and `DURING_LINK` clauses (`125` clauses across the corpus) carried no structured **Link Requirement** identifying which Pilot names/Traits a Unit needed or which Pilot matched a Unit.
4. **Targeted Card Regressions**: `GD06-001`, `GD06-002`, `GD06-003`, and `GD06-009` misbehaved in both compiled output and Match Sandbox execution.

## Solution

1. **Separate `TriggerEvent` from `Guard Condition`**: Add `triggerEvent?: TriggerEvent` and 19 reactive `EffectTiming` variants to `EffectClause`. Strip turn-phase guards (`During your turn,`) first into `condition`, then extract inline `When ...` / `Whenever ...` events via `parseLeadingWhenTrigger`.
2. **Structured `LinkRequirement` & `LINK` Prerequisites**: Populate `linkRequirement` (`UNIT_REQUIRES_PILOT` / `PILOT_MATCHING_UNIT`) on every `WHEN_LINKED` and `DURING_LINK` clause, extend `doesPilotLinkUnit` for **Command Pilots** (`GRANT_PILOT_MODE`) and aliases (`NAME_ALIAS`), and emit non-blocking `LINK` **Effect Prerequisites** (`primaryClause: false`).
3. **Zero-Residual Recursive AST**: Add `ScaleMetric`, exact `hpMin`/`hpMax`/`hpRank`/`lvRank` selectors, boolean/count `EffectCondition` variants (`ALL_OF`, `ANY_OF`, `NOT`, `BOARD_CARD_COUNT`, `SELF_STATE`, `HAND_COUNT`, `SHIELD_COUNT`, `RESOURCE_COUNT`, `PLAYER_LV_AT_LEAST`, `ENEMY_PLAYER_COUNT_AT_LEAST`, `TURN_HISTORY`), and nested `EffectStep` variants (`IF_CONDITION`, `IF_PREVIOUS_SUCCEEDED`, `GRANT_CLAUSE`, rule overrides, identity tags). Retain `RAW_CONDITION` and `unparsedResidual` strictly as future-sync escape hatches while driving current corpus counts to `0` / `0`.
4. **Runtime Sandbox Fidelity**: Wire `WHEN_ATTACKED`, `WHEN_DESTROY_BY_BATTLE`, `oncePerTurn` tracking (`triggeredClauseTurns`), continuous `ScaleMetric` AP buffs (`effectiveAp`), `ALL_OF`/`ANY_OF`/`NOT`/`HAND_COUNT`/`BOARD_CARD_COUNT` guards, and `hpMin`/`hpRank`/`lvRank` selectors in `lib/sandbox-engine.ts`, failing closed with `"Manual resolution required: ..."` for unsimulated AST nodes.

## Approved Decisions (`Q1`–`Q12`)

- **Raw Shards Immutable**: Keep `data/collections/*.json` untouched; compile exclusively into `data/effects/*.json`.
- **Escape Hatches Retained**: Keep `RAW_CONDITION` and `unparsedResidual` in TypeScript and `docs/schemas/effect-shard.schema.json`, while CI tests assert `0` across all `1,290` currently synced cards.
- **Identity Clauses & `primaryClause`**: `GRANT_PILOT_MODE` and `NAME_ALIAS` alone are identity declarations and do not clear `primaryClause: true` on a gated Command's main effect (`GD05-112`, `GD05-113`).
- **`LINK` Prerequisites Non-Blocking**: `LINK` prerequisites always set `primaryClause: false` so deck scoring penalizes missing Link support gently rather than blocking playable cards.
- **Command-Pilot Pairing Boundary**: `lib/gundam-keywords.ts` and `lib/deck-engine.ts` recognize **Command Pilots** for `[Link]` matching; Sandbox board `PAIR_PILOT` remains fail-closed to `type === 'PILOT'`.

## Verification Seams

- **`__tests__/effect-parser.test.ts`**: Verifies `GD06-001`, `GD06-002`, `GD06-003`, `GD06-009`, `linkRequirement`, `GRANT_PILOT_MODE`, `NAME_ALIAS`, and full-corpus invariants (`0` `RAW_CONDITION`, `0` `unparsedResidual`, `100%` Link coverage, `0` missing `hpMin`).
- **`__tests__/data-schemas.test.ts`**: Validates all 28 regenerated `data/effects/*.json` shards strictly against `docs/schemas/effect-shard.schema.json`.
- **`__tests__/deck-engine.test.ts`**: Verifies **Command Pilot** (`EB01-076`) and name-alias (`GD02-098`) `[Link]` matching plus `LINK` prerequisite satisfaction.
- **`__tests__/sandbox-engine.test.ts`**: Verifies runtime triggers, guards, continuous scaling, `oncePerTurn`, exact `1 HP` bounce, and fail-closed manual logs on `GD06-001`, `GD06-002`, `GD06-003`, and `GD06-009`.
