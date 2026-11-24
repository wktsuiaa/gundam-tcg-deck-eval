# 0004. Frame-Scoped No-Stack Chain Verifier, 4-Layer Modifiers, and Ruling Fixtures

Status: accepted

## Context

`lib/sandbox-engine.ts` resolves immediate triggers synchronously in place and skips unsimulated steps with fail-closed log messages, while `data/rules.json` (`119` general FAQs, `334` card FAQs) is stored only for UI display. To objectively verify whether a multi-card play line in the deck generator is legally executable under the Gundam Card Game Comprehensive Rules, the engine needs exact rules for no-stack trigger resolution, depth-first interrupts, `"can't"` overrides, `Lv` vs. `Cost`/`EX Resource` payment, and automated ruling tests.

## Decision

1. Implement a deterministic **Frame-Scoped Resolution Controller** (not a player-response stack): each atomic step runs **Replacement Effects** pre-commit (at most once per source per event), commits state mutations, runs state-based checks (`<= 0 HP` destruction emitting `WHEN_UNIT_DESTROYED` with `damageType: 'EFFECT'`, never battle damage) before queuing post-commit triggers, and opens depth-first child resolution frames resolved strictly **Turn Player → Non-Turn Player**, opening **Action Steps** only at explicit combat/end-of-turn windows.
2. Evaluate **Continuous Modifiers** via a fixed 4-layer deterministic pipeline—**(1) Base + Paired Pilot stats → (2) Trait/Keyword grants & removals → (3) Additive AP/HP/Cost adjustments → (4) `"can't"` prohibitions**—where Layer 4 unconditionally overrides `"can"`/`"gains"`.
3. Separate non-spending **`Lv` threshold checks** (total Resources + `EX Resource`s) from **Cost payment** (resting active Resources / exiling `EX Resource`s on spend), and require an explicit **Chain Witness** for all player/opponent choices, simultaneous-trigger ordering, and hidden-deck assumptions across two modes: **Concrete Snapshot Mode** and **Minimal-Board Feasibility Mode**.
4. Verify rules correctness in Vitest using **Ruling Scenario Fixtures** mapped directly to `data/rules.json` FAQ entries alongside 100% corpus parse gates, rather than NLP-parsing FAQ prose.

## Considered Options

- **MTG-style LIFO response stack**: Rejected because Gundam Card Game forbids stack responses; effects queue into pending trigger pools and newly triggered abilities interrupt depth-first.
- **Symbolic / probabilistic branching over hidden zones**: Rejected because unbounded search breaks determinism and makes deck-generator legality checks slow and flaky.

## Consequences

- Any ambiguous choice, target, or top-of-deck reveal without a **Chain Witness** fails closed as unverifiable rather than guessing.
- `data/rules.json` stays untouched as raw official source data while structured scenario fixtures track objective ruling pass rate and FAQ coverage in CI.
