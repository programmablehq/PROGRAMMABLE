import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET } from "../app/api/custom-ai/capabilities/route";
import { defineTool } from "../lib/custom-ai/capabilities/definition.server";
import { dispatchTool } from "../lib/custom-ai/capabilities/dispatch.server";
import { capabilityMetadata, executionProfile, assertExecutionProfile, getCapabilities } from "../lib/custom-ai/capabilities/registry.server";

afterEach(() => vi.unstubAllEnvs());
describe("Custom AI capability discovery", () => {
  it("does not expose a disabled product as available", () => {
    vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "false");
    expect(GET().status).toBe(404);
  });
  it("separates design support from active execution and costs no model request", async () => {
    vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_EVENTS_ENABLED", "false");vi.stubEnv("CUSTOM_AI_PROGRAMS_ENABLED", "true");
    const fetcher=vi.spyOn(globalThis,"fetch");
    const response=GET(), body=await response.json();
    expect(body.chains).toEqual([1,4663]);
    expect(body.chainScope).toBe("fixed-fee-launches");
    expect(body.browser).toEqual({ url: "https://programmable.market/launch/custom-ai", guide: "https://programmable.market/developers/custom-ai-browser.md",
      authentication: "wallet-session", messageLimit: 8000, recovery: "read-saved-request", stateAttribute: "data-chat-state" });
    expect(body.sourceProjects).toMatchObject({ chains: [1,4663,8453,999], state: "source-draft", requiresSession: true });
    expect(body.productRuntime).toMatchObject({requiresSession:true,chains:[1,4663,8453,999],maximumContracts:16,maximumRPCReadsPerProvider:32,cacheSeconds:60,polling:false,walletActions:false});
    expect(body.productValues).toMatchObject({requiresSession:true,maximumRPCReadsPerProvider:4,providers:2,cacheSeconds:10,polling:false,walletActions:false,tokenUnits:"not-inferred"});
    expect(body.capabilities.find((value:{id:string})=>value.id==="arbitrary-hooks").state).toBe("source-draft");
    expect(body.capabilities.find((value:{id:string})=>value.id==="fee-allocation-planning").state).toBe("design-only");
    expect(body.capabilities.find((value:{id:string})=>value.id==="external-events").state).toBe("design-only");
    expect(body.capabilities.find((value:{id:string})=>value.id==="fee-programs").state).toBe("requires-live-check");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
  });
  it("does not equate an enabled general endpoint with an approved launch", async () => {
    vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED", "false");
    expect((await GET().json()).sourceProjects.launchPreparation).toBe("not-enabled");
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED", "true");
    const body=await GET().json();
    expect(body.sourceProjects.launchPreparation).toBe("requires-current-review-and-preparation");
    expect(body.sourceProjects.state).toBe("source-draft");
    expect(body.productRuntime.state).toBe("requested-contract-observations");
  });
  it.each([undefined, "false", "1"])("does not advertise project tools when their server gate is %s", async (value) => {
    vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED", value);
    vi.stubEnv("PROJECT_HOSTING_VERCEL_TOKEN", "test-hosting-credential-not-for-response");
    const body = await GET().json();
    expect(body.projectPlatform).toEqual({ version: 1, state: "not-enabled" });
  });
  it("describes the enabled project workflow without promising a verified project or live service", async () => {
    vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED", "false");
    vi.stubEnv("PROJECT_HOSTING_VERCEL_TOKEN", "");
    const body = await GET().json();
    expect(body.projectPlatform).toMatchObject({
      version: 1, state: "enabled", authentication: "wallet-session",
      guide: "/developers/project-platform.md", projects: "/api/custom-ai/platform/projects",
      workModes: ["build", "plan", "test", "deploy"], messageLimit: 24000,
      recovery: "read-saved-run", sourceBinding: "immutable-project-revision",
      sandbox: { lifecycle: "per-run", network: "deny-by-default" },
      connections: { profiles: ["http", "openapi", "oauth-pkce", "remote-mcp", "signed-webhooks"], credentials: "private-project-store", actions: "explicit-project-grants" },
      hosting: { configuration: "missing-credential", profiles: ["static", "node-api", "vite"], unsupportedProfiles: ["nextjs-server"], visitorAuthentication: "application-defined" },
      launchPreparation: "not-enabled", readiness: "requires-project-checks-and-separate-publication-evidence",
    });
    expect(body.productPlanning.serviceDeployment).toBe("not-automatic");
  });
  it("reports configured hosting as needing a provider check and never includes its credential", async () => {
    vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED", "true");
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED", "true");
    vi.stubEnv("PROJECT_HOSTING_VERCEL_TOKEN", "test-hosting-credential-not-for-response");
    const body = await GET().json();
    expect(body).toMatchObject({ projectPlatform: {
      hosting: { configuration: "provider-check-required" },
      launchPreparation: "requires-current-review-and-preparation",
    } });
    expect(JSON.stringify(body)).not.toContain("test-hosting-credential-not-for-response");
  });
});

const context = () => ({ owner: "test", chainId: 1 as const, allowWeb: false, budget: { remaining: 2 } });
const hooks = defineTool("search_hooks", "Find hooks in a verified catalog", async () => ({ status: "current", facts: ["example"], sources: [] }),
  () => true, { type: "object", properties: { q: { type: "string", minLength: 1 } }, required: ["q"], additionalProperties: false });
describe("registered capability dispatch", () => {
  it.each([8453,999] as const)("only advertises connected read capabilities on chain%i",chainId=>{
    const ids=getCapabilities({...context(),chainId}).map(entry=>entry.ref.id);
    expect(ids).toContain("catalog");expect(ids).toContain("search_hooks");expect(ids).toContain("contract");expect(ids).not.toContain("web");
  });
  it("adds a new search tool through registration and schema alone", async () => {
    expect(capabilityMetadata([hooks])[0].ref.id).toBe("search_hooks");
    expect(await dispatchTool(hooks.ref, { q: "fee" }, context(), [hooks])).toMatchObject({ facts: ["example"] });
  });
  it("rejects a changed version, invalid inputs and depleted budgets", async () => {
    await expect(dispatchTool({ ...hooks.ref, version: "future" }, { q: "fee" }, context(), [hooks])).rejects.toMatchObject({ code: "capability" });
    await expect(dispatchTool(hooks.ref, { q: 7 }, context(), [hooks])).rejects.toMatchObject({ code: "capability_input" });
    await expect(dispatchTool(hooks.ref, { q: "fee" }, { ...context(), budget: { remaining: 0 } }, [hooks])).rejects.toMatchObject({ code: "lookup_budget" });
  });
  it("binds configurations and tool versions without changing an existing job", () => {
    const profile = executionProfile([hooks]);
    expect(() => assertExecutionProfile(profile, [hooks])).not.toThrow();
    expect(() => assertExecutionProfile({ ...profile, aiConfigVersion: "old" }, [hooks])).toThrow();
  });
});
