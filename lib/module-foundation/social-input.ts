import type { ModuleSocialKind, ModuleSocialLinks } from "@/lib/module-mode/token-metadata";

/** Turn convenient form input into URLs before the existing metadata validation. */
export function normalizeFoundationSocialInput(kind: ModuleSocialKind, value: string): string {
  const input = value.trim();
  if (!input || (kind !== "website" && kind !== "twitter")) return input;
  if (kind === "twitter" && /^@?[A-Za-z0-9_]{1,15}$/.test(input)) return `https://x.com/${input.replace(/^@/, "")}`;
  if (/^https?:\/\//i.test(input)) return input.replace(/^http:/i, "https:");
  if (input.startsWith("//")) return `https:${input}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) return `https://${input}`;
  return input;
}

export function normalizeFoundationSocialInputs(links: ModuleSocialLinks): ModuleSocialLinks {
  return Object.fromEntries(Object.entries(links).map(([kind, value]) => [kind,
    normalizeFoundationSocialInput(kind as ModuleSocialKind, value)]));
}
