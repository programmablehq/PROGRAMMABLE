import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";
type ModelSlug = "classic" | "custom" | "stock-paired";

const classicEvidenceCommit = "1fb9558af4f0248de75d5c7983f80036e32f47cb";
const stockPairedEvidenceCommit = "db30e8609002cdee16d7cbe5a2c5a0309b63ce9b";

const classicSections = [
  { id: "terms", label: "How it works" },
  { id: "starting-point", label: "Supply and liquidity" },
  { id: "fees", label: "Fees" },
  { id: "rewards", label: "Rewards" },
  { id: "initial-buy", label: "Initial Buy" },
  { id: "launch-transaction", label: "Launch transaction" },
  { id: "boundaries", label: "Limits and risks" },
  { id: "deployment", label: "Contracts and source" },
] as const;

const customSections = [
  { id: "overview", label: "What Custom is" },
  { id: "release-scope", label: "Bundle-specific behavior" },
  { id: "release-requirements", label: "Bundle requirements" },
  { id: "launch-information", label: "Launch information" },
  { id: "router-provenance", label: "Router provenance" },
  { id: "project-presentation", label: "What preparation does not prove" },
] as const;

const stockPairedSections = [
  { id: "overview", label: "Historical model" },
  { id: "token-boundary", label: "Token boundary" },
  { id: "quote-assets", label: "Quote assets" },
  { id: "pool-creation", label: "How launches worked" },
  { id: "quote-rewards", label: "Fees and rewards" },
  { id: "routing", label: "Routes" },
  { id: "quote-controls", label: "Controls" },
  { id: "deployment", label: "Contracts and source" },
] as const;

const modelMetadata: Record<ModelSlug, { description: string; title: string }> =
  {
    classic: {
      title: "Classic",
      description:
        "How Classic creates a fixed-supply token, its Uniswap v4 market and the related fee and reward paths.",
    },
    custom: {
      title: "Custom hooks",
      description:
        "API preparation requirements and provenance for individual Uniswap v4 hook graphs.",
    },
    "stock-paired": {
      title: "Stock-Paired",
      description:
        "Historical Uniswap v4 pools that use an allowlisted Ondo Global Markets token as their quote asset.",
    },
  };

function isModelSlug(value: string): value is ModelSlug {
  return value in modelMetadata;
}

export function generateStaticParams() {
  return Object.keys(modelMetadata).map((model) => ({ model }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ model: string }>;
}): Promise<Metadata> {
  const { model } = await params;
  if (!isModelSlug(model)) return {};
  const metadata = modelMetadata[model];
  return {
    title: `${metadata.title} · Programmable`,
    description: metadata.description,
    alternates: { canonical: `/docs/models/${model}` },
  };
}

