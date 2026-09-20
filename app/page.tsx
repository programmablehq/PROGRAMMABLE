import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

const pageDescription =
  "Build and launch custom Uniswap v4 hooks. Explore projects launched through Programmable.";
const pageSocialImage =
  "https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg";

export const metadata: Metadata = {
  title: "Programmable",
  description: pageDescription,
  openGraph: {
    type: "website",
    url: "https://programmable.market",
    siteName: "Programmable",
    title: "Programmable · Custom Uniswap v4 hooks",
    description: pageDescription,
    images: [
      {
        url: pageSocialImage,
        secureUrl: pageSocialImage,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: "Programmable over a vivid floral night garden",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Programmable · Custom Uniswap v4 hooks",
    description: pageDescription,
    creator: "@ProgrammableHQ",
    images: [
      {
        url: pageSocialImage,
        alt: "Programmable over a vivid floral night garden",
      },
    ],
  },
};

export default function HomePage() {
  return <LandingPage />;
}
