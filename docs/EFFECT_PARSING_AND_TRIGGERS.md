# Card Effect Parsing, Trigger Resolution, and Link Modeling

This guide explains how raw Gundam Card Game prose flows from `data/collections/*.json` through the offline compiler (`lib/effect-parser.ts` → `data/effects/*.json`) and into deck analysis (`lib/deck-engine.ts`) and live match execution (`lib/sandbox-engine.ts`), using the domain terms in [`GLOSSARY.md`](../GLOSSARY.md).

---

## 1. End-to-End Pipeline

```text
data/collections/*.json (raw prints)
  │  never modified at runtime
  ▼
scripts/compile_effects.ts  ──►  compileCardEffect(canonicalPrint)
  │                                  │
  │   1. stripReminderText         │  removes (All units...) reminders, keeps (Traits) & (AP/HP) tokens
  │   2. line split & modal merge  │  merges ■ Development lines, propagates 【Action】/【Main】 across ■ options
  │   3. innate Keyword Abilities  │  extracts standalone <Blocker>, <Breach X>, <Repair X>, ...
  │   4. compileSingleClauseLine │  separates:
  │        • Bracketed timings     │    【Deploy】, 【Attack】, 【Once per Turn】, 【When Linked】, 【Pilot】
  │        • ActivationCost        │    cost before "：" (resources, rest, discard, return, trash exile)
  │        • Guard Condition       │    "During your turn,", "At the end of your turn,", "If <state>,"
  │        • Trigger Event         │    inline "When this Unit is attacked,", "when this Unit destroys..."
  │        • Link Requirement      │    Unit card.link OR Pilot card.name + NAME_ALIAS + card traits
  │        • Recursive EffectStep[]│    IF_CONDITION, IF_PREVIOUS_SUCCEEDED, GRANT_CLAUSE, ScaleMetric, TargetSelector
  ▼
data/effects/<SET>.json (28 Effect Shards, 1,290 cards, 1,392 Effect Clauses)
  │  validated by docs/schemas/effect-shard.schema.json (__tests__/data-schemas.test.ts)
  ▼
lib/gundam-db.ts  ──►  hydrates card.compiledEffect onto every print by cardNo
  │
  ├──► lib/deck-engine.ts       (LINK & TRAIT prerequisites, Effect Styles, Synergy Knowledge Map)
  └──► lib/sandbox-engine.ts    (Trigger dispatch, oncePerTurn, continuous stats, fail-closed manual log)
```

Runtime modules (`lib/deck-engine.ts`, `lib/sandbox-engine.ts`) **never** call the regex compiler on catalog cards; they read `card.compiledEffect` exclusively.

---

## 2. Anatomy of an Effect Clause

Every parsed line produces an `EffectClause` with six distinct layers so **Trigger Events** and **Guard Conditions** are never conflated:

1. **Timing (`timings`) & `triggerEvent` (When does it fire?)**:
   - **Bracketed timings**: `【Deploy】`, `【Attack】`, `【Destroyed】`, `【When Paired】`, `【When Linked】`, `【During Pair】`, `【During Link】`, `【Burst】`, `【Activate･Main】`, `【Activate･Action】`, `【Main】`, `【Action】`.
   - **Turn-phase & play headers**: `At the end of your turn,` → `END_OF_TURN`; `At the start of your opponent's turn,` → `START_OF_OPPONENT_TURN`; `When playing this card from your hand,` → `WHEN_PLAYING`.
   - **Inline reactive Trigger Events (`parseLeadingWhenTrigger`)**: When a clause has no explicit action timing header (or only `【Once per Turn】`) and leads with `When ...` or `Whenever ...` (optionally preceded by a turn guard like `During your turn,`), the compiler promotes `timings` from `CONTINUOUS` to the specific reactive timing (`WHEN_ATTACKED`, `WHEN_DESTROY_BY_BATTLE`, `WHEN_DEAL_DAMAGE`, `WHEN_RECOVER_HP`, `WHEN_UNIT_DEPLOYED`, `WHEN_BLOCKED`, etc.) and populates `triggerEvent` (`actor`, `targetKind`, `damageType`, `whileAttacking`).
   - **Modal option propagation (`activeModalHeader`)**: Cards with `【Action】Choose 1 of the following effects.` followed by `■` bullet lines (e.g., `GD06-114`) inherit the active header timing (`ACTION`, `MAIN`, etc.) on every bullet option instead of falling back to `CONTINUOUS`.
