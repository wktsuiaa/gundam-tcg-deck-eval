# Spec: Effect Prerequisite Enforcement, Trait Focus Cohesion & 3-Pass Strategy Deck Builder

## Problem Statement

When generating a deck under a **Strategy Blueprint** configured with **Colors** `Purple + Red`, **Pacing** `Midrange Tempo`, **Trait Focus** `ZAFT`, **Build Deck Strategy** `Balanced Midrange`, and **Effect Styles** `Destroy` + `Trash Recursion`, the Deck Builder recommended unusable dead-brick cards (`3x GD05-112` *Hoka Kyoten Juzetsujin* and `3x GD05-113` *Rose Screamer*) alongside off-archetype fillers (`GD03-055` *Gundam Hajiroboshi*), while omitting native `(ZAFT)` self-mill enablers (`GD04-116` *Reliable Big Brother*).

Four interacting root causes produced this behavior:
1. **Self-Pairing Misclassification**: `"pair this card from your trash"` on G-Gundam Commands (`GD05-112`, `GD05-113`, `GD05-121`, `GD05-122`, `GD06-119`) was parsed as a generic `Trash Recursion` Pilot deployment (`DEPLOY_FROM_TRASH`), dropping the `(MF)` target restriction and adding an artificial `+18` fit bonus and `hasSearch` liquidity inflation.
2. **Missing Effect Prerequisite Enforcement**: Deck scoring and generation never verified whether a candidate's **Effect Prerequisite** (such as requiring friendly `(MF)` Units, `(Zeon)` Units, `(Neo Zeon)` Pilots, or sufficient Trash density) was supported by enablers in the chosen deck or **Trait Focus** pool.
3. **Single-Pass Static Deck Generation**: `generateStrategyDeck` ranked every card type once against an empty deck (`[]`), preventing chosen Units from gating or informing downstream Pilot, Base, and Command picks.
4. **Underweighted Trait Core & Missing Self-Mill Synergy**: `Trait Focus` added `+32` coherence (`+20.8` net fit) across all card types, letting off-trait Units outscore native `ZAFT` options, while self-mill `TRASH_COUNT_FUEL` cards received no bonus from `Trash Recursion` / `DEPLOY_FROM_TRASH` demand.

## Solution

Compile card-level **Effect Prerequisites**, calibrate copy thresholds across a 50-card deck, elevate **Trait Focus** core cohesion on deck bodies, credit self-mill Trash setup, and split strategy generation into 3 sequential passes:

1. **Dedicated `PAIR_SELF_FROM_TRASH` Clause Step**: Parse `"pair this card from your trash"` into its own typed action carrying the friendly `(Trait)` Unit selector (`owner: 'SELF', cardType: 'UNIT', zone: 'BATTLE_AREA'`), classify it under Synergy/Aggro rather than `Trash Recursion` or deck search, and execute it fail-closed in the Match Sandbox only when an unpaired matching Unit is in play.
2. **Typed Effect Prerequisite Extraction & Thresholds**: Extract structured `TRAIT`, `COLOR`, `CARD_TYPE`, and `NAME` prerequisites from pair filters, Trash/Unit conditions, self-targeted steps, top-deck searches, friendly-trait clauses, and mill-scaling text, distinguishing `primaryClause` cards (which do nothing without enablers, e.g., `GD05-112`, `GD05-113`) from secondary bonus cards (e.g., `GD05-121`, `GD04-114`).
3. **3-Pass Strategy Generation & Enabler Discovery**:
   - **Pass 1** selects Units against pool & **Trait Focus** alignment (skipping `primaryClause`-blocked Units).
   - **Pass 2** re-scores Pilots and Bases against the chosen Units, boosting Pilots that `[Link]` or satisfy a chosen Unit's **Effect Prerequisite**.
   - **Pass 3** re-scores Commands and remaining fill slots against chosen Units, Pilots, and Bases, disqualifying `primaryClause` cards with unmet prerequisites (falling back only if a tight constraint pool cannot otherwise reach 50 cards).
