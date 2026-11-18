import { getAddress } from "viem";
import { confirmFoundationLaunch, type ConfirmedLaunchRequest } from "@/lib/server/module-foundation/confirmed-launch";
import { findRecentFoundationLaunch, saveRecentFoundationLaunch } from "@/lib/server/module-foundation/recent-launch-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const requests = new Map<string, { expires: number; value: Promise<void> }>();
let windowStarted = 0, count = 0, active = 0;
const retrySeconds = 15;
const response = (status: number) => Response.json({ status: status === 200 ? "confirmed" : "pending" },
  { status, headers: { "cache-control": "no-store", ...(status === 503 ? { "retry-after": String(retrySeconds) } : {}) } });

async function record(input: ConfirmedLaunchRequest) {
  // Survives server restarts and page reloads. The stored receipt's block is
  // rechecked, but a repeated hint need not repeat every pool/metadata read.
  const existing = await findRecentFoundationLaunch(input.chainId, input.token).catch(() => null);
  if (existing?.row.transactionHash.toLowerCase() === input.transactionHash) return;
  let phase: "verify-receipt" | "save-confirmation" = "verify-receipt";
  try {
    const launch = await confirmFoundationLaunch(input);
    phase = "save-confirmation";
    await saveRecentFoundationLaunch(launch);
  } catch (error) {
    console.warn("module-foundation-confirmation-pending", { chainId: input.chainId, phase });
    throw error;
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return response(403);
  if (Number(request.headers.get("content-length") || 0) > 512 || !request.body) return response(400);
  const reader = request.body.getReader(); let raw = "", size = 0;
  try {
    const decoder = new TextDecoder();
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 512) return response(400);
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  let input: ConfirmedLaunchRequest;
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(",") !== "chainId,token,transactionHash"
      || (value.chainId !== 1 && value.chainId !== 4663) || !/^0x[\da-f]{64}$/i.test(value.transactionHash)
      || !/^0x[\da-f]{40}$/i.test(value.token)) return response(400);
    input = { chainId: value.chainId, transactionHash: value.transactionHash.toLowerCase(), token: getAddress(value.token) };
  } catch { return response(400); }
  const key = `${input.chainId}:${input.token}:${input.transactionHash}`;
  let saved = requests.get(key);
  if (!saved || saved.expires <= Date.now()) {
    if (Date.now() - windowStarted >= 60_000) { windowStarted = Date.now(); count = 0; }
    if (active >= 4 || count >= 20) return response(429);
    count++; active++;
    const value = record(input).finally(() => { active--; });
    saved = { expires: Date.now() + 60 * 60_000, value };
    if (requests.size >= 128) requests.delete(requests.keys().next().value!);
    requests.set(key, saved);
    const entry = saved;
    void value.catch(() => { if (requests.get(key) === entry) entry.expires = Date.now() + retrySeconds * 1_000; });
  }
  try { await saved.value; return response(200); }
  catch { return response(503); }
}
