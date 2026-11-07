import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomAIWorkspace } from "@/components/custom-ai/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Chat · Programmable",
  description: process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED === "true"
    ? "Build and review a custom hook, then prepare its launch on Ethereum, Robinhood, Base or HyperEVM."
    : "Describe your coin's fee rules, review its hook and launch on Ethereum or Robinhood.",
  alternates: { canonical: "/launch/custom-ai" } };

export default function CustomAIPage() {
  const localPreview = process.env.NODE_ENV === "development" && process.env.CUSTOM_AI_LOCAL_PREVIEW === "true";
  if (!localPreview && process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") notFound();
  return <CustomAIWorkspace localPreview={localPreview} generalLaunchEnabled={process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED === "true"} platformEnabled={process.env.CUSTOM_AI_PLATFORM_ENABLED === "true"} />;
}
