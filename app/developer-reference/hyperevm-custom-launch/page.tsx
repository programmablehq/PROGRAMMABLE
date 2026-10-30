import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "HyperEVM Custom Launch · Programmable Docs",
  description: "Launch your contracts on HyperEVM with a wallet API key, source review and controller signing.",
  alternates: { canonical: "/developer-reference/hyperevm-custom-launch" },
};

const sections = [
  { id: "setup", label: "Wallet and API key" },
  { id: "launch", label: "Review and launch" },
  { id: "after-launch", label: "Trading and fees" },
  { id: "index-hyperevm-launches", label: "Index launches" },
] as const;

export default function HyperEvmCustomLaunchGuide() {
  return <DocsShell
    currentPath="/developer-reference/hyperevm-custom-launch"
    title="Custom Launch on HyperEVM"
    description="Deploy your token, hook and supporting contracts on HyperEVM, chain ID 999, through the Programmable API."
    parentHref="/docs/developers" parentLabel="Developers" sections={sections}
  >
    <section id="setup">
      <h2>Wallet and API key</h2>
      <p>Read the <a href="https://api.programmable.market/v4/chains/999/capabilities">HyperEVM capabilities</a> and <a href="https://api.programmable.market/v4/chains/999/readiness">readiness</a> before preparing a launch. Public requests require <code>mode: active</code>, <code>ready: true</code> and <code>publicLaunchAuthorized: true</code>.</p>
      <p><Link href="/developers/api-keys?guide=custom-hook&chainId=999">Create a wallet API key for HyperEVM</Link> with <code>custom-launch:create</code> and <code>custom-launch:read</code>. Use the same wallet as the request&apos;s controller. The key prepares and reads requests; your wallet signs the launch.</p>
      <p>Fund the wallet with HYPE on HyperEVM for deployment, liquidity and gas. Custom deployments use HyperEVM&apos;s large blocks. Activate the same wallet on HyperCore and enable large transactions once, following the <a href="/developers/hyperevm-custom-launch-api-v1.md#first-hyperevm-launch">wallet setup instructions</a>.</p>
      <p>HyperEVM supports Custom Launch. Module Mode remains on Ethereum and Robinhood Chain.</p>
    </section>
    <section id="launch">
      <h2>Review and launch</h2>
      <ol>
        <li>Prepare the complete source and compiler package, HyperEVM configuration, token image and project links. Use the <a href="/developers/hyperevm-custom-launch-api-v1.md">versioned API guide</a> and <a href="/openapi/hyperevm-custom-launch-v1.json">OpenAPI reference</a> for exact request fields and protection requirements.</li>
        <li>Preflight through <code>POST /v4/chains/999/custom-launches/preflight</code>, then submit through <code>POST /v4/chains/999/custom-launches</code> with a stable <code>Idempotency-Key</code>. Keep the response and original request bytes.</li>
        <li>Follow the returned review status. Approval applies to that submitted version. A changes request needs a corrected package; an uncertain network response needs the same bytes and key.</li>
        <li>After approval, open the wallet handoff. Check chain <code>999</code>, controller, destination, value and calldata before signing.</li>
        <li>Follow <code>GET /v4/chains/999/custom-launches/&#123;launchId&#125;</code> until finalized. Retain the transaction hash while pending and recover that transaction after an interrupted wallet response.</li>
      </ol>
    </section>
    <section id="after-launch">
      <h2>Trading and fees</h2>
      <p>The finalized coin appears in <Link href="/explore/hyperevm">HyperEVM Explore</Link>. Its page at <code>/token/&#123;token&#125;?chain=999</code> provides the supported buy and sell route and creator-fee claim. Read the actual pool currency and fee policy; native HYPE and wrapped HYPE are different assets.</p>
      <p>The protected reference&apos;s creator-fee claim pays its fixed creator recipient. Platform fees and opening tax are separate balances. Custom contracts use their reviewed claim method. A verified launch proves origin; a trading route also needs available liquidity and supported contract behavior.</p>
    </section>
    <section id="index-hyperevm-launches">
      <h2>Index HyperEVM launches</h2>
      <p>Use the public <a href="https://api.programmable.market/v4/chains/999/finalized-custom-launches">finalized launch feed</a>. Follow <code>nextCursor</code> until null, persist records before advancing the cursor, and resume with overlap and deduplication. Identify launches by chain, router and router launch ID; identify coins by chain and token address.</p>
      <p>Verify receipts, launch stamps and pool initialization against the HyperEVM bindings and two independent providers. Their common finalized checkpoint must cover the launch block. HyperEVM uses HyperBFT finality. Keep source and finality evidence, and enrich prices and artwork separately.</p>
      <p>Providers can count HyperCore system transactions differently. Compare the transaction hash, canonical block and ordered event contents across providers, and retain each provider&apos;s original transaction and log indices.</p>
      <p>The <a href="https://programmable.market/api/explore/hyperevm?page=1&pageSize=50&sort=newest">Explore discovery feed</a> contains the website listing. The <a href="/developers/hyperevm-custom-launch-api-v1.md#index-hyperevm-launches">integration reference</a> describes the complete finalized source and exact contract bindings.</p>
    </section>
  </DocsShell>;
}
