"use client";
import type { ReactNode } from "react";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { useWallet } from "@/components/wallet-provider";
import { ChatLibrary } from "./chat-library";
import { SessionLoading } from "./session-loading";

/** Product children receive WalletContext outside the lazy SDK provider.
 * Reuse its confirmed owner without another profile request or SDK hook. */
export default function AuthenticatedChats({ account, headers, initialConversationId, children }: { account: string; headers: AISessionHeaders; initialConversationId?: string; children: ReactNode }) {
  const { sessionOwner, openWallet } = useWallet();
  if (!sessionOwner) return <SessionLoading onReconnect={openWallet}/>;
  return <ChatLibrary key={`${sessionOwner}:${account}`} account={account} headers={headers} initialConversationId={initialConversationId}>{children}</ChatLibrary>;
}
