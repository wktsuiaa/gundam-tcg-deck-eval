# Gundam Deck Atlas

Deck construction, tactical profiling, and matchup evaluation for the Gundam Card Game.

## Language

**Strategy Blueprint**:
The complete set of player preferences and restrictions—target colors, pacing, trait focus, build strategy, effect styles, constraints, and hexagon weights—used to score recommendations and generate a deck.
_Avoid_: Filter preset, generator config

**Build Deck Strategy**:
The single primary tactical identity chosen by the player to guide how a generated deck wins (for example, Link-Strike or Repair Fortress).
_Avoid_: Tactical style, archetype tag (when referring to the player's generator selection rather than post-build deck analysis)

**Deck Tactical Profile**:
The one to three emergent tactical identities automatically inferred from the cards inside an assembled deck.
_Avoid_: Build Deck Strategy

**Effect Style**:
An optional card-effect mechanic category (up to two selected) used to weight recommendations and generated card picks toward specific gameplay effects.
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
A single ability unit on a card, scoped by a trigger timing or continuous state and composed of an optional activation cost or condition, a target selector, and a resolution action.
_Avoid_: Effect line, card rule, effect tag

**Keyword Ability**:
A standardized, angle-bracketed gameplay rule on a card (such as `<Blocker>`, `<Breach X>`, or `<Repair X>`) that carries fixed engine semantics independent of prose effect clauses.
_Avoid_: Effect Style, mechanic tag

**Effect Prerequisite**:
A condition or friendly card requirement inside an **Effect Clause**—such as a required friendly `(Trait)` Unit, Pilot, color, card type, or minimum card density in play or in the Trash—that must be supported by the deck or board state for the clause to resolve.
_Avoid_: Generation Constraint, Trait Focus

**Compiled Card Effect**:
The pre-compiled, deterministic record for a unique card number containing its **Keyword Abilities**, **Effect Clauses**, **Effect Prerequisites**, and synergy profile derived offline from raw catalog prose.
_Avoid_: Effect cache, parsed effect JSON, runtime IR

**Effect Shard**:
A set-prefix JSON file grouping **Compiled Card Effects** by card number prefix so reprints across multiple packages are stored once.
_Avoid_: Effect dump, effect collection, parsed shard
