import { describe, expect, it } from "vitest";
import { parseCustomLaunchWalletHandoffV1 } from "../lib/custom-launch/developer-launch-truth-v1";
import { parseLaunch, parseHistoryPage } from "../components/developer-launch-history";
const id = "60000000-0000-4000-8000-000000000006", controller = `0x${"11".repeat(20)}`;
const valid = (chainId: string) => ({ walletHandoffUrl: `https://programmable.market/developers/api-keys?launchId=${id}${chainId === "1" ? "" : `&chainId=${chainId}`}`,
  expiresAt: "2033-05-18T03:43:20.000Z", secondsRemaining: 600 });
const resource = (chainId: string) => ({ schemaVersion: "programmable.custom-launch.v3", routeId: "custom-launch:create:v3", launchId: id, requestId: id,
  ownerWallet: controller, chainId, onchainLaunchId: null, status: "awaiting_funding_authorization", requestHash: `sha256:${"55".repeat(32)}`,
  launchProfileVersion: "3.1.0", launchProfileHash: `sha256:${"66".repeat(32)}`, launchIntentHash: `sha256:${"77".repeat(32)}`,
  projectMetadata: null, projectMetadataHash: null, fundingIntentHash: `0x${"88".repeat(32)}`,
  liquidityIntent: { model: "external-concentrated-liquidity", declaredLaunchState: "liquidity_required", binding: "legacy-v3-default" },
  createdAt: "2033-05-18T03:33:20.000Z", updatedAt: "2033-05-18T03:33:21.000Z", output: null, failure: null, ...valid(chainId) });
describe("network-bound V3 wallet links", () => {
  it.each(["1", "8453", "999"] as const)("retains a valid %s handoff in the actual resource and list parsers", chainId => {
    const item = resource(chainId);
    expect(parseCustomLaunchWalletHandoffV1(valid(chainId), id, chainId)).toEqual(valid(chainId));
    expect(parseLaunch(item, controller, chainId)?.walletHandoffUrl).toBe(item.walletHandoffUrl);
    expect(parseHistoryPage({ schemaVersion: "programmable.custom-launch-list.v3", launches: [item], nextCursor: null }, controller, chainId)?.launches).toHaveLength(1);
  });
  it.each(["8453", "999"] as const)("rejects missing, other, duplicate and cross-origin chain %s links", chainId => {
    for (const walletHandoffUrl of [valid("1").walletHandoffUrl, valid(chainId === "999" ? "8453" : "999").walletHandoffUrl,
      valid(chainId).walletHandoffUrl + `&chainId=${chainId}`, valid(chainId).walletHandoffUrl.replace("programmable.market", "example.com"),
      valid(chainId).walletHandoffUrl + "&next=external"])
      expect(parseCustomLaunchWalletHandoffV1({ ...valid(chainId), walletHandoffUrl }, id, chainId)).toBeNull();
    const item = resource(chainId);
    expect(parseLaunch(item, item.ownerWallet)).toBeNull();
    expect(parseLaunch(item, item.ownerWallet, chainId === "8453" ? "999" : "8453")).toBeNull();
  });
  it("keeps Ethereum free of a supplied alternate-chain override", () => {
    expect(parseCustomLaunchWalletHandoffV1(valid("8453"), id)).toBeNull();
    expect(parseCustomLaunchWalletHandoffV1({ ...valid("1"), walletHandoffUrl: valid("1").walletHandoffUrl + "&chainId=1" }, id)).toBeNull();
  });
});
