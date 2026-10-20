import "server-only";
import { launchShareCoinHref, launchShareText, type LaunchShareData, type LaunchShareIdentity } from "@/lib/launch-share";
import { resolveTokenPage } from "./token-page";
import { readRobinhoodPresentations } from "./robinhood-presentation";
import { presentEthereumToken } from "./ethereum-explore";
import { findRecentFoundationLaunch } from "./module-foundation/recent-launch-store";
import { readLaunchShareImage } from "./launch-share-image";

export async function readLaunchShare(identity: LaunchShareIdentity, { image = true }: { image?: boolean } = {}): Promise<LaunchShareData | null> {
  const record = await resolveTokenPage(identity.address, String(identity.chainId));
  let name: string | null | undefined, symbol: string | null | undefined;
  let presentation: { imageUrl?: string | null; description?: string | null } | null = null;
  if (record?.chainId === 4663 && record.token) {
    name = record.token.name; symbol = record.token.symbol;
    if (image) presentation = (await readRobinhoodPresentations([record.token], new Map()).catch(() => []))[0] ?? null;
  } else if (record?.chainId === 1 && record.token) {
    name = record.token.name; symbol = record.token.symbol;
    if (image) presentation = await presentEthereumToken(record.token).catch(() => record.token);
  } else if (record?.chainId === 8453 && record.token) {
    name = record.token.name; symbol = record.token.symbol; presentation = record.presentation;
  } else {
    if (identity.chainId === 8453) return null;
    const recent = await findRecentFoundationLaunch(identity.chainId, identity.address).catch(() => null);
    if (!recent) {
      if (record && "status" in record && record.status === "unavailable") throw new Error("Launch index unavailable");
      return null;
    }
    name = recent.row.name; symbol = recent.row.symbol; presentation = recent.presentation;
  }
  return { ...identity, name: launchShareText(name, 100) || "Unnamed coin", symbol: launchShareText(symbol, 24).replace(/^\$+/, ""),
    href: launchShareCoinHref(identity),
    imageDataUrl: image ? await readLaunchShareImage(presentation?.imageUrl) : null };
}
