import "server-only";

/** Bound even a malformed provider response before the RPC client parses JSON. */
export async function boundedEvmFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2_097_152) {
        await reader.cancel();
        throw new Error("RPC response exceeded its read limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
}
