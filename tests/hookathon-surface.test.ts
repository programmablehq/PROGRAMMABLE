import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HookathonRoute, { metadata } from "@/app/hookathon/page";
import { HookathonPage } from "@/components/hookathon-page";
import { hookathonConfig } from "@/lib/hookathon/config";

const confirmation = Date.parse(hookathonConfig.confirmationIso);
const deadline = Date.parse(hookathonConfig.deadlineIso);
const root = process.cwd();

function renderHookathon(initialNowMs: number) {
  return renderToStaticMarkup(
    createElement(HookathonPage, {
      initialNowMs,
    }),
  );
}

describe("Hookathon surface", () => {
  it("renders the complete compact running state from one config", () => {
    const html = renderHookathon(confirmation);

    expect(html).toContain('<h1 id="hookathon-title">Hookathon</h1>');
    expect(html).toContain("$10,000");
    expect(html).toContain("$5,000");
    expect(html).toContain("$3,000");
    expect(html).toContain("$2,000");
    expect(html).toContain(">Originality<");
    expect(html).toContain(">Usefulness<");
    expect(html).toContain(">Execution<");
    expect(html).toContain("Anyone can enter, with no team size limit");
    expect(html).not.toContain("How to enter");
    expect(html).not.toContain(
      'href="https://github.com/0xprogrammable/submit-launch"',
    );
    expect(html).not.toContain(">Submit Launch</a>");
  });

  it("omits the GitHub Hookbuilder action without announcing every second", () => {
    const html = renderHookathon(confirmation);

    expect(html).not.toContain("Copy builder prompt");
    expect(html).not.toContain('href="https://github.com/0xprogrammable/hookbuilder"');
    expect(html).not.toContain("Open Hookbuilder");
    expect(html).not.toContain("↗");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).not.toContain('role="timer"');
    expect(html).not.toContain('aria-live="assertive"');
    expect(html).not.toContain("Submissions close on");
    expect(html).not.toContain("Europe/Zurich");
    expect(html).not.toContain("<time");
    expect(html).toContain(
      "4 days, 0 hours, 0 minutes and 0 seconds remaining",
    );
  });

  it("keeps the ended state stable and removes the entry link", () => {
    const html = renderHookathon(deadline);

    expect(html).toContain("Submissions closed");
    expect(html).toContain('aria-disabled="true">Submissions closed</span>');
    expect(html).not.toContain('href="https://github.com/0xprogrammable/hookbuilder"');
    expect(html).not.toContain("Copy builder prompt");
  });

  it("keeps the retired route out of navigation and search indexes", () => {
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: false,
      noarchive: true,
    });
    expect(() => HookathonRoute()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("removes every public Hookathon entry point", () => {
    const publicSurfaces = [
      "components/site-navigation.tsx",
      "app/docs/creators/page.tsx",
      "app/docs/creators/programs/page.tsx",
      "components/docs-data.ts",
      "docs/public/SUMMARY.md",
      "docs/public/creators/programs.md",
    ];

    for (const path of publicSurfaces) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source, path).not.toMatch(/hookathons?|\/hookathon/i);
    }
  });
});
