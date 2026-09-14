import type { Metadata } from "next";

import docsStyles from "@/components/docs-experience.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Trust · Programmable",
  description:
    "Understand what bundle evidence, API preparation, wallet execution and Router provenance prove.",
  alternates: { canonical: "/docs/trust" },
};

const sections = [
  { id: "layers", label: "Evidence layers" },
  { id: "review", label: "Checks and preparation" },
  { id: "router", label: "Router provenance" },
  { id: "roles", label: "Roles and controls" },
  { id: "audits", label: "Independent review" },
  { id: "report", label: "Report an issue" },
] as const;

export default function TrustDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/trust"
      description="Programmable separates caller evidence, API preparation, wallet execution and public onchain verification."
      sections={sections}
      title="Trust"
    >
      <section id="layers">
        <h2>Evidence layers</h2>
        <p>
          No single green check proves the whole lifecycle. Each layer answers a
          narrower question.
        </p>
        <ol className={docsStyles.steps}>
          <li>
            <strong>Agent evidence</strong>
            <span>
              Which checks did the agent attest it ran for the exact graph
              bundle?
            </span>
          </li>
          <li>
            <strong>API preparation</strong>
            <span>
              Did the platform validate the declared manifest, graph, evidence
              digests and wallet binding and prepare the exact artifact?
            </span>
          </li>
          <li>
            <strong>Wallet execution</strong>
            <span>
              Did the creator inspect and submit the expected transaction?
            </span>
          </li>
          <li>
            <strong>Finality</strong>
            <span>
              Is the successful transaction part of the canonical finalized
              chain?
            </span>
          </li>
          <li>
            <strong>Router provenance</strong>
            <span>
              Does the canonical Router record bind the token, pool, hook and
              launch kind?
            </span>
          </li>
          <li>
            <strong>Public projection</strong>
            <span>
              Do the indexer, API and website show the same finalized identity?
            </span>
          </li>
        </ol>
      </section>

      <section id="review">
        <h2>Checks and preparation</h2>
        <p>
          Each Custom request binds one source descriptor, manifest digest,
          graph bundle and set of agent evidence digests. A changed bundle is a
          new launch subject, even when its project name is unchanged.
        </p>
        <div className={docsStyles.factGrid}>
          <div className={docsStyles.fact}>
            <span>Agent evidence</span>
            <strong>Caller-declared digests for checks on the exact graph</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Prepared</span>
            <strong>
              The exact artifact exists; the wallet transaction is null
            </strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Authorized</span>
            <strong>The exact transaction exists but is not wallet-signed</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Failed</span>
            <strong>The request did not satisfy a required binding or constraint</strong>
          </div>
        </div>
        <p>
          The platform validates shapes, digests and graph bindings. It does not
          fetch the evidence, reproduce the build, compile or simulate the
          project, audit it or adopt the agent&apos;s claims. Prepared and
          authorized results are not an approval, endorsement, price opinion or
          promise that a launch will trade.
        </p>
      </section>

      <section id="router">
        <h2>Router provenance</h2>
        <p>
          A valid Launch Stamp Router record establishes that a launch was
          executed and stamped through the published Router path. Applications
          can use the recorded kind to label it Programmable Classic or
          Programmable Custom.
        </p>
        <div className={docsStyles.callout}>
          <strong>Provenance is not a safety guarantee.</strong>
          <p>
            A stamp does not establish current liquidity, tradability, price,
            audit coverage or support in an external application. Direct factory
            calls outside the Router do not receive the label.
          </p>
        </div>
      </section>

      <section id="roles">
        <h2>Roles and controls</h2>
        <p>
          Every release should disclose who can change fees, recipients,
          dependencies, template configuration and future launch controls. The
          creator wallet controls its own launch transaction. Protocol roles do
          not sign that transaction on the creator&apos;s behalf.
        </p>
        <p>
          A pause can stop new launches or new authority actions when the
          relevant contract supports it. It cannot rewrite finalized launches or
          silently change immutable contracts already deployed.
        </p>
        <p>
          Use the exact release and deployment records for addresses, code
          hashes, roles and current control state.
        </p>
      </section>

      <section id="audits">
        <h2>Independent review</h2>
        <p>
          The Programmable contracts in the public product repository have not
          undergone an external audit or public security contest. Internal
          reviews, tests, static analysis and reproducible release evidence are
          not substitutes for an independent audit.
        </p>
        <p>
          A project can publish its own audit or security work. That evidence
          applies only to the version and scope it names.
        </p>
      </section>

      <section id="report">
        <h2>Report an issue</h2>
        <p>
          Include the affected chain, contract or URL, the exact source revision
          and a minimal reproduction. Do not post private keys, access tokens,
          wallet signatures or unpublished exploit details in a public issue.
        </p>
      </section>
    </DocsShell>
  );
}
