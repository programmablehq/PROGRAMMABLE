import type { ChatMessage } from "./types";

/** Keep complete recent turns within the transport budget. Older decisions live
 * in the server-owned conversation memory and the exact saved contract. */
export function conversationWindow(messages: readonly ChatMessage[], limit = 23, characters = 22_000): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let length = 0, bytes = 0;
  const encoder = new TextEncoder();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const size = encoder.encode(JSON.stringify(message)).length;
    if (selected.length >= limit || length + message.content.length > characters || bytes + size > 46_000) break;
    selected.unshift(message);
    length += message.content.length;
    bytes += size;
  }
  while (selected[0]?.role === "assistant") selected.shift();
  return selected;
}

/** The provider emits the reply first. Only a top-level JSON string is shown;
 * source code, partial escape sequences and incomplete JSON stay off screen. */
export function partialReply(json: string): string | undefined {
  let depth = 0;
  for (let index = 0; index < json.length; index++) {
    const character = json[index];
    if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") depth--;
    else if (character === '"') {
      const start = index++;
      for (; index < json.length; index++) {
        if (json[index] === "\\") index++;
        else if (json[index] === '"') break;
      }
      if (depth !== 1 || json.slice(start, index + 1) !== '"reply"') continue;
      const rest = /^\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/s.exec(json.slice(index + 1));
      if (!rest) continue;
      let value = rest[1];
      for (let remove = 0; remove < 6; remove++) {
        try { return JSON.parse(`"${value}"`) as string; }
        catch { value = value.slice(0, -1); }
      }
    }
  }
  return undefined;
}
