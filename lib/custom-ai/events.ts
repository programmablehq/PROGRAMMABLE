/** Bounded SSE reader shared by the browser and provider adapter. */
export async function* readServerEvents(response: Response, options: { allowDoneMarker?: boolean; signal?: AbortSignal; idleTimeoutMs?: number } = {}): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("The response stream is missing.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => { cleanup(); reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError")); };
        const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) { cleanup(); abort(); return; }
        if (options.idleTimeoutMs) timer = setTimeout(() => { cleanup(); reject(new Error("The response stream stopped sending updates.")); }, options.idleTimeoutMs);
        reader.read().then(result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); });
      });
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.length > 1_000_000) throw Error("The response event is too large.");
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue; // keep-alive comment
        if (options.allowDoneMarker && data === "[DONE]") { yield { type: "done" }; return; }
        const event = JSON.parse(data);
        if (!event || typeof event !== "object" || Array.isArray(event)) throw Error("Invalid response event.");
        yield event;
      }
      if (buffer.length > 1_000_000) throw Error("The response event is too large.");
      if (done) break;
    }
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
