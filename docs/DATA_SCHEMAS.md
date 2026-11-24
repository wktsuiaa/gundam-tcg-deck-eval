# Data JSON Schemas Reference

Technical specification for every JSON artifact generated and committed under `data/`. Each schema below is backed by a machine-readable **JSON Schema (Draft 2020-12)** contract under `docs/schemas/` and verified in CI against all real files on disk via `__tests__/data-schemas.test.ts`.

## Artifact Inventory & Pipeline Flow

| File / Directory | Producer | Runtime Consumer | JSON Schema |
| :--- | :--- | :--- | :--- |
| `data/packages.json` | `scripts/sync_catalog.py` | `lib/gundam-db.ts` (`readSplitJsonCatalog`) | [`docs/schemas/packages.schema.json`](./schemas/packages.schema.json) |
| `data/collections/<code>.json` | `scripts/sync_catalog.py` + `scripts/sync_rules.py` | `lib/gundam-db.ts`, `scripts/compile_effects.ts` | [`docs/schemas/collection-shard.schema.json`](./schemas/collection-shard.schema.json) |
| `data/rules.json` | `scripts/sync_rules.py` | `lib/gundam-db.ts` | [`docs/schemas/rules.schema.json`](./schemas/rules.schema.json) |
| `data/effects/<SET>.json` (**Effect Shards**) | `scripts/compile_effects.ts` (`npm run compile:effects`) | `lib/gundam-db.ts` → `lib/deck-engine.ts`, `lib/sandbox-engine.ts` | [`docs/schemas/effect-shard.schema.json`](./schemas/effect-shard.schema.json) |

All shard filenames are sanitized (`[A-Za-z0-9_-]+`) and path-confined to their respective directories.

---

## 1. Packages Index (`data/packages.json`)

An ordered JSON array of `GundamPackage` records (`26` products as of the latest sync).

| Field | Type | Nullable | Description & Constraints |
| :--- | :--- | :--- | :--- |
| `id` | `string` | No | Numeric upstream package ID (`^[0-9]+$`), e.g. `"619101"`. |
| `name` | `string` | No | Official display title, e.g. `"Newtype Rising [GD01]"`. |
| `code` | `string` | No | Bracketed set code (`"GD01"`, `"ST09"`, `"EB01"`, `"SC01"`) or numeric `id` fallback (`"619701"`, `"619901"`). |
| `category` | `string` | No | Enum: `"Booster Pack"`, `"Starter Deck"`, `"Special / Extra Set"`, `"Promotion"`, `"Basic Cards"`, `"Other Product"`. |
| `cardCount` | `integer` | No | Number of unique `printId` entries belonging to this package (`>= 0`). |

---

## 2. Collection Shards (`data/collections/<code>.json`)

Raw per-package card catalog shards (`26` files, `2,206` total print records across shards; multi-package promos/reprints appear in each package shard they belong to and are deduplicated by `printId` at SQLite/catalog load time).

### Top-Level Object

| Field | Type | Description |
| :--- | :--- | :--- |
| `syncedAt` | `string` | UTC ISO-8601 timestamp (`YYYY-MM-DDTHH:MM:SSZ`) from `sync_catalog.py`. |
| `source` | `string` | Upstream catalog URL (`https://www.gundam-gcg.com/asia-en/cards/`). |
| `package` | `GundamPackage` | Package metadata matching `data/packages.json`. |
| `cards` | `RawCardPrint[]` | Sorted list of card prints in this package. |

### `RawCardPrint` Record

Note: `lib/gundam-db.ts` hydrates an optional runtime-only `compiledEffect` property from `data/effects/` onto `GundamCardPrint`; `compiledEffect` is **never** written into `data/collections/*.json`.