function ClassicDocs() {
  const launcher = "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770";
  const hook = "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC";
  const rewardVaultFactory = "0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a";
  const initialBuyCustodyFactory = "0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4";
  const positionRecipientFactory = "0x291a9ff1059d225d02B1659430804486404dB507";
  const ctoAuthority = "0x9746469Cd79fdDc5aA7218e7dd51c829ee518c0C";

  return (
    <DocsShell
      currentPath="/docs/models/classic"
      kicker="Launch model · Ethereum"
      title="Classic"
      description="Classic creates a fixed-supply token and an ETH market with separately configured buy and sell fees."
      sections={classicSections}
    >
      <section id="terms">
        <h2>How Classic works</h2>
        <p>
          A Classic launch creates the token, initializes its ETH pool and
          deposits the full supply into a permanently locked one-sided Uniswap
          v4 position. Before signing, the launch wallet chooses the buy fee,
          sell fee, reward destination and Initial Buy custody.
        </p>
      </section>

      <section id="starting-point">
        <h2>Supply and liquidity</h2>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Supply</span>
            <strong>1 billion tokens with 18 decimals</strong>
          </div>
          <div className={styles.fact}>
            <span>Transfer tax</span>
            <strong>0%</strong>
          </div>
          <div className={styles.fact}>
            <span>Buy and sell fees</span>
            <strong>
              Set separately from 1% to 10% in one-percentage-point steps
            </strong>
          </div>
          <div className={styles.fact}>
            <span>Creator liquidity deposit</span>
            <strong>Not required</strong>
          </div>
        </div>
        <p>
          The full supply enters the one-sided position at launch. The position
          has no liquidity-removal path.
        </p>
        <p>
          The current Classic curve starts at an approximate fully diluted
          valuation of 1.36 ETH before the Initial Buy. This value is the
          curve&apos;s mathematical starting point, not the amount of liquidity
          or sale proceeds, and it does not describe future market value. The
          Initial Buy moves the pool price before public trading begins.
        </p>
      </section>

      <section id="fees">
        <h2>Fees</h2>
        <p>
          The launch wallet sets the buy fee and sell fee separately. Each rate
          is 1%, 2%, 3% through 10% and is fixed for the launch.
        </p>
        <ul className={styles.contentList}>
          <li>The pool identifies each swap as a buy or a sell.</li>
          <li>The fixed rate for that direction is accounted in ETH.</li>
          <li>
            The selected rate minus 0.10 percentage points accrues as creator
            rewards.
          </li>
          <li>
            0.10 percentage points of the gross native swap amount accrues to
            the Programmable fee recipient.
          </li>
        </ul>
        <div className={styles.callout}>
          <strong>
            The Programmable share is included in the selected fee.
          </strong>
          <p>
            A 1% buy fee leaves 0.90% for creator rewards. It is not a second
            fee added to the selected rate. Normal ERC-20 transfers do not pay
            the hook fee.
          </p>
        </div>
      </section>

      <section id="rewards">
        <h2>Rewards</h2>
        <p>
          Creator rewards accrue in ETH. They can go to the launch wallet,
          another wallet or a split between two and five unique wallets. The
          launch records the selected configuration, and each current payout
          wallet can claim only its own allocation.
        </p>
        <h3>Allocation</h3>
        <p>
          The vault accounts for each beneficiary without requiring the launch
          wallet to distribute funds.
        </p>
        <h3>Claims</h3>
        <p>
          Each beneficiary claims independently. A beneficiary cannot claim
          another wallet&apos;s rewards or redirect them.
        </p>
        <h3>Changing a payout wallet</h3>
        <p>
          Accrued rewards remain claimable by the previous wallet. Future
          accrual for that allocation moves to the new address without changing
          its percentage.
        </p>
        <div className={styles.callout}>
          <strong>
            The disclosed community takeover (CTO) authority can replace the
            configuration for future rewards.
          </strong>
          <p>
            The authority checkpoints the existing configuration before it
            changes future recipients or split percentages. It cannot move
            accrued rewards, alter swap fees, change the token supply or remove
            liquidity.
          </p>
        </div>
      </section>

      <section id="initial-buy">
        <h2>Initial Buy custody</h2>
        <p>
          The launch wallet selects an Initial Buy of at least 0.0006 ETH.
          Purchased tokens can remain unlocked, use a fixed lock, vest linearly
          or vest after a cliff. Lock and vesting periods can run from 1 to
          3,650 days and cannot be changed after launch.
        </p>
      </section>

      <section id="launch-transaction">
        <h2>Launch transaction</h2>
        <p>
          The launch wallet completes the following actions in one transaction.
        </p>
        <ol className={styles.steps}>
          <li>
            <strong>Create the fixed-supply token.</strong>
            <span>
              The UERC20 factory creates the token and records its metadata.
            </span>
          </li>
          <li>
            <strong>Initialize the recorded ETH pool.</strong>
            <span>
              The hook stores the buy fee, sell fee and reward vault for the
              pool.
            </span>
          </li>
          <li>
            <strong>Lock the one-sided position.</strong>
            <span>
              The complete supply enters a position with no liquidity-removal
              path.
            </span>
          </li>
          <li>
            <strong>Execute the Initial Buy.</strong>
            <span>
              Purchased tokens go to the launch wallet or its selected custody
              contract.
            </span>
          </li>
        </ol>
      </section>

      <section id="boundaries">
        <h2>Limits and risks</h2>
        <ul className={styles.contentList}>
          <li>No minting after launch.</li>
          <li>No blacklist, sell restriction, rebase or transfer tax.</li>
          <li>
            No free or pre-minted token allocation goes to the creator or
            Programmable. The launch wallet receives only the tokens it
            purchases in the Initial Buy.
          </li>
          <li>No separate Programmable launch fee beyond Ethereum gas.</li>
          <li>
            No conventional LP fee. Creator rewards come from the configured
            hook fee.
          </li>
          <li>
            A third-party terminal can use a different pool or route. Check
            which pool the terminal uses before trading.
          </li>
        </ul>
      </section>

      <section id="deployment">
        <h2>Contracts and source</h2>
        <p>
          These contracts define the current Classic deployment on Ethereum.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Launcher</td>
                <td>
                  <DocsAddress address={launcher} label="Launcher" />
                </td>
              </tr>
              <tr>
                <td>Fee hook</td>
                <td>
                  <DocsAddress address={hook} label="Fee hook" />
                </td>
              </tr>
              <tr>
                <td>Reward vault factory</td>
                <td>
                  <DocsAddress
                    address={rewardVaultFactory}
                    label="Reward vault factory"
                  />
                </td>
              </tr>
              <tr>
                <td>Initial Buy custody factory</td>
                <td>
                  <DocsAddress
                    address={initialBuyCustodyFactory}
                    label="Initial Buy custody factory"
                  />
                </td>
              </tr>
              <tr>
                <td>Position recipient factory</td>
                <td>
                  <DocsAddress
                    address={positionRecipientFactory}
                    label="Position recipient factory"
                  />
                </td>
              </tr>
              <tr>
                <td>CTO authority</td>
                <td>
                  <DocsAddress address={ctoAuthority} label="CTO authority" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>Source revision: <code>{classicEvidenceCommit}</code>.</p>
      </section>
    </DocsShell>
  );
}

