import type { Metadata } from "next";
import { CustomLaunchReviewConsole } from "@/components/custom-launch-review-console";
export const metadata: Metadata = { title: "Launch reviews · Programmable", robots: { index: false, follow: false } };
export default async function CustomLaunchReviewsPage({ searchParams }: { searchParams: Promise<{ reviewId?: string | string[] }> }) {
  const { reviewId } = await searchParams;
  const initialReviewId = typeof reviewId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reviewId) ? reviewId : undefined;
  return <CustomLaunchReviewConsole initialReviewId={initialReviewId} />;
}
