# P09 addendum: individual game bonus

The A5 reference says that the player with three signed wins receives the
bonus. The existing community-score module intentionally changes everyone's
fee, so it cannot by itself satisfy that reference. Preserve it as a separate
option and add a reusable individual-player example to the same source catalog.

The selected approach reuses the actor boundary already used by BuyCooldownV1:
an explicitly selected router with pinned runtime code provides `msgSender()`
for its current execution. The actual hook supplies the PoolManager callback
sender. A random router, EOA, absent actor, changed code, malformed response or
failed lookup receives the configured regular fee. No identity comes from
untrusted hook data or from assuming that the router address is the player.

An alternative per-swap signed permit would require a new nonce and signature
protocol; it is unnecessary for this reference. The community-wide threshold
remains available but is not an individual bonus.

`ProjectPlayerGameFeeModuleV1` reads the receiver's signed cumulative
`playerScore(wallet)`. The A5 fixture sets maximum event score to one and the
bonus threshold to three, so one valid win cannot count as three. Only the
selected player's additional fee changes. The core's platform fee and caps
remain authoritative. The configured bonus must not exceed the regular fee.
Earned eligibility persists; the receiver still rejects stale result submissions.
This persistence is a reference-fixture choice, not a new rule for user projects.

Both receiver and router runtime hashes enter the configuration commitment and
are checked on every quote. The router lookup has a fixed gas allowance and a
fixed-size output buffer. The module holds no funds, signs nothing, broadcasts
nothing and grants no project or launch authority.

Scope: contract, source catalog, planner guidance, independent behavior tests
and the A5 acceptance path. No network deployment or paid action is authorized
by this addendum. Existing production deployment requirements remain in force.

The independent review reproduced score pooling across multiple game accounts
on the original receiver. The individual module therefore requires a separate
`ProjectPlayerGameEventsV1` receiver with a one-to-one wallet/account mapping
and an explicit player-policy marker. The module rejects the legacy receiver.
The original receiver and community policy remain byte-for-byte unchanged.
The event service accepts either reviewed runtime template and uses the same
signed wire protocol, ownership, revision and receipt checks for both.