| Field | Type | Nullable | Empirical Notes / Constraints |
| :--- | :--- | :--- | :--- |
| `printId` | `string` | No | Unique print identifier, e.g. `"ST09-001"` or `"ST09-001_p1"`. |
| `cardNo` | `string` | No | Base card number shared across parallel/reprint variants, e.g. `"ST09-001"`. |
| `name` | `string` | No | Card display name. |
| `rarity` | `string` | No | One of `C`, `C+`, `C++`, `U`, `U+`, `R`, `R+`, `LR`, `LR+`, `LR++`, `P`, `P+`, `LKC+`, `LKU+`, `LKR+`. |
| `blockIcon` | `string` | No | Block rotation icon string (e.g. `"1"`). |
| `lv` | `integer \| null` | **Yes** | `null` on Resources, EX Bases, EX Resources, and Tokens (`275` prints). |
| `cost` | `integer \| null` | **Yes** | `null` on Resources, EX Bases, EX Resources, and Tokens (`275` prints). |
| `color` | `string` | No | Enum: `"Blue"`, `"Green"`, `"Red"`, `"Purple"`, `"White"`, `"Colorless"`. |
| `type` | `string` | No | Enum: `"UNIT"`, `"PILOT"`, `"COMMAND"`, `"BASE"`, `"RESOURCE"`, `"EX BASE"`, `"EX RESOURCE"`, `"UNIT TOKEN"`, `"UNIT・TOKEN"`. |
| `effect` | `string` | No | Raw multi-line card prose (or `"-"` / `""` when vanilla). |
| `zones` | `string[]` | No | Deployment zones (`["Space", "Earth"]`, `[]` when `"-"`). |
| `traits` | `string[]` | No | Extracted parenthesized traits, e.g. `["ZAFT", "Minerva Squad"]`. |
| `link` | `string` | No | Raw `[Link]` requirement string, or `""` when none. |
| `apRaw` / `hpRaw` | `string` | No | Raw display string (`"3"`, `"+2"`, `"-"`) preserving `+` sign on Pilots. |
| `ap` / `hp` | `integer \| null` | **Yes** | Parsed integer value, or `null` when `"-"` (`594` `ap` nulls, `432` `hp` nulls). |
| `sourceTitle` | `string` | No | Series title, or `""` when `"-"` (ignored by deck-scoring algorithms). |
| `whereToGet` | `string` | No | Product acquisition label. |
| `imagePath` | `string` | No | Relative upstream artwork path, e.g. `"jp/images/cards/card/ST09-001.webp"`. |
| `isParallel` | `boolean` | No | `true` when `"_" in printId` or `"+" in rarity`. |
| `faqs` | `CardFaq[]` | No | Array of `{ q: string, a: string }` Q&A pairs (merged from detail page + `rules.json`). |
| `packageIds` / `packageNames` / `packageCodes` | `string[]` | No | Parallel arrays listing every package containing this `printId`. |

---

## 3. Official Rules & FAQs (`data/rules.json`)

Single document synced by `scripts/sync_rules.py` containing official deck-construction rules, turn structure, rulebook PDFs, general FAQs (`119` entries), and per-card FAQs (`334` `cardNo` keys).

| Field | Type | Description |
| :--- | :--- | :--- |
| `syncedAt` | `string` | UTC ISO-8601 timestamp. |
| `source` / `faqSource` | `string` | Upstream rules & FAQ index URLs. |
| `deckConstruction` | `object` | `{ mainDeckSize, resourceDeckSize, maxColors, maxCopiesPerCardNo, allowedMainTypes, allowedResourceTypes, startingHandSize, startingShieldCount, turnPhases: { phase, summary }[] }`. |
| `documents` | `RuleDocument[]` | `{ title, url }[]` pointing to official PDF playsheets & comprehensive rules. |
| `sections` | `RuleSection[]` | `{ id, title, category, summary, sourceUrl }[]`. |
| `generalFaqs` | `CardFaq[]` | `{ q, a }[]` for non-card-specific rules rulings. |
| `cardFaqs` | `Record<string, CardFaq[]>` | Map from `cardNo` → `{ q, a }[]`. |

