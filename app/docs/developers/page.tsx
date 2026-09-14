import type { Metadata } from "next";
import Link from "next/link";

import {
  LAUNCH_KIND_V1,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
} from "@/components/launch-stamp-docs-contract";
import { PROGRAMMABLE_DEVELOPER_ORIGIN } from "@/components/developer-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Developer integration · Programmable",
  description:
    "Use live Ethereum V3, prepare for Robinhood V4 public self-serve, verify Router stamps or index launches.",
  alternates: { canonical: "/docs/developers" },
  openGraph: {
    type: "website",
    siteName: "Programmable",
    title: "Programmable developer integration",
    description:
      "Custom Launch API, verification and indexing guides for Programmable launches on Ethereum and Robinhood Chain.",
    url: "/docs/developers",
    images: [
      {
        url: "/og/programmable-night-garden-og-1200x630.png",
        width: 1200,
        height: 630,
        type: "image/png",
        alt: "A starry night garden with pink wildflowers and a violet glow",
      },
    ],
  },
};

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;
const chainId = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.chainId;
const customKind = LAUNCH_KIND_V1.find((kind) => kind.name === "CustomGraph");
const classicKind = LAUNCH_KIND_V1.find((kind) => kind.name === "Classic");

const developerSections = [
  { id: "paths", label: "Choose a path" },
  { id: "trust-root", label: "Before you start" },
  { id: "boundary", label: "Result states" },
  { id: "resources", label: "Resources" },
  { id: "checklist", label: "Checklist" },
  { id: "agents", label: "Machine-readable docs" },
] as const;

