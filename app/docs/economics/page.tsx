import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Fees and revenue · Programmable",
  description: "Creator and module rewards, platform fees and revenue allocation.",
  alternates: { canonical: "/docs/economics" },
};

const sections = [
  { id: "basis", label: "Fee units" },
  { id: "custom", label: "Custom Launches" },
  { id: "ethereum", label: "Ethereum Mainnet" },
  { id: "modules", label: "Module Mode" },
  { id: "revenue", label: "Revenue allocation" },
  { id: "analytics", label: "Analytics" },
] as const;

export default function EconomicsDocsPage() {
  return (
    <DocsShell currentPath="/docs/economics" title="Fees and revenue" sections={sections}
      description="Trading fees, recipient shares and protocol revenue are recorded separately for each launch model.">
      <section id="basis">
        <h2>Fee units</h2>
        <p>One basis point is 0.01%; 30 bps is 0.3%. Gas, initial purchases, liquidity deposits and module operating budgets are separate costs. The launch review shows the selected fees and funding before wallet confirmation.</p>
      </section>
      <section id="custom">
        <h2>Robinhood Custom Launches</h2>
        <p>The new Custom Launch fee policy charges <strong>0.3% (30 bps)</strong> on buys and sells prepared by Programmable. It is deducted from the gross output in the output asset, rounded down once. A gross output of 100 tokens pays 0.3 tokens to Programmable before the remaining output reaches the trader. Creator and pool fees are separate. Live capabilities identify the active policy.</p>
        <p>The trade review shows the exact fee, asset and recipient before wallet confirmation. The routed fee is paid to <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code> in the same swap. This pricing applies to Programmable routes; it does not establish a fee on external trades.</p>
        <p>Earlier signed fee obligations and verified immutable pool fees retain their recorded rates. When the existing pool fee is verified, Programmable adds no second route fee. Native20 accrues native ETH claims to its fixed recipient; claiming those balances does not create new revenue.</p>
      </section>
      <section id="ethereum">
        <h2>Ethereum Mainnet Custom Hooks</h2>
        <p>The new Ethereum routed policy charges <strong>0.3% (30 bps)</strong> on the gross native ETH input of a buy or gross native ETH output of a sell prepared by Programmable, rounded down once. A 1 ETH trade at this rate allocates 0.003 ETH to Programmable in the same swap. Project and LP fees are separate. Read the live capabilities and the trade&apos;s bound policy; external trades do not establish platform revenue.</p>
        <p>Verify the deployed hook&apos;s fee basis, asset, accounting mode and claim path. A launch stamp establishes origin; it does not prove fee enforcement or payment. Earlier Classic contracts and retained fee-certified API profiles keep their recorded 0.10% share.</p>
        <p><Link href="/developer-reference/ethereum-custom-hook#fees">Read the Ethereum Custom Hook reference</Link> for launch inputs and fee disclosure.</p>
      </section>
      <section id="modules">
        <h2>Module Mode</h2>
        <p>The new Foundation releases allocate 0.3% to Programmable on each buy and sell through the launch pool. Creators can add a fee from 0% to 10% in whole percentage points. Selected modules may receive part of that creator fee; they do not reduce the platform&apos;s 0.3%.</p>
        <p>Both fees are calculated on the gross quote amount and accrue in the quote asset. A 1 WETH trade with a 1% creator fee allocates 0.003 WETH to Programmable and 0.01 WETH to creator and module recipients. The combined fee is 1.3%. Foundation&apos;s initial pool has no additional LP fee. Earlier releases retain their immutable rates, including 1%; read the <a href="https://programmable.market/api/module-mode">active engine</a> and launch review for the applicable rate.</p>
      </section>
      <section id="revenue">
        <h2>Protocol revenue allocation</h2>
        <p>The revenue policy assigns 50% of net protocol revenue to V4 buybacks and burns and 50% to the treasury, with daily processing. Net revenue excludes creator, module author and other third-party liabilities. Half of a 30 bps platform share is equivalent to 15 bps of the qualifying trading amount.</p>
        <p>Collected V4 from the project&apos;s main-token LP fees is also assigned to daily burns. Finalized transactions establish what was processed. A policy, an accrued balance and a completed burn must not be counted as the same event. Read <Link href="/docs/v4-token">V4 token</Link> for token identity and burn accounting.</p>
      </section>
      <section id="analytics">
        <h2>Analytics</h2>
        <p>The <a href="https://dune.com/programmablehq/analytics">Dune dashboard</a> refreshes every 24 hours and separates launch counts, creator rewards, protocol revenue and burns. Custom fees are counted when <code>NativeFeesAccrued</code> credits the recipient, including unclaimed balances. Claiming later does not create new revenue. Gas, liquidity deposits and LP fees are excluded from those Custom totals.</p>
      </section>
    </DocsShell>
  );
}
