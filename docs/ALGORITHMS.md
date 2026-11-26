# Calculations & Algorithms

## 1. 6-Axis Hexagon Scoring (`computeHexagonAndBreakdowns`)

Every deck is evaluated across six normalized `0–100` axes derived from individual card signals (`scoreSingleCardSignals`):

- **Aggro / Pressure**: Rewards Cost ≤ 2 Units, high `AP / Cost` ratios (`≥ 1.5`), `<Breach>`, `<First Strike>`, `<High-Maneuver>`, and `【Attack】` triggers.
- **Defense / Durability**: Rewards high `HP / Cost` ratios, `<Blocker>`, `<Repair>`, `DAMAGE_PROOF` steps, and Base cards.
- **Attack / Ping**: Rewards lowered `DEAL_DAMAGE` steps (direct damage), `<Breach>`, `<First Strike>`, `<High-Maneuver>`, `<Suppression>`, `【Attack】` triggers, positive `MODIFY_AP`, and high-AP Units / Pilots. Driven by lowered AST nodes and card attributes, never by raw card text.
- **Card Liquidity**: Rewards direct card draw (`DRAW`), deck filtering/search (`LOOK_TOP`, `REVEAL_TOP`), Trash recursion, and Resource ramp / cost reduction (`ADD_RESOURCE`, `COST_REDUCTION`).
- **Synergy / Link**: Combines **Link Coverage %** (percentage of Link Units in the deck with a matching Pilot via `doesPilotLinkUnit`), Pilot density, shared Trait density, and `<Support>`.
- **Control / Disruption**: Rewards Command density, `REST` / `FREEZE`, negative `MODIFY_AP`, `BOUNCE`, `DEAL_DAMAGE`, and `DESTROY` steps.

## 2. Effect Style Detection (`detectEffectStyles` & lowered AST)

