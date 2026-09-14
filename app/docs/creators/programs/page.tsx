import type { Metadata } from "next";

import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creator programs · Programmable",
  description:
    "Understand Programmable partnerships and contribution opportunities.",
  alternates: { canonical: "/docs/creators/programs" },
};

const sections = [
  { id: "partnerships", label: "Partnerships" },
  { id: "contributions", label: "Contributions" },
  { id: "support", label: "Support" },
] as const;

export default function CreatorProgramsDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators/programs"
      description="Programmable supports builders through scheduled events, exact partnerships and public contribution work."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Creator programs"
    >
      <section id="partnerships">
        <h2>Partnerships</h2>
        <p>
          Partnerships do not create a special production fee path. An open
          arbitrary-hook launch has no automatic Programmable fee claim. A 10
          bps claim exists only for an exact fee-certified profile or adapter
          and its stamped PoolKey after server fee-path evidence is verified.
        </p>
        <p>
          No partner version is assumed active by this reference. The exact
          repository and activation record control when a partner path can
          accrue a share.
        </p>
        <p>
          Partnership support does not replace applicable project checks,
          Custom API requirements or wallet confirmation. It also does not
          endorse every project launched from that template.
        </p>
      </section>

      <section id="contributions">
        <h2>Contributions</h2>
        <p>
          Builders can improve the public product and developer references
          through their respective repositories. A contribution is reviewed
          against that repository&apos;s scope and rules.
        </p>
        <p>
          Paid work, bounties or grants are offered only when an issue or
          program says so explicitly. A pull request does not create an
          automatic payment.
        </p>
      </section>

      <section id="support">
        <h2>Support</h2>
        <p>
          Use the repository that owns the issue. Include the exact URL, source
          revision, reproduction steps that do not depend on a wallet and the
          result you expected.
        </p>
      </section>
    </DocsShell>
  );
}
