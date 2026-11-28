# Human Guide to Card Effect JSON (`data/effects/<SET>.json`) & Its Schema

This guide explains how to read **Effect Shards** (`data/effects/<SET>.json`) alongside their formal schema (`docs/schemas/effect-shard.schema.json`) and raw card text (`data/collections/<code>.json`). Every field, object shape, and enum value in `effect-shard.schema.json` is documented here with plain-English game rules and real-card examples.

> **Terminology note:** There is no single `data.json` file in this repository. Card data is split into raw **Collection Shards** (`data/collections/<code>.json`) and pre-compiled **Effect Shards** (`data/effects/<SET>.json`). Each **Effect Shard** holds **Compiled Card Effect** records grouped by card-number prefix (`ST01`, `GD01`, `EB01`, and so on).

---

## Contents

1. [How the Data Files Connect](#1-how-the-data-files-connect)
2. [How to Read `effect-shard.schema.json` (JSON Schema Primer)](#2-how-to-read-effect-shardschemajson-json-schema-primer)
3. [Top-Level File & Card Envelope](#3-top-level-file--card-envelope)
4. [Keyword Abilities (`keywords`)](#4-keyword-abilities-keywords)
5. [The Five Ability Kinds (`abilities`)](#5-the-five-ability-kinds-abilities)
6. [Triggers, Costs, Links & Pair Filters](#6-triggers-costs-links--pair-filters)
7. [Guard Conditions (`EffectCondition`)](#7-guard-conditions-effectcondition)
8. [Target Selectors & Dynamic Scaling (`TargetSelector` & `ScaleMetric`)](#8-target-selectors--dynamic-scaling-targetselector--scalemetric)
9. [Resolution Steps (`EffectStep`)](#9-resolution-steps-effectstep)
10. [Continuous Modifiers, Prohibitions & Replacement Outcomes](#10-continuous-modifiers-prohibitions--replacement-outcomes)
11. [Deck-Building Metadata (`synergy` & `prerequisites`)](#11-deck-building-metadata-synergy--prerequisites)
12. [End-to-End Real-Card Walkthroughs](#12-end-to-end-real-card-walkthroughs)
13. [Reverse Lookup: Card Text to JSON Field](#13-reverse-lookup-card-text-to-json-field)

---

## 1. How the Data Files Connect

Raw card prints live in `data/collections/<code>.json` (one file per retail product or promo package). Because reprints and parallel-art cards (`ST01-001_p1`) share the same gameplay rules as their base card number (`ST01-001`), the offline compiler picks one canonical non-parallel print per `cardNo`, parses its `effect` prose through the Chevrotain grammar, and writes the structured result once into `data/effects/<SET>.json`.

```text
data/collections/ST01.json (raw card print)
  ├── printId: "ST01-001"
  ├── cardNo:  "ST01-001"
  ├── link:    "[Amuro Ray]"
  └── effect:  "<Repair 2> ...\n【During Pair】During your turn, all your Units get AP+1."
         │
         ▼  compiled offline by scripts/compile_effects.ts
data/effects/ST01.json (Effect Shard, validated by docs/schemas/effect-shard.schema.json)
  └── effects["ST01-001"]
        ├── sourcePrintId: "ST01-001"   (points back to the exact collection print used)
        ├── keywords:      [{ "name": "Repair", "value": 2 }]
        ├── abilities:     [{ "kind": "CONTINUOUS_MODIFIER", ... }]
        ├── synergy:       { "requires": [], "enables": ["AP_THRESHOLD_5"] }
        └── prerequisites: []
```

To inspect the original human-facing stats (`lv`, `cost`, `ap`, `hp`, `traits`, `link`, `effect`, `faqs`) of any entry in `data/effects/<SET>.json`, look up `cardNo` or `sourcePrintId` in the matching `data/collections/<code>.json` file.

---

## 2. How to Read `effect-shard.schema.json` (JSON Schema Primer)

`docs/schemas/effect-shard.schema.json` uses **JSON Schema (Draft 2020-12)**. When you open it side by side with a shard file such as `data/effects/ST01.json`, you only need to recognize a handful of keywords:

| Schema Keyword | What It Means in Plain English | How to Read It |
| :--- | :--- | :--- |
| `$schema`, `$id`, `title`, `description` | File metadata. | Identifies the JSON Schema draft version and what data file the schema validates. |
| `properties` | Allowed keys inside a JSON object. | Lists every field name that may appear at that level, paired with its value rule. |
| `required` | Mandatory keys. | Every key listed here **must** exist on the object. Keys in `properties` that are **not** in `required` are optional and omitted when unused. |
| `additionalProperties: false` | Strict closed object. | Any typo or unlisted key is invalid and fails `npm test`. |
| `additionalProperties: { "$ref": "..." }` | Dictionary / map object. | Used on `effects`: keys can be any `cardNo` string (`"ST01-001"`), and every value must match `CompiledCardEffect`. |
| `$defs` | Reusable type library. | Holds named building blocks (such as `TargetSelector` or `EffectStep`) referenced elsewhere in the schema. |
| `$ref: "#/$defs/Name"` | Jump pointer. | Tells you to scroll to `"Name"` inside `$defs` to see the full structure of that field. |
| `type` | Primitive or container shape. | `"string"`, `"integer"`, `"boolean"`, `"object"`, `"array"`, or `["integer", "null"]` (either an integer or `null`). |
| `const` | Exact fixed value. | Only that exact value is legal—commonly used as a **tag** (`"kind": "EFFECT_CLAUSE"` or `"action": "DRAW"`). |
| `enum` | Closed list of allowed values. | The value must be one of the listed strings or numbers (for example, `CardColor` or `minCopies`). |
| `oneOf` | Exclusive choice ("pick exactly one shape"). | Used for polymorphic lists such as `AbilityAst`, `EffectCondition`, `EffectStep`, and `ContinuousModifierAst.modifier`. Match the tag (`kind`, `action`, or `type`) to find which branch applies. |
| `items` / `minItems` | Array element rule and minimum length. | Every item in the array must satisfy `items`; `minItems: 1` means the array cannot be empty. |
| `minimum` / `minLength` / `pattern` | Value bounds. | `minimum: 0` forbids negatives; `minLength: 1` forbids `""`; `pattern: "^[A-Za-z0-9_-]+$"` restricts characters. |

**Tip for reading a card:** Start at the root `properties` of `effect-shard.schema.json` (`schemaVersion`, `setPrefix`, `cardCount`, `effects`), follow `$ref` into `CompiledCardEffect`, then follow `abilities` into `AbilityAst`, and jump to each `$defs` block only as needed.

---

## 3. Top-Level File & Card Envelope

### `EffectShardFile` (Root Object of `data/effects/<SET>.json`)

| Field | Required | Type / Rule | Meaning |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | Yes | `integer` (`const: 2`) | Format version of the compiled shard (`2`). |
| `setPrefix` | Yes | `string` (`^[A-Za-z0-9_-]+$`) | Card-number prefix grouped in this file (e.g. `"ST01"`, `"GD06"`, `"EB01"`, `"EXB"`, `"EXBP"`, `"EXR"`, `"EXRP"`, `"R"`, `"RP"`, `"T"`, or `"MISC"`). |
| `cardCount` | Yes | `integer` (`minimum: 0`) | Total number of unique cards inside `effects`. |
| `effects` | Yes | `Record<string, CompiledCardEffect>` | Map keyed by `cardNo` (sorted alphabetically) to its compiled card record. |

### `CompiledCardEffect` (`$defs/CompiledCardEffect`)

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `cardNo` | Yes | `string` (`minLength: 1`) | Base card number matching its key in `effects` (e.g. `"ST01-001"`). |
| `sourcePrintId` | Yes | `string` (`minLength: 1`) | Specific `printId` from `data/collections/*.json` compiled into this record (prefers non-parallel print, lowest `printId` tiebreak). |
| `name` | Yes | `string` (`minLength: 1`) | Card display name (e.g. `"Gundam"`). |
| `type` | Yes | `string` (`minLength: 1`) | Card type from the collection print (e.g. `"UNIT"`, `"PILOT"`, `"COMMAND"`, `"BASE"`). |
| `color` | Yes | `CardColor` | Card color: `"Blue"`, `"Green"`, `"Red"`, `"Purple"`, `"White"`, or `"Colorless"`. |
| `keywords` | Yes | `KeywordAbility[]` | Innate angle-bracketed **Keyword Abilities** printed directly on the card (empty array `[]` if none). |
| `abilities` | Yes | `AbilityAst[]` | Ordered list of parsed ability nodes (`EFFECT_CLAUSE`, `CONTINUOUS_MODIFIER`, `REPLACEMENT_EFFECT`, `CUSTOM_HOOK`, or `DIAGNOSTIC`). Vanilla cards have `[]`. |
| `synergy` | Yes | `CardSynergyProfile` | Graph edges (`requires` and `enables`) connecting this card to deck-building payoff/enabler mechanics. |
| `prerequisites` | Yes | `EffectPrerequisite[]` | Deck-construction requirements inferred from this card's abilities (empty `[]` if self-contained). |

---

## 4. Keyword Abilities (`keywords`)

Innate keywords printed outside timing brackets—such as `<Repair 2>` or `<Blocker>`—appear in the card's `keywords` array. Keywords **granted dynamically** by an ability (for example, `【During Pair】This Unit gains <High-Maneuver>.`) are not in `keywords`; instead they appear inside `abilities` as `GRANT_KEYWORD`.

### `KeywordAbility` (`$defs/KeywordAbility`)

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `name` | Yes | `KeywordName` | Standardized keyword name. |
| `value` | Yes | `integer \| null` | Numeric rank `X` when parameterized (such as `2` in `<Repair 2>`), or `null` for parameterless keywords (such as `<Blocker>`). |

### `KeywordName` (`$defs/KeywordName`)

| Value | Typical `value` | Game Rule Meaning |
| :--- | :--- | :--- |
| `"Repair"` | `integer` (e.g. `2`) | At the end of your turn, this Unit recovers `X` HP. |
| `"Breach"` | `integer` (e.g. `3`) | When this Unit's attack destroys an enemy Unit during your turn, deal `X` damage to the enemy player's Shield area. |
| `"Support"` | `integer` (e.g. `1`) | Activate-Main rest this Unit to give another friendly Unit `+X` AP for the turn. |
| `"Blocker"` | `null` | Rest this Unit during the blocker step to intercept an attack and change the attack target to this Unit. |
| `"First Strike"` | `null` | While attacking, this Unit deals battle damage before the defending Unit. |
| `"High-Maneuver"` | `null` | While attacking, this Unit cannot be blocked by enemy `<Blocker>` Units. |
| `"Suppression"` | `null` | When this Unit deals battle damage to an enemy Shield during your turn, destroy 2 Shields simultaneously instead of 1 (if 2+ Shields remain). |

Example (`ST01-001` *Gundam*):

```json
"keywords": [
  { "name": "Repair", "value": 2 }
]
```

---

## 5. The Five Ability Kinds (`abilities`)

Every element of `abilities` conforms to `$defs/AbilityAst`, a `oneOf` union discriminated by `kind`.

| `kind` | Schema `$defs` | What It Represents on a Card |
| :--- | :--- | :--- |
| `"EFFECT_CLAUSE"` | `EffectClauseAst` | A triggered or activated rule (`【Deploy】`, `【Attack】`, `【Main】`, `【Burst】`, or inline `When ...`) that executes ordered `steps`. |
| `"CONTINUOUS_MODIFIER"` | `ContinuousModifierAst` | A passive, state-evaluated rule (always-on stat buff, keyword/trait grant, cost reduction, name alias, pilot mode, attack/block prohibition) active while its source is in scope. |
| `"REPLACEMENT_EFFECT"` | `ReplacementEffectAst` | An event interceptor (`"would ... instead"`) that catches a game event before it happens and substitutes an alternative outcome (at most once per event instance). |
| `"CUSTOM_HOOK"` | `CustomHookAst` | A versioned, named escape-hatch rule registered for a rare 1-of card whose prose exceeds the standard phrase grammar. |
| `"DIAGNOSTIC"` | `DiagnosticAst` | An explicit **Lowering Diagnostic** marker emitted if a line fails lexing, parsing, or lowering (`0` across committed shards). |

### Common Header Fields Across Ability Nodes

- `clauseIndex` (`integer >= 0`): Zero-based line index of the ability after normalizing the raw card text.
- `raw` (`string`): Normalized text of that clause, kept **only for human reading and `oncePerTurn` tracking**. Runtime engines never parse `raw`.
  - **Normalizer tokens you may see in `raw`:** `<DOT>` replaces middots (`･`), `<COST_SEP>` replaces the full-width cost colon (`：`), and `<RES_COST:N>` replaces circled resource icons (`①`–`⑩`).

### 5.1 `EFFECT_CLAUSE` (`$defs/EffectClauseAst`)

Represents an **Effect Clause** that fires at specific timings or on specific events and executes `steps`.

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `"EFFECT_CLAUSE"` | Identifies an **Effect Clause**. |
| `clauseIndex` | Yes | `integer` (`>= 0`) | Position among the card's abilities. |
| `raw` | Yes | `string` | Normalized source clause text for human inspection. |
| `timings` | Yes | `EffectTiming[]` (`minItems: 1`) | When this clause can trigger or be activated (e.g. `["MAIN", "ACTION"]`). |
| `oncePerTurn` | Yes | `boolean` | `true` when `【Once per Turn】` is present; prevents firing more than once per turn per instance. |
| `triggerEvent` | No | `TriggerEvent` | Structured reactive event details for inline `When ...` / `Whenever ...` clauses. |
| `pairFilter` | No | `PairFilter` | Pilot restriction on `【When Paired】` / `【During Pair】` headers. |
| `linkRequirement` | No | `LinkRequirement` | Pilot-to-Unit **Link Requirement** attached on `WHEN_LINKED` / `DURING_LINK` clauses. |
| `cost` | No | `ActivationCost` | Cost before `：` that must be paid to activate the clause. |
| `condition` | No | `EffectCondition` | **Guard Condition** checked before resolving `steps`. |
| `steps` | Yes | `EffectStep[]` | Ordered instructions executed when the clause resolves. |
| `modalGroup` | No | `string` | Shared group identifier when multiple `■` modal choice lines belong to one `"Choose 1 of the following effects"` prompt. |

*(Note: `$defs/EffectClause` is the nested version used inside `GRANT_CLAUSE` steps—it has the exact same fields except it omits `kind`, `clauseIndex`, and `modalGroup`.)*

### 5.2 `CONTINUOUS_MODIFIER` (`$defs/ContinuousModifierAst`)

Represents a passive **Continuous Modifier** evaluated across rule layers while its source stays in `activeIn` and its optional gates hold.

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `"CONTINUOUS_MODIFIER"` | Identifies a **Continuous Modifier**. |
| `clauseIndex` | Yes | `integer` (`>= 0`) | Position among the card's abilities. |
| `raw` | Yes | `string` | Normalized source clause text. |
| `layer` | Yes | `2 \| 3 \| 4` | Evaluation order layer (see Layer table below). |
| `activeIn` | Yes | `"BATTLE_AREA" \| "HAND" \| "TRASH" \| "ANY"` | Zone where the source card must be located for this passive rule to apply (`"HAND"` for cost reductions / `【Pilot】` mode, `"ANY"` for `NAME_ALIAS`). |
| `requiresPair` | No | `boolean` | `true` if `【During Pair】` requires a paired Pilot on the Unit. |
| `requiresLink` | No | `LinkRequirement` | Present when `【During Link】` requires a linked Pilot–Unit match. |
| `pairFilter` | No | `PairFilter` | Pilot filter when `【During Pair･...】` restricts which Pilots activate the passive rule. |
| `oncePerTurn` | No | `boolean` | Rare cap if the passive rule has a per-turn limit. |
| `condition` | No | `EffectCondition` | Passive **Guard Condition** (e.g. `IS_YOUR_TURN`) that must hold continuously. |
| `duration` | No | `EffectDuration` | Lifetime (`"CONTINUOUS"` for static card text; `"THIS_TURN"` / `"THIS_BATTLE"` / `"NEXT_TURN"` when scoped). |
| `modifier` | Yes | `oneOf` (11 variants) | The specific passive effect payload (see [Section 10.1](#101-continuous-modifier-payloads-modifier)). |

**What `layer` (`2`, `3`, `4`) means:**
- **Layer 2 (Identity, Keywords, Traits & Permissions):** Base traits, `NAME_ALIAS`, `GRANT_PILOT_MODE`, `GRANT_KEYWORD`, `GRANT_TRAIT`, and `ALLOW_ATTACK_ACTIVE`.
- **Layer 3 (Stats & Costs):** Additive `MODIFY_STAT` (`AP`/`HP` buffs or penalties) and `COST_REDUCTION`. Evaluated after Layer 2 so keyword/trait grants are already visible.
- **Layer 4 (Prohibitions & Restrictions):** `"Can't"` rules (`PROHIBITION`), `FREEZE_AURA`, `RESTRICTION`, and `REDIRECT_ATTACK_TARGET`. Evaluated last so prohibitions override permissions.

### 5.3 `REPLACEMENT_EFFECT` (`$defs/ReplacementEffectAst`)

Represents a **Replacement Effect** (`"would ... instead"`). It intercepts an event before resolution and substitutes `outcome`.

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `"REPLACEMENT_EFFECT"` | Identifies a **Replacement Effect**. |
| `clauseIndex` | Yes | `integer` (`>= 0`) | Position among the card's abilities. |
| `raw` | Yes | `string` | Normalized source clause text. |
| `scope` | Yes | `"ACTIVE_ZONE" \| "PAIRED" \| "LINKED"` | Whether the interceptor is active simply by being in play (`"ACTIVE_ZONE"`), only while paired (`"PAIRED"`), or only while linked (`"LINKED"`). |
| `intercepts` | Yes | `"WOULD_BE_DESTROYED" \| "WOULD_TAKE_DAMAGE" \| "WOULD_REST" \| "WOULD_MOVE_ZONE"` | The game event caught before it resolves. |
| `subject` | Yes | `TargetSelector` | Which permanent or player is about to suffer the intercepted event. |
| `sourceFilter` | No | `TargetSelector` | Optional filter on what caused the intercepted event (e.g. enemy Unit with `apMaxRef: "SELF_AP"`). |
| `pairFilter` | No | `PairFilter` | Optional Pilot restriction when `scope` is `"PAIRED"`. |
| `oncePerTurn` | No | `boolean` | `true` if limited to once per turn. |
| `condition` | No | `EffectCondition` | **Guard Condition** that must hold to offer or apply the replacement. |
| `optional` | Yes | `boolean` | `true` when the card says `"you may ... instead"`; `false` when mandatory. |
| `duration` | No | `EffectDuration` | Lifetime of the interceptor (`"CONTINUOUS"`, `"THIS_TURN"`, `"THIS_BATTLE"`, `"NEXT_TURN"`). |
| `steps` | No | `EffectStep[]` | Optional auxiliary steps tied to the replacement. |
| `outcome` | Yes | `ReplacementOutcome` | What happens instead of the intercepted event (see [Section 10.3](#103-replacement-outcomes-replacementoutcome)). |
| `maxPerEventInstance` | Yes | `1` (const) | Enforces the official rule that a single event instance can be replaced at most once by this effect. |

### 5.4 `CUSTOM_HOOK` (`$defs/CustomHookAst`)

Represents a **Custom Hook** for rare 1-of cards whose prose cannot be expressed cleanly by standard CFG rules alone (currently `ST01-015` *White Base*'s 3-way token selector).

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `"CUSTOM_HOOK"` | Identifies a **Custom Hook**. |
| `clauseIndex` | Yes | `integer` (`>= 0`) | Position among the card's abilities. |
| `hookId` | Yes | `string` (`minLength: 1`) | Registry key matching `<cardNo>#<clauseIndex>`, e.g. `"ST01-015#2"`. |
| `version` | Yes | `integer` (`minimum: 1`) | Revision number of the custom hook contract (e.g. `2`). |
| `raw` | Yes | `string` | Normalized card prose for that clause. |
| `timings` | Yes | `EffectTiming[]` (`minItems: 1`) | Trigger/activation timings for this hook. |
| `cost` | No | `ActivationCost` | Activation cost (e.g. `{ "resourceCost": 2 }`). |
| `steps` | Yes | `EffectStep[]` | Baseline representative steps exposed to deck-analysis callers. |
| `prerequisites` | Yes | `EffectPrerequisite[]` | Explicit deck-building prerequisites attached to the hook. |

### 5.5 `DIAGNOSTIC` (`$defs/DiagnosticAst`)

Represents a **Lowering Diagnostic** when the compiler cannot fully understand a line. Committed shards always have `0` diagnostics.

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `"DIAGNOSTIC"` | Identifies a failed parse/lowering line. |
| `clauseIndex` | Yes | `integer` (`>= 0`) | Line index that failed. |
| `code` | Yes | `"LEX_ERROR" \| "PARSE_ERROR" \| "NO_LOWERING" \| "UNPARSED_RESIDUAL"` | Stage where compilation stopped: unknown token (`LEX_ERROR`), grammar mismatch (`PARSE_ERROR`), unsupported CST branch (`NO_LOWERING`), or leftover tokens (`UNPARSED_RESIDUAL`). |
| `message` | Yes | `string` | Human-readable compiler error message. |
| `raw` | Yes | `string` | Exact line text that failed to compile. |

---

## 6. Triggers, Costs, Links & Pair Filters

### 6.1 `EffectTiming` (`$defs/EffectTiming` — 34 Values)

`timings` tells you **when** an `EFFECT_CLAUSE` fires or may be activated.

| Category | `EffectTiming` Value | Card Text / Rule Meaning |
| :--- | :--- | :--- |
| **Bracketed Triggers** | `"DEPLOY"` | `【Deploy】` — When this Unit or Base enters the Battle/Base Area. |
| | `"ATTACK"` | `【Attack】` — When this Unit declares an attack. |
| | `"DESTROYED"` | `【Destroyed】` — When this Unit or Base is destroyed. |
| | `"WHEN_PAIRED"` | `【When Paired】` — At the moment a Pilot pairs with a Unit. |
| | `"WHEN_LINKED"` | `【When Linked】` — At the moment a Pilot pairs with a matching Unit to form a Link. |
| | `"DURING_PAIR"` | `【During Pair】` — Active or fires while this card is paired. |
| | `"DURING_LINK"` | `【During Link】` — Active or fires while this card is linked. |
| | `"BURST"` | `【Burst】` — When revealed from your Shield area as damage. |
| **Bracketed Activated** | `"ACTIVATE_MAIN"` | `【Activate･Main】` — Activated during your Main Phase on board. |
| | `"ACTIVATE_ACTION"` | `【Activate･Action】` — Activated during an **Action Step** on board. |
| | `"MAIN"` | `【Main】` — Command played during your Main Phase. |
| | `"ACTION"` | `【Action】` — Command played during an **Action Step**. |
| **Turn-Phase & Play** | `"END_OF_TURN"` | `"At the end of your turn,"` |
| | `"START_OF_OPPONENT_TURN"` | `"At the start of your opponent's turn,"` |
| | `"WHEN_PLAYING"` | `"When playing this card from your hand,"` |
| **Reactive Events** | `"WHEN_ATTACKED"` | When this Unit (or specified card) is attacked. |
| | `"WHEN_DESTROY_BY_BATTLE"` | When a Unit destroys an enemy card/Unit with battle damage. |
| | `"WHEN_DEAL_DAMAGE"` | When a card deals battle or effect damage. |
| | `"WHEN_RECEIVE_DAMAGE"` | When a card/shield receives damage. |
| | `"WHEN_RECOVER_HP"` | When a Unit recovers HP. |
| | `"WHEN_UNIT_DEPLOYED"` | When a friendly/enemy Unit is deployed. |
| | `"WHEN_UNIT_PAIRED"` | When another Unit is paired with a Pilot. |
| | `"WHEN_UNIT_LINKED"` | When another Unit becomes linked. |
| | `"WHEN_UNIT_DESTROYED"` | When a Unit is destroyed (in general or by effect). |
| | `"WHEN_RESTED"` | When a card is rested. |
| | `"WHEN_BLOCKED"` | When an attack is blocked by `<Blocker>`. |
| | `"WHEN_PLACE_EX_RESOURCE"` | When a player places an EX Resource. |
| | `"WHEN_EXILE_EX_RESOURCE"` | When a player exiles an EX Resource. |
| | `"WHEN_ACTIVATE_COMMAND"` | When a player activates a Command card. |
| | `"WHEN_PAY_EFFECT_COST"` | When an effect cost is paid. |
| | `"WHEN_DRAW"` | When a player draws card(s) (outside normal draw phase or via effect). |
| | `"WHEN_AP_REDUCED"` | When a Unit's AP is reduced. |
| | `"WHEN_PLAY_CARD_WITH_EX_RESOURCE"` | When an EX Resource is spent to play a card. |
| **Static Fallback** | `"CONTINUOUS"` | Always-on timing for clauses without a trigger header (used for identity tags like `GRANT_PILOT_MODE` or `COUNT_UNITS`). |

### 6.2 `EffectDuration` (`$defs/EffectDuration`)

| Value | Meaning |
| :--- | :--- |
| `"THIS_TURN"` | Expires at the end of the current turn (`"during this turn"`). |
| `"THIS_BATTLE"` | Expires at the end of the current combat (`"during this battle"`). |
| `"NEXT_TURN"` | Persists into/through the opponent's next turn (e.g. `"during the start phase of your opponent's next turn"`). |
| `"CONTINUOUS"` | Permanent while the card/modifier remains in its active zone. |

### 6.3 `TriggerEvent` (`$defs/TriggerEvent`)

Attached to inline reactive `EFFECT_CLAUSE`s so the engine knows *who* triggered the event, *what* was affected, and *how*.

| Field | Required | Type / Values | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `EffectTiming` | Mirrors the reactive timing (e.g. `"WHEN_RECOVER_HP"`). |
| `actor` | No | `"SELF" \| "FRIENDLY" \| "ENEMY" \| "ANY"` | Who performed or suffered the event (`"SELF"` = this card). |
| `actorFilter` | No | `TargetSelector` | Extra filter on the acting card (e.g. `(AEUG)` Unit). |
| `targetKind` | No | `"UNIT" \| "SHIELD" \| "BASE" \| "ANY_ENEMY_CARD" \| "EX_RESOURCE" \| "COMMAND" \| "CARD"` | Kind of object affected by the trigger event. |
| `targetFilter` | No | `TargetSelector` | Extra filter on the affected object. |
| `damageType` | No | `"BATTLE" \| "EFFECT" \| "ANY"` | Distinguishes battle damage from effect damage on damage/destroy triggers. |
| `whileAttacking` | No | `boolean` | `true` when the trigger specifies `"while attacking"`. |
| `raw` | No | `string` | Raw trigger phrase for human inspection. |

### 6.4 `ActivationCost` (`$defs/ActivationCost`)

Costs printed before the colon (`：`, normalized as `<COST_SEP>`).

| Field | Required | Type | Meaning |
| :--- | :--- | :--- | :--- |
| `resourceCost` | No | `integer` | Number of Resources to rest (`②：` → `2`). |
| `restSelf` | No | `boolean` | `true` if `"Rest this Unit："` / `"Rest this Base："`. |
| `returnSelfToDeckBottom` | No | `boolean` | `true` if `"Return this card to the bottom of your deck："`. |
| `destroySelf` | No | `boolean` | `true` if `"Destroy this Unit："`. |
| `discardCount` | No | `integer` | Number of cards to discard from hand as cost. |
| `exileFromTrashCount` | No | `integer` | Number of cards to exile from your trash as cost. |
| `exileFilter` | No | `TargetSelector` | Filter restricting which trash cards count for `exileFromTrashCount` (e.g. `cardType: "COMMAND"`). |
| `raw` | No | `string` | Normalized cost phrase before `<COST_SEP>`. |

### 6.5 `PairFilter` (`$defs/PairFilter`) & `LinkRequirement` (`$defs/LinkRequirement`)

- **`PairFilter` (`$defs/PairFilter`):** Appears on `【When Paired･...】` / `【During Pair･...】` clauses when only specific Pilots qualify.
  - `trait` (`string`): Required Pilot trait, e.g. `"White Base Team"`.
  - `color` (`CardColor`): Required Pilot color.
  - `lvMin` / `lvMax` (`integer`): Minimum or maximum Pilot level.
- **`LinkRequirement` (`$defs/LinkRequirement`):** Attached to every `WHEN_LINKED` / `DURING_LINK` clause (including nested `GRANT_CLAUSE` abilities) so Link checks never touch prose.
  - `role` (required): `"UNIT_REQUIRES_PILOT"` (Unit listing which Pilots link with it) or `"PILOT_MATCHING_UNIT"` (Pilot/Command-Pilot advertising its names and traits for matching Units).
  - `names` (required `string[]`): Pilot names (including `NAME_ALIAS` names).
  - `traits` (required `string[]`): Matching traits (e.g. `["G Generation"]`).
  - `raw` (required `string`): Original `[Link]` label or formatted Pilot summary.

---

## 7. Guard Conditions (`EffectCondition`)

`$defs/EffectCondition` is a `oneOf` union of **24 structured predicates** checked before resolving an ability or conditional step (`IF_CONDITION`). Every variant is tagged by `kind`.

| `kind` | Required Fields | Optional Fields | Plain-English Meaning |
| :--- | :--- | :--- | :--- |
| `"DEPLOYED_FROM_ZONE"` | `kind`, `zone` (`"trash" \| "hand"`) | — | True if this Unit was deployed from the specified zone. |
| `"TRASH_COUNT_AT_LEAST"` | `kind`, `count` (`integer`) | `owner` (`"SELF" \| "ENEMY"`), `color` (`CardColor`), `trait`, `traits`, `cardType`, `nameContains` | True if the trash contains at least `count` matching cards. |
| `"FRIENDLY_BASE_IN_PLAY"` | `kind` | `color` (`CardColor`), `trait` | True if you control a Base in play (optionally matching `color` or `trait`). |
| `"SELF_AP_AT_LEAST"` | `kind`, `minAp` (`integer`) | — | True if this Unit's effective AP is `>= minAp`. |
| `"UNIT_TRAIT_IS"` | `kind`, `trait` | `traits` (`string[]`) | True if the acting/paired Unit has the given trait(s). |
| `"IS_YOUR_TURN"` | `kind` | — | True only during your turn (`"During your turn,"`). |
| `"IS_OPPONENT_TURN"` | `kind` | — | True only during your opponent's turn (`"During your opponent's turn,"`). |
| `"SELF_RESTED"` | `kind` | — | True if this Unit is currently rested. |
| `"DESTROYED_BY_BATTLE"` | `kind` | — | True if destruction occurred via battle damage rather than card effect. |
| `"UNIT_COUNT_AT_LEAST"` | `kind`, `owner` (`"ENEMY" \| "SELF" \| "ANY"`), `count` (`integer`) | — | True if `owner` has at least `count` Units in play. |
| `"DEVELOPMENT_EXILE"` | `kind`, `count` (`integer`) | — | True when `【Deploy･Development X】` exiles `count` qualifying cards from trash. |
| `"ALL_OF"` | `kind`, `conditions` (`EffectCondition[]`) | — | Logical **AND** — all nested conditions must pass. |
| `"ANY_OF"` | `kind`, `conditions` (`EffectCondition[]`) | — | Logical **OR** — at least one nested condition must pass. |
| `"NOT"` | `kind`, `condition` (`EffectCondition`) | — | Logical **NOT** — nested condition must be false. |
| `"BOARD_CARD_COUNT"` | `kind`, `owner` (`"SELF" \| "ENEMY" \| "ANY"`), `cardType` (`"UNIT" \| "PILOT" \| "BASE" \| "UNIT_TOKEN"`) | `min`, `max`, `other`, `rested`, `linked`, `paired`, `pairedPilotLvMax`, `color`, `notColor`, `traits`, `keyword`, `nameContains`, `lvMin`, `lvMax`, `apMax`, `hasDestroyedEffect` | Counts cards in play matching every supplied filter and checks `min <= count <= max`. `other: true` excludes the source card itself. |
| `"SELF_STATE"` | `kind` | `color`, `traits`, `linked`, `paired`, `pairedPilotLvMax`, `damaged`, `hpMin`, `hpMax`, `lvMin`, `lvMax`, `keyword`, `destroyedBy` (`owner`, `traits`, `cardEffect`), `attackingTarget` (`"ENEMY_UNIT" \| "ENEMY_PLAYER" \| "DAMAGED_ENEMY_UNIT"`), `battlingEnemy` (`keyword`, `lvMax`, `damaged`, `hasDestroyedEffect`, `apMaxRef`: `"SELF_AP"`), `pairedWithUnit` (`traits`, `nameContains`, `linkNames`, `lvMin`) | Inspects the state of the card itself (or its combat target / paired Unit / destroyer). `cardEffect: true` checks destruction by effect; `linkNames` checks the paired Unit's `[Link]` pilot names. |
| `"HAND_COUNT"` | `kind`, `owner` (`"SELF" \| "ENEMY"`) | `min`, `max` | Checks whether `owner`'s hand size is within `[min, max]`. |
| `"SHIELD_COUNT"` | `kind`, `owner` (`"SELF" \| "ENEMY" \| "ANY"`) | `min`, `max` | Checks remaining Shields within `[min, max]`. |
| `"RESOURCE_COUNT"` | `kind`, `owner` (`"SELF" \| "ENEMY"`) | `ex` (`boolean`), `min`, `max` | Checks Resource count (if `ex: true`, counts EX Resources specifically). |
| `"PLAYER_LV_AT_LEAST"` | `kind`, `minLv` (`integer`) | — | True if the player's current Lv. (resources/EX resources) is `>= minLv`. |
| `"ENEMY_PLAYER_COUNT_AT_LEAST"` | `kind`, `count` (`integer`) | — | Multi-player support: true if there are at least `count` enemy players. |
| `"TURN_HISTORY"` | `kind`, `event` (8 values below) | `traits` (`string[]`), `minCost` (`integer`), `other` (`boolean`) | True if the specified `event` already occurred earlier this turn. |
| `"EX_RESOURCE_USED_TO_PLAY"` | `kind` | — | True if at least one EX Resource was spent to play this card. |
| `"PHASE_AT_START_OF_OPPONENT_TURN"` | `kind` | — | Guard paired with `START_OF_OPPONENT_TURN` timing when phrased as an `"if ... at the start of your opponent's turn"` condition. |

### `TURN_HISTORY.event` Values

| `event` Value | What Happened Earlier This Turn |
| :--- | :--- |
| `"ACTIVATED_COMMAND"` | You activated a Command card (optionally matching `traits`). |
| `"UNIT_DESTROYED_BY_EFFECT"` | A Unit was destroyed by a card effect. |
| `"PAID_EFFECT_COST_AT_LEAST"` | You paid at least `minCost` resources for an effect cost. |
| `"DRAWN_BY_EFFECT"` | You drew card(s) via a card effect. |
| `"NO_ENEMY_ATTACKED"` | No enemy Unit attacked during the turn (used on end-of-turn checks). |
| `"PAIRED_UNIT_DESTROYED_ENEMY_BY_BATTLE"` | One of your paired Units destroyed an enemy Unit by battle. |
| `"FRIENDLY_UNIT_DEPLOYED"` | You deployed another friendly Unit (often with `other: true` and `traits`). |
| `"SET_RESOURCE_ACTIVE_BY_EFFECT"` | A Resource was set active by an effect. |

---

## 8. Target Selectors & Dynamic Scaling (`TargetSelector` & `ScaleMetric`)

### 8.1 `TargetSelector` (`$defs/TargetSelector` — 31 Properties)

`TargetSelector` describes *which* cards or players an action, filter, or modifier targets. Only `owner` is required.

| Property | Type / Allowed Values | Meaning |
| :--- | :--- | :--- |
| `owner` *(required)* | `"ENEMY" \| "SELF" \| "ANY" \| "ALL_PLAYERS"` | Whose cards/players are eligible. |
| `self` | `boolean` | `true` means *"this card / this Unit itself"*. |
| `other` | `boolean` | `true` excludes the source card itself (`"another ..."`). |
| `cardType` | `"UNIT" \| "PILOT" \| "BASE" \| "COMMAND" \| "SHIELD" \| "RESOURCE" \| "CARD" \| "EX_RESOURCE" \| "UNIT_TOKEN"` | Restricts target kind (`"CARD"` matches any card type). |
| `zone` | `"BATTLE_AREA" \| "TRASH" \| "HAND" \| "DECK" \| "SHIELD" \| "RESOURCE"` | Zone where the targets reside. |
| `count` | `integer \| "ALL" \| "UP_TO"` | Exact number of targets (`1`), every matching target (`"ALL"`), or optional range (`"UP_TO"`, paired with `maxCount`). |
| `maxCount` | `integer` | Upper bound when `count` is `"UP_TO"` (e.g. `"1 to 2"` → `count: "UP_TO", maxCount: 2`). |
| `countRef` | `"ENEMY_PLAYERS" \| "COUNTED_VALUE"` | Dynamic count: 1 per enemy player (`"ENEMY_PLAYERS"`) or equal to a preceding `COUNT_UNITS` result (`"COUNTED_VALUE"`). |
| `lvMin` / `lvMax` | `integer` | Inclusive Lv. bounds (`Lv.5 or lower` → `lvMax: 5`). |
| `lvMaxRef` | `"SELF_LV" \| "COUNTED_VALUE"` | Dynamic Lv. cap equal to this card's Lv. or a `COUNT_UNITS` tally. |
| `lvRank` | `"LOWEST" \| "HIGHEST"` | Selects only targets tied for lowest or highest Lv. |
| `apMin` / `apMax` | `integer` | Inclusive AP bounds (`5 or less AP` → `apMax: 5`). |
| `apMaxRef` | `"SELF_AP"` | Dynamic AP cap equal to this Unit's effective AP. |
| `hpMin` / `hpMax` | `integer` | Inclusive current HP bounds (exact `1 HP` sets both `hpMin: 1` and `hpMax: 1`). |
| `hpRank` | `"LOWEST" \| "HIGHEST"` | Selects only targets tied for lowest or highest HP. |
| `state` | `"ACTIVE" \| "RESTED" \| "DAMAGED"` | Required board status. |
| `trait` | `string` | Single required trait (e.g. `"G Generation"`). |
| `traits` | `string[]` | List of accepted traits (matched as listed by the clause). |
| `color` / `notColor` | `CardColor` | Requires (`color`) or excludes (`notColor`) a specific color. |
| `token` / `excludeToken` | `boolean` | `token: true` matches only tokens; `excludeToken: true` forbids tokens. |
| `linked` | `boolean` | `true` matches only linked Units; `false` matches unlinked Units. |
| `paired` | `boolean \| "NONE"` | `true` = has a paired Pilot; `false` or `"NONE"` = has no paired Pilot. |
| `keyword` | `KeywordName` | Target must have this keyword (e.g. `"Blocker"`). |
| `hasDestroyedEffect` | `boolean` | `true` if target must possess a `【Destroyed】` ability. |
| `nameContains` | `string` | Card name must contain this substring (e.g. `"Gundam Lfrith"`). |
| `excludeName` | `string` | Card name must **not** equal/contain this string. |

### 8.2 `ScaleMetric` (`$defs/ScaleMetric`)

Used in `scaleBy` (on `DEAL_DAMAGE`, `MODIFY_AP`, `MODIFY_HP`, `DRAW`, `DISCARD`, `GRANT_KEYWORD`, `MODIFY_STAT`) or `perTarget` (on `COST_REDUCTION`) when an effect scales `"by an amount equal to ..."`.

| Field | Required | Type / Values | Meaning |
| :--- | :--- | :--- | :--- |
| `metric` | Yes | `"HAND_COUNT" \| "TRASH_COUNT" \| "BOARD_UNIT_COUNT" \| "ENEMY_UNIT_COUNT" \| "ENEMY_PLAYER_COUNT" \| "RESTED_ENEMY_UNIT_COUNT" \| "SELF_DAMAGE" \| "PAID_COST" \| "AFFECTED_COUNT" \| "DRAWN_COUNT"` | Quantity multiplied by `amount` or `delta`: hand size, trash count, board Units, enemy Units, enemy players, rested enemy Units, damage counters on self (`SELF_DAMAGE`), resources paid (`PAID_COST`), targets affected (`AFFECTED_COUNT`), or cards drawn (`DRAWN_COUNT`). |
| `owner` | No | `"SELF" \| "ENEMY" \| "ANY"` | Whose zone/board is counted. |
| `cardType` | No | `"UNIT" \| "PILOT" \| "BASE" \| "COMMAND" \| "CARD" \| "UNIT_TOKEN"` | Filter counted cards by type. |
| `traits` | No | `string[]` | Filter counted cards by trait(s). |
| `nameContains` | No | `string` | Filter counted cards by name substring. |
| `uniqueNames` | No | `boolean` | `true` counts distinct card names rather than total copies (e.g. `GD03-089`). |
| `rested` | No | `boolean` | `true` counts only rested cards. |

---

## 9. Resolution Steps (`EffectStep`)

`$defs/EffectStep` is a `oneOf` union of **37 action objects** discriminated by `action`. Steps inside `steps` execute in order from top to bottom.

### 9.1 Self-Movement & Card Play

| `action` | Required Fields | Optional Fields | Meaning & Example |
| :--- | :--- | :--- | :--- |
| `"ADD_SELF_TO_HAND"` | `action` | — | Adds this card itself to its owner's hand (standard `【Burst】` on Pilots/Commands). |
| `"DEPLOY_SELF"` | `action` | — | Deploys this card itself into play (standard `【Burst】` on Bases/Units). |
| `"ACTIVATE_MAIN_EFFECT"` | `action` | `target`, `fromDiscard` (`boolean`) | Triggers/resolves a card's `【Main】` effect (optionally from trash when `fromDiscard: true`). |
| `"DEPLOY_FROM_TRASH"` | `action`, `free` (`boolean`), `target` | `rested` (`boolean`) | Deploys `target` from trash (`free: true` = without paying its cost; `rested: true` = enters rested). |
| `"DEPLOY_FROM_HAND"` | `action`, `target` | `free` (`boolean`), `rested` (`boolean`) | Deploys `target` from hand (`free` / `rested` optional). |
| `"DEPLOY_FROM_TOP_DECK"` | `action`, `target` | — | Deploys a revealed qualifying card directly from the top of the deck. |
| `"PAIR_SELF_FROM_TRASH"` | `action`, `target` | — | Pairs this Pilot card from the trash with `target` Unit. |
| `"PAIR_FROM_HAND"` | `action`, `target` | `pilotFilter` (`TargetSelector`) | Pairs a Pilot (filtered by `pilotFilter`) from hand onto `target` Unit. |
| `"DEPLOY_TOKEN"` | `action`, `count` (`integer`) | `ap`, `hp`, `name`, `traits`, `owner` (`"SELF" \| "ENEMY" \| "DESTROYED_OWNER"`), `baseToken` (`boolean`), `exBase` (`boolean`) | Creates `count` Unit or Base/EX Base tokens with the specified stats and traits. |

### 9.2 Combat, Damage, Stats & Board Manipulation

| `action` | Required Fields | Optional Fields | Meaning |
| :--- | :--- | :--- | :--- |
| `"DESTROY"` | `action`, `target` | — | Destroys `target` (Unit, Base, or Shield). |
| `"DEAL_DAMAGE"` | `action`, `amount` (`integer`), `target` | `scaleBy` (`ScaleMetric`) | Deals `amount` (or `amount * scaleBy`) effect damage to `target`. |
| `"RECOVER_HP"` | `action`, `amount` (`integer`), `target` | — | Heals `amount` damage from `target`. |
| `"MODIFY_AP"` | `action`, `delta` (`integer`), `target` | `scaleBy` (`ScaleMetric`), `duration` (`EffectDuration`) | Adjusts `target`'s AP by `delta` (positive buff or negative debuff). |
| `"MODIFY_HP"` | `action`, `delta` (`integer`), `target` | `scaleBy` (`ScaleMetric`), `duration` (`EffectDuration`) | Adjusts `target`'s HP by `delta`. |
| `"REST"` | `action`, `target` | — | Rests `target` (turns from active to rested). |
| `"SET_ACTIVE"` | `action`, `target` | — | Sets `target` as active (readies a rested card/resource). |
| `"FREEZE"` | `action`, `target` | — | Prevents `target` from setting active during the next start phase. |
| `"BOUNCE"` | `action`, `target` | — | Returns `target` from the Battle Area to its owner's hand. |
| `"RETURN_TO_DECK"` | `action`, `target` | `position` (`"TOP" \| "BOTTOM" \| "SHUFFLE"`), `shuffle` (`boolean`) | Returns `target` to top/bottom of deck or shuffles it into the deck. |
| `"COUNT_UNITS"` | `action`, `target` | `plusSelf` (`boolean`) | Tallies Units matching `target` (plus 1 if `plusSelf: true`) for a downstream `COUNTED_VALUE` selector. |

### 9.3 Cards, Hand, Deck, Trash & Resources

| `action` | Required Fields | Optional Fields | Meaning |
| :--- | :--- | :--- | :--- |
| `"DRAW"` | `action`, `count` (`integer`) | `scaleBy`, `bothPlayers` (`boolean`), `optional` (`boolean`), `targetOwner` (`"SELF" \| "ENEMY" \| "ALL_PLAYERS"`) | Draws `count` cards. |
| `"DISCARD"` | `action`, `count` (`integer`) | `scaleBy`, `targetOwner` (`"SELF" \| "ENEMY" \| "ALL_PLAYERS"`), `target`, `optional` (`boolean`) | Discards `count` cards from hand. |
| `"LOOK_TOP"` | `action`, `count` (`integer`) | `revealSearch` (`boolean`), `trashRest` (`boolean`), `trait`, `target`, `remainderPosition` (`"TOP" \| "BOTTOM" \| "TRASH"`) | Looks at top `count` cards of deck, optionally searching/trashing/reordering the rest. |
| `"REVEAL_TOP"` | `action`, `count` (`integer`) | — | Reveals top `count` cards of the deck. |
| `"REVEAL_FROM_HAND"` | `action`, `target` | — | Reveals matching card(s) from hand. |
| `"ADD_SHIELD_TO_HAND"` | `action`, `count` (`integer`) | — | Moves `count` Shield cards into hand (typical Base `【Deploy】`). |
| `"ADD_FROM_TRASH_TO_HAND"` | `action`, `target` | — | Recovers matching card(s) from trash to hand. |
| `"MILL"` | `action`, `count` (`integer`) | — | Sends top `count` cards of the deck straight to trash. |
| `"EXILE"` | `action`, `target` | — | Exiles `target` from the game (commonly from trash). |
| `"ADD_RESOURCE"` | `action`, `count` (`integer`) | `ex` (`boolean`), `rested` (`boolean`) | Adds `count` Resources (`ex: true` = EX Resource tokens; `rested: true` = enters rested). |
| `"PAY_RESOURCE"` | `action`, `amount` (`integer`) | `optional` (`boolean`) | Pays `amount` resources mid-resolution (`"You may pay ①"`). |
| `"COST_REDUCTION"` | `action`, `amount` (`integer`) | `lvDelta` (`integer`), `zone` (`"HAND" \| "TRASH"`), `perTarget` (`ScaleMetric`), `exactCost` (`integer`), `exactLv` (`integer`) | Reduces play cost by `amount` (and Lv. by `lvDelta`), or sets fixed `exactCost` / `exactLv` (as in `EB01-039`). |

### 9.4 Grants, Identity, Combat Overrides & Restrictions

| `action` | Required Fields | Optional Fields | Meaning |
| :--- | :--- | :--- | :--- |
| `"GRANT_KEYWORD"` | `action`, `keyword` (`KeywordAbility`), `target` | `scaleBy`, `duration` | Grants a keyword ability (e.g. `<High-Maneuver>`) to `target`. |
| `"GRANT_TRAIT"` | `action`, `traits` (`string[]`), `target` | `duration` | Adds trait(s) to `target`. |
| `"GRANT_PILOT_MODE"` | `action`, `pilotName` (`string`) | — | Marks a **Command Pilot** card's `【Pilot】[Name]` identity (e.g. `EB01-076`). |
| `"NAME_ALIAS"` | `action`, `alias` (`string`) | — | Declares `"This card's name is also treated as [alias]"` (e.g. `GD02-098`). |
| `"DAMAGE_PROOF"` | `action` | `amount`, `maxDamage`, `damageType` (`"BATTLE" \| "EFFECT" \| "ANY"`), `duration`, `target`, `sourceFilter` | Prevents or reduces damage (`amount` / `maxDamage`) of `damageType` from `sourceFilter` onto `target`. |
| `"CANT_ATTACK"` | `action`, `target` | `duration` | Prevents `target` from declaring attacks for `duration`. |
| `"ALLOW_ATTACK_ACTIVE"` | `action`, `target` | — | Allows attacking active enemy Units matching `target`. |
| `"REDIRECT_ATTACK_TARGET"` | `action`, `rule` (`"MUST_ATTACK_TARGET" \| "CANT_CHOOSE_TARGET" \| "CANT_CHOOSE_SAME_PLAYER"`), `target` | `attackerFilter`, `duration` | Forces or forbids attack target selection. |
| `"REDIRECT_BATTLE_DAMAGE"` | `action`, `fromTarget`, `toTarget` | `duration` | Diverts battle damage from `fromTarget` to `toTarget` instead (e.g. `GD04-087`). |
| `"FORCE_BATTLE_DAMAGE_STEP"` | `action`, `attacker`, `defender` | — | Forces a battle damage comparison between `attacker` and `defender` outside normal attack declaration. |
| `"MODIFY_DAMAGE_DEALT"` | `action`, `delta` (`integer`) | `sourceFilter`, `targetFilter`, `duration` | Increases or decreases damage dealt by `delta` (`GD06-033`). |
| `"RESTRICTION"` | `action`, `rule` (14 values below), `target` | `sourceFilter`, `duration` | Applies a temporary or continuous rule restriction to `target`. |

**`RESTRICTION.rule` Allowed Values (14):**
`"CANT_BE_PAIRED"`, `"CANT_SET_ACTIVE"`, `"CANT_BE_RESTED"`, `"CAN_ATTACK_TURN_DEPLOYED"`, `"ONLY_ATTACK_WHEN_DEPLOYED"`, `"DEPLOYED_RESTED"`, `"INSTEAD_REST_TARGET"`, `"CANT_ACTIVATE_BLOCKER"`, `"CANT_BE_DESTROYED"`, `"CANT_BE_CHOSEN"`, `"CANT_BLOCK"`, `"CANT_CHOOSE_ENEMY_PLAYER"`, `"CANT_ATTACK"`, `"CANT_REDUCE_AP"`.

### 9.5 Control Flow (`IF_CONDITION`, `IF_PREVIOUS_SUCCEEDED`, `GRANT_CLAUSE`)

| `action` | Required Fields | Optional Fields | Meaning |
| :--- | :--- | :--- | :--- |
| `"IF_CONDITION"` | `action`, `condition` (`EffectCondition`), `thenSteps` (`EffectStep[]`) | `elseSteps` (`EffectStep[]`), `replacesPrevious` (`boolean`) | Branches on `condition`. When `replacesPrevious: true` (e.g. `"If you use an EX Resource..., choose 1 to 2 instead"`), `thenSteps` supersedes the preceding step instead of adding to it. |
| `"IF_PREVIOUS_SUCCEEDED"` | `action`, `thenSteps` (`EffectStep[]`) | `negated` (`boolean`), `filter` (`count`, `lvMin`, `cardType`, `traits`, `drawAccepted`, `placedFromDeck`) | Runs `thenSteps` only if the immediately preceding step actually resolved (`"If you do, ..."`), or failed (`negated: true` = `"If you did not, ..."`). `filter` checks properties of the card(s) acted on (`drawAccepted: true` when optional draw was taken; `placedFromDeck: true` when placed from top of deck). |
| `"GRANT_CLAUSE"` | `action`, `clause` (`EffectClause`), `target` | `duration` | Grants an entire triggered/activated `EffectClause` onto `target` for `duration`. |

---

## 10. Continuous Modifiers, Prohibitions & Replacement Outcomes

### 10.1 Continuous Modifier Payloads (`modifier`)

Inside a `CONTINUOUS_MODIFIER`, `modifier` is a `oneOf` union of **11 shapes** discriminated by `type`:

| `modifier.type` | Required Fields | Optional Fields | Meaning |
| :--- | :--- | :--- | :--- |
| `"MODIFY_STAT"` | `type`, `stat` (`"AP" \| "HP"`), `delta` (`integer`), `target` | `scaleBy` (`ScaleMetric`) | Passive `+delta` or `-delta` to AP or HP on `target`. |
| `"COST_REDUCTION"` | `type`, `amount` (`integer`), `target` | `lvDelta` (`integer`), `perTarget` (`ScaleMetric`) | Passive cost/Lv. reduction in hand. |
| `"GRANT_KEYWORD"` | `type`, `keyword` (`KeywordAbility`), `target` | `scaleBy` (`ScaleMetric`) | Passive keyword grant (`【During Pair】This Unit gains <High-Maneuver>`). |
| `"GRANT_TRAIT"` | `type`, `traits` (`string[]`), `target` | — | Passive trait grant. |
| `"NAME_ALIAS"` | `type`, `alias` (`string`) | — | Card name also counts as `[alias]` (`GD02-098`). |
| `"GRANT_PILOT_MODE"` | `type`, `pilotName` (`string`) | — | Command card can pair as a **Command Pilot** (`EB01-076`). |
| `"PROHIBITION"` | `type`, `rule` (`ProhibitionRule`), `target` | `sourceFilter` (`TargetSelector`), `damageMax` (`integer`), `additionalRules` (`ProhibitionRule[]`) | Passive `"can't ..."` rule protecting or restricting `target` (e.g. `EB01-014`). |
| `"ALLOW_ATTACK_ACTIVE"` | `type`, `target` | `defenderFilter` (`TargetSelector`) | Passive permission to attack active enemy Units (`EB01-031`, `ST02-001`). |
| `"FREEZE_AURA"` | `type`, `target` | — | Passive aura stopping matching enemy Units from setting active (`ST14-001`). |
| `"RESTRICTION"` | `type`, `rule` (`string`), `target` | `sourceFilter` (`TargetSelector`) | Passive rule restriction (such as `DEPLOYED_RESTED`). |
| `"REDIRECT_ATTACK_TARGET"` | `type`, `rule` (`"MUST_ATTACK_TARGET" \| "CANT_CHOOSE_TARGET" \| "CANT_CHOOSE_SAME_PLAYER"`), `target` | `attackerFilter` (`TargetSelector`) | Passive attack-target redirection or exclusion. |

### 10.2 `ProhibitionRule` (`$defs/ProhibitionRule` — 14 Values)

| Value | Meaning |
| :--- | :--- |
| `"CANT_ATTACK"` | Cannot declare attacks. |
| `"CANT_BLOCK"` | Cannot block attacks. |
| `"CANT_ACTIVATE_BLOCKER"` | Cannot activate `<Blocker>` abilities. |
| `"CANT_RECEIVE_BATTLE_DAMAGE"` | Immune to battle damage (optionally capped by `damageMax` or filtered by `sourceFilter`). |
| `"CANT_RECEIVE_EFFECT_DAMAGE"` | Immune to effect damage (`EB01-014`). |
| `"CANT_RECEIVE_DAMAGE"` | Immune to all damage (battle and effect). |
| `"CANT_REDUCE_AP"` | AP cannot be reduced by enemy effects. |
| `"CANT_CHOOSE_ENEMY_PLAYER"` | Cannot choose the enemy player as an attack target. |
| `"CANT_BE_CHOSEN"` | Cannot be chosen by enemy effects or attacks. |
| `"CANT_SET_ACTIVE"` | Cannot be set active during the start phase or by effects. |
| `"CANT_BE_RESTED"` | Cannot be rested by enemy effects. |
| `"CANT_BE_PAIRED"` | Cannot have a Pilot paired with it. |
| `"CANT_DEPLOY"` | Cannot be deployed. |
| `"CANT_BE_DESTROYED"` | Cannot be destroyed. |

### 10.3 Replacement Outcomes (`$defs/ReplacementOutcome`)

Inside `REPLACEMENT_EFFECT.outcome`, `kind` specifies what replaces the intercepted event:

| `outcome.kind` | Optional Fields | Meaning |
| :--- | :--- | :--- |
| `"PREVENT_DAMAGE"` | `damageType` (`"BATTLE" \| "EFFECT" \| "ANY"`), `target`, `steps` | Stops the incoming damage from being dealt. |
| `"REST_OTHER"` | `damageType`, `target`, `steps` | Rests `target` instead of resting the original card (`GD03-079`). |
| `"PREVENT_DESTROY"` | `damageType`, `target`, `steps` | Prevents destruction (`steps` can perform the alternative cost, e.g. resting/discarding). |
| `"PREVENT_MOVE"` | `damageType`, `target`, `steps` | Prevents the card from leaving its current zone. |

---

## 11. Deck-Building Metadata (`synergy` & `prerequisites`)

### 11.1 `CardSynergyProfile` (`$defs/CardSynergyProfile` & `SynergyNodeKey`)

`synergy` powers the deck builder's Knowledge Map with two arrays (`requires` and `enables`) using nine canonical `SynergyNodeKey` mechanics:

| `SynergyNodeKey` | When in `enables` (Card Produces This) | When in `requires` (Card Wants This) |
| :--- | :--- | :--- |
| `"DEPLOY_FROM_TRASH"` | Deploys cards from trash (`DEPLOY_FROM_TRASH`). | Has a bonus/condition for being deployed from trash (`DEPLOYED_FROM_ZONE: "trash"`). |
| `"TRASH_COUNT_FUEL"` | Fills the trash (`DISCARD`, `MILL`, `LOOK_TOP` with `trashRest`). | Scales or gates on trash card count (`TRASH_COUNT_AT_LEAST`). |
| `"AP_THRESHOLD_5"` | Boosts friendly AP (`MODIFY_AP`, `<Support>`). | Checks `SELF_AP_AT_LEAST` with `minAp >= 5`. |
| `"DAMAGED_ENEMY_TARGET"` | Deals effect damage to enemy cards (`DEAL_DAMAGE`). | Targets `state: "DAMAGED"` enemies. |
| `"RESTED_ENEMY_TARGET"` | Rests enemy cards (`REST` on `owner: "ENEMY"`). | Targets `state: "RESTED"` enemies. |
| `"PLAYER_LV_UP"` | Places regular (non-EX) Resources (`ADD_RESOURCE` with `!ex`). | Checks `PLAYER_LV_AT_LEAST` (`You are Lv.X or higher`) or Lv.7+ cards. |
| `"RESOURCE_RAMP"` | Places temporary EX Resources (`ADD_RESOURCE` with `ex: true`). | Checks `RESOURCE_COUNT` (`ex: true`), `EX_RESOURCE_USED_TO_PLAY`, or EX-Resource play bonuses. |
| `"RESOURCE_ACTIVATE"` | Sets friendly Resources active (`SET_ACTIVE` on `RESOURCE`). | Requires prior Resource-activation state (`TURN_HISTORY: SET_RESOURCE_ACTIVE_BY_EFFECT`). |
| `"AP_REDUCTION"` | Reduces enemy Unit AP (`MODIFY_AP` on `ENEMY` with negative `delta`). | Targets `apMax` enemy Units (`apMax` filter, including `ALLOW_ATTACK_ACTIVE` `defenderFilter.apMax`). |

### 11.2 `EffectPrerequisite` (`$defs/EffectPrerequisite`)

Lists deck-building support requirements inferred from `abilities` so the deck builder warns if a card lacks partners.

| Field | Required | Type / Values | Meaning |
| :--- | :--- | :--- | :--- |
| `kind` | Yes | `"TRAIT" \| "COLOR" \| "CARD_TYPE" \| "NAME" \| "LINK"` | Type of deck support needed. |
| `trait` | No | `string` | Required single trait (e.g. `"White Base Team"`). |
| `color` | No | `CardColor` | Required card color. |
| `cardType` | No | `"UNIT" \| "PILOT" \| "BASE" \| "COMMAND" \| "CARD"` | Required card type of the supporting cards. |
| `nameContains` | No | `string` | Required name substring in supporting cards. |
| `anyNames` | No | `string[]` | Any one of these Pilot/Unit names satisfies the requirement (used for `LINK`). |
| `anyTraits` | No | `string[]` | Any one of these traits satisfies the requirement. |
| `minCopies` | Yes | `4 \| 8` | Minimum deck copy density recommended to activate this prerequisite reliably (`4` for secondary/Link/standard; `8` for heavy build-around thresholds). |
| `primaryClause` | Yes | `boolean` | `true` if the card's main non-Burst payoff depends on this prerequisite; `false` for secondary bonuses or `LINK` hints. |
| `reason` | Yes | `string` | Human-readable explanation shown in deck validation UI (e.g. `"Requires (White Base Team) Pilot"`). |

---

## 12. End-to-End Real-Card Walkthroughs

### Walkthrough 1: Keyword + Paired Continuous Buff (`ST01-001` — *Gundam*)

**Raw text in `data/collections/ST01.json`:**
> `<Repair 2> (At the end of your turn, this Unit recovers the specified number of HP.)`
> `【During Pair】During your turn, all your Units get AP+1.`

**Compiled JSON in `data/effects/ST01.json`:**

```json
{
  "cardNo": "ST01-001",
  "sourcePrintId": "ST01-001",
  "name": "Gundam",
  "type": "UNIT",
  "color": "Blue",
  "keywords": [{ "name": "Repair", "value": 2 }],
  "abilities": [
    {
      "kind": "CONTINUOUS_MODIFIER",
      "clauseIndex": 0,
      "raw": "【During Pair】During your turn, all your Units get AP+1.",
      "layer": 3,
      "activeIn": "BATTLE_AREA",
      "requiresPair": true,
      "condition": { "kind": "IS_YOUR_TURN" },
      "duration": "CONTINUOUS",
      "modifier": {
        "type": "MODIFY_STAT",
        "stat": "AP",
        "delta": 1,
        "target": { "owner": "SELF", "cardType": "UNIT", "count": "ALL" }
      }
    }
  ],
  "synergy": { "requires": [], "enables": ["AP_THRESHOLD_5"] },
  "prerequisites": []
}
```

**How to read it:** Line 1 is an innate keyword (`Repair`, `value: 2`), so it sits in `keywords` (reminder text in parentheses is stripped). Line 2 has no trigger action—it is an always-on stat modifier (`layer: 3`) active only in `BATTLE_AREA` while paired (`requiresPair: true`) and during your turn (`condition.kind: "IS_YOUR_TURN"`), adding `+1` `AP` to `ALL` `SELF` `UNIT`s. Because it boosts friendly AP, `synergy.enables` gains `"AP_THRESHOLD_5"`.

---

### Walkthrough 2: Activation Cost + Rest + Freeze Restriction (`EB01-001` — *Gundam Astray Red Frame Custom (EX)*)

**Raw text in `data/collections/EB01.json`:**
> `【Activate･Main】【Once per Turn】Exile 2 Command cards from your trash from the game：Choose 1 damaged enemy Unit that is Lv.7 or lower. Rest it. It won't be set as active during the start phase of your opponent's next turn.`

**Compiled JSON in `data/effects/EB01.json`:**

```json
{
  "kind": "EFFECT_CLAUSE",
  "clauseIndex": 0,
  "raw": "【Activate<DOT>Main】【Once per Turn】Exile 2 Command cards from your trash from the game<COST_SEP>Choose 1 damaged enemy Unit that is Lv.7 or lower. Rest it. It won't be set as active during the start phase of your opponent's next turn.",
  "timings": ["ACTIVATE_MAIN"],
  "oncePerTurn": true,
  "cost": {
    "exileFromTrashCount": 2,
    "exileFilter": { "owner": "SELF", "cardType": "COMMAND", "count": 2, "zone": "TRASH" }
  },
  "steps": [
    {
      "action": "REST",
      "target": { "owner": "ENEMY", "cardType": "UNIT", "count": 1, "state": "DAMAGED", "lvMax": 7 }
    },
    {
      "action": "RESTRICTION",
      "rule": "CANT_SET_ACTIVE",
      "target": { "owner": "ENEMY", "cardType": "UNIT", "count": 1, "state": "DAMAGED", "lvMax": 7 },
      "duration": "NEXT_TURN"
    }
  ]
}
```

**How to read it:** `timings` (`["ACTIVATE_MAIN"]`) and `oncePerTurn: true` come from the two brackets. Everything before `<COST_SEP>` (`：`) becomes `cost` (`exileFromTrashCount: 2` restricted by `exileFilter` to `COMMAND` cards in your `TRASH`). The two sentences after the colon become two sequential `steps`: `REST` the `DAMAGED` `ENEMY` `UNIT` (`lvMax: 7`), then apply `RESTRICTION` (`CANT_SET_ACTIVE`) for `NEXT_TURN`.

---

### Walkthrough 3: Conditional `IF_CONDITION` with `replacesPrevious` + Command Pilot (`GD04-106` — *Indiscriminate Violence*)

**Raw text in `data/collections/GD04.json`:**
> `【Main】Choose 1 friendly (Academy) Unit. During this turn, it may choose an active enemy Unit with 5 or less AP as its attack target. If you use an EX Resource to play this card, choose 1 to 2 friendly (Academy) Units instead.`
> `【Pilot】[Norea Du Noc]`

**How to read `abilities` in `data/effects/GD04.json`:**
1. `abilities[0]` is an `EFFECT_CLAUSE` with `timings: ["MAIN"]`. Its first step is `ALLOW_ATTACK_ACTIVE` (targeting `ACTIVE` enemy Units with `apMax: 5`). Its second step is `IF_CONDITION` with `condition: { "kind": "EX_RESOURCE_USED_TO_PLAY" }` and `"replacesPrevious": true`—meaning if you spent an EX Resource, `thenSteps` (`count: "UP_TO"`, `maxCount: 2`, `trait: "Academy"`) replaces the single-target selection instead of stacking with it.
2. `abilities[1]` is a Layer 2 `CONTINUOUS_MODIFIER` (`activeIn: "HAND"`) with `modifier: { "type": "GRANT_PILOT_MODE", "pilotName": "Norea Du Noc" }`, marking this Command as a **Command Pilot**.

---

### Walkthrough 4: Replacement Effect (`GD03-079` — *G-Defenser*)

**Raw text in `data/collections/GD03.json`:**
> `When you rest your Base with one of your Units' effects, you may rest this Unit instead.`

**How to read `abilities[0]` in `data/effects/GD03.json`:**
- `kind: "REPLACEMENT_EFFECT"`, `scope: "ACTIVE_ZONE"`, `intercepts: "WOULD_REST"`, `optional: true` (because of *"you may"*), `maxPerEventInstance: 1`.
- `outcome`: `{ "kind": "REST_OTHER", "target": { "owner": "SELF", "self": true, "cardType": "UNIT" } }` — instead of resting the Base, you rest G-Defenser itself.

---

### Walkthrough 5: Custom Hook (`ST01-015` — *White Base*)

**Raw text in `data/collections/ST01.json`:**
> `【Activate･Main】【Once per Turn】②：Deploy 1 [Gundam]((White Base Team)･AP3･HP3) Unit token if you have no Units in play, deploy 1 [Guncannon]((White Base Team)･AP2･HP2) Unit token if you have only 1 Unit in play, or deploy 1 [Guntank]((White Base Team)･AP1･HP1) Unit token if you have 2 or more Units in play.`

**How to read `abilities[2]` in `data/effects/ST01.json`:**
- `kind: "CUSTOM_HOOK"`, `hookId: "ST01-015#2"`, `version: 3`, `timings: ["ACTIVATE_MAIN"]`, `cost: { "resourceCost": 2 }`.
- Because the 3-way unit-count token choice uses a dedicated handler in `CUSTOM_HOOK_REGISTRY`, the JSON records `hookId` + `version` plus three `IF_CONDITION` branches checking `BOARD_CARD_COUNT` (`0` -> `Gundam` 3/3, `1` -> `Guncannon` 2/2, `2+` -> `Guntank` 1/1) for both deck analysis and runtime token deployment.

---

## 13. Reverse Lookup: Card Text to JSON Field

| What You See on the Card | Where to Look in `CompiledCardEffect` |
| :--- | :--- |
| `<Repair 2>`, `<Blocker>`, `<Breach 3>` (standalone line) | `keywords[]` → `KeywordAbility` (`name`, `value`) |
| `gains <High-Maneuver>` | `abilities[]` → `GRANT_KEYWORD` step or modifier |
| `【Deploy】`, `【Attack】`, `【Main】`, `【Action】`, `【Burst】` | `EFFECT_CLAUSE.timings[]` |
| `【Once per Turn】` | `oncePerTurn: true` |
| `When ...` / `Whenever ...` (no bracketed timing) | `EFFECT_CLAUSE.timings[]` + `EFFECT_CLAUSE.triggerEvent` |
| `【During Pair】` / `【When Paired･(Trait) Pilot】` | `requiresPair: true` / `pairFilter` |
| `【During Link】` / `【When Linked】` | `linkRequirement` (or `requiresLink` on `CONTINUOUS_MODIFIER`) |
| `②：`, `Rest this Unit：`, `Exile 2 ... from your trash：` | `cost` (`ActivationCost`) |
| `During your turn, ...` / `If you have 3 or more ...` | `condition` (`EffectCondition`) |
| `... instead` (preventing damage/destruction/rest) | `REPLACEMENT_EFFECT` (`intercepts`, `outcome`) |
| `... instead` (upgrading a clause when a condition holds) | `IF_CONDITION` with `replacesPrevious: true` |
| `If you do, ...` / `If you did not, ...` | `IF_PREVIOUS_SUCCEEDED` (`negated: true` when *"did not"*) |
| `This Unit gets AP+1` / `can't receive effect damage` | `CONTINUOUS_MODIFIER` (`layer`, `activeIn`, `modifier`) |
| `【Pilot】[Name]` | `CONTINUOUS_MODIFIER` → `modifier.type: "GRANT_PILOT_MODE"` |
| `This card's name is also treated as [Name]` | `CONTINUOUS_MODIFIER` → `modifier.type: "NAME_ALIAS"` |
| `equal to the number of ...` | `scaleBy` (`ScaleMetric`) |
| `with 2 or less HP` / `with 1 HP` / `damaged enemy Unit` | `target` (`TargetSelector` — `hpMax`, `hpMin`, `state`) |
| Why deck builder flags `"Requires (Trait) Pilot"` | `prerequisites[]` (`EffectPrerequisite`) |
| Why Knowledge Map links two cards | `synergy.requires[]` & `synergy.enables[]` (`SynergyNodeKey`) |
