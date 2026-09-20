# Robinhood website index

The website reads one saved list. A scheduled server job follows the canonical
Robinhood Router, verifies new stamps and updates that list. Page requests do
not call an RPC, the launch API or a market-data provider. Ethereum is excluded.

The source of launch identity is the [Developer Router specification](https://github.com/programmablehq/Developers/blob/c22118326650b2d0883ce1ef37076e6df0665629/docs/reference/launch-stamp.md#onchain-backfill-and-live-follow).
Addresses, ABI and deployment ranges are resolved from Developer discovery.
Names, symbols and decimals are optional ERC-20 reads; unavailable metadata does
not remove a verified launch. Market prices and charts are outside this index.

`verify-launch-stamp.ts` is the Developer repository's viem point verifier, pinned
to commit `c22118326650b2d0883ce1ef37076e6df0665629`:

- Source: `examples/verify-launch-stamp-viem.ts`
- Original SHA-256: `5fbd236defbbcd21fee956f57c63c1d626ee3b976140cdfce94f771b6fd919ca`
- Local adaptations: lint directive and an optional shared RPC fetch function,
  with an eight-second timeout and no transport retry. Stamp validation is unchanged.
- Original license: `VERIFIER-LICENSE`

The updater publishes only complete verified ranges. Dense ranges are split;
a dense single block keeps partial verification privately for the next pass.
It retains a bounded window
of block-hash checkpoints, replays an overlap and rewinds affected records if a
canonical hash changes. Optimistic Blob writes prevent overlapping jobs from
advancing an older snapshot over a newer one. Readers retain accepted records
when the updater is unavailable, with an explicit stale state.

The job uses the RPC from the Developer example, `https://rpc-robinhood.blockmachine.io`,
or the single `ROBINHOOD_RPC_URL` override. Requests are spaced by 350 ms and log
ranges contain at most 10,000 blocks. It runs every minute using the existing
`CRON_SECRET` and saves to the existing private operations Blob store
(`OPS_BLOB_READ_WRITE_TOKEN`, falling back to `BLOB_READ_WRITE_TOKEN`). Initial
history is backfilled over bounded runs; the list reports `syncing` until caught up.
Changing the canonical Router itself requires an explicit index migration;
new tokens and custom hooks on that Router require no configuration.

Engine sources can be indexed before their templates are published. The server
discovers them through the authenticated backend source inventory and verifies
their complete release, provenance and finality before updating the saved list.

`config/module-engine/index-releases.json` binds additional Engine sources for
the deployment read checks. Its `programmable.module-engine.index-releases.v1`
schema contains only `schemaVersion` and `releases`. Each entry is a complete
active Engine release, including the actual deployment, source-verification and
lifecycle evidence digests. The canonical Engine binder verifies its identity;
the backend remains responsible for validating the actual evidence bytes.
The combined expected inventory is limited to 32 sources. Duplicate release
digests or source addresses, including current and historical catalog sources,
are rejected. Remove a technical entry when moving that same source into the
public current or historical release configuration.

The committed technical list starts empty. It is read only by deployment checks
and grants no template availability, public launch version or backend source
installation. Review identities are not imported into it. Before an additional
backend source reaches the shared website index, its exact technical binding
must be reviewed and included in the deployed website checkout. The unchanged
runtime smoke still rejects any observed source outside those exact bindings.


Foundation sources use the same saved Module lanes, bounded-range scheduler,
reorg handling and conditional Blob writes. The backend's retained-release
inventory identifies every factory generation; each lane obtains fresh
release-specific acceptance before it scans. A missing inventory is reported
as incomplete even if the active factory can be collected during a rollout.
V1, V2 and V3 retain separate source digests, factory addresses and checkpoints.

Each Foundation range contains at most 5,000 blocks and is verified by two
independent providers configured through `ROBINHOOD_RPC_URL` and
`ROBINHOOD_RPC_SECONDARY_URL`. Both must support state reads at the common
finalized boundary. The SDK pins historical event windows separately from that
finalized state checkpoint so old event history does not require historical
contract state. Both hashes are checked again before storing rows. The job
advances at most 48 ranges per source and pass, within its shared deadline;
backfill must finish before the release is declared caught up.

`config/module-foundation/index-releases.json` adds exact Foundation identities
to the existing deployment smoke expectations. It records factory and deployer
runtime pins and deployment transactions, plus accepted source artifact,
decision and manifest digests. The four retained records come from the deployed
backend registry at `edb0776110b3387989e0144fac9f0c86e837edd7`; the current and
native-ETH V2 bindings were also matched to fresh public authority responses.
These records do not grant runtime or finality approval. The background source
still requires fresh per-release authority and independent provider evidence.
Future factory releases require their own reviewed technical record before
being introduced to the shared index; new tokens on an existing factory need
no per-token configuration. Unknown source identities remain a smoke failure.
