import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { DOCUMENTATION } from "../lib/documentation";

const root = process.cwd();
const component = readFileSync(
  join(root, "components/generic-launch-directory-v2.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(root, "components/generic-launch-directory-v2.module.css"),
  "utf8",
);
const directoryPage = readFileSync(
  join(root, "app/custom-launches/page.tsx"),
  "utf8",
);

describe("legacy Custom Registry directory", () => {
  it("labels the retired flow and routes new launches to the API path", () => {
    expect(component).toContain("Legacy Custom records");
    expect(component).toContain("retired Registry approval flow");
    expect(component).toContain('href="/developers/api-keys"');
    expect(component).toContain("href={DOCUMENTATION.customLaunch}");
    expect(DOCUMENTATION.customLaunch).toBe("/docs/developers/custom-launch-quickstart/custom-launch");
    expect(component).not.toContain("Launched from an approved revision.");
  });

  it("uses the current flat product surface and stays out of search results", () => {
    expect(styles).toContain("var(--webde-surface");
    expect(styles).toContain("var(--webde-line");
    expect(styles).not.toContain("liquid-glass");
    expect(directoryPage).toContain("robots: { follow: false, index: false }");
  });

  it("reserves the launch-card geometry while the cold feed is loading", () => {
    expect(component).toContain('Array.from({ length: 3 }');
    expect(component).toContain('aria-hidden="true"');
    expect(component).toContain("styles.skeletonCard");
    expect(component).not.toContain(
      '<p role="status" className={styles.status}>Loading launch records…</p>',
    );
    expect(styles).toMatch(/\.skeletonCard\s*\{[^}]*pointer-events:\s*none/s);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.skeletonLine\s*\{[\s\S]*animation:\s*none/,
    );
  });
});
