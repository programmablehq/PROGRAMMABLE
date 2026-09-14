import type { ComponentProps } from "react";
import { isGitHubUrl } from "@/lib/public-link-visibility";

export function PublicExternalLink({ children, href, ...props }: ComponentProps<"a">) {
  if (href && isGitHubUrl(href)) return <span>{children}</span>;
  return <a href={href} {...props}>{children}</a>;
}
