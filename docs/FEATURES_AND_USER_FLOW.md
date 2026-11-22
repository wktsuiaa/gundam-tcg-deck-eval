# Features & User Flows

## Workspace 1: Catalog (`CatalogWorkspace` + `CatalogFilterPanel`)

- **Goal**: Rapidly discover, filter, and inspect every official Asia-English card print and alternate art.
- **Encapsulated Multi-Select Filtering**:
  - Every facet supports selecting multiple values simultaneously: **OR** logic applies within a single facet (e.g., `Blue` OR `White`; `Lv. 2` OR `Lv. 3`), while **AND** logic applies across facets.
  - Long checklists (**Sets & Products**, **Traits**, **Link Conditions**, **Source Titles**) include inline search boxes inside the filter drawer.
- **Card Detail Drawer**: Clicking any card opens its high-resolution art, Alternate Art switcher, structured stats, keyword glossary, cross-linked Pilot/Unit partners, synced official card rulings (FAQs), and a 1-click **Add to Active Deck** action.

## Workspace 2: Deck Builder (`DeckWorkspace`)

- **Default Experience**: New users begin on an empty **Custom Deck** instead of a pre-loaded starter deck. Starter Presets remain accessible in a secondary dropdown menu.
- **Build & Cards (Consolidated Strategy + Card Editor)**:
  1. **Strategy & Constraints Generator** (collapsible top panel):
     - Select 1–2 **Target Colors** or **`Any (Auto Best 2)`**.
     - Pick **Target Pacing** (*Early Rush*, *Midrange Tempo*, *Late-Game Control*, *Ramp / Combo*) and optional **Trait Focus**.
     - Multi-select **Build Deck Strategies** (each displays a concise tactical description).
     - Multi-select **Effect Styles** (*AP Deduction*, *Destroy*, *Damage Proof*, *Repair*, *Bounce*, *Rest Lock*, *Direct Damage*, *Draw & Search*, *Trash Recursion*, *Resource Ramp*, *Combat Keywords*, *Token Deploy*).
     - Configure **Generation Limitations & Constraints**: Allowed Sets, Max Copies (`1–4`), Max Cost, Max Lv., Rarity Cap (`All`, `No LR`, `C/U/R Only`), and **Strict Trait / Link Lock**.
     - Inspect the live **Pool Feasibility Check** and click **Generate Legal 50+10 Deck**.
  2. **Card Search / Suggested Cards Panel (Left)**:
     - Switch between full keyword **Card Search** and strategy-ranked **Suggested Cards**.
     - Each suggested card displays its **Primary Hexagon Axis**, **Coherence Score**, matched **Effect Styles**, and **fit reason**.
  3. **Visual Decklist (Right)**:
     - Shows every card grouped by `UNIT`, `PILOT`, `COMMAND`, `BASE`, and `RESOURCE DECK` with card artwork thumbnails, card numbers, Lv/Cost, and `+/-` buttons.
- **Strict Format & ExBurst Integration**:
  - **Import**: Supports strict `<number> <cardNo>` lines (auto-routing `RESOURCE` cards to the Resource Deck and rejecting comments/`4x`/names) OR pasting a public `https://exburst.dev/gundam/deck/...` URL.
  - **Export**: Produces strict `<number> <cardNo>` text with **Copy Strict List**, **Copy Strict List & Open ExBurst**, and **Copy Shareable URL**.
- **Official Rules Modal**: Accessible from the Deck Builder status strip to inspect synced deck rules, turn phases, official PDF links, and searchable general FAQs.
- **Hexagon & Matchups**: Compare your deck's 6-axis Hexagon against Meta Archetypes, Starter Presets, or Saved Decks, inspect Cost/Level curves, and review matchup difficulty matrices.
- **Playbook & Mulligan**:
  - View **Turn 1–6+ Best Action & Worst Action** cards with featured card art.
  - Configure **Turn-by-Turn Winning Chance %** by Turn Order (`Going 1st` / `Going 2nd`), Opponent Archetype, and Opening Hand Quality (`Optimal` / `Average` / `Post-Mulligan`).
  - Run the live 5-card Test Hand & Mulligan Simulator.

## Workspace 3: Match Sandbox (`MatchSandbox`)

- **Setup**: Choose any two Saved Custom Decks or Starter Presets (`Side A` vs `Side B`) and assign who goes first.
- **Interactive Board**: Control either side manually (click playable hand cards to deploy Units, pair/link Pilots, deploy Bases, or cast Commands; attack Shields/Base or Rested enemy Units) or click **Auto-Step 1 Move** / **Auto-Play Turn**.
- **Reactive Best-Move Advisor**: Continuously evaluates the active board state and `lastOpponentAction` to rank the **Top 3 Best Moves** with expected Win-Chance delta (`+X%`), tactical explanation, and 1-click **Apply Move**.
