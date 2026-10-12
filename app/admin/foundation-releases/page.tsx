import type { Metadata } from "next";
import { ModuleReviewAdminConsole } from "@/components/module-review-admin-console";

export const metadata: Metadata = {
  title: "Foundation releases · Programmable",
  description: "Internal source and build review for Foundation host releases.",
  robots: { index: false, follow: false },
};

// Existing wallet authentication and backend review policy remain authoritative.
// Public module submissions stay closed; /admin/modules keeps its publishing guide.
export default function FoundationReleasesPage() {
  return <ModuleReviewAdminConsole title="Foundation releases" />;
}
