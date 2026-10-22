import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomAIWorkspace } from "@/components/custom-ai/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Custom AI · Programmable", robots: { index: false, follow: false } };

export default function CustomAIPage() {
  const localPreview = process.env.NODE_ENV === "development" && process.env.CUSTOM_AI_LOCAL_PREVIEW === "true";
  if (!localPreview && process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") notFound();
  return <CustomAIWorkspace localPreview={localPreview} />;
}
