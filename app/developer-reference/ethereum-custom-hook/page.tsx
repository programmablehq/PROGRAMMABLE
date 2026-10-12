import type { Metadata } from "next";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/developer-docs.module.css";

export const metadata: Metadata = {
  title: "Direct Ethereum Custom Hooks · Programmable",
  description: "Prepare a direct CustomGraph launch and verify its Programmable stamp on Ethereum Mainnet.",
  alternates: { canonical: "/developer-reference/ethereum-custom-hook" },
};

const sections = [
  { id: "files", label: "Files" },
  { id: "fees", label: "Platform fee" },
  { id: "inputs", label: "Launch inputs" },
  { id: "authorization", label: "Authorization" },
  { id: "indexing", label: "Indexing" },
  { id: "metadata", label: "Token metadata" },
] as const;

export default function EthereumCustomHookReference() {
  return <DocsShell currentPath="/developer-reference/ethereum-custom-hook" title="Direct Ethereum Custom Hooks"
    kicker="Developers" parentHref="/docs/developers" parentLabel="Developers" sections={sections}
    description="Prepare your token and hook through the canonical Ethereum CustomGraph route. Its verified launch stamp supplies the indexing identity.">
    <section id="files"><h2>Files</h2>
      <p className={styles.bodyCopy}>Give your builder the <a href="/developers/ethereum-custom-hook-indexing.zip" download>Ethereum indexing bundle</a>
        {" and "}<a href="/developers/ethereum-custom-hook-indexing.md">complete launch reference</a>. The bundle contains the exact ABI,
        Solidity interfaces, an incomplete request template, the deployment snapshot and read-only verifiers.</p>
      <p className={styles.bodyCopy}>Read the current <a href="https://developers.programmable.family/api/v2/manifest">Ethereum stamp manifest</a> before preparing
        a launch. Match its chain, Router, Graph Factory, runtime hashes, ABI hash and finality policy. The bundled snapshot is a reference.</p>
    </section>
    <section id="fees"><h2>Platform fee</h2>
      <p className={styles.bodyCopy}>The new Ethereum routed policy charges
        <strong> 1% (100 bps)</strong> on the gross native ETH input of a buy or gross native ETH output of a sell prepared by Programmable.
        Project and LP fees are separate. A 1 ETH trade at this rate allocates 0.01 ETH to Programmable.</p>
      <p className={styles.bodyCopy}>Use integer arithmetic: the rate is <code>10,000 / 1,000,000</code>, rounded down once per swap.
        Read live capabilities and the trade&apos;s bound policy before preparing a transaction. External routes have their own fee behavior.
        Disclose the hook&apos;s fee basis, asset, accounting mode, recipient, rounding, accrual and claim path.
        The launch stamp establishes origin; it does not prove fee enforcement or payment.
        Earlier contracts and exact versioned API profiles retain their recorded rates.</p>
    </section>
    <section id="inputs"><h2>Launch inputs</h2>
      <p className={styles.bodyCopy}>Prepare the complete <code>CustomGraphRouteV1</code>, <code>StampRequestV1</code> and <code>LaunchPermitV1</code>
        {" "}tuples from the supplied interfaces. Use chain ID <code>1</code> and CustomGraph kind <code>1</code>.</p>
      <ul className={styles.steps}>
        <li>The graph binds deployment targets, initialization calldata, predicted outputs, topology, namespace, nonce and total value.</li>
        <li>The stamp binds the launch ID, token, hook, PoolKey and every graph component to their exact post-initialization runtime hashes.</li>
        <li>The permit binds the Router, creator wallet, route payload hash, result hash, stamp hash, nonce, validity window and transaction value.</li>
      </ul>
      <p className={styles.bodyCopy}>Use the pinned ABI and hash helpers for encoding. Predict the CREATE2 addresses and verify the initialized
        runtimes in a fork simulation. The complete reference specifies component ordering, scopes, units and limits.</p>
    </section>
    <section id="authorization"><h2>Authorization</h2>
      <p className={styles.bodyCopy}>Obtain Programmable authority authorization for the exact permit digest. The creator wallet&apos;s signature
        alone does not supply this authorization. Fork-simulate the fully authorized Router transaction before execution.</p>
      <p className={styles.bodyCopy}>A token deployed independently cannot receive this launch stamp afterward. The token and hook must be
        outputs of the authorized canonical Router route. Your hook&apos;s economic rules can be independent of the Custom Launch API profiles.</p>
    </section>
    <section id="indexing"><h2>Indexing</h2>
      <p className={styles.bodyCopy}>Preserve the chain, Router, launch ID, token, hook, creator, PoolId, stamp hash, component proofs, transaction
        hash and event coordinates. Verify the Router events and getters at the same finalized canonical block using the supplied verifier.</p>
      <p className={styles.bodyCopy}>Programmable&apos;s Ethereum Custom source scans this Router independently of API submissions. Explore
        includes valid finalized stamps. Missing market data or an unsupported trading adapter does not remove a verified launch.</p>
      <p className={styles.bodyCopy}>External terminals need their own integration with this stamp contract. They control their ingestion and
        timing. The stamp does not guarantee that a third-party service has completed indexing.</p>
    </section>
    <section id="metadata"><h2>Token metadata</h2>
      <p className={styles.bodyCopy}>Expose standard <code>name()</code> and <code>symbol()</code> getters. For the image, description and links,
        expose <code>metadata()</code> returning <code>(string description, string website, string image, bytes extraData)</code>,
        or <code>tokenURI()</code> returning inline <code>data:application/json</code>. The website reads these values at a finalized
        block and caches the display for one minute. During a provider interruption, recent values remain visible for up to five minutes.
        Updated display values do not change the original launch stamp.</p>
      <p className={styles.bodyCopy}>Inline JSON accepts <code>description</code>, <code>image</code>, <code>website</code> or <code>external_url</code>,
        <code>x</code> or <code>twitter</code>, and <code>telegram</code>, <code>discord</code>, <code>github</code> and <code>gitbook</code>.
        Use public HTTPS URLs. JSON can be literal UTF-8, percent-encoded or base64-encoded. The website does not fetch external tokenURI documents.
        Unsupported or invalid metadata does not remove the coin from Explore.</p>
    </section>
  </DocsShell>;
}
