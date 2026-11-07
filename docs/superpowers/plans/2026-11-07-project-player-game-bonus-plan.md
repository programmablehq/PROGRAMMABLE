# P09 individual game bonus implementation plan

> **For agentic workers:** Use superpowers:executing-plans in the existing
> isolated Goal worktree. The user already selected autonomous inline execution.

**Goal:** Satisfy A5's individual three-win bonus without substituting a community effect.

**Architecture:** Add an optional, immutable fee-proposal module to the existing
signed-game source package. Use the pinned router's active initiator and the
existing signed per-wallet score. Unsupported identity paths retain regular fees.

**Tech Stack:** Solidity 0.8.26, Foundry custom-ai profile, existing TypeScript catalog.

**Spec:** `docs/superpowers/specs/2026-11-07-project-player-game-bonus-design.md`;
the main Project Platform V1 R08/R13/R14/R15/R19 and A5 requirements still apply.

## Global constraints

- Preserve existing community module, receiver signing protocol and launch authority.
- No signer secrets in source or prompts; no network transaction from tests.
- Use actual signed receiver events, not stub scores, to establish eligibility.
- Caller-supplied router identity is never independently authoritative.

## Review focus

- Winner A receives a bonus; nonwinner B keeps the regular fee.
- Duplicate, stale, forged and out-of-order results cannot create eligibility.
- A lookalike router cannot borrow a winner's identity.
- Zero, malformed, oversized, reverting or gas-burning router replies keep regular fees.
- Changed runtime code and invalid fee configuration fail safely.

## Task 1: immutable individual fee proposal

Files: add `contracts/src/custom-ai/ProjectPlayerGameFeeModuleV1.sol` and
`contracts/test/custom-ai/ProjectPlayerGameFeeModuleV1.t.sol`.

Interface: constructor `(ProjectPlayerGameEventsV1,address,uint256,uint16,uint16)`;
existing `ICustomAIFeeModuleV1.quoteFee` output shape and immutable configuration hash.

- [x] Write failing actual-EVM tests for every review-focus case.
- [x] Confirm the new optional module is absent and the tests fail to compile.
- [x] Implement bounded identity resolution and per-player threshold selection.
- [x] Run the focused test and the complete custom-ai profile; inspect failures.

## Task 2: source package and planner integration

Files: `scripts/custom-ai/export-game-events.mjs`, generated
`lib/custom-ai/platform/game-events-code.json`, event tool/planner descriptions,
`docs/project-platform-v1/GAME-EVENTS.md`, focused catalog tests.

- [x] Add a failing catalog test requiring the new complete source closure.
- [x] Export the built artifact, preserve existing artifacts, update guidance.
- [x] Verify package freshness, TypeScript and targeted lint/tests.
- [ ] Review the diff, commit and publish only to the existing staging path.
- [ ] Keep ordinary-user A5 build/operation acceptance open until it actually passes.

## Confirmed review correction: one-to-one game identity

- [x] Reproduce two distinct authenticated game accounts pooling wins into one wallet.
- [x] Add `ProjectPlayerGameEventsV1` with inverse wallet-to-player binding, leaving the existing receiver unchanged.
- [x] Require its policy marker in the individual fee module; reject a legacy receiver.
- [x] Add the new reviewed runtime template to the event service and source export.
- [x] Recheck actual swaps, malformed-router cases, package freshness and the independent review.
