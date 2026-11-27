# 0003. Chevrotain Pure-TS CFG Pipeline and Versioned CustomHook Escape Hatch

Status: accepted (extends ADR-0001, updates parser implementation in ADR-0002)

## Context

`ADR-0002` achieved full corpus coverage across `1,290` cards using a hand-written regex and recursive-descent TypeScript parser (`lib/effect-parser.ts`), while flattening **Replacement Effects** and **Continuous Modifiers** into `EffectStep[]` inside `EffectClause`. Maintaining regex precedence across expanding Gundam Card Game sets increases ambiguity risk and obscures layer/replacement boundaries, while runtime deployments on free-tier Vercel (and environments without a JVM) must run purely in Node/TypeScript with committed JSON **Effect Shards** (`ADR-0001`).

## Decision

1. Replace ad-hoc clause classification with a deterministic **pre-parse structural normalizer** (stripping parenthetical reminder text while keeping `(Trait)`/`(AP/HP)` tokens, propagating modal `■` headers, and normalizing glyphs such as `：`, `･`, and `①`–`⑩`) feeding a pure-TypeScript **Chevrotain LL(k) CFG lexer/parser** (`lib/cfg-parser.ts`).
2. Commit both the pure-TS Chevrotain parser and the compiled `data/effects/*.json` **Effect Shards** to the repository so CI runs `compile:effects` offline with zero JVM requirement anywhere (local, CI, or Vercel).
3. Split the top-level card ability AST (`abilities: AbilityAst[]`) additively into distinct kinds—**Effect Clause** (`EFFECT_CLAUSE`), **Replacement Effect** (`REPLACEMENT_EFFECT`), **Continuous Modifier** (`CONTINUOUS_MODIFIER`), and **CustomHook** (`CUSTOM_HOOK`)—while preserving `clauses` on `CompiledCardEffect` during migration; CI fails if any committed shard contains an unparsed clause or an unregistered `CustomHook` handler.

## Considered Options

- **ANTLR4 `.g4` codegen (`antlr4ng`)**: Requires Java (`java`) to regenerate `.ts` artifacts from `.g4`, which is unavailable in Java-free CI/dev containers; Chevrotain executes the same formal CFG directly in pure TypeScript.
- **Keep extending only the regex compiler (`lib/effect-parser.ts`)**: Rejected because precedence interactions across compound conditions, inline `instead` substitutions, and nested modal bullets grow brittle without a formal CFG.

## Consequences

- Zero JVM dependency across dev, CI, and Vercel deployments using the runnable Chevrotain CFG.
- Additive `abilities` field on `CompiledCardEffect` keeps existing `deck-engine.ts` and `sandbox-engine.ts` callers green while the chain verifier consumes `abilities` directly.
- Every newly synced card that falls outside the core CFG fails CI deterministically until either the CFG is extended or a tested `CustomHook` handler is registered.
