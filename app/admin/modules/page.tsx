import type { Metadata } from "next";
import Link from "next/link";
import { ModuleReviewAdminConsole } from "@/components/module-review-admin-console";
import publishers from "@/config/module-foundation/owner-publishers.json";

export const metadata: Metadata = {
  title: "Module reviews · Programmable",
  description: "Review submitted modules and publish Programmable-owned modules.",
  robots: { index: false, follow: false },
};

export default function ModuleReviewPage() {
  return <>
    <ModuleReviewAdminConsole />
    <section aria-labelledby="owned-module-publishing" style={{ maxWidth: 760, margin: "32px auto 64px", padding: "0 24px" }}>
    <h2 id="owned-module-publishing">Publish Programmable-owned modules</h2>
    <p>Build a compatible module, test its behavior, and publish it directly with the automation wallet.
      Programmable-owned modules do not require a contributor application or a separate reviewer.</p>
    <p>Automation wallet · Robinhood Chain</p>
    <code style={{ overflowWrap: "anywhere" }}>{publishers.wallets[0]}</code>
    <ol>
      <li>Build against the Foundation module interface.</li>
      <li>Run the module’s focused launch and trading checks.</li>
      <li>Publish. The module appears in Add module without a separate website deployment.</li>
    </ol>
    <Link href="/launch/modules/foundation">Open Module Mode</Link>
    </section>
  </>;
}
