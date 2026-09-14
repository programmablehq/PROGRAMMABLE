const SITE_ORIGIN = "https://programmable.market";
const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
const APPLICATION_ID = `${SITE_ORIGIN}/#application`;

export const programmableSiteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "Programmable",
      url: SITE_ORIGIN,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_ORIGIN}/apple-touch-icon.png`,
      },
      sameAs: [
        "https://x.com/ProgrammableHQ",
        "https://discord.com/invite/programmable",
      ],
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      name: "Programmable",
      url: SITE_ORIGIN,
      description: "Shape what assets can do",
      inLanguage: "en",
      publisher: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "SoftwareApplication",
      "@id": APPLICATION_ID,
      name: "Programmable",
      url: SITE_ORIGIN,
      description:
        "Discover verified launches, understand their Uniswap v4 hooks, and use the website to create or interact with tokens on Ethereum.",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      publisher: { "@id": ORGANIZATION_ID },
    },
  ],
} as const;

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}
