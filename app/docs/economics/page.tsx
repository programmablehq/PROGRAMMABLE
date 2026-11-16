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
  { id: "custom-ai", label: "Custom AI" },
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
        <p>New Custom Launch approvals on Ethereum, Robinhood, Base, HyperEVM and Elysium require <strong>0.3% (30 bps)</strong> for Programmable on buys and sells through the launch pool, including the initial buy. Creator and liquidity-provider fees are separate. Live capabilities identify the exact policy enforced by the submitted contracts.</p>
        <p>On Robinhood, the automatic hook sends platform fees to the fee router. It pays 20% as ETH to the team wallet <code>0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62</code> and reserves 80% for V4 purchases delivered to that wallet. The additional opening surcharge uses the same route; creator fees remain separate.</p>
        <p>Earlier signed fee obligations and verified immutable pool fees retain their recorded rates. When the existing pool fee is verified, Programmable adds no second route fee. Native20 accrues native ETH claims to its fixed recipient; claiming those balances does not create new revenue.</p>
      </section>
      <section id="ethereum">
        <h2>Ethereum Mainnet Custom Hooks</h2>
        <p>On Ethereum and Base, the automatic hook pays the platform share directly as ETH to the team wallet <code>0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62</code>. HyperEVM and Elysium pay HYPE to the same wallet. A 1 ETH trade at the normal 0.3% rate allocates 0.003 ETH to Programmable. Opening surcharges follow the same destination.</p>
        <p>Verify the deployed hook&apos;s fee basis, asset, accounting mode and claim path. A launch stamp establishes origin; it does not prove fee enforcement or payment. Earlier Classic contracts and retained fee-certified API profiles keep their recorded 0.10% share.</p>
        <p><Link href="/developer-reference/ethereum-custom-hook#fees">Read the Ethereum Custom Hook reference</Link> for launch inputs and fee disclosure.</p>
      </section>
      <section id="modules">
        <h2>Module Mode</h2>
        <p>The new Foundation releases allocate 0.3% to Programmable on each buy and sell through the launch pool. Creators can add a fee from 0% to 10% in whole percentage points. Selected modules may receive part of that creator fee; they do not reduce the platform&apos;s 0.3%.</p>
        <p>Both fees are calculated on the gross quote amount and accrue in the quote asset. A 1 WETH trade with a 1% creator fee allocates 0.003 WETH to Programmable and 0.01 WETH to creator and module recipients. The combined fee is 1.3%. Foundation&apos;s initial pool has no additional LP fee. Earlier releases retain their immutable rates, including 1%; read the <a href="https://programmable.market/api/module-mode">active engine</a> and launch review for the applicable rate.</p>
      </section>
      <section id="custom-ai">
        <h2>Custom AI</h2>
        <p>Custom AI allocates <strong>0.5% (50 bps)</strong> to Programmable on each buy and sell through the launch pool, including the initial buy. The generated fee module can add a fee, with a maximum combined trading fee of 15%. Normal token transfers are free.</p>
        <p>Fees accrue in the paired asset. A 1 WETH trade with a 3% total fee allocates 0.005 WETH to Programmable and 0.025 WETH to the generated module&apos;s recipients. The fixed platform fee and the module&apos;s fees have separate accounting and claim paths.</p>
        <p>Read <Link href="/docs/models/custom-ai">Custom AI</Link> for the fixed contract rules and supported fee behavior.</p>
      </section>
      <section id="revenue">
        <h2>Protocol revenue allocation</h2>
        <p>The revenue policy allocates 80% of fee revenue actually collected by Programmable to V4 purchases and 20% to treasury and operating costs. This includes platform fees and quote-asset fees from the project&apos;s own liquidity position. Creator fees, module rewards, customer funds, liquidity principal and internal wallet transfers are excluded. Collecting 1 ETH of eligible fees allocates 0.8 ETH to buybacks and 0.2 ETH to the treasury.</p>
        <p>The Robinhood fee router makes automatic V4 purchases in batches when its gas, price and liquidity limits permit. Purchased V4 goes to the team wallet. Revenue outside this router continues to use manual purchases. Burns are separate transactions. Unclaimed fees, the buyback allocation, completed purchases and completed burns are separate records. Read <Link href="/docs/v4-token">V4 token</Link> for token identity and burn accounting.</p>
      </section>
      <section id="analytics">
        <h2>Analytics</h2>
        <p>The <a href="https://dune.com/programmablehq/analytics">Dune dashboard</a> reports the sources covered by each query and its indexed-through time. Track the automatic team wallet 0x9F58…8f62, Robinhood fee router 0xB7ec…A001 and earlier project wallets 0xD885…79da, 0x3954…24F6 and 0x4957…376c together. Accrued fees, collected revenue, the 80% allocation, actual purchases and actual burns are separate measurements. A claim or internal wallet transfer does not create revenue a second time.</p>
      </section>
    </DocsShell>
  );
}
