# Making Changes

## Setup

```bash
npm install --legacy-peer-deps   # vitest needs vite as a peer; add it with `npm i --no-save vite --legacy-peer-deps` if tests fail to start
npm test
```

## Loop

1. Read [GLOSSARY.md](../GLOSSARY.md) and any ADR in `docs/adr/` that touches the area.
2. Write one failing test at a public seam (`analyzeDeck`, `detectEffectStyles`, `parseCardAbilities`, `normalizeBlueprint`). Run only that file:
   ```bash
   npx vitest run __tests__/deck-engine.test.ts
   ```
3. Make it pass with the smallest change. Repeat.
4. Typecheck after each slice: `npx tsc --noEmit`.
5. Before pushing: `npm test`, `npx tsc --noEmit`, `npx eslint .`. All three must be clean.

## Compare evaluation output before and after a scoring change

`scripts/eval_snapshot.ts` prints hexagon, pacing, strategy, matchup scores for the six starter decks plus a generated deck as JSON.

```bash
npx vite-node -c vitest.config.mts scripts/eval_snapshot.ts > before.json
# change scoring
npx vite-node -c vitest.config.mts scripts/eval_snapshot.ts > after.json
diff before.json after.json
```

Axes you did not touch should not move. If they do, find out why before you commit.

## Rules of thumb

- Scoring reads `card.compiledEffect` only. Never regex `card.effect` in `lib/deck-engine.ts` or `lib/sandbox-engine.ts`.
- Strategy and effect-style names live in `TACTICAL_STYLE_META` / `EFFECT_STYLE_META` and `types/gundam.ts`. Rename in all three, and add a legacy mapping in `normalizeBlueprint` so saved decks keep working.
- A new domain term goes in `GLOSSARY.md`. A hard-to-reverse, surprising decision gets the next number in `docs/adr/`.
- Data shape changes follow [data-maintenance.md](data-maintenance.md).
- A source file stays at 500 lines or fewer (`max-lines` in `eslint.config.js`). Split along domain seams, never into `part1`/`utils`. Tests are exempt. Files still over the cap are listed in an exemption block in `eslint.config.js`; remove an entry when you split that file.
- Lint is flat config (`eslint.config.js`): correctness and readability rules only, no formatting rules.
