# Spec: Fail-Closed Effect Clause Compiler, Enabler–Payoff Knowledge Map, and Rule-Faithful Sandbox Execution

## Problem Statement

Players evaluating cards, generating decks, and testing hands in the match sandbox receive inaccurate card classifications and rule-breaking board outcomes because the system previously read raw effect text with flat substring checks rather than parsing card grammar.

Specifically:
1. **Condition vs. Action Conflation (`ST09-006`)**: Cards with prerequisite conditions such as *"If you deploy this Unit from your trash, choose 1 enemy Unit that is Lv.3 or lower. Destroy it."* were tagged as `Trash Recursion` and `Liquidity Search` because `"from your trash"` appeared in the condition clause, inflating Card Liquidity and recommending the card as a general recursion/draw piece instead of a conditional removal payoff.
2. **Reminder-Text & Burst False Positives**: Parenthetical keyword reminders (such as `<Blocker>`'s *"change the attack target"* or `<Support>`'s *"Rest this Unit..."*) leaked into `Rest Lock` and `AP Deduction` counts, while `【Burst】Add this card to your hand.` triggers were misclassified as active `Draw & Search` card velocity.
3. **Unconditional, Guesswork Sandbox Resolution**: The match sandbox inferred card effects from `Effect Style` tags rather than parsed **Effect Clauses**, causing `ST09-006` to destroy enemy Units even when deployed from hand, ignoring target caps (`Lv.3 or lower`, `active`, `AP <= 4`), ignoring `【Activate･Main】` chains (`ST09-001` → `ST09-006`), and skipping conditional **Keyword Abilities** (`ST09-004` gaining `<Suppression>` while a friendly Base is in play).
4. **Missing Synergy Awareness**: Deck recommendations and combo detection could not link an Enabler card (e.g., deploying from Trash or fueling Trash count) with a conditional Payoff card whose Effect Clause depended on that state.

## Solution

Replace flat text substring matching across scoring, recommendations, and sandbox gameplay with a deterministic **Effect Clause** and **Keyword Ability** compiler backed by a sparse, high-signal Enabler ↔ Payoff Knowledge Map:

1. Compile raw card effect prose at runtime into typed `EffectClause` structures (separating timing headers, once-per-turn flags, activation costs, prerequisite conditions, target selectors, ordered resolution steps, and a fail-closed `unparsedResidual` field) alongside innate **Keyword Abilities**.
2. Strip parenthetical rules reminder text before parsing while preserving `(Trait)` tokens.
3. Drive **Effect Style** classification and single-card Hexagon scoring exclusively from parsed action steps (falling back only on `unparsedResidual`), applying a baseline discount to gated payoffs that recovers and boosts fit/coherence when a matching Enabler from the Knowledge Map is present.
4. Execute Match Sandbox triggers fail-closed from parsed **Effect Clauses**, tracking unit deployment origin (`hand` vs. `trash`) and per-turn activation state, enforcing target filters, prompting human players when multiple legal enemy targets exist, and logging explicit manual-resolution notices whenever a clause contains unparsed prose.

## User Stories

