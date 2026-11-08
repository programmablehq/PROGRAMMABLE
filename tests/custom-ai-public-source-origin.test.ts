import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { generalSourcePublicUri } from "../lib/custom-ai/public-launch-source.server";

const id = `sha256:${"a".repeat(64)}`;
afterEach(() => vi.unstubAllEnvs());

it("keeps the canonical production origin unless the server configures another", () => {
  vi.stubEnv("PROJECT_PUBLIC_ORIGIN", undefined);
  expect(generalSourcePublicUri(id)).toBe(`https://programmable.market/api/custom-ai/source/${"a".repeat(64)}`);
});
it("binds exported launch packages to their own staging source store", () => {
  vi.stubEnv("PROJECT_PUBLIC_ORIGIN", "https://programmable-project-platform-staging-v1-aficialais-projects.vercel.app");
  expect(generalSourcePublicUri(id)).toBe(`https://programmable-project-platform-staging-v1-aficialais-projects.vercel.app/api/custom-ai/source/${"a".repeat(64)}`);
});
it.each([
  "http://example.com", "https://user:password@example.com", "https://example.com/source", "https://example.com?key=value", "https://example.com#source", "not-a-url",
])("rejects an invalid server source origin (%s)", origin => {
  vi.stubEnv("PROJECT_PUBLIC_ORIGIN", origin);
  expect(() => generalSourcePublicUri(id)).toThrow();
});
