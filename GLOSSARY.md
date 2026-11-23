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