function CustomDocs() {
  return (
    <DocsShell
      currentPath="/docs/models/custom"
      kicker="Launch model · Ethereum"
      title="Custom hooks"
      description="Custom launches use deterministic Uniswap v4 hook graphs prepared through the credential-principal API."
      sections={customSections}
    >
      <section id="overview">
        <h2>What Custom is</h2>
        <p>
          A Custom launch creates a token whose Uniswap v4 market uses hook
          logic defined for that release. The hook can change how swaps, fees,
          liquidity or other permitted callbacks work.
        </p>
        <p>
          Each request binds one source descriptor, manifest digest, graph
          bundle and controller wallet. The authenticated API prepares an exact
          artifact. Only the later <code>authorized</code> state contains the
          permit-attached wallet transaction, and the API does not wallet-sign
          or broadcast it.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/developers/custom-launch">
            Read the Custom Launch API guide
          </Link>
        </p>
      </section>

      <section id="release-scope">
        <h2>Behavior varies by release</h2>
        <p>
          Do not infer one Custom release&apos;s permissions, controls, fee path
          or liquidity path from another. Use the deployment and release records
          for the launch you are inspecting.
        </p>
      </section>

      <section id="release-requirements">
        <h2>Bundle requirements</h2>
        <p>
          Before submission, a bundle must define the following information.
        </p>
        <ul className={styles.contentList}>
          <li>The allowed token and pool configuration.</li>
          <li>The fee path, reward recipients and mutable controls.</li>
          <li>Liquidity custody and every withdrawal path.</li>
          <li>Transaction construction, graph bindings and controller wallet.</li>
          <li>
            Deployment records, runtime verification and supported network.
          </li>
        </ul>
      </section>

      <section id="launch-information">
        <h2>Launch-specific information</h2>
        <p>
          Read the launch&apos;s token, pool, hook and release records together.
          They identify the deployed contracts, supported network, hook
          permissions, fee and reward path, mutable controls, liquidity custody
          and any withdrawal path. Project artwork, descriptions and links are
          presentation data and are not substitutes for these records.
        </p>
      </section>

      <section id="router-provenance">
        <h2>Router provenance</h2>
        <p>
          A Custom launch executed and stamped through the Launch Stamp Router
          can be identified by its canonical Router origin, launch ID, launch
          kind, token, pool and recorded components. The published verification
          procedure must pass before an application uses that provenance. The
          published start block is the first block to scan for this Router. It
          does not cover earlier launches, and direct factory calls remain
          outside the Router record even when they occur later.
        </p>
      </section>

      <section id="project-presentation">
        <h2>What preparation does not prove</h2>
        <p>
          A prepared artifact is not a wallet transaction or wallet
          authorization. It does not establish current tradability, liquidity,
          price, pool state, audit coverage, support in an external terminal or
          the behavior of an interface outside the submitted graph. Project
          artwork, descriptions and links do not verify the hook or make another
          launch path available.
        </p>
      </section>
    </DocsShell>
  );
}