4. **Self-Mill Synergy & Trait Core Priority**: Award Trash-setup fit credit to `TRASH_COUNT_FUEL` enablers (`MILL`, `DISCARD`, `LOOK_TOP` with Trash rest) when `Trash Recursion` or `DEPLOY_FROM_TRASH` is active, and raise `Trait Focus` coherence on Units, Pilots, and Bases (`+56`) while leaving traitless staple Commands unpenalized.

## Clarifying Decision Record (Including Q6)

### Q6 — *"What is the count (`4` vs. `8`) for?"*

The counts (`4` and `8`) are **minimum total enabler copy thresholds** in a **50-card Main Deck** needed for a conditional **Effect Prerequisite** card to function reliably during an actual match, derived from 50-card hypergeometric opening-hand/turn-draw probabilities:

| Threshold (`minCopies`) | Prerequisite Kind | Examples | Mathematical Rationale (50-Card Deck) |
| :--- | :--- | :--- | :--- |
| **`4` copies** | Single-target / Pair-timing prerequisite | `(MF) Unit`, `Purple Pilot`, `(ZAFT) Link Unit`, `"Shinn Asuka"` Pilot | You only need **1** partner on board at any time. Seeing **7–9 cards by Turn 3–4** (5 starting hand + 2–4 draws) yields `1 - C(46, 8) / C(50, 8) = 51.6%` (`8` cards seen) to `56.0%` (`9` cards seen) odds of finding at least 1 enabler; with `< 4` copies, odds collapse under ~42% and the card frequently strands in hand. |
| **`8` copies** | Density / Top-deck Search / Trash-count / Mill-scaling prerequisite | `LOOK_TOP (Trait)`, `DEPLOY_FROM_TRASH (Trait)`, `ADD_FROM_TRASH_TO_HAND (Trait)`, `TRASH_COUNT_AT_LEAST` color/trait, mill-scaling (`GD04-116`) | Effects that check the **top 2–5 cards** (`GD04-116` mills 2; `LOOK_TOP` checks 3–5) or demand **3–5 matching cards in Trash** need high deck concentration rather than a single draw. On a 5-card look, `4` copies whiff `54.7%` of the time (`1 - C(46, 5) / C(50, 5) = 35.7%` hit), whereas **`8` copies** hit **at least once `60.2%`** of the time on top-5, ~`30%+` per top-2 mill, and reach 3–5 Trash copies reliably by midgame. |

- When scoring against an **already-populated deck** (`currentEntries.length > 0`, including Pass 2 & Pass 3 of `generateStrategyDeck`), total matching copies in the deck are compared directly against `minCopies` (`4` or `8`).
- When scoring against an **empty deck** (`currentEntries.length === 0`, e.g., initial Strategy Blueprint browse before Units are picked), Trait prerequisites verify support inside the `Trait Focus` pool (or distinct card minimums `>= 1` / `>= 2` across the legal pool when no **Trait Focus** is active).

### Agreed Design Scope (Q1–Q9)
- **Q1 (Disqualification & Penalty)**: Disqualify unmet `primaryClause` cards in `generateStrategyDeck` (with constrained-pool fallback only if <50 cards would be reachable) and apply `-70` fit (`-30` secondary) in `getRecommendedCardsForStrategy`, keeping traitless removal staples (`ST09-009`, `ST05-014`) unpenalized.
- **Q2 (Multi-Pass Ordering)**: Units (Pass 1) → Pilots/Bases (Pass 2) → Commands/Fill (Pass 3).
- **Q3 (`PAIR_SELF_FROM_TRASH`)**: Dedicated `EffectStep` tagged as Synergy/Aggro (not `Trash Recursion` or `hasSearch`).
- **Q4 (Self-Mill Enablers)**: Credit `TRASH_COUNT_FUEL` cards when `Trash Recursion` or `DEPLOY_FROM_TRASH` payoffs are present.
- **Q5 (Glossary)**: Standardize **Effect Prerequisite** in the canonical domain glossary.
- **Q6 (Thresholds)**: Enforce `4` copies for single-target/pair gates and `8` copies for search/Trash/mill-scale gates.
- **Q7 (Trait Core Cohesion)**: Prototype and calibrate `+56` coherence for `UNIT`/`PILOT`/`BASE` matching `Trait Focus`, leaving `COMMAND` at `+32`.
- **Q8 (Sandbox Conformance)**: Execute `PAIR_SELF_FROM_TRASH` fail-closed onto matching unpaired friendly Units only.
- **Q9 (Documentation)**: Document updated scoring/generation rules alongside this clarifying record.

