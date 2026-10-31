"use client";
import type { ReactNode } from "react";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { useWallet } from "@/components/wallet-provider";
import { ChatLibrary } from "./chat-library";
import styles from "./workspace.module.css";

/** Product children receive WalletContext outside the lazy SDK provider.
 * Reuse its confirmed owner without another profile request or SDK hook. */
export default function AuthenticatedChats({ account, headers, children }: { account: string; headers: AISessionHeaders; children: ReactNode }) {
  const { sessionOwner } = useWallet();
  if (!sessionOwner) return <div className={styles.libraryEmpty}><p role="status">Restoring your wallet session…</p></div>;
  return <ChatLibrary key={`${sessionOwner}:${account}`} account={account} headers={headers}>{children}</ChatLibrary>;
}