2. **Frequency (`oncePerTurn`)**: Set when `【Once per Turn】` is present.
3. **Link Requirement (`linkRequirement`)**: Attached whenever a clause includes `WHEN_LINKED` or `DURING_LINK`:
   - On a **Unit** (`role: "UNIT_REQUIRES_PILOT"`): extracts `[Pilot Name]` entries into `names` and `(Trait) Trait` entries into `traits` from `card.link`.
   - On a **Pilot** (`role: "PILOT_MATCHING_UNIT"`): records the Pilot's effective names (including card-level `NAME_ALIAS` clauses) in `names` and the Pilot's traits in `traits` for matching against Unit `[Link]` conditions.
   - `extractEffectPrerequisites` also emits a non-blocking `LINK` prerequisite (`primaryClause: false`, `minCopies: 4`) so deck evaluation surfaces Link partner gaps without hiding the card as unplayable.
4. **Activation Cost (`cost`)**: Text before the full-width colon `：` (resources, self-rest, discard, deck-bottom return, trash exile with optional `exileFilter`).
5. **Guard Condition (`condition`)**: Evaluated **only** when the clause fires or during continuous state checks—never used to infer when a trigger happens:
   - Leading turn guards (`During your turn,` → `IS_YOUR_TURN`, `During your opponent's turn,` → `IS_OPPONENT_TURN`) are stripped before trigger parsing and preserved in `condition` (or composed with `ALL_OF` if an `If ...` clause follows).
   - Compound `and` / `or` / negative conditions compile recursively into `ALL_OF`, `ANY_OF`, and `NOT`.
   - `RAW_CONDITION` remains in the TypeScript/JSON schema strictly as a future-sync escape hatch and is asserted at **`0`** across all committed shards.
6. **Resolution Steps (`steps`)**: Ordered `EffectStep` instructions with:
   - Dynamic scaling via `ScaleMetric` (e.g., `HAND_COUNT`, `TRASH_COUNT`, `SELF_DAMAGE`, `DRAWN_COUNT`).
   - Exact bounds on `TargetSelector` (`hpMin` + `hpMax`, `hpRank`, `lvRank`, `linked`, `paired`, `state`, `traits`, `color`, `notColor`, `token`, `excludeToken`).
   - Control flow (`IF_CONDITION`, `IF_PREVIOUS_SUCCEEDED`, `GRANT_CLAUSE`) and card identity tags (`GRANT_PILOT_MODE` for `【Pilot】[Name]`, `NAME_ALIAS`).
   - `unparsedResidual` remains strictly as a future-sync escape hatch and is asserted at **`""`** across all `1,392` committed clauses.

---

## 3. Worked Examples (Raw Prose → Compiled AST → Runtime Trigger)

### Example 1: Reactive Self-Defense Trigger (`GD06-001` — *Gundam GP01Fb*)

- **Raw Effect**:
  - Clause 1: `【Once per Turn】When this Unit is attacked, draw 1.`
  - Clause 2: `【During Pair】This Unit gains<High-Maneuver>.`
- **Parsing Flow**:
  1. Clause 1 strips `【Once per Turn】` (`oncePerTurn: true`), detects no bracketed action timing, and invokes `parseLeadingWhenTrigger` on `"When this Unit is attacked, draw 1."`.
  2. `"When this Unit is attacked"` yields `timings: ["WHEN_ATTACKED"]` and `triggerEvent: { kind: "WHEN_ATTACKED", actor: "SELF", raw: "When this Unit is attacked" }`, leaving `"draw 1."` to compile into `{ action: "DRAW", count: 1, bothPlayers: false }`.
- **Runtime Trigger (`lib/sandbox-engine.ts`)**:
  - In `ATTACK_UNIT`, or in `ATTACK_SHIELD` after a defender with `<Blocker>` intercepts, the engine invokes `resolveClausesForTiming(next, oppSide, defender.card, 'WHEN_ATTACKED', defender)` (and for `defender.pairedPilot`).
  - `resolveClause` checks `oncePerTurn` against `defender.triggeredClauseTurns[clause.raw] === state.turn`; if unused this turn, it records the current turn and draws 1 card. Attacks in subsequent turns re-trigger; a second attack in the same turn does not.

---

### Example 2: Separated Turn Guard + Battle-Destroy Trigger + Two-Step Deploy (`GD06-002` — *Infinite Justice Gundam*)

