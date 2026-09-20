import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Programmable",
  alternates: { canonical: "/developers/api-keys" },
};

export default async function CustomHookBuilderPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.append(key, value);
  }
  if (!query.has("guide") && !query.has("launchId")
    && query.get("view") !== "history" && query.get("start") !== "custom") {
    query.set("guide", "custom-hook");
  }
  redirect(`/developers/api-keys${query.size ? `?${query}` : ""}`);
}
