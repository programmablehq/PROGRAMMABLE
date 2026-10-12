import type { Metadata } from "next";

import { DeveloperApiKeys } from "@/components/developer-api-keys";
import { developerApiKeysInitialSection } from "@/lib/developer-api-key-route";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Create a key for your builder, manage its access and review custom hook launches.",
  alternates: {
    canonical: "/developers/api-keys",
  },
};

type DeveloperApiKeysSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function DeveloperApiKeysPage({
  searchParams,
}: Readonly<{ searchParams: DeveloperApiKeysSearchParams }>) {
  const resolvedSearchParams = await searchParams;
  return (
    <DeveloperApiKeys
      initialSection={developerApiKeysInitialSection(resolvedSearchParams)}
      initialGuideOpen={resolvedSearchParams.guide === "custom-hook"}
    />
  );
}
