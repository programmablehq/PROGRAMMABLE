import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentConnection, buildAgentInstructions } from "../lib/agent-connection";
import { safeDeveloperDetails, developerRecovery } from "../lib/developer-access-feedback";
import { launchOverviewItem, mergeLaunchOverview } from "../lib/developer-launch-overview";
import { GET } from "../app/api/developer/connection/route";
const id = "10000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());
describe("developer setup and diagnostics", () => {
  it("keeps Ethereum instructions free of Robinhood bindings and headers", () => {
    const input = { scopes: ["custom-launch:create", "custom-launch:read"], chainId: "1" as const, launchContract: { manifestDigest: "old", text: "robinhood-only-setup" } };
    const data = JSON.parse(buildAgentConnection(`pm_live_${"a".repeat(22)}_${"b".repeat(43)}`, input));
    expect(data.selectedChainId).toBe("1"); expect(data.launchContract).toBeUndefined();
    expect(data.instructions).toContain("/v3/capabilities");
    expect(data.instructions).not.toContain("robinhood-only-setup");
    expect(data.instructions).not.toContain("Programmable-Launch-Response-Version");
    expect(buildAgentInstructions({ chainId: "4663" })).toContain("Programmable-Launch-Response-Version: 1.2");
    expect(buildAgentInstructions({ chainId: "8453" })).toContain("/v4/chains/8453/capabilities");
    expect(buildAgentInstructions({ chainId: "8453" })).not.toContain("/v4/chains/8453/custom-launch-capabilities");
  });
  it("does not instruct a read-only agent to prepare a launch", () => {
    const instructions = buildAgentInstructions({ scopes: ["custom-launch:read"], chainId: "1" });
    expect(instructions).toContain("do not prepare or submit launch requests");
    expect(instructions).not.toContain("Build the custom hook for the user's idea");
  });
  it("copies only diagnostic identifiers, never a secret or body", () => {
    const result = safeDeveloperDetails(`PLAN_PROVIDER_UNAVAILABLE Request ID: req_123 Body: Authorization: Bearer pm_live_${"a".repeat(22)}_${"b".repeat(43)} https://private/path?key=secret`, "4663");
    expect(result).toContain("req_123"); expect(result).toContain("PLAN_PROVIDER_UNAVAILABLE");
    expect(result).not.toMatch(/pm_live|Authorization|https|secret/);
    expect(developerRecovery("HTTP 401").owner).toBe("Your action");
    expect(developerRecovery("HTTP 503").owner).toBe("Programmable");
  });
  it("connection checks use only allowlisted public endpoints and cannot authorize a key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: "programmable.custom-launch-capabilities.v1", chain: { id: "1" }, profile: { productionLaunchAuthorized: true } })));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(new Request("https://programmable.market/api/developer/connection?chainId=1"));
    expect(await response.json()).toMatchObject({ reachable: true, createState: "active", authorizesKey: false, chainId: "1" });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.programmable.market/v3/capabilities");
    expect((await GET(new Request("https://programmable.market/api/developer/connection?chainId=https://attacker"))).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not treat an unrelated or failed response as available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ chainId: "1", availability: { operations: { create: { state: "active" } } } }))));
    expect((await GET(new Request("https://programmable.market/api/developer/connection?chainId=4663"))).status).toBe(503);
  });
});
describe("unified launch overview", () => {
  it("preserves source and chain identity even with matching ids", () => {
    const ethereum = launchOverviewItem({ launchId: id, routeId: "custom-launch:create:v3", status: "finalized", createdAt: "2026-10-12T12:00:00Z", projectMetadata: { token: { name: "Hive", symbol: "HIVE" } } }, "legacy", Date.now());
    const robinhood = launchOverviewItem({ planId: id, status: "accepted", plan: { publication: { name: "ROBIN" } }, createdAt: "2026-10-12T13:00:00Z" }, "custom_launch_plan_v1", Date.now());
    const base = launchOverviewItem({ launchId: id, routeId: "custom-launch:create:v3", status: "finalized", manualReview: { chainId: "8453" }, createdAt: "2026-10-12T14:00:00Z" }, "legacy", Date.now());
    expect(mergeLaunchOverview([ethereum], [robinhood, ethereum, base])).toEqual([base, robinhood, ethereum]);
    expect(base.chainId).toBe("8453"); expect(base.version).toBe("v3");
    expect(ethereum.status).toBe("Completed"); expect(robinhood.chainId).toBe("4663");
  });
  it("confirmation takes precedence over stale approval", () => {
    const item = launchOverviewItem({ planId: id, status: "submitted", manualReview: { state: "pending" } }, "custom_launch_plan_v1", Date.now());
    expect(item.status).toBe("Confirming");
  });
  it("completion takes precedence over a stale manual review", () => {
    const item = launchOverviewItem({ planId: id, status: "finalized", manualReview: { state: "pending" } }, "custom_launch_plan_v1", Date.now());
    expect(item.status).toBe("Completed"); expect(item.next).toBe("Launch completed");
  });
});
