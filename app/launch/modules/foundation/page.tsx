import type { Metadata } from "next";
import { ModuleFoundationLaunchHost } from "@/components/module-foundation-launch-host";

export const metadata: Metadata = { title: "Launch a Coin · Programmable", description: "Create a fixed-supply coin with a Uniswap v4 pool and optional reviewed modules." };
export default function FoundationLaunchPage() { return <ModuleFoundationLaunchHost />; }
