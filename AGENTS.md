# Agent instructions

## Voice: `caveman` full mode (compulsory)

Load the `caveman` skill at session start and keep it on for every chat reply until the user says "stop caveman" or "normal mode". Use the standard `caveman` voice (`full`), not `ultracave` or `megacave`.

Caveman governs chat only. Anything written outside chat is plain, complete prose: code, comments, commits, docs, ADRs, issues, PRs.

## Project context

- Issues and specs live in GitHub Issues. See `docs/agents/issue-tracker.md`.
- Domain docs use the single-context layout. See `docs/agents/domain.md`.
- Read `GLOSSARY.md` and the relevant `docs/adr/` entries before changing an area. Use glossary terms; do not drift to the words it says to avoid.
- Workflow, checks and data upkeep: `docs/making-changes.md`, `docs/data-maintenance.md`.

## Skill routing (load on demand, only when the task matches)

| Task | Skill |
| --- | --- |
| Build a feature or fix a bug test-first | `tdd` |
| New or changed domain term, GLOSSARY or ADR edit | `domain-modeling` |
| Rename, schema, data-shape or persisted-format change | `migration` |
| Restructure without changing behavior | `safe-refactor` |
| Unknown cause, failing or flaky behavior | `diagnosing-bugs` or `investigate-first` |
| Small bug fix at the narrowest layer | `surgical-patch` |
| Review a diff | `code-review` |
| Prove finished work, no new scope | `verify-and-stop` |

Do not preload skills. Two skills may apply to one task; load both and follow the precedence below.

## Precedence

When instructions conflict, the higher item wins:

1. The user's explicit request in the current session.
2. Safety rules: no data loss, no secrets in commits, confirm hard-to-reverse actions.
3. This file.
4. A loaded skill.
5. Tool and model defaults.

A skill never overrides this file. Caveman never shortens persisted text, security warnings, or confirmations of irreversible actions.

## Scope discipline

Make the smallest complete change. Reuse what the codebase already has. Do not add options, wrappers, or dependencies nobody asked for. Finish every caller, test, fixture and doc the change touches.

- Scoring and deck analysis read `card.compiledEffect` only. Never match card prose with regex in `lib/deck-engine.ts` or `lib/sandbox-engine.ts`.
- New non-trivial logic gets a test. A shortcut with a known limit gets a comment: `shortcut: <limit>, <when to upgrade>`.
- Before commit: `npm test`, `npx tsc --noEmit`, `npx eslint .`.
- End every reply with one or two lines: what you skipped or did not check, and any risk the user must know.
