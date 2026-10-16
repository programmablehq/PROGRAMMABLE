# Launch protection v1 rollout

Status: candidate only. Nothing in this document claims a production launch requirement is active.

The implementation uses the existing exact-source review and immutable launch graph. It does not change the frozen historical API schemas. The local reference package includes a protected token, native-fee kernel with mandatory opening module, atomic initializer, and rational USD price planner.

The candidate's additional buy fee is provisionally 99% total at launch, falling linearly for 30 seconds. It accrues as LP fees to an irretrievable LP position. It is locked value, not an automatic increase to active liquidity. The owner has not yet selected the final initial rate or fee destination.

Required before release:

1. Resolve the initial-rate and fee-destination choices. If parameters change, update source, policy validator and shared test vectors together.
2. Bind real approved USD oracle addresses and exact runtime evidence for each supported chain. The local test feed proves arithmetic and stale-data rejection, not price-source trust.
3. Run provider-backed forks with each actual canonical Universal Router, including smart-wallet origin, buy/sell, exact-output behavior and token-recipient delivery.
4. Package the exact source/compiler artifacts for Custom API clients. Update creation code/runtime recognition and no-double-platform-fee proofs for the new kernel, module and fee-vault child.
5. Add required protection fields to Module Mode preparation and UI, with server-side validation. A change to a display/default price alone cannot enforce an onchain USD floor.
6. Integrate the same policy into Classic and every remaining launch/permit path, or explicitly pause unsupported new launches. Already-live immutable tokens retain their deployed rules.
7. Reassess unused old approvals and outstanding signed permits. An API deployment cannot revoke a signature already issued onchain; use the existing expiry/revocation mechanisms with exact release authority.
8. After exact source review, passing builds, authenticated full-path tests and release evidence, publish API/website changes together and enable `PROGRAMMABLE_LAUNCH_PROTECTION_V1_MODE=required` consistently on API and issuer processes. Unknown mode values reject execution. The default/candidate mode preserves the currently deployed policy while preparation is unfinished.

The candidate API gate consumes only authenticated operator-recorded trade reports, bound to the exact review ID, source subject and chain. Reports must include the complete protection scenarios, exact component runtime hashes, two-percent amount math, USD floor and unchanged platform fee proof. Applicant JSON claims cannot supply that evidence.

Current tests exercise real local Uniswap Core instances with Ethereum and Robinhood address/chain bindings. They do not prove production deployment, provider support or resistance to a bot using many independent wallets.
