import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { defineTool } from "../lib/custom-ai/capabilities/definition.server";
import { dispatchTool } from "../lib/custom-ai/capabilities/dispatch.server";
import { capabilityMetadata, executionProfile, assertExecutionProfile } from "../lib/custom-ai/capabilities/registry.server";
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
