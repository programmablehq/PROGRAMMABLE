import Image from "next/image";
import type { ReactNode } from "react";

import type {
  CreatorArticleBlockV1,
  CreatorArticleInlineV1,
  CreatorArticleMarkV1,
  CreatorArticleV1,
} from "@/lib/creator-article/contract-v1";
import {
  CreatorArticleLinkIcon,
  creatorArticleLinkLabelV1,
  creatorArticleLinkProviderV1,
} from "@/components/creator-article-link-icon";
import { PROGRAMMABLE_MAIN_TOKEN_ADDRESS } from
  "@/lib/creator-article/programmable-example-v1";
import { PROGRAMMABLE_MAIN_TOKEN_PRESENTATION } from
  "@/lib/programmable-main-token-presentation";
import { isGitHubUrl } from "@/lib/public-link-visibility";

import styles from "./creator-article.module.css";

export { creatorArticleLinkProviderV1 };

type CreatorArticleHeaderLinkV1 = Readonly<{
  href: string;
  label: string;
}>;

const PROGRAMMABLE_CURRENT_X =
  PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.links.find(({ kind }) => kind === "x")!
    .url;

function currentCreatorArticleHeaderLinkV1(
  article: CreatorArticleV1,
  link: CreatorArticleHeaderLinkV1,
): CreatorArticleHeaderLinkV1 {
  if (
    article.chainId !== 1 ||
    article.tokenAddress.toLowerCase() !==
      PROGRAMMABLE_MAIN_TOKEN_ADDRESS.toLowerCase()
  ) return link;
  const normalized = link.href.toLowerCase().replace(/\/+$/u, "");
  const href = normalized === "https://x.com/0xprogrammable"
    ? PROGRAMMABLE_CURRENT_X
    : link.href;
  return href === link.href
    ? link
    : Object.freeze({ href, label: creatorArticleLinkLabelV1(href) });
}

export function CreatorArticle({
  article,
  editAction = null,
}: Readonly<{
  article: CreatorArticleV1 | null;
  editAction?: ReactNode;
}>) {
  if (article === null) {
    return editAction ? (
      <div
        className={styles.actionRow}
        role="group"
        aria-label="Project article actions"
      >
        {editAction}
      </div>
    ) : null;
  }
  const headerContent = creatorArticleHeaderContentV1(article.document.content);
  const headerLinks = headerContent.links.filter((link) => !isGitHubUrl(link.href)).map((link) =>
    currentCreatorArticleHeaderLinkV1(article, link)
  );
  const updated = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(article.updatedAt));
  return (
    <article className={styles.article} aria-labelledby="creator-article-title">
      {editAction ? <div className={styles.actionRow}>{editAction}</div> : null}
      {article.bannerImage ? (
        <figure className={`${styles.media} ${styles.banner}`}>
          <Image
            src={article.bannerImage.url}
            alt={article.bannerImage.alt}
            width={article.bannerImage.width}
            height={article.bannerImage.height}
            sizes="(max-width: 720px) 100vw, (max-width: 1200px) 92vw, 1120px"
            unoptimized
          />
          {article.bannerImage.caption ? (
            <figcaption>{article.bannerImage.caption}</figcaption>
          ) : null}
        </figure>
      ) : null}
      <header className={styles.header}>
        <h2
          id="creator-article-title"
          data-single-line={article.title.trim().length <= 32 ? "true" : undefined}
        >
          {article.title}
        </h2>
        <time className={styles.updated} dateTime={article.updatedAt}>
          Updated {updated}
        </time>
        {headerLinks.length > 0 ? (
          <nav className={styles.socials} aria-label="Project links">
            {headerLinks.map((link) => (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                title={link.label}
                data-creator-link-provider={creatorArticleLinkProviderV1(link.href)}
                key={link.href}
              >
                <CreatorArticleLinkIcon
                  href={link.href}
                  className={styles.socialIcon}
                />
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      <div className={styles.body}>
        {headerContent.body.map((block, index) => {
          if (block.type === "paragraph") {
            return <p key={index}>{renderInline(block.content ?? [])}</p>;
          }
          if (block.type === "heading") {
            return block.attrs.level === 2
              ? <h3 key={index}>{renderInline(block.content)}</h3>
              : <h4 key={index}>{renderInline(block.content)}</h4>;
          }
          if (block.type === "articleImage") {
            return (
              <figure
                className={`${styles.media} ${styles[block.attrs.size]}`}
                key={`${block.attrs.url}:${index}`}
              >
                <Image
                  src={block.attrs.url}
                  alt={block.attrs.alt}
                  width={block.attrs.width}
                  height={block.attrs.height}
                  sizes={block.attrs.size === "wide"
                    ? "(max-width: 720px) 100vw, (max-width: 1200px) 92vw, 1120px"
                    : block.attrs.size === "compact"
                      ? "(max-width: 720px) 74vw, 520px"
                      : "(max-width: 720px) 92vw, 720px"}
                  unoptimized
                />
                {block.attrs.caption ? <figcaption>{block.attrs.caption}</figcaption> : null}
              </figure>
            );
          }
          const List = block.type === "orderedList" ? "ol" : "ul";
          return (
            <List key={index}>
              {block.content.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.content.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex}>{renderInline(paragraph.content ?? [])}</p>
                  ))}
                </li>
              ))}
            </List>
          );
        })}
      </div>
    </article>
  );
}

export function creatorArticleHeaderContentV1(
  blocks: readonly CreatorArticleBlockV1[],
): Readonly<{
  body: readonly CreatorArticleBlockV1[];
  links: readonly CreatorArticleHeaderLinkV1[];
}> {
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block?.type !== "paragraph" || !block.content) continue;
    const links: CreatorArticleHeaderLinkV1[] = [];
    let linkOnly = true;
    for (const node of block.content) {
      if (node.type === "hardBreak") continue;
      const link = node.marks?.find((mark) => mark.type === "link");
      if (!link) {
        if (!/^[\s·|•,/]*$/u.test(node.text)) linkOnly = false;
        continue;
      }
      if (node.text.trim() === "") continue;
      links.push(Object.freeze({
        href: link.attrs.href,
        label: creatorArticleLinkLabelV1(link.attrs.href),
      }));
    }
    if (!linkOnly || links.length < 2) continue;
    const seen = new Set<string>();
    return Object.freeze({
      body: Object.freeze(blocks.filter((_, index) => index !== blockIndex)),
      links: Object.freeze(links.filter(({ href }) => {
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      })),
    });
  }
  return Object.freeze({ body: blocks, links: Object.freeze([]) });
}

function renderInline(nodes: readonly CreatorArticleInlineV1[]) {
  return nodes.map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    let content: ReactNode = node.text;
    for (const mark of node.marks ?? []) content = applyMark(mark, content, index);
    return <span key={index}>{content}</span>;
  });
}

function applyMark(mark: CreatorArticleMarkV1, content: ReactNode, key: number) {
  if (mark.type === "bold") return <strong key={`bold-${key}`}>{content}</strong>;
  if (mark.type === "italic") return <em key={`italic-${key}`}>{content}</em>;
  if (isGitHubUrl(mark.attrs.href)) return content;
  return (
    <a
      className={styles.link}
      data-creator-link-provider={creatorArticleLinkProviderV1(mark.attrs.href)}
      href={mark.attrs.href}
      target="_blank"
      rel="noopener noreferrer"
      key={`link-${key}`}
    >
      <CreatorArticleLinkIcon href={mark.attrs.href} className={styles.linkIcon} />
      {content}
    </a>
  );
}
