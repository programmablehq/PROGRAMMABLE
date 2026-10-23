/** Bounded SSE reader shared by the browser and provider adapter. */
export async function* readServerEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("The response stream is missing.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.length > 1_000_000) throw Error("The response event is too large.");
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue; // keep-alive comment
        const event = JSON.parse(data);
        if (!event || typeof event !== "object" || Array.isArray(event)) throw Error("Invalid response event.");
        yield event;
      }
      if (buffer.length > 1_000_000) throw Error("The response event is too large.");
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
