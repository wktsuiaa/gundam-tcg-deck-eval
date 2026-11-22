# Calculations & Algorithms

## 1. 6-Axis Hexagon Scoring (`computeHexagonAndBreakdowns`)

Every deck is evaluated across six normalized `0–100` axes derived from individual card signals (`scoreSingleCardSignals`):

- **Aggro / Pressure**: Rewards Cost ≤ 2 Units, high `AP / Cost` ratios (`≥ 1.5`), `<Breach>`, `<First Strike>`, `<High-Maneuver>`, and `【Attack】` triggers.
- **Defense / Durability**: Rewards high `HP / Cost` ratios, `<Blocker>`, `<Repair>`, Damage Proof effects (`reduce ... damage`, `cannot be destroyed`), and Base cards.
- **Tempo / Resource**: Rewards smooth early curve (`Lv ≤ 3, Cost ≤ 2`), Resource Ramp / cost reduction, Token/Extra Deploy, and proximity to an efficient average cost (`2.3`).
- **Card Liquidity**: Rewards direct card draw (`draw N`, `add to hand`), deck filtering/search (`look at top`, `reveal`, `search`), and Trash recursion.
- **Synergy / Link**: Combines **Link Coverage %** (percentage of Link Units in the deck with a matching Pilot via `doesPilotLinkUnit`), Pilot density, shared Trait density, and `<Support>`.
- **Control / Disruption**: Rewards Command density, Rest effects, AP Deduction, Bounce, Direct Damage, and Destroy effects.

## 2. Effect Style Detection (`detectEffectStyles`)

Card effect text is classified into 12 tactical Effect Styles using deterministic pattern rules (`AP Deduction`, `Destroy`, `Damage Proof`, `Repair`, `Bounce`, `Rest Lock`, `Direct Damage`, `Draw & Search`, `Trash Recursion`, `Resource Ramp`, `Combat Keywords`, `Token Deploy`). Selecting Effect Styles in `StrategyBlueprint` awards `+18` fit points per matched effect style on candidate cards.

## 3. Trait + Linkage Coherence Scoring (Series & FAQs Excluded)

In `getRecommendedCardsForStrategy`:
- **Strict Scope**: Card **Series (`sourceTitle`)** and **Official Card FAQs (`faqs`)** are intentionally **excluded** from all recommendation, coherence, and constraint calculations. FAQs are stored purely for display in `CardDetailDrawer` and `RulesModal`.
- **Trait Coherence**: Awards up to `+32` when matching `traitFocus`, up to `+28` proportional to shared Trait frequency with cards already in the deck (`sharedTraitHits × 4`), and `+20` when a card's effect tutors/buffs a Trait cluster present in the deck.
- **Pilot–Unit Linkage Coherence**: Awards `+36` (+6 per additional matching partner up to `+18`) when a Pilot links with Units already in the deck (or `+34` for a Link Unit matching Pilots in the deck).

## 4. Constraint Filtering & Auto Best-2 Generation (`generateStrategyDeck`)

1. `filterPoolByConstraints` filters unique base prints by `allowedPackageCodes`, `maxCost`, `maxLv`, `rarityCap`, target `colors`, and `strictTraitLinkLock` (which restricts to selected `traitFocus` + its Link partners, or Link-capable Unit/Pilot pairs if no trait is chosen).
2. `evaluateConstraintFeasibility` verifies that at least 50 Main Deck card slots are reachable under `maxCopiesPerCard`.
3. If `colors` is empty (**Any — Auto Best 2**), all 10 two-color combinations (`Blue`, `Green`, `Red`, `Purple`, `White`) are scored on their top 25 recommended cards, and the highest-scoring legal pair is selected.
4. Slots are filled deterministically according to pacing ratios (early Cost ≤ 2 Units, curve Units, Link-matched Pilots, Bases, Commands) followed by top-fit fill up to 50 Main + 10 Resource cards.

## 5. Hypergeometric Odds & Turn-by-Turn Win Chance (`computeTurnWinChances`)

- Opening hand probabilities use exact combinatorics (`hypergeometricAtLeast(50, S, 5, 1)`).
- For Turns `t = 1..6`:
  - `cardsSeen = 5 + (turnOrder === 'second' ? 1 : 0) + (t - 1)`.
  - `effectiveLv = turnOrder === 'second' && t <= 4 ? t + 1 : t`.
  - Combines **Matchup Edge** (`evaluateMatchupBetween`), **Opening Hand State offset** (`optimal +11`, `average 0`, `mulliganed -9`), **Curve Hit %**, **Link-Pair Readiness %**, and **Pacing Tempo Delta** clamped to `[14%, 90%]`.

## 6. Match Sandbox Best-Move Advisor (`evaluateSandboxBestMoves`)

Enumerates all legal `MAIN` phase actions for the active side (`DEPLOY_UNIT`, `PAIR_PILOT`, `DEPLOY_BASE`, `PLAY_COMMAND`, `ATTACK_SHIELD`, `ATTACK_UNIT`, `PASS_TURN`), simulates tactical value (lethal shield detection, `[Link]` immediate-attack haste, `<Blocker>` walls, favorable trades preserving `<First Strike>`, and Command removal targeting the opponent's highest-AP Unit), and ranks the Top 3 moves with Win-Chance delta (`winDeltaPct`).
