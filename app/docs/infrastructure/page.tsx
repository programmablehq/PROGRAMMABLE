import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { PROGRAMMABLE_LAUNCH_STAMP_RESOURCES } from "@/components/launch-stamp-docs-contract";
import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Infrastructure · Programmable",
  description:
    "Understand how Programmable launches create Uniswap v4 markets, how Router provenance works, and which public resources define the integration.",
  alternates: { canonical: "/docs/infrastructure" },
};

const sections = [
  { id: "launch", label: "From launch to application" },
  { id: "provenance", label: "Launch provenance" },
  { id: "resources", label: "Public resources" },
  { id: "boundaries", label: "Verification boundaries" },
] as const;

const resources = [
  {
    description:
      "Current Ethereum deployment, Router range, runtime hash and immutable bindings.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl,
    label: "Deployment manifest",
  },
  {
    description:
      "The exact interface used to read and verify Launch Stamp Router V1.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl,
    label: "Router ABI",
  },
] as const;

export default function InfrastructureDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/infrastructure"
      description="Programmable launch contracts create tokens and Uniswap v4 markets. The Launch Stamp Router separately records provenance for launches executed through it."
      sections={sections}
      title="How Programmable works"
    >
      <section id="launch">
        <h2>From launch to application</h2>
        <p>
          Each layer answers a different question. Do not use market state as
          proof of origin, or a provenance record as proof of current market
          behavior.
        </p>

        <div className={styles.topicList}>
          <div>
            <h3>Launch execution</h3>
            <p>
              Model-specific contracts create the token, initialize its Uniswap
              v4 market and apply the selected launch rules.
            </p>
          </div>
          <div>
            <h3>Onchain market</h3>
            <p>
              PoolManager and poolId identify the v4 market. Its currencies,
              fee, tick spacing, hook and current state must be read separately.
            </p>
          </div>
          <div>
            <h3>Launch provenance</h3>
            <p>
              For a launch executed and stamped through Router V1, the Router
              records the token, hook, market, launch kind and component proofs.
            </p>
          </div>
          <div>
            <h3>Application label</h3>
            <p>
              A terminal, wallet, scanner or indexer can show a Programmable
              label after it verifies the Router address, runtime, bindings,
              lookups and record cross-checks.
            </p>
          </div>
        </div>
      </section>

      <section id="provenance">
        <h2>Router verification applies only to stamped launches</h2>
        <p>
          Start with a token address or with PoolManager and poolId. Resolve the
          launch ID, read the recorded stamp and cross-check the returned
          identity at the same canonical block.
        </p>
        <p>
          The published start block is the first block to scan for this Router.
          It does not add provenance to earlier launches. A direct factory call
          remains outside the Router record even when it occurs at or after that
          block. Do not infer a stamp from a name, symbol, shared hook or older
          event.
        </p>
        <p className={styles.note}>
          A verified record establishes Router provenance.{" "}
          <strong>It is not a safety guarantee.</strong> It is also not an
          audit, approval or endorsement.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/launch-stamps">
            Read the Launch Stamp Router reference
            <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
          </Link>
        </p>
      </section>

      <section id="resources">
        <h2>Public resources</h2>
        <p>
          Use these resources together. The manifest identifies the deployment
          and the ABI defines the reads.
        </p>

        <ul className={styles.linkList}>
          {resources.map((resource) => (
            <li key={resource.href}>
              <a href={resource.href} rel="noreferrer" target="_blank">
                <span>
                  <strong>{resource.label}</strong>
                  <small>{resource.description}</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
                <span className="sr-only">Opens in a new tab</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section id="boundaries">
        <h2>What verification proves</h2>
        <dl className={styles.boundaryList}>
          <div>
            <dt>It establishes</dt>
            <dd>
              The recorded Router origin, token, hook, market, launch kind and
              component proofs for that stamped launch at the verified block.
            </dd>
          </div>
          <div>
            <dt>It does not establish</dt>
            <dd>
              Current safety, tradability, liquidity, price, terminal support,
              audit coverage or the behavior of an external interface.
            </dd>
          </div>
          <div>
            <dt>It does not cover</dt>
            <dd>
              Launches created before Router activation and every direct factory
              call outside the canonical Router path, including calls made at or
              after the published start block.
            </dd>
          </div>
        </dl>

        <p className={styles.inlineAction}>
          <Link href="/docs/developers">
            Open the developer integration guide
            <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
          </Link>
        </p>
      </section>
    </DocsShell>
  );
}
