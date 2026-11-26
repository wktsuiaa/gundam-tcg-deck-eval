# 0005. AST Lowering With Explicit Diagnostics, and the Attack / Ping Axis

Status: accepted

## Context

Deck scoring read `card.compiledEffect`, but two text-matching paths survived: a regex fallback over unparsed residual prose in `lib/deck-engine.ts` (dead since `residualText` became `''`) and a regex timing guess in `lib/cfg-parser.ts` that ran when no lowered clause existed. Lexer and parser failures were pushed to an `errors` list and the line vanished from the AST. The Hexagon also scored a `tempo` axis that overlapped Aggro (early drops) and mixed in Resource ramp, and the strategy and effect-style names no longer matched how players describe decks.

## Decision

1. **Lowering emits `DIAGNOSTIC` nodes.** `parseCardAbilities` now requires the typed clauses from `parseCardEffects` and lowers every CST line into an `AbilityAst`. A lex error, parse error, missing lowered clause, or leftover `unparsedResidual` becomes a `DiagnosticAst` with a code. `inferFallbackTimings` and the deck-engine residual regexes are deleted. Shards must contain zero diagnostics, enforced by tests.
2. **Scoring reads only lowered nodes.** `detectEffectStyles` and `scoreSingleCardSignals` map steps, keywords and timings to styles and signals. The `(Trait) Unit` synergy regex on `card.effect` became a check on lowered target selectors.
3. **Vocabulary.** Build Deck Strategy: Rush / Aggro, Midrange / Value, Control / Attrition, Ramp / Big Unit, Link / Synergy Combo, Burn / Ping. Effect Style: Attack / Ping, Board / Deploy, Removal / Disrupt, Draw / Recursion, Resource / Ramp, Link / Synergy.
4. **Tempo becomes Attack / Ping** on the Hexagon (`HexagonAxes.tempo` to `attack`). Resource ramp credit moved to Card Liquidity. `normalizeBlueprint` upgrades persisted blueprints on load: legacy names map to the nearest new one, and a saved `targetHexagon.tempo` is dropped (not renamed) so `attack` takes its default.

## Considered Options

- **Keep regex as a last-resort fallback**: rejected; it hid parser gaps and could never be tested against the corpus.
- **Rewrite the legacy clause compiler on top of the CST**: rejected as out of scope; `effect-parser.ts` remains the step lowerer behind the CST gate.
- **Alias `tempo` to `attack` in the type**: rejected; two names for one axis would keep the old meaning alive.

## Consequences

- Saved decks keep their cards. Their blueprint is rewritten to the new names when next saved; an older build reading a new blueprint falls back to default strategy and drops unknown effect styles.
- Per-axis scores for Aggro, Defense, Synergy and Control are unchanged on the six starter decks; only the new Attack axis and ramp-heavy Liquidity moved.
- `PacingTier` keeps its `Midrange Tempo` option; it names a pacing curve, not an axis.
