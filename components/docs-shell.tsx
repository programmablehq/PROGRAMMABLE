import type { ReactNode } from "react";
import Link from "next/link";

import { docsCategories, docsNavigation } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";
import {
  DocsNavigation,
  DocsPageNavigation,
  type DocsPageSection,
} from "@/components/docs-navigation";
import { DocsSearch } from "@/components/docs-search";

export function DocsShell({
  children,
  currentPath,
  description,
  heroAside,
  heroId,
  heroMeta,
  kicker,
  parentHref,
  parentLabel,
  sections,
  title,
}: {
  children: ReactNode;
  currentPath: string;
  description: string;
  heroAside?: ReactNode;
  heroId?: string;
  heroMeta?: ReactNode;
  kicker?: string;
  parentHref?: string;
  parentLabel?: string;
  sections?: readonly DocsPageSection[];
  title: string;
}) {
  const category = docsCategories.find(
    (item) =>
      item.href === currentPath ||
      item.relatedPaths.some((path) => path === currentPath),
  );
  let currentNavigationItem: { href: string; label: string } | undefined;
  for (const group of docsNavigation) {
    const item = group.items.find(
      (candidate) => candidate.href.split("#")[0] === currentPath,
    );
    if (item) {
      currentNavigationItem = item;
      break;
    }
  }
  const breadcrumbParent =
    parentHref && parentLabel
      ? { href: parentHref, label: parentLabel }
      : category && category.href !== currentPath
        ? { href: category.href, label: category.label }
        : null;
  const breadcrumbLabel =
    category?.href === currentPath
      ? category.label
      : (currentNavigationItem?.label ?? kicker ?? title);

  return (
    <div className={`${styles.page} page-width`} data-docs-shell>
      <a className={styles.skipDocsNavigation} href="#docs-content">
        Skip documentation navigation
      </a>

      <aside className={styles.sidebar} data-docs-sidebar>
        <Link className={styles.sidebarBrand} href="/docs">
          <span>Programmable</span>
          <strong>Documentation</strong>
        </Link>

        <div className={styles.sidebarSearch} data-docs-tools>
          <DocsSearch id="docs-search-desktop" />
        </div>

        <DocsNavigation
          currentPath={currentPath}
          mobileSearch={<DocsSearch id="docs-search-mobile" />}
          sections={sections}
        />
      </aside>

      <div className={styles.mainColumn} id="docs-content" tabIndex={-1}>
        <header
          className={styles.hero}
          data-docs-hero
          data-has-aside={heroAside ? "true" : undefined}
          id={heroAside ? (heroId ?? "paths") : undefined}
        >
          <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
            {currentPath === "/docs" ? (
              <span aria-current="page">Docs</span>
            ) : (
              <>
                <Link href="/docs">Docs</Link>
                <span aria-hidden="true">/</span>
                {breadcrumbParent ? (
                  <>
                    <Link href={breadcrumbParent.href}>
                      {breadcrumbParent.label}
                    </Link>
                    <span aria-hidden="true">/</span>
                  </>
                ) : null}
                <span aria-current="page">{breadcrumbLabel}</span>
              </>
            )}
          </nav>
          <div className={styles.heroHeader}>
            <div className={styles.heroCopy}>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {heroMeta ? (
              <div className={styles.heroMeta}>{heroMeta}</div>
            ) : null}
          </div>
          {heroAside ? (
            <div className={styles.heroAside}>{heroAside}</div>
          ) : null}
        </header>

        <div className={styles.layout} data-docs-layout>
          <article className={styles.content} data-docs-content>
            {children}
          </article>
          <DocsPageNavigation currentPath={currentPath} sections={sections} />
        </div>
      </div>
    </div>
  );
}
