import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PROGRAMMABLE_AGENT_ENTRY } from "../lib/agent-connection";
import nextConfig from "../next.config";

it("keeps retired module submissions out of public discovery and navigation", async () => {
  expect(PROGRAMMABLE_AGENT_ENTRY.workflows).not.toHaveProperty("moduleContribution");
  expect(PROGRAMMABLE_AGENT_ENTRY.website).not.toHaveProperty("buildModule");
  expect(readFileSync("components/docs-data.ts", "utf8")).not.toContain('label: "Build a module"');
  expect(readFileSync("app/docs/developers/module-mode/page.tsx", "utf8")).toContain('redirect("/docs/models/module-mode")');
  expect(await nextConfig.redirects?.()).toContainEqual({
    source: "/docs/developers/module-mode", destination: "/docs/launch/module-mode", permanent: false,
  });
  expect(readFileSync("public/developers/module-mode-api-v1.md", "utf8")).toContain("New module API keys and source submissions are no longer offered.");
});
