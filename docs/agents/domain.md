# Domain Docs

How engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- `GLOSSARY.md` at the repo root, if it exists
- `GLOSSARY-MAP.md` at the repo root, if it exists
- `docs/adr/`, for ADRs that touch the area being changed

If these files do not exist, proceed silently.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary vocabulary

When an output names a domain concept, use the term defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If an output contradicts an existing ADR, surface the conflict explicitly rather than silently overriding it.