---

## 4. Compiled Effect Shards (`data/effects/<SET>.json`)

Pre-compiled, deterministic **Effect Shards** (`28` files, `1,290` unique `cardNo` entries, `1,392` **Effect Clauses**, `100.0%` full AST coverage with `0` `RAW_CONDITION` and `0` `unparsedResidual` across the synced corpus) produced by `scripts/compile_effects.ts` from canonical non-parallel card prints (resolving historical errata/wording diffs in favor of the canonical non-parallel print).

Shards omit volatile timestamps so repeated compiler runs are byte-for-byte idempotent.

### Top-Level Object (`EffectShardFile`)

| Field | Type | Description |
| :--- | :--- | :--- |
| `schemaVersion` | `1` (const) | Schema format version (`1`). |
| `setPrefix` | `string` | `cardNo` prefix (`GD01`..`GD06`, `ST01`..`ST14`, `EB01`, `EXB`, `EXBP`, `EXR`, `EXRP`, `R`, `RP`, `T`, or `MISC`). |
| `cardCount` | `integer` | Exact count of keys in `effects` (`cardCount === Object.keys(effects).length`). |
| `effects` | `Record<string, CompiledCardEffect>` | Map keyed and sorted by `cardNo`. |

### `CompiledCardEffect` Record

| Field | Type | Description |
| :--- | :--- | :--- |
| `cardNo` | `string` | Canonical card number matching its parent key. |
| `sourcePrintId` | `string` | Canonical `printId` chosen for compilation (`!isParallel` preferred, lowest `printId` tiebreak). |
| `name` | `string` | Abstracted card name. |
| `type` | `string` | Abstracted card type (`UNIT`, `PILOT`, `COMMAND`, `BASE`, etc.). |
| `color` | `CardColor` | `Blue \| Green \| Red \| Purple \| White \| Colorless`. |
| `keywords` | `KeywordAbility[]` | Innate **Keyword Abilities** outside timing headers: `{ name: KeywordName, value: integer \| null }`. |
| `clauses` | `EffectClause[]` | Ordered compiled **Effect Clauses** (see below). |
| `synergy` | `CardSynergyProfile` | `{ requires: SynergyNodeKey[], enables: SynergyNodeKey[] }` for Knowledge Map edges. |
| `prerequisites` | `EffectPrerequisite[]` | Deck-composition requirements (`{ kind: "TRAIT" \| "COLOR" \| "CARD_TYPE" \| "NAME" \| "LINK", trait?, color?, cardType?, nameContains?, anyNames?, anyTraits?, minCopies: 4 \| 8, primaryClause, reason }`). |

### `EffectClause` & Union Discriminators

