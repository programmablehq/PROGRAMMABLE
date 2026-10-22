import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/developer-docs.module.css";

export const metadata: Metadata = {
  title: "Custom AI · Programmable Docs",
  description: "Create a coin with chat-defined fee rules on Ethereum or Robinhood.",
  alternates: { canonical: "/developer-reference/custom-ai" },
};
const sections = [
  { id: "launch", label: "Create a coin" },
  { id: "rules", label: "Fixed rules" },
  { id: "scope", label: "Supported behavior" },
  { id: "after-launch", label: "After launch" },
] as const;

export default function CustomAIGuide() {
  return <DocsShell currentPath="/docs/models/custom-ai" title="Custom AI" kicker="Launch models"
    description="Describe your coin's fee rules in the chat, review the result and confirm the launch in your wallet."
    parentHref="/docs/tokens" parentLabel="Launch models" sections={sections}>
    <section id="launch">
      <h2>Create a coin</h2>
      <ol className={styles.list}>
        <li>Open <Link href="/launch/custom-ai">Custom AI</Link> and connect your wallet.</li>
        <li>Describe the fee behavior. For example, ask for a 3% total fee on buys and sells for one day, then 1%.</li>
        <li>Choose Ethereum or Robinhood, a pair token and an image. The chat can also fill in the name, ticker and initial buy.</li>
        <li>Review the coin description and select <strong>Create coin</strong>. Confirm the hook deployment, funding approval and launch in your wallet.</li>
      </ol>
      <p className={styles.bodyCopy}>Accepted drafts launch directly after signing, without a manual submission review.
        Keep the launch open if a wallet request is interrupted; its saved transaction can be checked again.</p>
    </section>
    <section id="rules">
      <h2>Fixed rules</h2>
      <p className={styles.bodyCopy}>Every coin starts with 1 billion tokens and a pre-buy value of $15,000,
        with tick rounding up to $15,091.50. The initial buy must be worth at least 0.01 ETH. Network fees are separate.</p>
      <p className={styles.bodyCopy}>The initial one-sided liquidity stays locked. Buys and sells change the pool reserves
        and price. The coin has no later mint, burn, transfer tax, blacklist, pause or upgrade authority.</p>
      <p className={styles.bodyCopy}>The platform receives 0.5% on buys and sells. Total trading fees cannot exceed 15%.
        Normal token transfers are free. There is no maximum purchase or holding limit.</p>
    </section>
    <section id="scope">
      <h2>Supported behavior</h2>
      <p className={styles.bodyCopy}>The current builder creates immutable fee rules and schedules, including different
        buy and sell fees and changes over time. Time-based schedules start when the coin launches.</p>
      <p className={styles.bodyCopy}>Weather, news, sports feeds and custom reward strategies need additional integrations
        and are not supported by this builder yet. A generated draft is checked against the fixed core before it can launch.</p>
      <p className={styles.bodyCopy}>Pair tokens must be compatible ERC20 tokens on the selected chain with a supported
        price reference. External tokens can have their own admin rights. Robinhood WETH is upgradeable and its bridge
        can burn balances; these rights are shown before launch.</p>
    </section>
    <section id="after-launch">
      <h2>After launch</h2>
      <p className={styles.bodyCopy}>The coin appears in Explore after finality and indexing. Its coin page provides
        swaps and creator-fee claims. Claims pay the recipients fixed in the contracts.</p>
      <p className={styles.bodyCopy}>The public <Link href="/api/custom-ai/tokens">Custom AI catalog</Link> provides
        finalized launch records and its indexing status. Chat, draft and wallet-operation APIs require an authenticated
        website account; a Custom Launch API key does not replace that session.</p>
    </section>
  </DocsShell>;
}
