"use client";
import type { ReactNode } from "react";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { useWallet } from "@/components/wallet-provider";
import { ChatLibrary } from "./chat-library";
import { SessionLoading } from "./session-loading";

/** Product children receive WalletContext outside the lazy SDK provider.
 * Reuse its confirmed owner without another profile request or SDK hook. */
export default function AuthenticatedChats({ account, headers, initialConversationId, existingConversationId, onSelected, registerBeforeLeave, embedded, children }: { account: string; headers: AISessionHeaders; initialConversationId?: string; existingConversationId?: string; onSelected?:(id:string)=>void; registerBeforeLeave?:(leave:(()=>Promise<void>)|undefined)=>void; embedded?:boolean; children: ReactNode }) {
  const { sessionOwner, openWallet } = useWallet();
  if (!sessionOwner) return <SessionLoading onReconnect={openWallet}/>;
  return <ChatLibrary key={`${sessionOwner}:${account}`} account={account} headers={headers} initialConversationId={initialConversationId} existingConversationId={existingConversationId} onSelected={onSelected} registerBeforeLeave={registerBeforeLeave} embedded={embedded}>{children}</ChatLibrary>;
}