- **Raw Effect**:
  - Clause 1: `【Once per Turn】During your turn, when this Unit destroys an enemy card with battle damage, choose 1 of your (Orb) Units. It recovers 3 HP.`
  - Clause 2: `【Deploy】You may choose 3 Unit cards from your trash. Exile them from the game. If you do, choose 1 active enemy Unit. Return it to its owner's hand.`
- **Parsing Flow**:
  1. Clause 1 strips `【Once per Turn】`, extracts the leading turn guard `"During your turn,"` (`condition: { kind: "IS_YOUR_TURN" }`), and then passes `"when this Unit destroys an enemy card with battle damage, ..."` to `parseLeadingWhenTrigger`.
  2. Result: `timings: ["WHEN_DESTROY_BY_BATTLE"]`, `triggerEvent: { kind: "WHEN_DESTROY_BY_BATTLE", actor: "SELF", targetKind: "ANY_ENEMY_CARD", damageType: "BATTLE" }`, `condition: { kind: "IS_YOUR_TURN" }`, `steps: [{ action: "RECOVER_HP", amount: 3, target: { owner: "SELF", cardType: "UNIT", count: 1, trait: "Orb" } }]`.
  3. Clause 2 merges `"Exile them from the game."` and `"If you do, choose 1 active enemy Unit. Return it to its owner's hand."` into an `EXILE` (`zone: "TRASH"`, `count: 3`) step followed by an `IF_PREVIOUS_SUCCEEDED` step wrapping `BOUNCE` (`owner: "ENEMY"`, `state: "ACTIVE"`, `count: 1`).
- **Runtime Trigger (`lib/sandbox-engine.ts`)**:
  - When this Unit destroys an enemy Unit (in `ATTACK_UNIT` or against a `<Blocker>`), an enemy Base, or an enemy Shield via battle damage in `ATTACK_SHIELD` / `ATTACK_UNIT`, the sandbox dispatches `WHEN_DESTROY_BY_BATTLE` with `destroyedByBattle = true` and `destroyTargetKind = 'UNIT' | 'BASE' | 'SHIELD'`.
  - `resolveClausesForTiming` verifies `triggerEvent.damageType !== 'EFFECT'` and matches `targetKind` (`ANY_ENEMY_CARD` accepts all three).
  - `resolveClause` evaluates `IS_YOUR_TURN` (`state.activeSide === side`): it heals the most damaged friendly `(Orb)` Unit by 3 HP on the owner's turn (once per turn), and **does not fire** if the Unit kills an attacker while defending on the opponent's turn.
  - Clause 2 (`EXILE` + `IF_PREVIOUS_SUCCEEDED`) is recognized as a valid typed AST without residual prose; because interactive multi-trash exile selection is outside the sandbox simulator scope, `applyEffectStep` fails closed by logging `"Manual resolution required: EXILE (...)"` and `"Manual resolution required: IF_PREVIOUS_SUCCEEDED (...)"`.

---

### Example 3: Continuous Scaling Buff + Compound `ALL_OF` Attack Guard (`GD06-003` — *GQuuuuuuX (Omega Psycommu Released)*)

- **Raw Effect**:
  - Clause 1: `Increase this Unit's AP by an amount equal to the number of cards in your hand.`
  - Clause 2: `【Attack】If another friendly (Alphacide) Unit is in play and you have 5 or less cards in your hand, draw 1.`
- **Parsing Flow**:
  1. Clause 1 has no `until the end of this turn` suffix and no trigger header, so `timings: ["CONTINUOUS"]` compiles `MODIFY_AP` with `delta: 1`, `scaleBy: { metric: "HAND_COUNT", owner: "SELF" }`, `target: { owner: "SELF", self: true, cardType: "UNIT" }`, and no `THIS_TURN` duration.
  2. Clause 2 compiles `condition` into `ALL_OF` containing:
     - `BOARD_CARD_COUNT`: `{ owner: "SELF", cardType: "UNIT", min: 1, other: true, traits: ["Alphacide"] }`
     - `HAND_COUNT`: `{ owner: "SELF", max: 5 }`
- **Runtime Interpretation (`lib/sandbox-engine.ts`)**:
  - `effectiveAp(unit, state, side)` sums static `CONTINUOUS` `MODIFY_AP` clauses dynamically via `continuousApBuff`, evaluating `evaluateScaleMetric({ metric: 'HAND_COUNT', owner: 'SELF' })` every time AP is read (combat, lethal advisor checks, `apMax` selectors) without double-counting into `unit.apBuff`.
  - On `ATTACK_SHIELD` or `ATTACK_UNIT`, `ATTACK` evaluates both `ALL_OF` branches (`other: true` excludes the attacker itself from `(Alphacide)` count, and `hand.length <= 5`), drawing 1 only when both hold.

