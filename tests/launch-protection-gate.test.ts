import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { legacyLaunchGuardV1 } from "@/lib/launch-protection/legacy-gate.server";

afterEach(() => vi.unstubAllEnvs());

describe("legacy launch protection gate", () => {
  it("preserves candidate behavior and blocks required or unknown modes", async () => {
    expect(legacyLaunchGuardV1({})).toBeNull();
    expect(legacyLaunchGuardV1({ PROGRAMMABLE_LAUNCH_PROTECTION_V1_MODE: "candidate" })).toBeNull();
    for (const mode of ["required", "typo", ""]) {
      const response = legacyLaunchGuardV1({ PROGRAMMABLE_LAUNCH_PROTECTION_V1_MODE: mode })!;
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await response.json()).code).toBe("LAUNCH_PROTECTION_REQUIRED");
    }
  });

  it.each([
    () => import("@/app/api/module-foundation/compose/route"),
    () => import("@/app/api/module-foundation/authorize/route"),
    () => import("@/app/api/module-mode/any-quote/launch-preview/route"),
    () => import("@/app/api/launch/preflight/route"),
  ])("rejects legacy creation before body parsing, simulation or signing", async load => {
    vi.stubEnv("PROGRAMMABLE_LAUNCH_PROTECTION_V1_MODE", "required");
    const { POST } = await load();
    // An unreadable request is sufficient: the policy must run before request parsing.
    const response = await POST(undefined as never);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("LAUNCH_PROTECTION_REQUIRED");
  });
});
