import { isVisibleRobinhoodToken } from "@/lib/robinhood-explore-policy";
import { parseLaunchProjectionV1 } from "@/lib/custom-launch/launch-projection-v1";
import { tokenLaunchRecord, type RobinhoodSnapshot } from "./model";

/** Reads the same saved lane used by Explore, Profile and /token; a backend final flag is insufficient. */
export function indexedLaunchProjectionV1(snapshot: RobinhoodSnapshot | null, launchId: string, source: string) {
  const row = snapshot?.launchProjections?.items.find(item => item.launchId === launchId && item.launchProjection?.sourceVersion === source);
  if (!row?.launchProjection || !isVisibleRobinhoodToken(row.tokenAddress) || row.launchProjection.publication?.visibility !== "listed") return null;
  const projection = parseLaunchProjectionV1(row.launchProjection);
  if (projection.finality.status !== "final" || projection.chainId !== "4663") return null;
  const detail = tokenLaunchRecord(snapshot, row.tokenAddress);
  if (detail.token?.launchId !== launchId || detail.token.launchProjection?.planHash !== projection.planHash) return null;
  return { schemaVersion: "programmable.website-indexed-launch.v1" as const, status: "indexed" as const,
    projection, indexedAt: snapshot!.launchProjections!.updatedAt, href: `/token/${row.tokenAddress}?chain=4663` };
}
