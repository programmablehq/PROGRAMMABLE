import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET } from "../app/api/custom-ai/capabilities/route";
import { defineTool } from "../lib/custom-ai/capabilities/definition.server";
import { dispatchTool } from "../lib/custom-ai/capabilities/dispatch.server";
import { capabilityMetadata, executionProfile, assertExecutionProfile } from "../lib/custom-ai/capabilities/registry.server";

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
    expect(body.capabilities.find((value:{id:string})=>value.id==="external-events").state).toBe("design-only");
    expect(body.capabilities.find((value:{id:string})=>value.id==="fee-programs").state).toBe("requires-live-check");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
  });
});

const context = () => ({ owner: "test", chainId: 1 as const, allowWeb: false, budget: { remaining: 2 } });
const hooks = defineTool("search_hooks", "Find hooks in a verified catalog", async () => ({ status: "current", facts: ["example"], sources: [] }),
  () => true, { type: "object", properties: { q: { type: "string", minLength: 1 } }, required: ["q"], additionalProperties: false });
describe("registered capability dispatch", () => {
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
