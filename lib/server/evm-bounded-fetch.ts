import "server-only";
import { BoundedBodyErrorV1, readBoundedUtf8BodyV1 } from "@/lib/server/custom-launch/bounded-utf8-body-v1";

/** Bound even a malformed provider response before the RPC client parses JSON. */
export async function boundedEvmFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.body) return response;
  try {
    const body = await readBoundedUtf8BodyV1(response, 2_097_152, {
      signal: init?.signal ?? undefined, timeoutMs: 10_000,
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    if (error instanceof BoundedBodyErrorV1 && error.code === "too-large") {
      throw new Error("RPC response exceeded its read limit");
    }
    throw error;
  }
}
