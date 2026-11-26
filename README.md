# Gundam Card Atlas

Competitive card catalog, strategy-driven deck builder, tactical analyzer, and 2-deck match sandbox for the **Gundam Card Game (GCG)** Asia-English edition.

## Key Capabilities

1. **Multi-Select Card Catalog**: Browse 2,200+ official card prints across 26 Asia-English sets with encapsulated multi-select filtering (`CatalogFilterPanel`), variant switching, Pilot–Unit `[Link]` discovery, and synced official card rulings.
2. **Consolidated Strategy & Visual Deck Builder (`Build & Cards`)**:
   - Starts on an empty **Custom Deck** (with Starter Presets available from the secondary menu).
   - One **Build Deck Strategy** (*Rush / Aggro*, *Midrange / Value*, *Control / Attrition*, *Ramp / Big Unit*, *Link / Synergy Combo*, *Burn / Ping*) plus up to two **Effect Styles** (*Attack / Ping*, *Board / Deploy*, *Removal / Disrupt*, *Draw / Recursion*, *Resource / Ramp*, *Link / Synergy*), each with inline descriptions.
   - **Trait + Pilot–Unit Linkage Coherence** (intentionally excludes Series and card FAQs from deck scoring).
   - Configurable **Generation Constraints** (Allowed Sets, Max Copies `1–4`, Max Cost, Max Lv., Rarity Cap, Strict Trait/Link Lock, and `Any (Auto Best 2)` color resolution) with live Pool Feasibility Checking.
   - **Visual Decklist** displaying card artwork thumbnails, card numbers, and quantities.
   - **Strict `<number> <cardNo>` Import/Export** + **ExBurst** (`https://exburst.dev/gundam/`) deck URL import & clipboard export.
   - **Official Rules & FAQs Modal** sourced from `data/rules.json`.
3. **Hexagon Telemetry & Playbook (`Hexagon & Matchups` / `Playbook & Mulligan`)**:
   - 6-axis Hexagon Radar (Aggro, Defense, Attack / Ping, Liquidity, Synergy, Control) with head-to-head overlays against Meta Archetypes, Starter Presets, and Saved Decks.
   - **Turn 1–6+ Best Action & Worst Action** sequencing cards.
   - Configurable **Turn-by-Turn Winning Chance %** model (Turn Order `1st`/`2nd`, Opponent Matchup, Opening Hand State).
   - Live 5-card Mulligan Simulator & Combo Detector.
4. **Interactive 2-Deck Match Sandbox (`Match Sandbox`)**:
   - Play any two saved or preset decks head-to-head across Battle Area, Shields, Base, Resources, Hand, and Trash.
   - Live **Best-Move Advisor** reacts to either side's latest action with Top 3 ranked moves, Win-Chance delta, and 1-click execution.
5. **Split Collection Shards, Local SQLite DB & Vercel-Ready Deployment**:
   - Cards are stored per collection in `data/collections/<code>.json` alongside `data/packages.json` and `data/rules.json`.
   - Locally, server-side `better-sqlite3` (`data/gundam.db`) auto-hydrates and deduplicates prints on startup.
   - On read-only serverless hosts (such as Vercel), the server automatically falls back to reading the bundled JSON shards into `memoryCache` (`outputFileTracingIncludes` bundles `./data/**/*`) without attempting SQLite writes, while live **Sync Cards** updates stay session-scoped in memory.
   - Weekly GitHub Actions workflow scrapes updated rules, FAQs, collections, and cards, runs tests/lint/build, and commits data updates.

## Quickstart

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

## Scripts

- `npm run dev` — Start Next.js development server on port 3000
- `npm test` — Run automated Vitest unit & integration test suite
- `npm run lint` — Run ESLint (flat config, `eslint.config.js`)
- `npm run compile:effects` — Recompile card effects into `data/effects/` shards
- `npm run build` — Build production bundle

## Documentation

- [Repository Architecture](docs/architecture.md)
- [Making Changes](docs/making-changes.md)
- [Data Maintenance](docs/data-maintenance.md)
- [Glossary](GLOSSARY.md) and [ADRs](docs/adr/)
- [Features & User Flows](docs/FEATURES_AND_USER_FLOW.md)
- [Calculations & Algorithms](docs/ALGORITHMS.md)
- [Data JSON Schemas](docs/DATA_SCHEMAS.md)
- [Effect Parsing & Triggers](docs/EFFECT_PARSING_AND_TRIGGERS.md)
- [Testing Flow & Verification](docs/TESTING.md)
