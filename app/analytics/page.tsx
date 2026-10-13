import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics-view";
import { getAnalytics } from "@/lib/analytics/data.server";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Analytics · Programmable",
  description: "Trading volume, collected protocol revenue, V4 buybacks and burns across Ethereum and Robinhood.",
  alternates: { canonical: "/analytics" },
};
export default async function AnalyticsPage() {
  return <AnalyticsView data={await getAnalytics()} />;
}