Card effect text is lowered offline (see [architecture](architecture.md#effect-lowering-pipeline)) into typed abilities. `detectEffectStyles` and `scoreSingleCardSignals` read only the lowered steps, keywords, and timings. They never regex the prose; text the lowering could not understand appears as a `DIAGNOSTIC` ability and contributes nothing.

Each lowered step maps to at most one Effect Style (`effectStyleOfStep`):

| Effect Style | Lowered source |
| --- | --- |
| `Attack / Ping` | `DEAL_DAMAGE`; keywords `<Breach>`, `<First Strike>`, `<High-Maneuver>`, `<Suppression>` |
| `Board / Deploy` | `DEPLOY_TOKEN`, `DAMAGE_PROOF`, `RECOVER_HP`; keywords `<Blocker>`, `<Repair>` |
| `Removal / Disrupt` | `DESTROY`, `BOUNCE`, `REST`, `FREEZE`, `MODIFY_AP` with negative delta |
| `Draw / Recursion` | `DRAW`, `LOOK_TOP`, `REVEAL_TOP`, `ADD_FROM_TRASH_TO_HAND`, `DEPLOY_FROM_TRASH` |
| `Resource / Ramp` | `ADD_RESOURCE`, `COST_REDUCTION` |
| `Link / Synergy` | pair or link timings, `PAIR_SELF_FROM_TRASH`, `PAIR_FROM_HAND`, `<Support>` |

- Steps behind a density gate (for example `ST09-006`) get a `0.5×` baseline discount unless an Enabler from `extractSynergyProfile` is present.
- Selecting up to 2 Effect Styles in `StrategyBlueprint` awards `+18` fit points per matched style on candidate cards. Self-mill / discard `TRASH_COUNT_FUEL` enablers (such as `GD04-116`) also earn `+18` when `Draw / Recursion` is selected or `DEPLOY_FROM_TRASH` payoffs exist in the deck.

## 2b. Build Deck Strategies

`Rush / Aggro`, `Midrange / Value`, `Control / Attrition`, `Ramp / Big Unit`, `Link / Synergy Combo`, `Burn / Ping`. Each blends a `targetBias` into the target hexagon (`blendTargetHexagon`) and adds a per-card bonus from `STRATEGY_FIT_RULES`. `analyzeDeck` infers up to three of them as the **Deck Tactical Profile** from the finished deck.

Saved blueprints written before this vocabulary are upgraded on load by `normalizeBlueprint` (legacy strategy and effect-style names map to the nearest new one; `targetHexagon.tempo` is dropped and `attack` takes its default, because the two axes measure different things).

## 3. Trait Coherence, Effect Prerequisites & Knowledge Map Enablers (Series & FAQs Excluded)

In `getRecommendedCardsForStrategy`:
- **Strict Scope**: Card **Series (`sourceTitle`)** and **Official Card FAQs (`faqs`)** are intentionally **excluded** from all recommendation, coherence, and constraint calculations. FAQs are stored purely for display in `CardDetailDrawer` and `RulesModal`.
- **Trait Coherence**: Awards `+56` coherence to `UNIT` / `PILOT` / `BASE` cards (and `+32` to `COMMAND` cards, keeping generic staples competitive) when matching any selected `traitFocus` (OR logic), up to `+28` proportional to shared Trait frequency with cards already in the deck (`sharedTraitHits × 4`), and `+20` when a card's effect tutors/buffs a Trait cluster present in the deck.
- **Pilot–Unit Linkage Coherence**: Awards `+36` (`+6` per additional matching partner up to `+18`) when a Pilot links with Units already in the deck (or `+34` for a Link Unit matching Pilots in the deck).
- **Effect Prerequisite Enforcement (`extractEffectPrerequisites`)**:
  - `4` copies minimum for single-target / pair prerequisites (e.g., `(MF) Unit`, `Purple Pilot`, `(ZAFT) Link Unit`).
  - `8` copies minimum for density, deck search (`LOOK_TOP (Trait)`), Trash recursion (`DEPLOY_FROM_TRASH` / `ADD_FROM_TRASH_TO_HAND`), Trash-count (`TRASH_COUNT_AT_LEAST`), or mill-scaling effects (`GD04-116`).
  - Against a populated deck (`currentEntries.length > 0`), unmet `primaryClause` prerequisites apply a `-70` fit penalty (`-30` for secondary bonuses like `GD05-121` or `GD04-114`) with an explicit `Requires (...)` reason, while Enablers that satisfy a chosen card's missing **Effect Prerequisite** gain up to `+30` coherence. Against an empty deck (`[]`), Trait prerequisites check eligibility within `focusPool` (if `traitFocus` is set) or the constrained pool.

## 4. Constraint Filtering & 3-Pass Strategy Generation (`generateStrategyDeck`)

1. `filterPoolByConstraints` filters unique base prints by `allowedPackageCodes`, `maxCost`, `maxLv`, `rarityCap`, target `colors`, and `strictTraitLinkLock` (which restricts to any selected `traitFocus` via OR logic + their Link partners, or Link-capable Unit/Pilot pairs if no trait is chosen).
2. `evaluateConstraintFeasibility` verifies that at least 50 Main Deck card slots are reachable under `maxCopiesPerCard`.
3. If `colors` is empty (**Any — Auto Best 2**), all 10 two-color combinations (`Blue`, `Green`, `Red`, `Purple`, `White`) are scored on their top 25 recommended cards, and the highest-scoring legal pair is selected.
4. **3-Pass Sequential Selection** prevents empty-deck scoring from importing dead-brick Commands:
   - **Pass 1 (Units)**: Ranks against the pool & `traitFocus` and fills Cost ≤ 2 early Units + curve Units while skipping `primaryClause`-blocked Units.
   - **Pass 2 (Pilots & Bases)**: Re-scores candidates via `getRecommendedCardsForStrategy` against chosen Units, prioritizing Pilots that `[Link]` (`+35` per matched Unit) or unlock a chosen Unit's **Effect Prerequisite** (`+50`).
   - **Pass 3 (Commands & Fill)**: Re-scores remaining candidates against chosen Units + Pilots + Bases, selecting legal Commands (`unmetPrimary === false`) up to target Command count, filling remaining slots cleanly, and falling back to gated cards only if the constrained pool cannot reach 50 cards otherwise.

## 5. Hypergeometric Odds & Turn-by-Turn Win Chance (`computeTurnWinChances`)

- Opening hand probabilities use exact combinatorics (`hypergeometricAtLeast(50, S, 5, 1)`).
- For Turns `t = 1..6`:
  - `cardsSeen = 5 + (turnOrder === 'second' ? 1 : 0) + (t - 1)`.
  - `effectiveLv = turnOrder === 'second' && t <= 4 ? t + 1 : t`.
  - Combines **Matchup Edge** (`evaluateMatchupBetween`), **Opening Hand State offset** (`optimal +11`, `average 0`, `mulliganed -9`), **Curve Hit %**, **Link-Pair Readiness %**, and **Pacing Tempo Delta** clamped to `[14%, 90%]`.

## 6. Match Sandbox Best-Move Advisor (`evaluateSandboxBestMoves`)

Enumerates all legal `MAIN` phase actions for the active side (`DEPLOY_UNIT`, `PAIR_PILOT`, `DEPLOY_BASE`, `PLAY_COMMAND`, `ATTACK_SHIELD`, `ATTACK_UNIT`, `PASS_TURN`), simulates tactical value (lethal shield detection, `[Link]` immediate-attack haste, `<Blocker>` walls, favorable trades preserving `<First Strike>`, and Command removal targeting the opponent's highest-AP Unit), and ranks the Top 3 moves with Win-Chance delta (`winDeltaPct`).