---

### Example 4: Exact HP Bound Selector (`GD06-009` — *GM Custom*)

- **Raw Effect**: `【Deploy】You may choose 1 enemy Unit with 1 HP. Return it to its owner's hand.`
- **Parsing Flow**:
  - `parseTargetSelector` matches `with <N> HP` (distinct from `with N or less HP` / `or more HP`) and emits both `hpMin: 1` and `hpMax: 1` on `BOUNCE.target`.
- **Runtime Execution (`lib/sandbox-engine.ts`)**:
  - `matchesUnitSelector` computes current remaining HP (`effectiveRemainingHp(u)`) and enforces `effectiveHp >= hpMin` and `effectiveHp <= hpMax`, so undamaged 1-HP Units and higher-HP Units chipped down to exactly 1 remaining HP are valid bounce targets, while 2+ remaining HP Units are rejected.

---

### Example 5: Structured Link Requirements & Command Pilots (`ST09-003`, `GD01-088`, `EB01-076`)

| Card | Raw `[Link]` / Pilot Declaration | Compiled `linkRequirement` & Identity Steps | Runtime & Deck Builder Behavior |
| :--- | :--- | :--- | :--- |
| **`ST09-003`** (*Saviour Gundam*) | `card.link = "[Athrun Zala]"` | `WHEN_LINKED` clause carries `linkRequirement: { role: "UNIT_REQUIRES_PILOT", names: ["Athrun Zala"], traits: [], raw: "[Athrun Zala]" }`; `prerequisites` adds `{ kind: "LINK", cardType: "PILOT", anyNames: ["Athrun Zala"], minCopies: 4, primaryClause: false }`. | Fires `WHEN_LINKED` only when paired with a Pilot/Command-Pilot matching `Athrun Zala` (including alias matches). |
| **`GD01-088`** (*Banagher Links*) | Pilot (`Civilian`, `Newtype`), `【When Linked】Draw 1.` | `WHEN_LINKED` clause carries `linkRequirement: { role: "PILOT_MATCHING_UNIT", names: ["Banagher Links"], traits: ["Civilian", "Newtype"], raw: "[Banagher Links]" }`; `prerequisites` adds `{ kind: "LINK", cardType: "UNIT", anyNames: ["Banagher Links"], anyTraits: ["Civilian", "Newtype"], minCopies: 4, primaryClause: false }`. | `matchesEffectPrerequisite` scans Units whose `card.link` matches `Banagher Links` or `(Civilian)/(Newtype) Trait`. |
| **`EB01-076`** (*Gerbera Straight*) | Command (`G Generation`) with `【Pilot】[Lowe Guele]` | Clause 2 compiles to `{ timings: ["CONTINUOUS"], steps: [{ action: "GRANT_PILOT_MODE", pilotName: "Lowe Guele" }] }` (without overriding `primaryClause: true` on Clause 1). | `extractPilotNamesForLink` returns `["Lowe Guele"]` so `doesPilotLinkUnit` matches Command Pilots in deck analysis & Link checks; Sandbox board `PAIR_PILOT` remains fail-closed to `type === "PILOT"`. |

---

## 4. Fail-Closed Contracts Across Layers

- **Schema & Corpus Gate (`npm test` + `npm run compile:effects -- --check`)**:
  - `docs/schemas/effect-shard.schema.json` strictly checks every shard (`additionalProperties: false`, `oneOf` exclusivity).
  - `__tests__/effect-parser.test.ts` asserts `0` `RAW_CONDITION`, `0` `unparsedResidual`, `100%` `linkRequirement` coverage on `WHEN_LINKED`/`DURING_LINK`, and `0` missing `hpMin` bounds on exact `<N> HP` clauses across all `1,290` unique cards.
- **Sandbox Execution (`lib/sandbox-engine.ts`)**:
  - Unsimulated AST steps (e.g., `EXILE`, `IF_PREVIOUS_SUCCEEDED`, `REDIRECT_ATTACK_TARGET`, `FORCE_BATTLE_DAMAGE_STEP`), unsimulated `Condition` kinds, or any future non-empty `unparsedResidual` **never crash or guess**—they emit `"Manual resolution required: ..."` entries directly in the match action log.
