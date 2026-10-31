"use client";
import { usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { ChatLibrary } from "./chat-library";
import styles from "./workspace.module.css";

/** Loaded only after the existing wallet session is ready. Reading this SDK
 * context makes principal changes reactive without another profile request. */
export default function AuthenticatedChats({ account, headers, children }: { account: string; headers: AISessionHeaders; children: ReactNode }) {
  const { user } = usePrivy();
  if (!user?.id) return <div className={styles.libraryEmpty}><p role="status">Restoring your wallet session…</p></div>;
  return <ChatLibrary key={`${user.id}:${account}`} account={account} headers={headers}>{children}</ChatLibrary>;
}
