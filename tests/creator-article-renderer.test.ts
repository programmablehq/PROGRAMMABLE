import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as creatorArticleRenderer from "../components/creator-article";
import { CreatorArticle } from "../components/creator-article";
import { parseCreatorArticleV1 } from "../lib/creator-article/contract-v1";

const article = parseCreatorArticleV1({
  schemaVersion: "programmable.creator-article.v1",
  chainId: 1,
  tokenAddress: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  revision: 1,
  status: "published",
  title: "Programmable, by its creators",
  bannerImage: null,
  document: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "A public story" }],
      },
      {
        type: "paragraph",
        content: [{
          type: "text",
          text: "programmable.market",
          marks: [{ type: "link", attrs: { href: "https://programmable.market/" } }],
        }],
      },
    ],
  },
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
});

describe("creator article public renderer", () => {
  it("renders semantic content and safe external links", () => {
    const html = renderToStaticMarkup(createElement(CreatorArticle, { article }));
    expect(html).toContain("<article");
    expect(html).toContain("<h3><span>A public story</span></h3>");
    expect(html).toContain('href="https://programmable.market/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders no placeholder when the article is absent", () => {
    expect(renderToStaticMarkup(createElement(CreatorArticle, { article: null })))
      .toBe("");
  });

  it("keeps the create action reachable before the first article exists", () => {
    const html = renderToStaticMarkup(createElement(CreatorArticle, {
      article: null,
      editAction: createElement("button", { type: "button" }, "Create article"),
    }));
    expect(html).toContain('aria-label="Project article actions"');
    expect(html).toContain("Create article");
  });

  it("recognizes common social providers and keeps an icon for unknown HTTPS links", () => {
    const provider = (creatorArticleRenderer as unknown as {
      creatorArticleLinkProviderV1(href: string): string;
    }).creatorArticleLinkProviderV1;
    expect(typeof provider).toBe("function");
    expect(provider("https://github.com/0xprogrammable/programmable")).toBe("github");
    expect(provider("https://discord.gg/programmable")).toBe("discord");
    expect(provider("https://x.com/0xProgrammable")).toBe("x");
    expect(provider("https://t.me/programmable")).toBe("telegram");
    expect(provider("https://docs.programmable.gitbook.io/docs")).toBe("gitbook");
    expect(provider("https://dune.com/0xprogrammable6098")).toBe("dune");
    expect(provider("https://programmable.market/docs")).toBe("docs");
  });

  it("keeps GitHub article text without a public link or social icon", () => {
    const githubArticle = parseCreatorArticleV1({
      ...article,
      document: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{
            type: "text",
            text: "github.com",
            marks: [{
              type: "link",
              attrs: { href: "https://github.com/0xprogrammable/programmable" },
            }],
          }],
        }],
      },
    });
    const html = renderToStaticMarkup(createElement(CreatorArticle, {
      article: githubArticle,
    }));
    expect(html).not.toContain('href="https://github.com');
    expect(html).not.toContain('data-creator-link-provider="github"');
    expect(html).not.toContain("<svg");
    expect(html).toContain(">github.com<");
  });

  it("lifts a social link row into an icon-only header with accessible names", () => {
    const socialArticle = parseCreatorArticleV1({
      ...article,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Website",
                marks: [{ type: "link", attrs: { href: "https://programmable.market/" } }],
              },
              { type: "text", text: "   " },
              {
                type: "text",
                text: "Docs",
                marks: [{ type: "link", attrs: { href: "https://programmable.market/docs" } }],
              },
              { type: "text", text: "   " },
              {
                type: "text",
                text: "Analytics",
                marks: [{ type: "link", attrs: { href: "https://dune.com/0xprogrammable6098/programmable-analytics" } }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "The article story remains visible." }],
          },
        ],
      },
    });
    const html = renderToStaticMarkup(createElement(CreatorArticle, {
      article: socialArticle,
    }));
    expect(html).toContain('aria-label="Project links"');
    expect(html).toContain('aria-label="Website"');
    expect(html).toContain('aria-label="Docs"');
    expect(html).toContain('aria-label="Dune analytics"');
    expect(html).not.toContain(">Analytics<");
    expect(html).toContain("The article story remains visible.");
  });

  it("replaces stale organization links on the official Programmable article", () => {
    const staleArticle = parseCreatorArticleV1({
      ...article,
      document: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "X",
              marks: [{
                type: "link",
                attrs: { href: "https://x.com/0xProgrammable" },
              }],
            },
            { type: "text", text: "   " },
            {
              type: "text",
              text: "GitHub",
              marks: [{
                type: "link",
                attrs: { href: "https://github.com/0xprogrammable" },
              }],
            },
          ],
        }],
      },
    });

    const html = renderToStaticMarkup(createElement(CreatorArticle, {
      article: staleArticle,
    }));
    expect(html).toContain('href="https://x.com/ProgrammableHQ"');
    expect(html).not.toContain('href="https://github.com/programmablehq"');
    expect(html).not.toContain('href="https://x.com/0xProgrammable"');
    expect(html).not.toContain('href="https://github.com/0xprogrammable"');
  });
});
