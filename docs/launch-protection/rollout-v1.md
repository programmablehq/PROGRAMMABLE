# Launch protection v1 rollout

Status: candidate only. Nothing in this document claims a production launch requirement is active.

The implementation uses the existing exact-source review and immutable launch graph. It does not change the frozen historical API schemas. The local reference package includes a protected token, native-fee kernel with mandatory opening module, atomic initializer, and rational USD price planner.

The owner selected 99% total opening buy fees, declining to normal fees over 30 seconds, with all additional opening fees payable to the fixed platform treasury. A second vault separates this amount from normal platform and creator fees.

Required before release:

1. Keep the confirmed 99%-to-normal schedule and platform recipient identical in contracts, source package, evidence and client quotes.
2. Fixed real USD oracle addresses are now enforced on both chains. Preserve provider evidence of each proxy runtime and round, and use the published per-chain heartbeat for expiry. Local fixture tests remain separate from provider evidence.
3. Provider-backed forks now pass native initial purchase, ordinary and exempt buys, the 30-second tax boundary, real-router sells through Permit2, over-cap rejection and treasury claims on both chains. Add smart-wallet and routed-recipient coverage before production activation; exact-output behavior is currently covered by local Core tests.
4. The exact source/compiler package is now in `packages/launch/contracts/launch-protection-v1` with a deterministic check script. Ethereum native-fee recognition supports the new kernel without combining opening-tax custody into the normal 0.3% proof. Wire the package into the public Custom API builder and deployment descriptors, with all six component identities.
5. Add protected Module Mode creation and the three exemption fields to the UI, with server-side validation. Legacy creation/preflight endpoints already fail closed in required mode. Quote protected-window trades using the authenticated canonical-router path; a generic quoter cannot impersonate a tax-exempt buyer. A display/default price change alone cannot enforce the USD floor.
6. Legacy Ethereum Classic and Module Mode authorizers now reject issuance when protection is required. Integrate protected replacements or keep these paths paused. Cover Robinhood direct factory creation on the official website before activation; immutable external factories remain callable outside it. Already-live immutable tokens retain their deployed rules.
7. Reassess unused old approvals and outstanding signed permits. An API deployment cannot revoke a signature already issued onchain; use the existing expiry/revocation mechanisms with exact release authority.
8. After exact source review, passing builds, authenticated full-path tests and release evidence, publish API/website changes together and enable `PROGRAMMABLE_LAUNCH_PROTECTION_V1_MODE=required` consistently on API and issuer processes. Unknown mode values reject execution. The default/candidate mode preserves the currently deployed policy while preparation is unfinished.

The candidate API gate consumes only authenticated operator-recorded trade reports, bound to the exact review ID, source subject and chain. Reports must include the complete protection scenarios, exact component runtime hashes, two-percent amount math, USD floor and unchanged platform fee proof. Applicant JSON claims cannot supply that evidence.

Tests include local Core cases on both chain bindings, plus separate provider-backed forks using each actual canonical router and existing oracle. This does not prove production deployment, availability through every client or resistance to a bot using many independent wallets.