## User Stories

1. As a deck builder using **Trait Focus** `ZAFT` with `Destroy` & `Trash Recursion`, I want `(MF)`-only Commands (`GD05-112`, `GD05-113`), `(Zeon)` recursion (`GD06-116`), and `(Neo Zeon)` search (`GD05-115`) excluded from my generated deck unless matching enablers exist in the deck, so that every card in my 50-card list is playable.
2. As a strategy browser viewing recommendations against an empty or partial deck, I want cards with unmet **Effect Prerequisites** clearly penalized with a `Requires (...)` explanation while generic removal staples remain highly ranked, so I understand why niche build-arounds are suppressed.
3. As a `Trash Recursion` player, I want self-mill / Trash-setup enablers matching my deck's trait (such as `GD04-116` *Reliable Big Brother*) rewarded alongside recursion payoffs, so that my Trash conditions come online consistently.
4. As a Match Sandbox player, I want `PAIR_SELF_FROM_TRASH` Commands to attach themselves from Trash onto eligible unpaired friendly Units (and stay in Trash if none qualify), so that playtesting mirrors official rules.

## Prototype Experiment & Calibrated Constants

Three **Trait Focus** coherence levels (`48`, `56`, `62`) paired with prerequisite penalties (`-55/-25`, `-70/-30`, `-85/-35`) were evaluated across 5 blueprints (`Purple/Red ZAFT`, `White/Red Orb`, `Green/Blue Operation Meteor`, `Red/White MF`, `Purple/Green Zeon`) on the full `1,278`-card catalog:
- **Observed Baseline (`traitBoost = 48`)**: `59%` average **Trait Focus** share (`39/50` in `ZAFT`), `2` unmet primary prerequisites across 5 decks.
- **Observed Calibrated (`traitBoost = 56`, `-70 / -30`, 3-pass + plural anaphora fix)**: Raised average target-trait share (`39/50 → 50/50` in `Purple/Red ZAFT`), reached `69%` Link coverage in `ZAFT`, and dropped unmet `primaryClause` bricks to `0` on `Purple/Red ZAFT`, `White/Red Orb`, `Green/Blue Operation Meteor`, and `Red/White MF` (`50/50` legal across all 5 blueprints). Raising `traitBoost` further to `62` yielded zero additional gain (`62%` plateau), establishing `56` (`-70` primary / `-30` secondary) as the recommended balanced calibration.

## Testing Decisions

1. **Parser & Corpus Prerequisites**: Assert `GD05-112` / `GD05-113` compile `PAIR_SELF_FROM_TRASH` with `(MF)` (`minCopies: 4, primaryClause: true`), `GD05-121` marks `(MF)` as secondary (`primaryClause: false`), `GD04-116` extracts `(Minerva Squad)` (`minCopies: 8`), and plural anaphora (`they`) plus `friendly (Trait)` clauses preserve target selectors across the `1,278`-card catalog.
2. **Recommendation & 50-Card Strategy Builder**: Assert `GD05-112` / `GD05-113` lose `Trash Recursion` / `hasSearch` tags, unmet `(MF)`/`(Zeon)`/`(Neo Zeon)` commands are penalized behind generic removal and `GD04-116`, and the generated `Purple/Red ZAFT` 50+10 deck contains zero `(MF)` / `(Zeon)` / `(Neo Zeon)` bricks with every `primaryClause` prerequisite satisfied (`>= minCopies`).
3. **Sandbox Conformance**: Assert `GD05-112` pairs itself from Trash onto an unpaired `(MF)` Unit and remains in Trash when only a `(ZAFT)` Unit is in play.

## Out of Scope

- Full runtime automation of multi-subtrait sub-deck reservation during Pass 1 when a sub-trait pool (e.g., `(Cyclops Team)` inside `(Zeon)`) occupies fewer than 10% of the focused trait pool.
- Exposing custom user sliders for minimum hypergeometric copy thresholds (`4` vs. `8`) in the **Strategy Blueprint** UI.
