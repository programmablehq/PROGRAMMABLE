import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomAIWorkspace } from "@/components/custom-ai/workspace";
import {projectPlatformRollout} from "@/lib/custom-ai/platform/rollout.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Chat · Programmable",
  description: "Build custom hooks, apps and connected projects. Keep your source, review the results and prepare a launch on a supported network.",
  alternates: { canonical: "/launch/custom-ai" } };

export default function CustomAIPage() {
  const localPreview = process.env.NODE_ENV === "development" && process.env.CUSTOM_AI_LOCAL_PREVIEW === "true";
  if (!localPreview && process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") notFound();
  return <CustomAIWorkspace localPreview={localPreview} generalLaunchEnabled={process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED === "true"} platformEnabled={projectPlatformRollout()!==null} />;
}