| Field | Type | Description |
| :--- | :--- | :--- |
| `raw` | `string` | Single clause line after parenthetical reminder-text stripping, modal header propagation, and `■` Development merging. |
| `timings` | `EffectTiming[]` | Non-empty array across 34 trigger/state timings: bracketed headers (`DEPLOY`, `ATTACK`, `DESTROYED`, `WHEN_PAIRED`, `WHEN_LINKED`, `DURING_PAIR`, `DURING_LINK`, `BURST`, `ACTIVATE_MAIN`, `ACTIVATE_ACTION`, `MAIN`, `ACTION`), turn/play headers (`END_OF_TURN`, `START_OF_OPPONENT_TURN`, `WHEN_PLAYING`), reactive **Trigger Events** (`WHEN_ATTACKED`, `WHEN_DESTROY_BY_BATTLE`, `WHEN_DEAL_DAMAGE`, `WHEN_RECEIVE_DAMAGE`, `WHEN_RECOVER_HP`, `WHEN_UNIT_DEPLOYED`, `WHEN_UNIT_PAIRED`, `WHEN_UNIT_LINKED`, `WHEN_UNIT_DESTROYED`, `WHEN_RESTED`, `WHEN_BLOCKED`, `WHEN_PLACE_EX_RESOURCE`, `WHEN_EXILE_EX_RESOURCE`, `WHEN_ACTIVATE_COMMAND`, `WHEN_PAY_EFFECT_COST`, `WHEN_DRAW`, `WHEN_AP_REDUCED`, `WHEN_PLAY_CARD_WITH_EX_RESOURCE`), or `CONTINUOUS`. |
| `oncePerTurn` | `boolean` | `true` when tagged `【Once per Turn】`. |
| `triggerEvent` | `TriggerEvent` (optional) | Structured reactive trigger metadata `{ kind, actor?, actorFilter?, targetKind?, targetFilter?, damageType?, whileAttacking?, raw? }` extracted when a clause is fired by an inline `When ...` / `Whenever ...` event (e.g., `WHEN_ATTACKED`, `WHEN_DESTROY_BY_BATTLE`) rather than a static aura. |
| `pairFilter` | `PairFilter` (optional) | `{ trait?, color?, lvMin?, lvMax? }` parsed from `【... Pilot】` headers. |
| `linkRequirement` | `LinkRequirement` (optional) | `{ role: "UNIT_REQUIRES_PILOT" \| "PILOT_MATCHING_UNIT", names: string[], traits: string[], raw: string }` attached to every `WHEN_LINKED` / `DURING_LINK` clause (`125` clauses across the catalog). |
| `cost` | `ActivationCost` (optional) | `{ resourceCost?, restSelf?, returnSelfToDeckBottom?, destroySelf?, discardCount?, exileFromTrashCount?, exileFilter?, raw? }`. |
| `condition` | `EffectCondition` (optional) | Recursive **Guard Condition** union discriminated by `kind`: `ALL_OF`, `ANY_OF`, `NOT`, `DEPLOYED_FROM_ZONE`, `TRASH_COUNT_AT_LEAST`, `FRIENDLY_BASE_IN_PLAY`, `SELF_AP_AT_LEAST`, `UNIT_TRAIT_IS`, `IS_YOUR_TURN`, `IS_OPPONENT_TURN`, `SELF_RESTED`, `DESTROYED_BY_BATTLE`, `UNIT_COUNT_AT_LEAST`, `DEVELOPMENT_EXILE`, `BOARD_CARD_COUNT`, `SELF_STATE`, `HAND_COUNT`, `SHIELD_COUNT`, `RESOURCE_COUNT`, `PLAYER_LV_AT_LEAST`, `ENEMY_PLAYER_COUNT_AT_LEAST`, `TURN_HISTORY`, `EX_RESOURCE_USED_TO_PLAY`, `PHASE_AT_START_OF_OPPONENT_TURN`, and future-sync escape hatch `RAW_CONDITION` (asserted `0` across committed shards). |
| `steps` | `EffectStep[]` | Ordered typed actions discriminated by `action` (47 variants, including scaling via `ScaleMetric`, exact `TargetSelector` bounds `hpMin` / `hpMax` / `hpRank` / `lvRank` / `linked` / `paired`, identity actions `GRANT_PILOT_MODE` / `NAME_ALIAS`, rule overrides `REDIRECT_ATTACK_TARGET` / `REDIRECT_BATTLE_DAMAGE` / `FORCE_BATTLE_DAMAGE_STEP` / `MODIFY_DAMAGE_DEALT` / `COUNT_UNITS` / `RESTRICTION`, and recursive control-flow steps `IF_CONDITION`, `IF_PREVIOUS_SUCCEEDED`, `GRANT_CLAUSE`). |
| `unparsedResidual` | `string` | Fail-closed future-sync escape hatch (`""` across all `1,392` committed clauses; logs `"Manual resolution required: ..."` in `lib/sandbox-engine.ts` if ever non-empty after a new card sync). |
