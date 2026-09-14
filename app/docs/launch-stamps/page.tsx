import type { Metadata } from "next";
import { PublicExternalLink } from "@/components/public-external-link";
import Link from "next/link";

import { DocsShell } from "@/components/docs-shell";
import {
  LAUNCH_KIND_V1,
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT,
  STAMP_RECORD_V1_FIELDS,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/launch-stamp-docs.module.css";

export const metadata: Metadata = {
  title: "Launch Stamp Router · Programmable",
  description:
    "Reference for identifying launches stamped through the Programmable Launch Stamp Router on Ethereum.",
  alternates: { canonical: "/docs/launch-stamps" },
};

const sections = [
  { id: "trust-root", label: "Scope" },
  { id: "integration", label: "Deployment record" },
  { id: "launch-kinds", label: "Launch kinds" },
  { id: "algorithm", label: "Token and pool identity" },
  { id: "record", label: "Stamp record" },
  { id: "indexing", label: "Events" },
  { id: "result-states", label: "Result states" },
  { id: "boundary", label: "What it proves" },
  { id: "versioning", label: "Versioning and retirement" },
] as const;

const abiBoundVerifier = [
  "input := token OR (PoolManager, poolId)",
  "",
  "preflight  require HTTPS RPC; HTTP is loopback-only",
  "           require live/retired-in-range manifest with complete",
  "           canary, binding, atomic, getter and event descriptors",
  "           resolve one finalized canonical block → (number, openingHash)",
  "           require eth_chainId, block range and Router runtime",
  "           require ABI byte hash, getters, topics and indexed layouts",
  "           require CHAIN_ID() == manifest.chainId",
  "           require all six immutable bindings to match the manifest",
  "           require permit authority, Graph Factory and PoolManager runtimes",
  "",
  "step 1  launchId := input is token",
  "          ? launchIdByToken(token)",
  "          : launchIdByPool(PoolManager, poolId)",
  "        if launchId == bytes32(0) → candidate := NOT_STAMPED; finalize",
  "",
  "step 2  record := launchStamp(launchId)",
  "        require supported kind and exact token or pool identity",
  "        require valid address fields and nonzero bytes32 fields",
  "        require record.poolManager == immutable PoolManager",
  "        for token input, require stampProof(token) ==",
  "          (launchId, record.stampHash)",
  "        CustomGraph → require Graph Factory address + runtime binding",
  "        Classic → retain permit-bound recorded launcher + runtime",
  "        candidate := STAMPED(record)",
  "",
  "finalize  for number-bound reads, require closingHash == openingHash",
  "return candidate only after every required gate succeeds",
].join("\n");

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;
const chainId = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.chainId;
const deployment = router.deploymentEvidence;
const bindings = router.bindings;
const canary = router.canaryEvidence;
const artifact = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT;
const abi = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;
const events = Object.values(router.events);

const terminalLogFilter = JSON.stringify(
  {
    address: router.address,
    fromBlock: "0x1886b6c",
    toBlock: "finalized",
    topics: [events.map((event) => event.topic0)],
  },
  null,
  2,
);

const manifestFields = [
  ["chainId", chainId],
  ["version", router.version],
  ["generation", router.generation],
  ["address", router.address],
  ["startBlock", router.startBlock],
  ["endBlock", router.endBlock],
  ["runtimeCodeHash", router.runtimeCodeHash],
  ["finalityConfirmations", router.finalityConfirmations],
  ["abiUrl", router.abiUrl],
  ["abiSha256", router.abiSha256],
] as const;

const deploymentEvidenceFields = [
  ["verificationStatus", deployment.verificationStatus],
  ["address", deployment.address],
  ["deploymentTransactionHash", deployment.deploymentTransactionHash],
  ["deploymentBlockNumber", deployment.deploymentBlockNumber],
  ["deploymentBlockHash", deployment.deploymentBlockHash],
  ["finalizedBlockNumber", deployment.finalizedBlockNumber],
  ["finalizedBlockHash", deployment.finalizedBlockHash],
  ["finalityDepth", deployment.finalityDepth],
  ["runtimeCodeBytes", deployment.runtimeCodeBytes],
  ["runtimeCodeKeccak256", deployment.runtimeCodeKeccak256],
  ["runtimeCodeSha256", deployment.runtimeCodeSha256],
  ["getterBundleSha256", deployment.getterBundleSha256],
  ["evidenceSha256", deployment.evidenceSha256],
] as const;

const activationBindingFields = [
  ["permitAuthority", bindings.permitAuthority],
  ["permitAuthorityRuntimeCodeHash", bindings.permitAuthorityRuntimeCodeHash],
  ["graphFactory", bindings.graphFactory],
  ["graphFactoryRuntimeCodeHash", bindings.graphFactoryRuntimeCodeHash],
  ["poolManager", bindings.poolManager],
  ["poolManagerRuntimeCodeHash", bindings.poolManagerRuntimeCodeHash],
] as const;

const canaryIdentityFields = [
  ["finality", canary.finality],
  [
    "customGraphOnchainCanary",
    String(canary.routeCoverage.customGraphOnchainCanary),
  ],
  ["classicOnchainCanary", String(canary.routeCoverage.classicOnchainCanary)],
  ["transactionHash", canary.transactionHash],
  ["blockNumber", canary.blockNumber],
  ["blockHash", canary.blockHash],
  ["launchId", canary.launchId],
  ["stampHash", canary.stampHash],
  ["launchKind", canary.launchKind],
  ["sourceRepository", canary.source.sourceRepository],
  ["sourceCommit", canary.source.sourceCommit],
  ["commitSubject", canary.source.commitSubject],
  ["evidenceFileSha256", canary.evidenceFileSha256],
  ["evidenceLineSha256", canary.evidenceLineSha256],
] as const;

const canaryObservationFields = [
  ["initializer", canary.components.initializer],
  ["token", canary.components.token],
  ["hook", canary.components.hook],
  ["poolManager", canary.pool.poolManager],
  ["poolId", canary.pool.poolId],
  ["activeLiquidity", canary.pool.activeLiquidity],
  ["positionManager", canary.lpPosition.positionManager],
  ["lpNftTokenId", canary.lpPosition.tokenId],
  ["lpNftOwner", canary.lpPosition.owner],
  ["platformFeePips", canary.platformFee.feePips],
  ["platformFeeRecipient", canary.platformFee.recipient],
  ["tokenTotalSupply", canary.tokenTotalSupply],
] as const;

type ReferenceValue = string | number | null;

function ReferenceList({
  rows,
}: {
  rows: readonly (readonly [string, ReferenceValue])[];
}) {
  return (
    <dl className={styles.referenceList}>
      {rows.map(([field, value]) => (
        <div key={field}>
          <dt>{field}</dt>
          <dd>{value ?? "null"}</dd>
        </div>
      ))}
    </dl>
  );
}

type AbiEntry = {
  readonly label: string;
  readonly signature: string;
  readonly selector: string;
  readonly returns: string;
};

function SignatureList({ entries }: { entries: readonly AbiEntry[] }) {
  return (
    <dl className={styles.signatureList}>
      {entries.map((entry) => (
        <div key={entry.signature}>
          <dt>{entry.label}</dt>
          <dd>
            <code>{entry.signature}</code>
            <span>
              selector <code>{entry.selector}</code> · returns{" "}
              <code>{entry.returns}</code>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function LaunchStampDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/launch-stamps"
      description="The canonical onchain reference for identifying launches stamped through the Programmable Router on Ethereum."
      kicker="Reference"
      parentHref="/docs/infrastructure"
      parentLabel="Infrastructure"
      sections={sections}
      title="Launch Stamp Router"
    >
      <section
        aria-labelledby="trust-root-heading"
        data-launch-stamp-docs
        id="trust-root"
      >
        <h2 id="trust-root-heading">Scope</h2>
        <p className={styles.sectionLead}>
          Router V1 covers only launches executed and stamped through it. Read
          the Router directly to resolve a token or Uniswap v4 pool to one
          frozen record.
        </p>

        <dl className={styles.definitionList}>
          <div>
            <dt>Network</dt>
            <dd>
              Ethereum mainnet, <code>chainId 1</code>
            </dd>
          </div>
          <div>
            <dt>Recognition input</dt>
            <dd>
              <code>{"token or (PoolManager, poolId)"}</code>
            </dd>
          </div>
          <div>
            <dt>Returned identity</dt>
            <dd>
              A <code>launchId</code> and its <code>StampRecordV1</code>
            </dd>
          </div>
          <div>
            <dt>Trust dependency</dt>
            <dd>
              An Ethereum provider.{" "}
              {
                "A Registry, indexer, Supabase project, Programmable API, or application server is not required."
              }
            </dd>
          </div>
        </dl>

        <p className={styles.criticalNote}>
          A valid record establishes Router provenance only. It does not
          establish safety, tradability, current liquidity or pool state, audit
          coverage, review status, or third-party terminal support.
        </p>
      </section>

      <section id="integration">
        <h2>Ethereum deployment record</h2>
        <p className={styles.sectionLead}>
          The record below describes the Ethereum deployment. Validate the full
          binding at the same canonical block as every launch lookup.
        </p>

        <p className={styles.statusLine}>
          <span aria-hidden="true" /> Manifest status value:{" "}
          <code>{router.status}</code>
        </p>
        <ReferenceList rows={manifestFields} />
        <p className={styles.detailLine}>
          <code>runtimeCodeHash</code> means{" "}
          {LAUNCH_STAMP_RUNTIME_HASH_DEFINITION} This binding applies at or
          after <code>startBlock</code> and through <code>endBlock</code> when a
          retirement boundary is published.
        </p>

        <h3 className={styles.subheading}>Finalized deployment evidence</h3>
        <ReferenceList rows={deploymentEvidenceFields} />
        <p className={styles.detailLine}>
          <code>finalized-verified</code> describes the deployment receipt,
          runtime, and immutable getter evidence. It is not an Explorer source
          publication status. The SHA-256 values are supplied handoff digests;
          this Website repository did not independently download and recompute
          their source evidence files.
        </p>

        <h3 className={styles.subheading}>Immutable bindings</h3>
        <ReferenceList rows={activationBindingFields} />

        <h3 className={styles.subheading}>
          Finalized CustomGraph test case: PCAN
        </h3>
        <p>
          This point-in-time test case covers the CustomGraph route. PCAN is the
          token symbol in this test case, not a separate trust root or
          classification. The published evidence does not include{" "}
          {"a separate Classic onchain canary"}. Router-stamped Classic launches
          use the same published Router ABI and become verifiable when their
          records exist.
        </p>
        <ReferenceList rows={canaryIdentityFields} />
        <p className={styles.detailLine}>
          Canary source commit <code>{canary.source.sourceCommit}</code> is
          separate from Router artifact source commit{" "}
          <code>{artifact.sourceCommit}</code> and does not replace it. The
          canary SHA-256 fields are supplied handoff digests; this Website
          repository did not independently download or recompute their evidence
          files and does not host them.
        </p>

        <h4 className={styles.minorHeading}>Canary observations</h4>
        <ReferenceList rows={canaryObservationFields} />

        <h4 className={styles.minorHeading}>Canary component proofs</h4>
        <dl className={`${styles.signatureList} ${styles.proofList}`}>
          {canary.stampProofs.map((proof) => (
            <div key={proof.component}>
              <dt>{proof.component}</dt>
              <dd>
                <code>{proof.launchId}</code>
                <span>
                  stampHash <code>{proof.stampHash}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="launch-kinds">
        <h2>Launch kinds</h2>
        <p>
          Classify a stamped record only from <code>record.kind</code>. The kind
          is returned metadata; it never selects a different trust root.
        </p>
        <dl className={styles.kindList}>
          {LAUNCH_KIND_V1.map((kind) => (
            <div key={kind.name}>
              <dt>
                <code>{kind.value}</code>
              </dt>
              <dd>
                <strong>LaunchKindV1.{kind.name}</strong>
                <span>
                  {kind.publicLabel ?? "Not a valid stamped record kind"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.detailLine}>
          Map <code>LaunchKindV1.CustomGraph</code> to Programmable Custom and{" "}
          <code>LaunchKindV1.Classic</code> to Programmable Classic.
        </p>
      </section>

      <section id="algorithm">
        <h2>Token and pool identity</h2>
        <p className={styles.sectionLead}>
          Complete the manifest, canonical block, runtime, ABI, descriptor and
          immutable-binding gates before resolving a launch identifier. Read the
          lookup, record and proof from the same Router at the same block.
        </p>

        <div className={styles.codeFrame}>
          <div>
            <span>ABI-bound read sequence</span>
            <span>Ethereum deployment · finalized reads</span>
          </div>
          <pre aria-label="Launch stamp verifier pseudocode using the frozen ABI">
            {abiBoundVerifier}
          </pre>
        </div>

        <p className={styles.detailLine}>
          Remote RPC URLs must use HTTPS. Plain HTTP is accepted only for
          loopback development endpoints. Prefer EIP-1898 reads with a concrete
          block hash and <code>requireCanonical: true</code>. When reads are
          bound by block number instead, refetch that height and require its
          closing hash to match the opening hash before returning either result.
        </p>

        <h3 className={styles.subheading}>Identity checks</h3>
        <dl className={styles.definitionList}>
          <div>
            <dt>Token</dt>
            <dd>
              Require <code>launchIdByToken(token)</code>,{" "}
              <code>record.token == token</code>, and{" "}
              <code>stampProof(token) == (launchId, record.stampHash)</code>.
            </dd>
          </div>
          <div>
            <dt>v4 pool</dt>
            <dd>
              Require <code>launchIdByPool(PoolManager, poolId)</code> and exact
              equality with <code>record.poolManager</code> and{" "}
              <code>record.poolId</code>. PoolManager must equal the published
              immutable binding.
            </dd>
          </div>
          <div>
            <dt>Exclusive component</dt>
            <dd>
              Require <code>launchIdByComponent(component)</code>, matching{" "}
              <code>stampProof(component)</code>, and a nonzero recorded{" "}
              <code>componentRuntimeCodeHash(component)</code>. Compare current
              runtime separately as a drift signal; equality is not a historical
              provenance gate.
            </dd>
          </div>
        </dl>
        <p className={styles.detailLine}>
          A Classic hook is shared infrastructure, so its component proof is
          intentionally <code>(bytes32(0), bytes32(0))</code> even when its
          launch is stamped. <code>stampProof(address)</code> corroborates an
          exclusive component. There is no universal hook getter. A current
          component-runtime mismatch may require separate consumer action, but
          it does not erase the Router&apos;s historical origin record.
        </p>

        <h3 className={styles.subheading} id="abi">
          Frozen ABI
        </h3>
        <p>
          Bind the source-exact ABI to the published address, runtime code hash,
          immutable getters, block range, and finality policy before reading a
          result.
        </p>
        <dl className={styles.referenceList}>
          <div>
            <dt>Contract</dt>
            <dd>{artifact.contractName}</dd>
          </div>
          <div>
            <dt>Source commit</dt>
            <dd>{artifact.sourceCommit}</dd>
          </div>
          <div>
            <dt>Source tree</dt>
            <dd>{artifact.sourceTree}</dd>
          </div>
          <div>
            <dt>Forge artifact</dt>
            <dd>{artifact.artifactPath}</dd>
          </div>
          <div>
            <dt>Published ABI</dt>
            <dd>
              <a href={router.abiUrl}>{router.abiUrl}</a>
            </dd>
          </div>
          <div>
            <dt>ABI file SHA-256</dt>
            <dd>{router.abiSha256}</dd>
          </div>
        </dl>
        <p className={styles.detailLine}>
          Hash the exact downloaded ABI file bytes. Do not normalize or
          reserialize the JSON before comparing its SHA-256 digest.
        </p>

        <h4 className={styles.minorHeading}>Trust-root reads</h4>
        <SignatureList entries={abi.bindingReads} />

        <h4 className={styles.minorHeading}>Primary verification reads</h4>
        <SignatureList entries={abi.primaryReads} />

        <h4 className={styles.minorHeading}>Exclusive-component reads</h4>
        <SignatureList entries={abi.componentReads} />

        <h4 className={styles.minorHeading}>Atomic write selector</h4>
        <div className={styles.atomicSignature}>
          <code>{abi.market.signature}</code>
          <span>
            selector <code>{abi.market.selector}</code> · payable · returns{" "}
            <code>{abi.market.returns}</code>
          </span>
        </div>
        <p className={styles.detailLine}>
          This is the sole market-bearing state-changing selector. Verification
          uses the read calls above and does not require a permit service,
          Registry, or application server.
        </p>
      </section>

      <section id="record">
        <h2>Stamp record</h2>
        <p>
          <code>launchStamp(bytes32)</code> returns <code>StampRecordV1</code>{" "}
          with fourteen fields in this exact order. Decode the tuple with the
          frozen ABI rather than a locally reconstructed type.
        </p>

        <ol
          aria-label="StampRecordV1 fields in ABI order"
          className={styles.recordFields}
        >
          {STAMP_RECORD_V1_FIELDS.map(([type, name]) => (
            <li key={name}>
              <code>{type}</code>
              <strong>{name}</strong>
            </li>
          ))}
        </ol>

        <p className={styles.detailLine}>
          Every address field must have valid 20-byte address encoding; this
          does not add a blanket nonzero-address rule. Require nonzero values
          for <code>poolId</code>, <code>poolKeyHash</code>,{" "}
          <code>componentSetHash</code>, <code>routePayloadHash</code>,{" "}
          <code>routeLauncherRuntimeCodeHash</code>,{" "}
          <code>expectedResultHash</code>, <code>permitDigest</code>, and{" "}
          <code>stampHash</code>.
        </p>

        <dl className={styles.definitionList}>
          <div>
            <dt>Identity</dt>
            <dd>
              <code>launchId</code> is the lookup key. Do not replace it with a
              name, ticker, creator label, or hook address.
            </dd>
          </div>
          <div>
            <dt>Hook</dt>
            <dd>
              <code>record.hook</code> is descriptive metadata. The shared
              Classic hook is not a universal lookup or classification key.
            </dd>
          </div>
          <div>
            <dt>Launch kind</dt>
            <dd>
              Use <code>record.kind</code> for the public Classic or Custom
              label. It does not change the Router binding.
            </dd>
          </div>
        </dl>
      </section>

      <section id="indexing">
        <h2>Events</h2>
        <p className={styles.sectionLead}>
          Use Router events to discover candidate launch IDs. Accept a result
          only after reproducing the record with canonical getter reads.
        </p>

        <dl className={styles.eventList}>
          {events.map((event) => (
            <div key={event.topic0}>
              <dt>{event.name}</dt>
              <dd>
                <code>{event.signature}</code>
                <span>
                  topic0 <code>{event.topic0}</code>
                </span>
                <span>
                  indexed: <code>{event.indexedInputs.join(", ")}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <div className={styles.codeFrame}>
          <div>
            <span>eth_getLogs filter</span>
            <span>Ethereum · canonical Router only</span>
          </div>
          <pre aria-label="Launch stamp Router event filter">
            {terminalLogFilter}
          </pre>
        </div>

        <p>
          Require <code>eth_chainId == 0x1</code> and the exact Router emitter.
          Backfill bounded ranges from <code>{router.startBlock}</code> to a
          finalized boundary and respect <code>endBlock</code> when present.
          Explicit block-number reads require at least{" "}
          <code>{router.finalityConfirmations}</code> confirmations.
        </p>
        <p>
          Decode each log by its matched signature and correlate the three event
          types by <code>launchId</code>. Only{" "}
          <code>ProgrammableLaunchStampedV1</code> supplies token and hook plus
          the non-indexed PoolManager, poolId, and stampHash. Classify only from{" "}
          <code>record.kind</code> after reading the record at the same
          canonical block.
        </p>
        <p>
          Persist block number and hash, transaction hash and index, and log
          index as the idempotency key. Replay an overlap window and prefer
          EIP-1898 reads with <code>requireCanonical: true</code>. If a stored
          block hash changes, rewind to the last common finalized checkpoint.
        </p>
        <p className={styles.detailLine}>
          A matching topic is only a discovery candidate. The full backfill,
          checkpoint subscription and reorg procedure is in the{" "}
          <PublicExternalLink href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.terminalGuideUrl}>
            terminal and scanner guide
          </PublicExternalLink>
          .
        </p>
      </section>

      <section id="result-states">
        <h2>Result states</h2>
        <p>
          Keep failed reads separate from valid negative results. Every state is
          evaluated against one finalized canonical block and the published
          Router binding.
        </p>
        <dl className={styles.stateList}>
          <div>
            <dt>STAMPED</dt>
            <dd>
              Every activation, canonical-block, runtime, ABI-descriptor,
              immutable-binding, lookup, record, identity, proof, route and any
              required closing-hash gate succeeds. Current component-runtime
              equality is reported separately.
            </dd>
          </div>
          <div>
            <dt>NOT_STAMPED</dt>
            <dd>
              After the preflight and any required closing block-hash check, a
              successful canonical lookup returns <code>bytes32(0)</code>.
            </dd>
          </div>
          <div>
            <dt>UNAVAILABLE</dt>
            <dd>
              The Router is outside its published block range, the chain is
              inactive, or required activation data is incomplete.
            </dd>
          </div>
          <div>
            <dt>INDETERMINATE</dt>
            <dd>
              A call fails, the Router binding cannot be verified, or a nonzero
              lookup and record are inconsistent.
            </dd>
          </div>
        </dl>
        <p className={styles.criticalNote}>
          Indeterminate is not a provenance result and is not a claim that the
          token, pool, or project is unsafe.
        </p>
      </section>

      <section id="boundary">
        <h2>What a stamp proves</h2>
        <p className={styles.sectionLead}>
          A verified record establishes that the returned Classic or Custom
          launch followed the canonical Router route at the observed block.
        </p>
        <dl className={styles.definitionList}>
          <div>
            <dt>Router provenance</dt>
            <dd>
              The route and origin are bound to this Router at or after{" "}
              <code>startBlock</code>. A record does not claim that every
              component was newly created; shared Classic infrastructure can be
              recorded by reference.
            </dd>
          </div>
          <div>
            <dt>Atomic v4 pool check</dt>
            <dd>
              For the recorded pool, the Router requires{" "}
              <code>slot0.sqrtPriceX96 == 0</code> immediately before its
              authorized launch call and <code>slot0.sqrtPriceX96 != 0</code>{" "}
              immediately after it, then writes the stamp in the same
              transaction. This establishes initialization during that atomic
              launch, not current pool state or liquidity.
            </dd>
          </div>
          <div>
            <dt>Not a safety result</dt>
            <dd>
              Safety, tradability, current pool state, current liquidity, audit
              coverage, review status, approval, endorsement, and permission to
              launch are not established by a stamp.
            </dd>
          </div>
          <div>
            <dt>Not terminal support</dt>
            <dd>
              A stamp does not automatically list a token in GMGN, Axiom, FOMO,
              or any other terminal. Each consumer decides whether and how to
              implement the published verification procedure.
            </dd>
          </div>
          <div>
            <dt>Not generic discovery</dt>
            <dd>
              Generic pool or token discovery in a third-party API is not Router
              stamp integration and must not be presented as Programmable
              provenance. GMGN market numbers are not canonical onchain stamp
              evidence; read current pool state separately through PoolManager
              or StateView.
            </dd>
          </div>
          <div>
            <dt>Not launch authorization</dt>
            <dd>
              A Router reference does not grant launch access. Custom launch
              preparation uses a scoped wallet, partner-root or partner-subkey
              credential and the authenticated API.
              Read the <Link href="/docs/trust">trust boundaries</Link> and{" "}
              <Link href="/docs/creators/launch">creator launch guide</Link> for
              the separate access and wallet rules.
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.finalSection} id="versioning">
        <h2>Versioning and retirement</h2>
        <p>
          Treat the trust root as the full manifest binding: chain ID, version,
          generation, Router address, block range, runtime code hash, frozen ABI
          hash, finality policy, and immutable getters. Do not carry one field
          forward on its own.
        </p>
        <ul className={styles.plainList}>
          <li>
            The current binding starts at block <code>{router.startBlock}</code>{" "}
            and has <code>endBlock: null</code>.
          </li>
          <li>
            If a future manifest publishes an <code>endBlock</code>, stop
            accepting this Router outside its published range and bind later
            observations to the replacement entry.
          </li>
          <li>
            Launches before this Router&apos;s start block are excluded. Do not
            backfill them or infer stamps from older contracts and events.
          </li>
          <li>
            Direct Classic Factory, Graph Factory, or Single Factory calls
            outside the canonical Router do not create Router provenance.
          </li>
        </ul>

        <h3 className={styles.subheading}>Canonical resources</h3>
        <ul className={styles.resourceList}>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl}>
              Discovery document
            </a>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}>
              Deployment manifest
            </a>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}>
              Frozen Router ABI
            </a>
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
