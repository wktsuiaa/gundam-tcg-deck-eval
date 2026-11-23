# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: post the explanation with `gh issue comment <number> --body "..."`, then `gh issue close <number>`

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

The target repository is `wktsuiaa/gundam-tcg-deck-eval`. File issues only in this repository.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Sub-issues and blocking

- **Make an issue a sub-issue**: use `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` with GitHub CLI 2.94+.
- **Add a blocker**: use `gh issue edit <child> --add-blocked-by <blocker>` with GitHub CLI 2.94+.
- Older GitHub CLI versions should fall back to `Part of #<parent>` or `Blocked by: #<n>, #<n>` in issue bodies.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.
