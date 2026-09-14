import type { Metadata } from "next";
import Link from "next/link";

import {
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Index new launches · Programmable",
  description:
    "Discover Router-stamped Programmable launches with canonical events, getter verification, finality checkpoints and reorg handling.",
  alternates: { canonical: "/docs/developers/indexing" },
};

const manifest = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST;
const router = manifest.launchStampRouter;
const reads = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;
const events = Object.values(router.events);
const CLAIM_CONSOLE_MAX_FINALIZED_SPREAD_BLOCKS = 32;

const indexingSections = [
  { id: "scope", label: "When to index" },
  { id: "binding", label: "Router binding" },
  { id: "events", label: "Discovery events" },
  { id: "verification", label: "Verify candidates" },
  { id: "finality", label: "Finality and reorgs" },
  { id: "storage", label: "Stored fields" },
  { id: "claims", label: "Protocol fee claims" },
] as const;

export default function IndexLaunchesPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/indexing"
      description="Discover launches from Router events, then establish provenance with canonical contract reads."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={indexingSections}
      title="Index new launches"
    >
      <section id="scope">
        <div className={styles.sectionIntro}>
          <h2>Index only when you need discovery</h2>
          <p>
            Point verification needs an Ethereum provider, the manifest and the
            Router ABI. Continuous event indexing is optional.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          If your product already has a token address or pool ID, use the{" "}
          <Link href="/docs/developers/verify">point-verification guide</Link>.
          Build an indexer when you need a complete feed of new Router-stamped
          launches.
        </p>
      </section>

      <section id="binding">
        <div className={styles.sectionIntro}>
          <h2>Start at the published block</h2>
          <p>
            Verify the published Router binding before reading logs. Ignore
            events from every other emitter.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Network</dt>
            <dd>
              Ethereum mainnet · <code>chainId {manifest.chainId}</code>
            </dd>
          </div>
          <div>
            <dt>Router</dt>
            <dd>
              <DocsAddress
                address={router.address}
                label="Launch Stamp Router"
              />
            </dd>
          </div>
          <div>
            <dt>Start block</dt>
            <dd>
              <code>{router.startBlock}</code>
            </dd>
          </div>
          <div>
            <dt>End block</dt>
            <dd>
              <code>{router.endBlock ?? "open"}</code>
            </dd>
          </div>
          <div>
            <dt>Explicit-block finality</dt>
            <dd>
              At least <code>{router.finalityConfirmations}</code> confirmations
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          Resolve these values from the{" "}
          <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}>
            deployment manifest
          </a>
          . Also verify the Router runtime, immutable bindings, hosted ABI and
          ABI digest before the backfill begins. Remote RPC URLs must use HTTPS;
          plain HTTP is accepted only for loopback development endpoints.
        </p>
      </section>

      <section id="events">
        <div className={styles.sectionIntro}>
          <h2>Treat events as candidates</h2>
          <p>
            Filter by the exact Router address and full event topics. Logs help
            you discover a launch; getter verification establishes provenance.
          </p>
        </div>

        <div
          aria-label="Launch Stamp Router discovery events"
          className={styles.tableScroll}
          role="region"
          tabIndex={0}
        >
          <table className={styles.eventTable}>
            <caption>Launch Stamp Router discovery events</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Full signature</th>
                <th scope="col">topic0</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.topic0}>
                  <th scope="row">{event.name}</th>
                  <td>
                    <code>{event.signature}</code>
                  </td>
                  <td>
                    <code>{event.topic0}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className={styles.bodyCopy}>
          Hash the exact downloaded ABI bytes and match the manifest digest.
          From that byte-verified ABI, derive each full event signature, topic0,
          and the indexed input names in their published order. If any event
          descriptor differs from the manifest, return{" "}
          <code>INDETERMINATE</code> and do not ingest the log.
        </p>
      </section>

      <section id="verification">
        <div className={styles.sectionIntro}>
          <h2>Backfill and continue from a checkpoint</h2>
          <p>
            Import the verified range first, then continue from an overlapping
            checkpoint so no launch is skipped.
          </p>
        </div>

        <ol className={styles.steps}>
          <li>
            Read bounded <code>eth_getLogs</code> chunks from{" "}
            <code>{router.startBlock}</code> through a finalized boundary.
            For a fee-claim inventory, require the Wallet RPC and two
            independent public RPCs to report finalized views no more than{" "}
            <code>{CLAIM_CONSOLE_MAX_FINALIZED_SPREAD_BLOCKS}</code> blocks apart.
            Use the oldest view as the safe boundary, require all three RPCs to
            return its exact block hash, then compare the complete raw log
            tuples through that boundary. Any disagreement is{" "}
            <code>INDETERMINATE</code> and must block execution.
          </li>
          <li>
            Require the exact Router emitter and published topic signatures,
            after deriving the byte-verified ABI closure: full signature,
            topic0, and indexed input names in order. A mismatch is{" "}
            <code>INDETERMINATE</code>; do not ingest the log.{" "}
            {"Correlate the three event types by "}
            <code>launchId</code>.
          </li>
          <li>
            Reproduce every candidate with{" "}
            <code>{reads.primaryReads[2].signature}</code> and the
            identity-specific token or pool lookup at the same canonical block.
          </li>
          <li>
            Accept the launch only when the Router binding, record, launch kind,
            identity and required proof checks succeed.
          </li>
          <li>
            Begin polling or subscription from an overlapping checkpoint so the
            backfill and subsequent subscription have no gap.
          </li>
        </ol>

        <aside className={styles.callout}>
          <strong>Reuse point verification</strong>
          <p>
            Event ingestion and point verification should return the same record
            for the same canonical block. Do not maintain a second, weaker
            acceptance path for indexed launches.
          </p>
        </aside>
      </section>

      <section id="finality">
        <div className={styles.sectionIntro}>
          <h2>Advance checkpoints only through finality</h2>
          <p>
            Keep an overlap between the stored checkpoint and the next query.
            Replay that overlap on every run.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>Deduplicate identical block, transaction and log coordinates.</li>
          <li>
            Prefer EIP-1898 reads with <code>requireCanonical: true</code>.
          </li>
          <li>
            After a reorg, rewind to the last common finalized checkpoint and
            replay.
          </li>
          <li>
            Respect <code>endBlock</code> if a future manifest retires this
            Router.
          </li>
          <li>
            Keep <code>ORPHANED</code> as an event-observation state. It is not
            a point-verification result.
          </li>
        </ul>
      </section>

      <section id="storage">
        <div className={styles.sectionIntro}>
          <h2>Store enough data to replay</h2>
          <p>
            A minimal durable index keeps the source coordinates, the
            verification block and the facts your product displays.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Event coordinate</dt>
            <dd>
              Block number and hash, transaction hash and index, and log index.
            </dd>
          </div>
          <div>
            <dt>Correlation</dt>
            <dd>Launch ID, event topic and the exact Router address.</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>
              Canonical block number and hash, result state, launch kind and the
              token or pool identity you verified.
            </dd>
          </div>
          <div>
            <dt>Checkpoint</dt>
            <dd>The last finalized block number and hash.</dd>
          </div>
        </dl>
      </section>

      <section id="claims">
        <div className={styles.sectionIntro}>
          <h2>Keep the protocol fee inventory complete</h2>
          <p>
            Launch discovery and protocol fee claiming use related provenance,
            but they are separate indexes with different execution bindings.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            Classic V2 and V3 coin rows come from complete canonical Launcher
            event scans. Fee execution is one aggregate claim per verified
            version hook; the legacy V1 aggregate hook remains a separate row.
          </li>
          <li>
            A Router-stamped Classic launch is covered automatically only when
            its exact hook matches a known verified aggregate hook. An unknown
            Classic hook remains visible and blocks the combined claim.
          </li>
          <li>
            The complete Registry history remains available for audit, but
            Custom Registry V1 is retired as a live discovery or claim source.
          </li>
          <li>
            Router-stamped Custom launches come from a bounded common
            consensus-finalized checkpoint and raw-log replay agreed by the
            Wallet RPC and two independent public RPCs. Each candidate is
            reproduced through the Router record, identity lookup, component
            proof, runtime and displayed claim balance at that same checkpoint.
          </li>
          <li>
            A Custom claim requires an exact reviewed profile bound to its
            launch ID, token, fee source and runtime. FADE uses its native
            accumulator, SHARD uses a direct launcher-fee claim, PCAN redeems
            both PoolManager currencies in one call and PCR2 claims its native
            and token balances as two independent fee-Vault calls. Only positive
            balances enter the batch. Future Router-stamped Custom launches are
            discovered and stay visible, but a new or unknown ABI blocks the
            combined claim until its exact profile is reviewed. The console
            does not offer universal arbitrary Custom support and never guesses
            calldata.
          </li>
          <li>
            Stock claims use the published fixed release asset set. New Stock
            assets are not inferred or silently added.
          </li>
          <li>
            Custom V2 remains unavailable until an exact deployed, finalized
            release binding exists. Unknown, mismatched or unverified bindings
            block execution. Quarantined sources remain visible and
            non-executable.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          The live claim console publishes its machine-readable boundary at{" "}
          <a href="https://claimhazard.vercel.app/claim-discovery.json">
            claimhazard.vercel.app/claim-discovery.json
          </a>
          . The page rescans before every claim and sends positive verified
          entries only as one wallet-declared atomic batch from the fixed reward
          wallet. Its immediate latest simulation can include fees accrued after
          the displayed finalized balance. The current safe limit is 64 calls;
          overflow blocks instead of silently dropping a claim. Before the
          wallet opens, the console persists an app-defined batch ID under an
          origin-wide tab lock. A confirmed batch stays locked across reloads
          until its exact transaction and block receipts agree across all three
          RPCs and the Router checkpoint has finalized them. Partial or
          ambiguous outcomes remain locked for manual reconciliation. If the
          page closes during wallet submission, the saved call set can only be
          resumed with the same app-defined ID; it is never rebuilt as a second
          batch.
        </p>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/verify">Verify a token or pool</Link>
          </li>
          <li>
            <Link href="/docs/developers/machine-readable">
              Use machine-readable docs
            </Link>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
