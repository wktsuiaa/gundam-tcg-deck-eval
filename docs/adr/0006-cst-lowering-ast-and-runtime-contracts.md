# 0006. Phrase-Level CST Lowering AST and Structured Runtime Contracts

Status: accepted (supersedes the clause-lowerer boundary in ADR-0005, updates ADR-0003)

## Context

`ADR-0003` introduced a pure-TypeScript Chevrotain parser (`lib/cfg-parser.ts`) to classify clause lines into `EFFECT_CLAUSE`, `REPLACEMENT_EFFECT`, `CONTINUOUS_MODIFIER`, and `CUSTOM_HOOK`, while `ADR-0005` kept `lib/effect-parser.ts` behind the CST gate as the regex-based step, condition, trigger, and selector lowerer. In practice, that split left four problems:

1. `GundamClauseCstParser` parsed clause bodies only as flat `clauseBodyAtom` token streams and ignored CST structure during lowering.
2. `lib/cfg-parser/lift.ts` and `lib/effect-parser/prerequisites.ts` ran extra regexes over raw text, misclassifying some `PROHIBITION` rules (such as `can't receive enemy effect damage`) and leaving `sourceFilter` unpopulated.
3. `CompiledCardEffect` retained semantic raw-string escape hatches (`RAW_CONDITION`, `STATIC_PERMISSION`, `insteadUpgrade.rawUpgrade`, `replacementSummary`), and `synergy`/`prerequisites` still read legacy `EffectClause[]`.
4. Runtime and UI consumers still inspected `.raw` or `card.effect` strings (`effective-state.ts`, `runner-base.ts`, `gundam-keywords.ts`, `CardDetailDrawer.tsx`), and `deck-engine` flattened `AbilityAst` through a lossy `getAbilitySteps` bridge.

## Decision

1. **Phrase-level Chevrotain CFG and direct CST Lowering.** Replace the legacy regex clause compiler (`clause-compile.ts`, `conditions.ts`, `triggers.ts`, `selectors.ts`, and `*-sentences.ts`) with phrase-level Chevrotain grammar rules and a CST-to-`AbilityAst` Lowering pass. Regular expressions exist only inside Chevrotain lexer token patterns and structural pre-normalization; zero prose regexes remain in Lowering, synergy, prerequisites, runtime engines, or UI.
2. **Structured AST without semantic raw catch-alls (`schemaVersion: 2`).** Bump `docs/schemas/effect-shard.schema.json` to `schemaVersion: 2`:
   - Remove `RAW_CONDITION`, `STATIC_PERMISSION`, `insteadUpgrade`, `replacementSummary`, and `summary` on `RESTRICTION`/`DAMAGE_PROOF`.
   - Retain `raw` on AST nodes strictly for human debugging; runtime, synergy, and prerequisite code never inspect `raw`.
   - Give `ReplacementEffectAst` structured `outcome`, `interceptedTarget`, `sourceFilter` (supporting relative bounds like `apMaxRef: 'SELF_AP'`), and `oncePerTurn`.
   - Populate `sourceFilter`, `damageMax`, and `additionalRules` on `ContinuousModifierAst` (`PROHIBITION`), and add `CANT_REDUCE_AP`.
   - Store structured `timings`, `cost`, `steps`, and `synergy` inside `CUSTOM_HOOK_REGISTRY` so `abilities.ts` has no hardcoded card IDs, while still gating hooked lines on CST lex/parse validation.
3. **AST-native synergy, prerequisites, runtime, and UI.** Compute `synergy` and `prerequisites` directly from `AbilityAst[]` and `KeywordAbility[]`. Update `chain-verifier`, `sandbox-engine`, `deck-engine/card-signals.ts`, `gundam-keywords.ts`, and `CardDetailDrawer.tsx` to read structured `AbilityAst` fields exclusively, wiring `COST_REDUCTION`, `PROHIBITION`, and `HP` modifiers in `sandbox-engine`.

## Consequences

- `data/effects/*.json` regenerates under `schemaVersion: 2` across all 1,278+ canonical cards with zero `DIAGNOSTIC` nodes.
- Runtime and UI helpers fail closed when given unhydrated cards lacking `compiledEffect`; test fixtures and dynamic card builders must call `compileCardEffect`.
- Any new card prose phrasing outside the Chevrotain CFG fails compilation deterministically with an explicit `DIAGNOSTIC` node instead of silently falling back to regex matching.
