import type { Metadata } from "next";
import { LaunchOperations } from "@/components/launch-operations";
export const metadata: Metadata = { title: "Launch overview · Programmable", robots: { index: false, follow: false } };
export default function LaunchOperationsPage() { return <LaunchOperations />; }
