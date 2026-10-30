# Custom AI workbench

## Product contract

A user can describe an idea, discuss it, build supported mechanics and launch the saved result from their wallet. A question does not authorize a build. A generated contract is not a completed launch. Open choices and unavailable services remain visible; the builder must preserve the whole requested design.

The current Custom AI launch core supports Ethereum and Robinhood. The separate Custom Launch API supports other networks too; that does not automatically extend this core. Fee modules can use time, direction and validated feeds within the fixed core. Arbitrary mutable Uniswap v4 hooks cannot be installed as fee modules. Reward programs and automatic execution have separate deployment, data and funding requirements.

## Work completed in this update

1. Guard composed builds against unresolved choices before compiling or spending on another generation call.
2. Preserve unfinished composed designs through follow-up questions and prevent fallback to a fee-only replacement.
3. Compare executable phase/action settings for retained requirements, rather than only checking their ids. Replacements and removals declare their scope and quote the latest user instruction.
4. Bind targeted edits to a saved source hash and requirement. Reject stale targets before model use.
5. Add starter ideas and direct rule selection. Launch remains unavailable while the current design is incomplete.
6. Share capability descriptions between the planner and a public read-only discovery route: `GET /api/custom-ai/capabilities`. Configuration is not live execution proof.
7. Version the behavior as AI configuration 2.1.0 and exercise regressions for lost rules, altered allocations, unrequested edits and interrupted design discussions.
8. Preserve the unsent message and selected rule across reloads. Choosing to keep the previous rules restores that draft's conversation context too, so a discarded proposal does not silently return.

## Where to make a focused change

| Change | Entry point | Verification |
| --- | --- | --- |
| Wording and conversation behavior | `lib/custom-ai/prompt.ts` | Replay a relevant conversation; no financial deployment |
| Planning and clarification | `lib/custom-ai/rules.ts`, `service.server.ts` | Planner/service regressions |
| Scope of an edit | `lib/custom-ai/design-edits.ts` | `tests/custom-ai-design-edits.test.ts` |
| Research tool or API | New folder in `lib/custom-ai/capabilities/`, then register it | Input bounds, timeout, provenance and request budget |
| Supported product capability | `lib/custom-ai/builder-capabilities.ts` | Discovery response and actual enforcement agree |
| Models and budgets | `lib/custom-ai/ai-config.ts` | Verify provider model availability; one bounded real request |
| New executable money behavior | Versioned rule/compiler/program implementation | Contract behavior and exact deployment evidence, then its own activation |
| Chat UI | `components/custom-ai/` | Desktop/mobile interaction and draft recovery |

Increment `AI_CONFIG.version` when changing planner behavior. In-flight requests keep their existing job identity; retries must not repeat a paid request blindly. Tool versions and implementation hashes are recorded per job. Do not modify a launched contract to roll out a chat improvement.

## Remaining capability work

External-event and financial programs need their exact network releases, connected data, and funded operational services before being advertised as launchable. Use the existing activation checklist and acceptance records; this UI/planner update does not activate those services. Add genuinely new rule primitives through the versioned compiler and validate the requested cash flow, not only compilation.

No claim of "every possible hook" is justified by the current fixed core. The product should explain the particular unsupported mechanic and save it for continued design. Keep the common supported path short: describe, review the rules, sign the launch.