function StockPairedDocs() {
  const contractRows = [
    {
      release: "V1",
      contract: "Launcher",
      address: "0x195750f33caD5eF2DF857a53226B421297A1e79e",
    },
    {
      release: "V1",
      contract: "Fee hook",
      address: "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc",
    },
    {
      release: "V1",
      contract: "ETH launch coordinator",
      address: "0xfa5f17389CA28D071781d59750b32C842ab6A54b",
    },
    {
      release: "V2",
      contract: "Launcher",
      address: "0x5eA6Be24838061bA45dbE8D82DE1b267DC240Daf",
    },
    {
      release: "V2",
      contract: "Fee hook",
      address: "0x90c67C1E866f86526F0e338459cD435E1F23A0cc",
    },
    {
      release: "V2",
      contract: "ETH launch coordinator",
      address: "0xFb9E1034df6161088E8F358502B19E7515c30fD2",
    },
    {
      release: "V3",
      contract: "Launcher",
      address: "0x0573879f72d8eE8B0e5a4Ec5E8bcDb2fCab9E51c",
    },
    {
      release: "V3",
      contract: "Fee hook",
      address: "0x90c67C1E866f86526F0e338459cD435E1F23A0cc",
    },
    {
      release: "V3",
      contract: "ETH launch coordinator",
      address: "0xdDC3ABbAB0df7F1189310a4f70e7e365796B74E2",
    },
  ] as const;

  return (
    <DocsShell
      currentPath="/docs/models/stock-paired"
      kicker="Historical launch model · Ethereum"
      title="Stock-Paired"
      description="Stock-Paired describes existing fixed-supply tokens whose Uniswap v4 pools use a supported Ondo Global Markets token as the quote asset."
      sections={stockPairedSections}
    >
      <section id="overview">
        <h2>Historical model</h2>
        <p>
          Stock-Paired describes existing fixed-supply tokens and their
          deployment records. Trading and quote-to-ETH conversion depend on the
          route, issuer, network and runtime checks for the specific record.
          Direct quote-token claims and payout changes use separate vault,
          runtime and transaction-simulation checks.
        </p>
      </section>

      <section id="token-boundary">
        <h2>The launched token is not a share</h2>
        <p>
          A Stock-Paired launch created a new Programmable token and paired it
          with one supported Ondo Global Markets token. The Programmable token
          does not represent ownership in the company and is not redeemable for
          the selected stock.
        </p>
      </section>

      <section id="quote-assets">
        <h2>Quote assets by release</h2>
        <p>
          The supported set changed between the three deployed releases. A token
          remains bound to the release and quote asset used at launch.
        </p>
        <ul className={styles.contentList}>
          <li>
            <strong>V1 registry:</strong> NVDAon, SPYon, GOOGLon, SLVon, QQQon,
            TSLAon and AAPLon. The ETH launch coordinator supported six of them.
            QQQon was registered but not available through the ETH launch flow.
          </li>
          <li>
            <strong>V2:</strong> NVDAon, SPYon, GOOGLon, SLVon, TSLAon, AAPLon,
            BABAon, COPXon, CRCLon, TLTon and USOon.
          </li>
          <li>
            <strong>V3:</strong> NVDAon, SPYon, GOOGLon, SLVon, TSLAon and
            AAPLon.
          </li>
        </ul>
        <p>
          V1 and V2 used one fixed start tick for every supported quote asset.
          V3 used an immutable start tick for each asset, calibrated near
          Classic&apos;s 1.3557 ETH initial fully diluted valuation. The
          calibration was release evidence, not a current price oracle or a
          fixed dollar valuation.
        </p>
      </section>

      <section id="pool-creation">
        <h2>How historical launches worked</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Select a supported quote asset.</strong>
            <span>The available assets depended on the launch release.</span>
          </li>
          <li>
            <strong>Route ETH into the quote asset.</strong>
            <span>
              The coordinator routed ETH through configured pools into the
              selected quote asset.
            </span>
          </li>
          <li>
            <strong>Create and lock the new token pool.</strong>
            <span>
              The token supply entered a permanently locked one-sided v4
              position against the quote asset.
            </span>
          </li>
          <li>
            <strong>Buy the launched token with the quote asset.</strong>
            <span>
              The routed quote asset bought the launched token in the same
              wallet transaction.
            </span>
          </li>
        </ol>
      </section>

      <section id="quote-rewards">
        <h2>Fees and rewards</h2>
        <p>Rewards accrue in the selected quote token.</p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Supply</span>
            <strong>1,000,000,000 tokens</strong>
          </div>
          <div className={styles.fact}>
            <span>Transfer tax</span>
            <strong>0%</strong>
          </div>
          <div className={styles.fact}>
            <span>Creator share</span>
            <strong>0.90% in the selected quote token</strong>
          </div>
          <div className={styles.fact}>
            <span>Programmable share</span>
            <strong>0.10% in the selected quote token</strong>
          </div>
        </div>
      </section>

      <section id="routing">
        <h2>Trading routes</h2>
        <p>
          A buy routes ETH into the configured quote token and then into the
          launched token&apos;s exact v4 pool. A sell reverses that path back to
          ETH. The server checks the current round trip before preparing a
          transaction and stops if the configured route fails its liquidity
          check.
        </p>
        <div className={styles.callout}>
          <strong>External terminals must implement the combined route.</strong>
          <p>
            GMGN, Fomo and other interfaces do not inherit Programmable&apos;s
            route. Compatibility requires direct testing of the interface and
            its configured pools.
          </p>
        </div>
      </section>

      <section id="quote-controls">
        <h2>Quote-asset controls</h2>
        <ul className={styles.contentList}>
          <li>
            Ondo controls the supported quote-token implementation and can
            upgrade, pause or restrict it.
          </li>
          <li>
            Availability can depend on issuer controls, jurisdiction, market
            hours and third-party eligibility.
          </li>
          <li>
            Programmable does not mint, redeem or promise delivery of the
            underlying share.
          </li>
          <li>Programmable does not prepare new Stock-Paired launches.</li>
        </ul>
      </section>

      <section id="deployment">
        <h2>Historical contracts and source</h2>
        <p>
          V1, V2 and V3 are separate immutable Ethereum Mainnet deployments.
          Existing launches must be identified by their launcher and fee-hook
          addresses. V3 was the final release used for new launches in this
          historical model. Consult the relevant repository for any successor
          release and its intake instructions.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {contractRows.map((row) => (
                <tr key={`${row.release}-${row.contract}`}>
                  <td>
                    {row.release} · {row.contract}
                  </td>
                  <td>
                    <DocsAddress
                      address={row.address}
                      label={`${row.release} ${row.contract}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Source revision: <code>{stockPairedEvidenceCommit}</code>.</p>
      </section>
    </DocsShell>
  );
}

export default async function ModelDocsPage({
  params,
}: {
  params: Promise<{ model: string }>;
}) {
  const { model } = await params;
  if (!isModelSlug(model)) notFound();
  if (model === "classic") return <ClassicDocs />;
  if (model === "custom") return <CustomDocs />;
  return <StockPairedDocs />;
}
