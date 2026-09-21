"use client";

import { useEffect, useState } from "react";
import { launchModuleDetailsBinding, launchPresentationDetails, type LaunchPairObservation, type LaunchPresentationSource } from "@/lib/launch-presentation-details";
import { readPublicModuleDetailsResponse, type PublicModuleDetails } from "@/lib/module-mode/public-details";
import styles from "./launch-pair-modules.module.css";

// Exact package/release metadata is immutable. Sharing each in-flight request avoids per-card duplicates.
const requests = new Map<string, Promise<PublicModuleDetails | null>>();
function readDetails(query: string) {
  const existing = requests.get(query);
  if (existing) return existing;
  if (requests.size >= 100) requests.delete(requests.keys().next().value!);
  const request = fetch(`/api/module-mode/details?${query}`, { signal: AbortSignal.timeout(8_000),
    redirect: "error", headers: { accept: "application/json" } })
    .then(async response => response.ok && /^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
      ? readPublicModuleDetailsResponse(await response.json()) : null)
    .catch(() => null);
  requests.set(query, request);
  void request.then(details => { if (!details && requests.get(query) === request) requests.delete(query); });
  return request;
}

export function LaunchPairModules({ launch, chainId, market, className = "" }: {
  launch: LaunchPresentationSource;
  chainId: number;
  market?: LaunchPairObservation | null;
  className?: string;
}) {
  const binding = chainId === 4663 ? launchModuleDetailsBinding(launch) : null;
  const query = binding ? new URLSearchParams({ packages: binding.modulePackageIds.join(","), release: binding.sourceReleaseDigest,
    ...(binding.sourceKind === "module-engine-v1" ? { sourceKind: binding.sourceKind } : {}) }).toString() : null;
  const [loaded, setLoaded] = useState<{ query: string; details: PublicModuleDetails | null } | null>(null);
  useEffect(() => {
    if (!query) return;
    let active = true;
    void readDetails(query).then(details => { if (active) setLoaded({ query, details }); });
    return () => { active = false; };
  }, [query]);
  const { pair, modules, moduleCount } = launchPresentationDetails(launch, chainId, market, loaded?.query === query ? loaded?.details : null);
  if (!pair && !moduleCount) return null;
  return <dl className={`${styles.details} ${className}`}>
    {pair ? <div><dt>Pair</dt><dd title={pair.address}>{pair.label}</dd></div> : null}
    {moduleCount ? <div><dt>{moduleCount === 1 && modules.length ? "Module" : "Modules"}</dt><dd title={modules.join(", ") || undefined}>{modules.length ? modules.join(", ") : moduleCount}</dd></div> : null}
  </dl>;
}
