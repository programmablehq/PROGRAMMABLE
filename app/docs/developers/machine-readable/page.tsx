import type { Metadata } from "next";
import Link from "next/link";

import {
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";
import { V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";
import { robinhoodV4PublicContractDiscovery, robinhoodV4PublicLaunchRequirements } from "@/lib/custom-launch/v4-public-contract-discovery";

const robinhoodContract = robinhoodV4PublicContractDiscovery(V4_API_PROFILE_VERSION);
const robinhoodVersion = V4_API_PROFILE_VERSION === "4.1.0" ? "4.1.0" : "4.0.0";
const robinhoodOpenApiPath = robinhoodContract.openApiUrl?.replace("https://programmable.market", "") ?? "/openapi/custom-launch-v4.json";
const robinhoodPackConfigPath = robinhoodContract.packConfigSchemaUrl?.replace("https://programmable.market", "") ?? "/schemas/custom-launch/v4/pack-config.json";
const robinhoodSourceVerificationPath = robinhoodContract.sourceVerificationSchemaUrl?.replace("https://programmable.market", "") ?? "/schemas/custom-launch/v4/source-verification-status.json";

export const metadata: Metadata = {
  title: "Machine-readable docs · Programmable",
  description:
    "Live Ethereum V3 resources, Robinhood V4 release discovery, compatibility history, manifests and verification files.",
  alternates: { canonical: "/docs/developers/machine-readable" },
};

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;
const robinhoodV4WalletStatusCommand =
  "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until authorized";
const robinhoodV4FinalityStatusCommand =
  "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized";

const machineSections = [
  { id: "documents", label: "Documentation files" },
  { id: "robinhood-v4", label: "Robinhood V4" },
  { id: "artifacts", label: "Contract artifacts" },
  { id: "authority", label: "Source authority" },
  { id: "access", label: "Access" },
] as const;

export default function MachineReadableDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/machine-readable"
      description="Use the same published source set in agents, terminals, scanners and build pipelines."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={machineSections}
      title="Machine-readable docs"
    >
      <section id="documents">
        <div className={styles.sectionIntro}>
          <h2>Start with the right file</h2>
          <p>
            Read the human guide first. Agents and integrations should then
            fetch only the machine contract needed for their task.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <Link href="/docs/developers/custom-launch">
              Custom Launch API guide
            </Link>
            <span>
              Canonical human guide for public V3 creation, lifecycle, wallet
              handoff, errors, discovery and claims.
            </span>
          </li>
          <li>
            <a href="/openapi.json">
              <code>/openapi.json</code>
            </a>
            <span>
              Combined contract for public reads and authenticated Custom
              launch routes.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v1.json">
              <code>/openapi/custom-launch-v1.json</code>
            </a>
            <span>
              Standalone OpenAPI contract for live Bearer-authenticated V1
              reads, preserved schemas and its explicit fresh-write fence.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v2.json">
              <code>/openapi/custom-launch-v2.json</code>
            </a>
            <span>
              Compatibility contract for existing V2 resources, schemas and
              the explicit fresh-write fence. Prepared and simulating detail
              reads are observation-only and cannot expose a new wallet action.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v3.json">
              <code>/openapi/custom-launch-v3.json</code>
            </a>
            <span>
              Preparatory profile 3.4 request contract plus the live 3.3
              capabilities, fee-policy and finalized-feed surface. It does not
              activate profile 3.4 or replace live/default profile 3.3.0.
            </span>
          </li>
          <li>
            <a href={robinhoodOpenApiPath}>
              <code>{robinhoodOpenApiPath}</code>
            </a>
            <span>
              {robinhoodVersion === "4.1.0"
                ? "Robinhood Chain Mainnet V4.1 contract with a funding plan, atomic minimum initial buy and native fee proof. Require live publicWrites, publicAuthorization and releaseReady; this pointer is not activation evidence."
                : "Robinhood Chain Mainnet V4 contract. Public discovery promotion, writes and authorization remain inactive; this pointer is not activation evidence."}
            </span>
          </li>
          <li>
            <a href="/policies/custom-launch-agent-remediation-v1.json">
              <code>/policies/custom-launch-agent-remediation-v1.json</code>
            </a>
            <span>
              Versioned cold-agent contract for inspecting existing projects,
              building V3 pack config, EIP-3009 compatibility, liquidity and
              automatic remediation without a project allowlist.
            </span>
          </li>
          <li>
            <a href="/schemas/custom-launch/v3/pack-config.json">
              <code>/schemas/custom-launch/v3/pack-config.json</code>
            </a>
            <span>
              Source-tree JSON Schema for{" "}
              <code>programmable.launch-pack-config.v3</code>, including pending
              profile 3.4 inputs. Check live discovery before submission.
            </span>
          </li>
          <li>
            <a href={robinhoodPackConfigPath}>
              <code>{robinhoodPackConfigPath}</code>
            </a>
            <span>
              V4 pack-config schema for chain 4663. Check
              discovery before any network action.
            </span>
          </li>
          <li>
            <a href={robinhoodSourceVerificationPath}>
              <code>{robinhoodSourceVerificationPath}</code>
            </a>
            <span>
              Server-authored post-finality source-verification status. It does
              not determine chain finality, indexing, trading or publication.
            </span>
          </li>
          <li>
            <a href="/developers/custom-launch-api-v1.md">
              <code>/developers/custom-launch-api-v1.md</code>
            </a>
            <span>
              Raw guide for agent and script compatibility.
            </span>
          </li>
          <li>
            <a href="/docs/developers.md">
              <code>/docs/developers.md</code>
            </a>
            <span>The integration guide as Markdown.</span>
          </li>
          <li>
            <a href="/llms.txt">
              <code>/llms.txt</code>
            </a>
            <span>
              A short source index and the required interpretation rules.
            </span>
          </li>
          <li>
            <a href="/llms-full.txt">
              <code>/llms-full.txt</code>
            </a>
            <span>
              Expanded context for readers that need the complete overview in
              one response.
            </span>
          </li>
        </ul>
      </section>

      <section id="robinhood-v4">
        <div className={styles.sectionIntro}>
          <h2>Read Robinhood V4 release discovery</h2>
          <p>
            CLI <code>3.3.9</code> remains the installable live Ethereum V3
            release. For Robinhood V4, verify the immutable <code>{robinhoodVersion}</code> release,
            source commit, release manifest and tarball checksum from live discovery
            before installing.
          </p>
        </div>

        {robinhoodV4PublicLaunchRequirements(V4_API_PROFILE_VERSION).map((requirement) => (
          <p className={styles.bodyCopy} key={requirement}>{requirement}</p>
        ))}

        <ul className={styles.checkList}>
          <li>
            Stop before authenticated preflight or submission while either the V4 or
            chain 4663 discovery entry reports{" "}
            <code>publicWrites: false</code>,{" "}
            <code>publicAuthorization: false</code> or{" "}
            <code>releaseReady: false</code>, or a required field is missing.
            Require all three gates to be true in both entries before proceeding.
          </li>
          <li>
            V4 uses <code>received</code>, <code>validating</code>,{" "}
            <code>action_required</code>, <code>authorized</code>,{" "}
            <code>awaiting_wallet_signature</code>,{" "}
            <code>wallet_action_required</code>, <code>submitted</code>,{" "}
            <code>sequencer_soft_confirmed</code>,{" "}
            <code>ethereum_posted</code>, <code>finalized</code> and{" "}
            <code>failed</code>. <code>action_required</code> is remediation, not a
            wallet action.
          </li>
          <li>
            Poll the wallet stage with{" "}
            <code>{robinhoodV4WalletStatusCommand}</code>
            . Stop for separate controller-wallet review, signing and broadcast,
            then poll <code>{robinhoodV4FinalityStatusCommand}</code>.
          </li>
          <li>
            The CLI can prepare and display the exact transaction. It never signs
            or broadcasts.
          </li>
          <li>
            Source verification starts after finality and remains independent.
            Indexing, trading readiness, Explore visibility and publication are
            separate outcomes.
          </li>
        </ul>
      </section>

      <section id="artifacts">
        <div className={styles.sectionIntro}>
          <h2>Contract artifacts</h2>
          <p>
            Resolve the current Router first. Then pin the exact ABI bytes and
            verification reference used by your build.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl}>
              Discovery document
            </a>
            <span>
              Stable entry point that supplies <code>manifestUrl</code>.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}>
              Deployment manifest
            </a>
            <span>
              Chain, Router, published range, runtime, immutable bindings, event
              topics, ABI URL and digest.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}>
              Hosted Router ABI
            </a>
            <span>
              Hash the exact downloaded bytes and match{" "}
              <code>{router.abiSha256}</code>.
            </span>
          </li>
        </ul>
      </section>

      <section id="authority">
        <div className={styles.sectionIntro}>
          <h2>Know which source defines what</h2>
          <p>
            The files have different jobs. Do not treat a model-context file as
            a replacement for the deployed contract binding.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Deployment manifest</dt>
            <dd>
              Supplies the current chain, Router, block range, runtime,
              bindings, topics and ABI digest.
            </dd>
          </div>
          <div>
            <dt>Hosted ABI</dt>
            <dd>
              Defines the contract interface. Verify its exact bytes against the
              manifest digest.
            </dd>
          </div>
          <div>
            <dt>GitHub Router reference</dt>
            <dd>
              Defines the canonical point-verification algorithm and test
              vector.
            </dd>
          </div>
          <div>
            <dt>Custom Launch API contract</dt>
            <dd>
              Defines the authenticated request, manifest and attestation
              shapes, graph constraints, permit binding and wallet handoff. It
              does not define a universal check-ID catalog or a safety review.
            </dd>
          </div>
          <div>
            <dt>Web, Markdown and model context</dt>
            <dd>
              Explain and route the integration. <code>/llms-full.txt</code> is
              expanded convenience context, not the normative algorithm.
            </dd>
          </div>
        </dl>
      </section>

      <section id="access">
        <div className={styles.sectionIntro}>
          <h2>Access</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            Public documentation, discovery and Registry-read endpoints require
            no authentication.
          </li>
          <li>
            <code>https://api.programmable.market/v3/custom-launches</code>{" "}
            requires a scoped wallet, partner-root or partner-subkey Bearer
            credential.
          </li>
          <li>
            Public V3.3 creation, list and single-resource reads are live. V2 and
            V1 history and schemas remain readable, while fresh authenticated
            POSTs return non-retryable{" "}
            <code>409 CUSTOM_LAUNCH_V2_READ_ONLY</code> and{" "}
            <code>409 CUSTOM_LAUNCH_V1_READ_ONLY</code>. Only V3.3 accepts new
            submissions.
          </li>
          <li>
            CLI <code>3.3.9</code> is the current installable release and
            defaults to live profile <code>3.3.0</code>. Explicit profile{" "}
            <code>3.4.0</code> output remains preparatory and is rejected by live
            capabilities until backend and <code>.well-known</code> activation.
          </li>
          <li>
            The default V3 profile uses{" "}
            <code>programmable.direct-native-hook-graph-profile.v3</code>,{" "}
            <code>profileRevision: 3</code> and{" "}
            <code>profileVersion: 3.3.0</code>. It supports project-owned tokens,
            hooks, 3–16 exact direct graph targets and every valid Uniswap v4
            permission mask. Profile 3.3.0 requires and binds canonical project name,
            symbol, meaningful description, exact non-empty local image, one
            website and one X profile into the launch identity. Other public
            links are optional. Its selection uses{" "}
            <code>
              programmable.direct-native-hook-graph-profile-selection-binding.v3
            </code>
            . Exact 3.2.0, metadata-absent 3.1.0 and 3.0.0 requests remain readable
            and byte-identical retryable under their original policies. Profile
            3.2.0 keeps its nullable-image semantics. Revision 2 also remains compatible.
          </li>
          <li>
            Revision 3 pins exact{" "}
            <code>solc 0.8.26+commit.8a97fa7a</code> Standard JSON, limited to
            5,242,880 bytes per unit and in aggregate and 2,048 inline sources.
          </li>
          <li>
            Role-aware exact-source static admission binds every finding.
            Profile 3.3.0 has exactly seven objective hard-block rules. Proxy,
            delegatecall, mint, tax, pause, liquidity and return-delta surfaces
            require evidence instead of categorical rejection. A hard-block
            code-and-role match returns <code>action_required</code>; other
            findings remain visible. There is no manual project allowlist. A
            final Router simulation is mandatory and must pass before wallet
            handoff. Missing behavior execution leaves behavior, fee, liquidity
            and routability claims unverified; an authenticated executed failure
            blocks the handoff.
          </li>
          <li>
            Public <code>GET /v3/capabilities</code> and authenticated,
            side-effect-free <code>POST /v3/custom-launches/preflight</code>
            expose risk classification, platform-owned behavior evidence and
            six separate product-truth axes. A not-executed or needs-evidence
            result is outstanding, not verified, and cannot authorize a wallet
            handoff. CLI and preflight results are preparation; the API server is
            the decision authority.
          </li>
          <li>
            Admission and simulation are not an audit or a guarantee of safety,
            honeypot resistance, liquidity, tradeability or fee behavior.
            A 10 bps claim applies only to a fee-certified profile or adapter and
            its exact stamped PoolKey; arbitrary custom hooks are not automatically
            fee-enforced.
          </li>
          <li>
            <code>prepared</code> contains an artifact but no wallet transaction.
            <code>authorized</code> is possible only after objective static hard
            blocks and exact Router simulation pass and contains the
            permit-attached transaction for the bound wallet to review, sign and
            broadcast. Missing behavior execution leaves related claims
            unverified; an authenticated executed failure blocks. The API key is
            not wallet authority.
          </li>
          <li>
            <code>GET /v3/custom-launches</code> returns an exact-launch-principal,
            cursor-paginated snapshot. Partner roots aggregate all partner-attributed
            launches; each subkey sees only its stable lineage and rotation preserves
            that lineage history. It makes a bounded best-effort
            reconciliation pass over pending rows and still returns durable
            history when RPC is unavailable. Resource
            <code> lifecycleQueue</code> is bounded worker scheduling guidance,
            not launch finality.
          </li>
          <li>
            After broadcast, poll the single-launch status route. It is the
            canonical full-resource path while the durable worker and bounded
            list reconciliation may also advance pending state. Finality
            requires 64 confirmations.
          </li>
          <li>
            The API request UUID is returned as <code>requestId</code> and the
            legacy <code>launchId</code> alias. The distinct bytes32
            <code>onchainLaunchId</code> identifies the Router launch.
          </li>
          <li>
            For <code>action_required</code>, keep the exact report and resource{" "}
            <code>requestId</code>. Send support only that ID, status, UTC time
            and public code. Never send the API key.
          </li>
          <li>
            Finalized Router launches are eligible for Explore and Profile
            discovery after refresh. Third-party discovery and listing remain
            consumer-controlled.
          </li>
          <li>
            Router verification proves initialization and fixed runtime and pool
            bindings, not active liquidity or tradability. Agent checks remain
            caller-declared and are not an audit. Exact-source status is
            server-authored only after a real provider exact match.
          </li>
          <li>
            Fee claims and automated buybacks are not active Custom Launch API
            operations for arbitrary hooks. FADE uses a specifically bound
            adapter, not a generic capability.
          </li>
          <li>Ethereum RPC authentication depends on your provider.</li>
          <li>
            After manifest and ABI bootstrap, point verification needs an
            Ethereum provider only.
          </li>
        </ul>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/custom-launch">
              Read Custom Launch API availability
            </Link>
          </li>
          <li>
            <Link href="/docs/developers/verify">Verify a token or pool</Link>
          </li>
          <li>
            <Link href="/docs/developers/indexing">Index new launches</Link>
          </li>
          <li>
            <Link href="/docs/launch-stamps">
              Open the full Router reference
            </Link>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