export default function DeveloperDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers"
      description="Create and track live Ethereum V3 launches, integrate the Robinhood V4 public self-serve contract, verify Router-stamped tokens and pools, or index launches."
      kicker="Developer integration"
      sections={developerSections}
      title="Integrate Programmable launches"
    >
      <section id="paths">
        <div className={styles.sectionIntro}>
          <h2>Choose a path</h2>
          <p>
            Start with the task your product needs. Public V3 general-hook
            creation and lifecycle reads use a wallet key, partner root or bounded
            partner subkey. Funding
            and Router wallet actions remain separate from API authorization.
            Verification and indexing remain public read paths.
          </p>
        </div>

        <ul className={styles.taskList}>
          <li id="custom-api">
            <h3>
              <Link href="/docs/developers/custom-launch">
                Package locally and read launch history
              </Link>
            </h3>
            <p>
              Package and validate one deterministic graph locally, then use a
              scoped credential to submit and track the exact V3 request. Wallet
              review and signing remain separate. EIP-3009 funding adds one
              explicit typed-data signature; native-value and no-funding modes
              do not. The exact Router transaction always requires its own
              explicit wallet review and send.
            </p>
            <Link
              className={styles.textLink}
              href="/docs/developers/custom-launch"
            >
              Read the Custom Launch API guide
            </Link>
          </li>
          <li id="robinhood-v4">
            <h3>
              <Link href="/developer-reference/robinhood-terminal-indexer">
                Integrate Robinhood terminals and indexers
              </Link>
            </h3>
            <p>
              Bind to the chain-4663 Router and finalized feed, map verified
              records to Programmable Custom, and keep provenance, finality,
              security, market support and fee behavior separate. Resolve V4
              write activation live; the required fee policy is not proof of
              onchain enforcement or revenue.
            </p>
            <Link
              className={styles.textLink}
              href="/developer-reference/robinhood-terminal-indexer"
            >
              Read the Robinhood terminal integration contract
            </Link>
          </li>
          <li id="identity">
            <h3>
              <Link href="/docs/developers/verify">Verify a token or pool</Link>
            </h3>
            <p>
              Resolve a token address or Uniswap v4 pool to one launch record,
              cross-check the stamp and return an explicit result state.
            </p>
            <Link className={styles.textLink} href="/docs/developers/verify">
              Read the verification guide
            </Link>
          </li>
          <li id="indexing">
            <h3>
              <Link href="/docs/developers/indexing">Index new launches</Link>
            </h3>
            <p>
              Follow Router events from the published start block, verify every
              candidate and handle finality and reorgs.
            </p>
            <Link className={styles.textLink} href="/docs/developers/indexing">
              Read the indexing guide
            </Link>
          </li>
        </ul>
      </section>

      <section id="trust-root">
        <div className={styles.sectionIntro}>
          <h2>Before you start</h2>
          <p>
            Bind your integration to the published manifest before you read a
            token, pool or event.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Network</dt>
            <dd>
              Ethereum mainnet · <code>chainId {chainId}</code>
            </dd>
          </div>
          <div>
            <dt>Launch Stamp Router</dt>
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
            <dt>Launch kinds</dt>
            <dd>
              <code>{customKind?.value}</code> is {customKind?.publicLabel};{" "}
              <code>{classicKind?.value}</code> is {classicKind?.publicLabel}.
              Kind <code>0</code> is invalid.
            </dd>
          </div>
        </dl>

        <aside className={styles.callout}>
          <strong>Router V1 scope</strong>
          <p>
            This path covers only launches executed and stamped through this
            Router within its published block range. <code>startBlock</code> is
            the first block to scan, not a claim about earlier launches. A
            direct factory call remains outside this verification path even when
            it occurs later.
          </p>
        </aside>
      </section>

      <section id="boundary">
        <div className={styles.sectionIntro}>
          <h2>Return an explicit result</h2>
          <p>
            Keep negative results separate from missing or inconsistent
            evidence.
          </p>
        </div>

        <dl className={styles.resultList}>
          <div>
            <dt>
              <code>STAMPED</code>
            </dt>
            <dd>Every required binding, lookup and cross-check succeeds.</dd>
          </div>
          <div>
            <dt>
              <code>NOT_STAMPED</code>
            </dt>
            <dd>A canonical token or pool lookup succeeds and returns zero.</dd>
          </div>
          <div>
            <dt>
              <code>UNAVAILABLE</code>
            </dt>
            <dd>
              The Router is outside its published block range, the chain is
              inactive or activation data is incomplete.
            </dd>
          </div>
          <div>
            <dt>
              <code>INDETERMINATE</code>
            </dt>
            <dd>
              RPC, ABI, runtime, block, decoding or cross-check evidence is
              incomplete or inconsistent.
            </dd>
          </div>
        </dl>

        <aside className={styles.callout}>
          <strong>Provenance is not a safety claim</strong>
          <p>
            A verified stamp does not establish safety, tradability, current
            liquidity or pool state, audit coverage, approval, endorsement or
            terminal support.
          </p>
        </aside>
      </section>

      <section id="resources">
        <div className={styles.sectionIntro}>
          <h2>Use the published source set</h2>
          <p>
            Resolve the current Router from the manifest and verify the exact
            ABI bytes before the first lookup.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}>
              Deployment manifest
            </a>
            <span>Current chain, Router, start block and bindings.</span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}>
              Launch Stamp Router ABI
            </a>
            <span>
              Exact hosted bytes. Match <code>{router.abiSha256}</code>.
            </span>
          </li>
          <li>
            <Link href="/docs/launch-stamps">
              Router reference on this site
            </Link>
            <span>Selectors, events, records and deployment evidence.</span>
          </li>
          <li>
            <a href={`${PROGRAMMABLE_DEVELOPER_ORIGIN}/api/v2/launches`}>
              Hosted launch feed
            </a>
            <span>
              Paginated Classic and Custom records for applications that need a
              read API rather than direct event indexing.
            </span>
          </li>
          <li>
            <a href={`${PROGRAMMABLE_DEVELOPER_ORIGIN}/api/v2/token-list`}>
              Token list
            </a>
            <span>
              Read the finalized token projection for wallet and terminal
              integrations.
            </span>
          </li>
          <li>
            <a href={`${PROGRAMMABLE_DEVELOPER_ORIGIN}/api/v2/status`}>
              Feed health
            </a>
            <span>
              Check coverage, freshness and finality before ingestion.
            </span>
          </li>
          <li>
            <Link href="/developer-reference/robinhood-terminal-indexer">
              Robinhood terminal and indexer integration
            </Link>
            <span>
              Chain-bound identity, Router events, finalized feed, pagination,
              finality, reorg handling and explicit result states.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v4.json">Robinhood V4 OpenAPI</a>
            <span>
              Public self-serve release contract. Resolve production activation
              from live discovery.
            </span>
          </li>
          <li>
            <a href="/schemas/custom-launch/v4/source-verification-status.json">
              Robinhood V4 source-verification schema
            </a>
            <span>
              Post-finality provider status, separate from finality, indexing,
              trading and publication.
            </span>
          </li>
        </ul>
        <p className={styles.detailLine}>
          The hosted API is a convenience read surface. Router verification and
          onchain reads remain the authority for Programmable provenance.
        </p>
      </section>

      <section id="checklist">
        <div className={styles.sectionIntro}>
          <h2>Integration checklist</h2>
        </div>

        <ul className={styles.checkList}>
          <li>Load the deployment manifest and verify the Router binding.</li>
          <li>Use one canonical block for every read in a verification.</li>
          <li>
            Return <code>INDETERMINATE</code> when required evidence fails or
            disagrees.
          </li>
          <li>
            Validate the implementation against the finalized PCAN vector.
          </li>
        </ul>
      </section>

      <section id="agents">
        <div className={styles.sectionIntro}>
          <h2>Machine-readable docs</h2>
          <p>
            The same source set is available as Markdown, compact model context
            and raw contract artifacts.
          </p>
        </div>

        <p className={styles.inlineAction}>
          <Link href="/docs/developers/machine-readable">
            Open machine-readable documentation
          </Link>
        </p>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/custom-launch">
              Read Custom launch availability
            </Link>
          </li>
          <li>
            <Link href="/docs/developers/verify">Verify a token or pool</Link>
          </li>
          <li>
            <Link href="/docs/developers/indexing">Index new launches</Link>
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
