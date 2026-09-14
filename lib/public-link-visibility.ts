export function isGitHubUrl(href: string): boolean {
  try {
    const hostname = new URL(href, "https://programmable.market").hostname
      .toLowerCase().replace(/\.$/u, "");
    return ["github.com", "githubusercontent.com"].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}
