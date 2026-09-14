import {
  BookOpenText,
  ExternalLink,
  ScanSearch,
} from "lucide-react";
import type { ReactNode } from "react";

import { GitHubBrandIcon, XBrandIcon } from "@/components/brand-icons";
import styles from "@/components/docs-experience.module.css";
import { isGitHubUrl } from "@/lib/public-link-visibility";

export type DocsExternalLinkVariant = "address" | "chip" | "inline";

type DocsLinkProvider = "Etherscan" | "GitHub" | "Uniswap" | "X" | "website";

export function getDocsExternalLinkProvider(href: string): DocsLinkProvider {
  const normalizedHref = href.toLowerCase();
  if (normalizedHref.includes("github.com/")) return "GitHub";
  if (
    normalizedHref.includes("x.com/") ||
    normalizedHref.includes("twitter.com/")
  ) {
    return "X";
  }
  if (normalizedHref.includes("etherscan.io/")) return "Etherscan";
  if (normalizedHref.includes("docs.uniswap.org/")) return "Uniswap";
  return "website";
}

function ProviderIcon({ provider }: { provider: DocsLinkProvider }) {
  if (provider === "GitHub") return <GitHubBrandIcon />;
  if (provider === "X") return <XBrandIcon />;
  if (provider === "Etherscan") {
    return <ScanSearch aria-hidden="true" strokeWidth={1.8} />;
  }
  if (provider === "Uniswap") {
    return <BookOpenText aria-hidden="true" strokeWidth={1.8} />;
  }
  return <ExternalLink aria-hidden="true" strokeWidth={1.8} />;
}

export function DocsExternalLink({
  children,
  href,
  variant = "inline",
}: {
  children: ReactNode;
  href: string;
  variant?: DocsExternalLinkVariant;
}) {
  if (isGitHubUrl(href)) return <span>{children}</span>;
  const provider = getDocsExternalLinkProvider(href);
  const variantClassName =
    variant === "address"
      ? styles.externalLinkAddress
      : variant === "chip"
        ? styles.externalLinkChip
        : styles.externalLinkInline;

  return (
    <a
      className={`${styles.externalLink} ${variantClassName}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <span className={styles.externalLinkIcon} aria-hidden="true">
        <ProviderIcon provider={provider} />
      </span>
      <span className={styles.externalLinkText}>{children}</span>
      <span className="sr-only"> — opens {provider} in a new tab</span>
    </a>
  );
}
