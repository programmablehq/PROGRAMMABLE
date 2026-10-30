# Programmable workspace rules

## Canonical repository

- The public product repository is `https://github.com/programmablehq/PROGRAMMABLE`.
- `production` is the canonical full-product branch and the only branch used for website production releases.
- `main` remains the public contracts and release-evidence branch. Never deploy the website from `main`.
- Confirm the destination remote before every push. Do not assume that a remote named `origin` is canonical.
- Preserve unrelated local changes. Never clean, reset, or overwrite a dirty worktree to simplify a task.

## Parallel work

- Every parallel workstream uses its own Git worktree and `codex/` branch.
- Assign explicit path ownership before implementation. Two active workstreams must not edit the same files.
- Feature worktrees may produce local or preview builds. They must not deploy production.
- Only the integration owner may combine workstreams and publish. Use the release route appropriate to the change below.
- Product branches target `production`. Contract-only evidence may target `main` only when the task explicitly says so.
- Handoffs must include the branch, commit, changed paths, checks run, and remaining release blockers.

## Path ownership

- Web product: `app/`, `components/`, browser-facing files in `lib/`, and referenced assets in `public/`.
- Contracts: `contracts/src/`, `contracts/test/`, `contracts/script/`, `contracts/spec/`, and `contracts/security/`.
- Operations: `ops/` and narrowly assigned operational scripts.
- Shared integration: `config/`, shared onchain readers in `lib/onchain/`, release manifests, and deployment bindings. These require an integration-owner review.
- Documentation and brand assets: `docs/`, `README.md`, `public/brand/`, and `public/og/`.

## Release discipline

- `tested`, `deployed`, `source verified`, `lifecycle verified`, and `available` are separate states.
- Do not describe a model as live from a build, simulation, fork test, source match, or UI implementation alone.
- Contract, wallet, trading, indexer and API activation requires exact deployment evidence, runtime checks, provider-backed lifecycle verification, monitoring, and a clean integration build.
- Production deploys must use a clean integration worktree at the exact reviewed `production` commit.
- Never expose secrets, private keys, personal identities, or local environment files in commits, logs, screenshots, or public artifacts.

## Fast website edits

- An owner request to change the website includes publishing routine presentation edits unless the owner asks for a draft or preview. Implement and publish without another confirmation.
- CSS, images, fonts and TSX copy edits use the presentation lane. The classifier proves that executable code, handlers, links and transaction values are unchanged. The production build and credential scan remain; unrelated unit suites, wallet browser suites and financial lifecycle audits do not run for this lane.
- Merge one coherent change into `production`. `Publish website UI` builds and publishes it automatically using the existing production configuration. Do not run `npm run verify`, a local production build, the manual staging workflow, or a second deploy for these edits.
- `npm run ship:ui:plan` shows the outstanding changes since the live deployment. `npm run ship:ui` is the single recovery entry point from a clean production checkout with the existing Vercel and GitHub access.
- Verify the requested appearance at the relevant viewport. Do not add tests for reversible text, spacing, color or image edits. Do not repeat checks that already passed for the exact commit.
- Before functional interface work, use `npm run verify:interface:plan` with the base/head commits. Run the affected checks once; do not add a local full-suite/build pass before identical CI coverage. CI reuses successful exact-tree PR verification for ordinary interface changes.
- Do not run historical launch/finality rehearsals, module CLI checks or wallet browser suites for unrelated display changes. Do not add tests asserting CSS values, layout source strings or exact marketing copy. Keep behavioral tests for money movement, permissions, contract bindings and API response contracts.
- Verification-only changes do not need a Vercel deployment when application source and production configuration are unchanged. Do not delete deployment journals or rollback evidence as test cleanup.
- Logic, account, signing, fee, contract, route, API, deployment configuration and dependency changes keep their relevant functional release route. The presentation publisher rejects mixed outstanding changes, stale branches and concurrent production changes.

See [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md) for the directory map.

## Shared Module Mode publication

- The owner wants new Module Mode versions to become available on Robinhood and Ethereum mainnet together once Ethereum Module Mode is enabled.
- Design new modules around one immutable source package, one configuration interface and one publication job targeting both chains. Keep deployment addresses, host releases, runtime evidence and wallet preparation separate per chain.
- Retain the active version until both target deployments are verified and ready; do not publish a replacement on only one chain or treat one chain's evidence as proof for the other.
- The implementation target and current rollout limitations are recorded in [docs/module-foundation/MULTICHAIN-PUBLICATION.md](docs/module-foundation/MULTICHAIN-PUBLICATION.md). This policy does not activate Ethereum launches or authorize spending by itself.

## Public documentation

- Use factual, direct language. No marketing claims, em dashes, filler or rhetorical contrasts.
- Explain Module Mode through its interfaces and workflow. Do not maintain lists or counts of available modules in general documentation; read the active catalog instead.
- Keep variable release data in versioned discovery and evidence. State actual capabilities and limits without promising support for an unknown future engine.
- Index by launch source and canonical token identity. Module names, categories and optional market metadata must not determine whether a verified launch exists.
- Keep GitBook, native guides and agent discovery linked. See [docs/PUBLIC-DOCS-STYLE.md](docs/PUBLIC-DOCS-STYLE.md).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