1. As a deck builder, I want cards with conditional prerequisites (such as *"If you deploy this Unit from your trash..."*) to be classified strictly by their resolved action rather than their prerequisite text, so that conditional payoffs do not pollute unrelated **Effect Style** filters or inflate Card Liquidity.
2. As a deck builder, I want parenthetical reminder text inside **Keyword Abilities** ignored during effect analysis, so that `<Blocker>` or `<Support>` units are not mislabeled as `Rest Lock`.
3. As a deck builder, I want `【Burst】Add this card to your hand.` effects excluded from active `Draw & Search` velocity tags, so that Burst pilots and commands do not distort my deck's draw consistency metrics.
4. As a deck builder, I want conditional payoff cards discounted in standalone scoring unless a matching Enabler is present in my deck or eligible card pool, so that build-around cards are recommended accurately alongside their enablers.
5. As a deck analyzer user, I want the playbook's Detected Combos & Synergies section to surface concrete Enabler ↔ Payoff Mechanic Chains (such as `Impulse Gundam` enabling `Sword Impulse Gundam`) alongside Link Pairs and Trait Formations, so that I understand why non-Link synergy cards belong together.
6. As a strategy generator user, I want recommendation reasons to explain when a candidate card unlocks or is unlocked by an Enabler or Payoff already in my deck, so that I can make informed swaps inside my **Strategy Blueprint**.
7. As a match sandbox player, I want `ST09-006` (*Sword Impulse Gundam*) deployed from my hand NOT to destroy an enemy Unit, so that sandbox play matches official Gundam Card Game rules.
8. As a match sandbox player, I want `【Activate･Main】` on `ST09-001` (*Impulse Gundam*) to pay `②`, return itself to the bottom of my deck, deploy `ST09-006` from my Trash with Trash origin recorded, and trigger `ST09-006`'s `【Deploy】` destruction against a `Lv.3 or lower` enemy Unit, so that multi-card recursion lines can be tested end-to-end.
9. As a match sandbox player, I want `【Activate･Main】` to remain unavailable and refuse cost payment when required Trash targets, board space, activation conditions, or once-per-turn limits are not met, so that I never waste Resources or Units on an illegal activation.
10. As a match sandbox player, I want target selectors (such as `active enemy Unit with 4 or less AP` or `all Units with 5 or less AP`) enforced strictly—including symmetrical AoE hitting eligible friendly Units—so that board trades and removal windows behave authentically.
11. As a match sandbox player, I want continuous conditional **Keyword Abilities** (such as `ST09-004` gaining `<Suppression>` only while a friendly Base is in play) evaluated dynamically on board state rather than statically, so that Base protection and shield pressure interact properly.
12. As a match sandbox player, I want an inline target-selection prompt when a targeted **Effect Clause** has two or more legal enemy Units (and automatic fizzle with zero prompt when zero legal targets exist), so that I control removal choices without unnecessary clicks.
13. As a match sandbox player, I want unparsed or bespoke card text to fail closed and record a `"Manual resolution required: ..."` entry in the match log rather than guessing an approximate effect, so that I can trust automated board changes and resolve edge cases manually.

## Implementation Decisions

1. **Domain Glossary Alignment**: Keep **Effect Style** reserved strictly for the 12 deck-building/scoring categories, and standardize **Effect Clause** and **Keyword Ability** in the domain glossary so parser, engine, and sandbox code share one vocabulary.
2. **Raw Card Shards Unchanged**: Keep official collection data shards untouched as raw ingested records and compile **Effect Clauses** deterministically at runtime, preserving parity with weekly catalog syncs without needing a generated schema migration.
3. **Fail-Closed Clause IR Shape** *(trimmed type shape from the parser prototype)*:
   ```ts
   export interface EffectClause {
     raw: string;
     timings: EffectTiming[];
     oncePerTurn: boolean;
     pairFilter?: { trait?: string; color?: CardColor; lvMin?: number; lvMax?: number };
     cost?: ActivationCost;
     condition?: EffectCondition;
     steps: EffectStep[];
     unparsedResidual: string;
   }
   ```
   - Reminder-text stripping removes nested parenthetical rules explanations while preserving short `(Trait)` and token stat tokens.
   - Multi-timing headers separated by `/` (e.g. `【Main】/【Action】`), `Lv.` abbreviations inside sentences, and `While <state> in play` phrasing are handled before step compilation.
   - Any sentence not matched cleanly is appended to `unparsedResidual` rather than guessed.
4. **Sparse High-Signal Knowledge Map** *(trimmed type shape from the synergy prototype)*:
   ```ts
   export type SynergyNodeKey =
     | 'DEPLOY_FROM_TRASH'
     | 'TRASH_COUNT_FUEL'
     | 'AP_THRESHOLD_5'
     | 'DAMAGED_ENEMY_TARGET'
     | 'RESTED_ENEMY_TARGET';

   export interface CardSynergyProfile {
     requires: SynergyNodeKey[];
     enables: SynergyNodeKey[];
   }
   ```
   - Intentionally excludes trivial universal nodes (such as owning any `Base`) to keep combo signals high-precision.
   - Integrates directly into existing combo lists and recommendation rationale without adding new UI tabs or panels.
5. **Conditional Discount & Residual-Only Fallback in Deck Scoring**:
   - **Effect Style** detection and single-card Hexagon signals inspect parsed `EffectClause` `steps` first; legacy regex checks run solely against `unparsedResidual` so parsed prerequisite conditions and reminder text can never trigger false tags.
   - Cards whose parsed steps are all gated behind `DEPLOYED_FROM_ZONE`, `TRASH_COUNT_AT_LEAST`, or `DEVELOPMENT_EXILE` receive a `0.5×` baseline discount on liquidity/control weights, restored and boosted when a matching Enabler is present.
