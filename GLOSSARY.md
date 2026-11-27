# Gundam Deck Atlas

Deck construction, tactical profiling, and matchup evaluation for the Gundam Card Game.

## Language

**Strategy Blueprint**:
The complete set of player preferences and restrictions—target colors, pacing, trait focus, build strategy, effect styles, constraints, and hexagon weights—used to score recommendations and generate a deck.
_Avoid_: Filter preset, generator config

**Build Deck Strategy**:
The single primary tactical identity chosen by the player to guide how a generated deck wins (one of Rush / Aggro, Midrange / Value, Control / Attrition, Ramp / Big Unit, Link / Synergy Combo, or Burn / Ping).
_Avoid_: Tactical style, archetype tag (when referring to the player's generator selection rather than post-build deck analysis)

**Deck Tactical Profile**:
The one to three emergent tactical identities automatically inferred from the cards inside an assembled deck.
_Avoid_: Build Deck Strategy

**Effect Style**:
An optional card-effect mechanic category (Attack / Ping, Board / Deploy, Removal / Disrupt, Draw / Recursion, Resource / Ramp, or Link / Synergy; up to two selected) used to weight recommendations and generated card picks toward specific gameplay effects.
_Avoid_: Keyword filter, mechanic tag

**Generation Constraint**:
A hard rule limiting which cards are eligible for recommendations and deck generation, such as allowed sets, copy limits, cost or level caps, rarity caps, or strict trait/link locking.
_Avoid_: Soft preference, recommendation weight

**Pool Feasibility**:
Whether the eligible card pool remaining after applying all Generation Constraints can legally form a 50-card Main Deck under the configured copy limit.
_Avoid_: Deck legality

**Trait Focus**:
An optional multi-select set of card traits (matched with OR logic) used to anchor coherence scoring and strict trait/link locking during recommendations and deck generation.
_Avoid_: Series filter, Faction lock

**Effect Clause**:
A single triggered or activated ability unit on a card, scoped by a timing header or **Trigger Event** and composed of an optional **Link Requirement**, **Guard Condition**, activation cost, target selector, and ordered resolution steps (including conditional *"instead"* upgrades).
_Avoid_: Effect line, card rule, effect tag

**Replacement Effect**:
A rule on a card that intercepts a specific game event before it resolves and substitutes a structured alternative outcome (for example, preventing damage or resting another permanent *"instead"*), applying at most once per event instance.
_Avoid_: Interrupt trigger, prevent step, continuous redirect

**Continuous Modifier**:
A passive, state-evaluated rule active while its source remains in scope and its **Guard Condition** holds—such as stat adjustments, keyword or trait grants, cost reductions, or `"can't"` prohibitions with structured source filters.
_Avoid_: Static trigger, continuous clause, passive step

**Trigger Event**:
The explicit gameplay occurrence inside an **Effect Clause** (such as being attacked, destroying an enemy card with battle damage, or recovering HP) that fires the clause when that event happens, distinct from passive state prerequisites.
_Avoid_: Inline when condition, continuous trigger, raw condition

**Guard Condition**:
The state prerequisite checked before an **Effect Clause** or conditional sub-step resolves (such as turn ownership, friendly Trait presence, hand size, or Trash count), evaluated independently of what **Trigger Event** fires the clause.
_Avoid_: Trigger text, raw condition, inline prefix

**Link Requirement**:
The explicit Pilot-to-Unit pairing criteria attached to a Link-gated **Effect Clause**, identifying the Pilot names or Traits a Unit requires or that a Pilot satisfies when linked.
_Avoid_: Link label, raw link text, pair filter

**Pair Filter**:
A Pilot trait, color, or level restriction on a pair-gated **Effect Clause** specifying which Pilots activate that clause when paired with a Unit.
_Avoid_: Link Requirement, pair condition

**Command Pilot**:
A Command card carrying a Pilot mode declaration that allows it to pair with a Unit in the Battle Area and satisfy matching **Link Requirements** as a Pilot.
_Avoid_: Hybrid command, pilot command card

**Keyword Ability**:
A standardized, angle-bracketed gameplay rule on a card (such as `<Blocker>`, `<Breach X>`, or `<Repair X>`) that carries fixed engine semantics independent of prose effect clauses.
_Avoid_: Effect Style, mechanic tag

**Effect Prerequisite**:
A condition or friendly card requirement inside an **Effect Clause**—such as a required friendly `(Trait)` Unit, matching **Link Requirement**, color, card type, or minimum card density in play or in the Trash—that must be supported by the deck or board state for the clause to resolve.
_Avoid_: Generation Constraint, Trait Focus

**Compiled Card Effect**:
The pre-compiled, deterministic record for a unique card number containing its **Keyword Abilities**, lowered ability nodes, **Effect Prerequisites**, and synergy profile derived offline solely from structured syntax **Lowering**.
_Avoid_: Effect cache, parsed effect JSON, runtime IR

**Effect Shard**:
A set-prefix JSON file grouping **Compiled Card Effects** by card number prefix so reprints across multiple packages are stored once.
_Avoid_: Effect dump, effect collection, parsed shard

**Action Step**:
A rule-defined combat or end-of-turn window during which players may activate `【Action】` abilities or `<Blocker>` one at a time without forming a response stack.
_Avoid_: Response window, stack phase, priority pass

**Chain Witness**:
The explicit player choices, target selections, and top-of-deck card assumptions supplied to verify whether a multi-card play line is legally executable without nondeterministic branching.
_Avoid_: Replay log, mock RNG, symbolic branch

**Chain Preview**:
A non-destructive dry-run resolution trace of a pending move or multi-card play line showing cost checks, pre-commit **Replacement Effects**, Turn Player-first **Effect Clauses**, **Action Steps**, and required **Chain Witness** assumptions.
_Avoid_: Stack preview, response queue, live simulation

**Attack / Ping Axis**:
The Hexagon axis that replaced Tempo. It scores effect-driven damage, evasive or breaching **Keyword Abilities**, attack triggers, and high-AP bodies, read from lowered **Effect Clause** steps and card attributes.
_Avoid_: Tempo, Aggro (Aggro scores raw curve and combat stats, not effect damage)

**Lowering**:
The offline pass that parses normalized card prose with a context-free grammar into a concrete syntax tree and lowers every branch directly into typed ability nodes stored in a **Compiled Card Effect**, retaining raw line text for human debugging only.
_Avoid_: Regex fallback, text parsing at runtime

**Lowering Diagnostic**:
An explicit `DIAGNOSTIC` ability node recording a line that **Lowering** could not lex, parse, or fully resolve (`LEX_ERROR`, `PARSE_ERROR`, `NO_LOWERING`, `UNPARSED_RESIDUAL`), so gaps are visible in data and tests instead of silently dropped.
_Avoid_: Parse warning, error log
