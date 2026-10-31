import { parseChatRequest } from "./types";

/** Only the prompt explicitly submitted in this tab crosses sign-in. This
 * object is never a browser-cache migration or permission to run inference. */
export type PromptHandoff = {
  id: string;
  content: string;
  createdAt: number;
  principal?: string;
  account?: string;
};

const lifetime = 15 * 60_000;

export function createPromptHandoff(content: string, now = Date.now()): PromptHandoff {
  const id = crypto.randomUUID();
  const request = parseChatRequest({ id, intent: "chat", messages: [{ role: "user", content: content.trim() }] });
  return { id, content: request.messages[0].content, createdAt: now };
}

/** First confirmed product identity owns the handoff. Switching either the
 * account or its linked wallet discards it, even in the same browser tab. */
export function bindPromptHandoff(prompt: PromptHandoff, principal: string, account: string, now = Date.now()): PromptHandoff | undefined {
  if (!principal || !/^0x[0-9a-f]{40}$/i.test(account) || now < prompt.createdAt || now - prompt.createdAt >= lifetime) return;
  const wallet = account.toLowerCase();
  if (prompt.principal) return prompt.principal === principal && prompt.account === wallet ? prompt : undefined;
  return { ...prompt, principal, account: wallet };
}