6. **Sandbox State & Execution Semantics**:
   - Extend board Unit instances with `deployedFromZone?: 'hand' | 'trash'` and `activatedMainTurn?: number` so deployment-origin conditions and `Once per Turn` limits are enforced deterministically.
   - Evaluate continuous/pair/link `GRANT_KEYWORD` clauses dynamically against current match state during combat, blocking, shield resolution, and end-of-turn `<Repair>`.
   - Enforce cost, condition, `oncePerTurn`, board capacity, and Trash-target availability uniformly in both the UI readiness check and move application for `ACTIVATE_MAIN`.
   - When `DEPLOY_FROM_TRASH` chains into a `DEPLOY` trigger on the newly deployed Unit (e.g., `ST09-001` → `ST09-006`), the sandbox records a documented shortcut auto-selecting the highest-AP legal enemy target rather than opening a nested second target prompt.
   - Unimplemented niche step actions (`FREEZE`, `CANT_ATTACK`, `ALLOW_ATTACK_ACTIVE`, `DAMAGE_PROOF`, `COST_REDUCTION`, `REVEAL_TOP`, `RETURN_TO_DECK`) parse for deck scoring and no-op safely in the sandbox without crashing.

## Testing Decisions

Good tests in this feature verify external domain behavior against real official card text and board states rather than internal regex structure or helper call counts.

1. **Test Seam 1 — Effect Clause Compiler & Full-Corpus Audit**:
   - Tests the clause compiler public entry point against canonical cards (`ST09-006`, `ST09-001`, `ST09-003`, `ST09-004`, `ST04-010`, `GD01-054`, `GD06-050`) asserting exact timings, costs, conditions, target selectors, and empty residuals.
   - Runs a full-corpus invariant test across all 1,278 unique base cards in the official collection shards verifying zero crashes, zero reminder-text leaks, and at least 80% full clause parse coverage.
2. **Test Seam 2 — Deck Scoring, Corpus False-Positive Guard & Knowledge Map**:
   - Extends the existing deck-engine test suite (prior art: existing `detectEffectStyles` and strategy generation tests) to verify `ST09-006` classifies strictly as `['Destroy']` with conditional discounting, `ST04-010` excludes `Draw & Search`, `<Blocker>`/`<Support>` reminder text excludes `Rest Lock`, zero false positives occur across the full 1,278-card corpus, and Knowledge Map recommendations boost `ST09-001` + `ST09-006` together.
3. **Test Seam 3 — Fail-Closed Sandbox Execution & Rule Conformance**:
   - Extends the existing sandbox test suite (prior art: existing match initialization and turn-step tests) to verify `ST09-006` from hand does not destroy enemies, `ST09-001` → `ST09-006` from Trash destroys `Lv.<=3` while sparing `Lv.4+`, `ST09-001` activation is blocked when Trash lacks a valid target, `ST09-003` damages eligible friendly and enemy Units symmetrically, `ST09-004` `<Suppression>` depends on a friendly Base, `ST09-009` enforces active/AP≤4 filters, and unparsed prose fails closed with `"Manual resolution required"`.

## Out of Scope

- Automated runtime execution of official card FAQs (`334` card FAQs / `119` general FAQs); FAQs remain a design reference and UI inspection payload.
- Full turn-scoped enforcement of niche defensive/freeze flags (`FREEZE`, `CANT_ATTACK`, `DAMAGE_PROOF`, `COST_REDUCTION`, `RETURN_TO_DECK`) in the Match Sandbox.
- Nested two-step human target prompting for chained `ACTIVATE_MAIN` → `DEPLOY_FROM_TRASH` → `DEPLOY` sequences.
- Adding separate Knowledge Map graph visualization panels or modifying raw collection JSON schemas.

## Further Notes

- Empirical baseline across the synced catalog (`1,278` unique base cards, `1,112` with non-empty effects, `1,405` clauses) measured `81.1%` (`1,140 / 1,405`) full clause compilation with `0` reminder leaks and reduced corpus misclassifications on Burst hand-adds, reminder text, and Trash-condition payoffs from `130`, `216`, and `5` respectively down to `0` each.
- Recommended issue tracker target: `wktsuiaa/gundam-tcg-deck-eval` with triage label `ready-for-agent`.
