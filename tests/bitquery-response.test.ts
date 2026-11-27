import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readBoundedBitqueryResponseText,
} from "../lib/market-data/bitquery-response.server";

function responseFromChunks(
  chunks: readonly Uint8Array[],
  init?: ResponseInit,
) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), init);
}

describe("bounded Bitquery response reader", () => {
  it("accepts a response exactly at the byte limit", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcd"));
        controller.close();
      },
    });
    const response = new Response(body, {
      headers: { "content-length": "4" },
    });

    await expect(readBoundedBitqueryResponseText(response, 4)).resolves.toBe(
      "abcd",
    );
    expect(body.locked).toBe(false);
  });

  it("cancels a chunked response when it crosses the byte limit", async () => {
    let canceled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(2));
      },
      cancel() {
        canceled = true;
      },
    });

    await expect(readBoundedBitqueryResponseText(new Response(body), 4))
      .rejects.toMatchObject({
        name: "BitqueryResponseBodyError",
        kind: "too-large",
      });
    expect(canceled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("cancels a declared oversized response before reading it", async () => {
    let canceled = false;
    const body = new ReadableStream({
      cancel() {
        canceled = true;
      },
    });

    await expect(readBoundedBitqueryResponseText(new Response(body, {
      headers: { "content-length": "5" },
    }), 4)).rejects.toMatchObject({ kind: "too-large" });
    expect(canceled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("rejects malformed declared lengths", async () => {
    const response = responseFromChunks([new Uint8Array(0)], {
      headers: { "content-length": "4x" },
    });

    await expect(readBoundedBitqueryResponseText(response, 4))
      .rejects.toMatchObject({ kind: "too-large" });
  });

  it("rejects invalid UTF-8 and releases the stream lock", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xc3, 0x28));
        controller.close();
      },
    });
    const response = new Response(body);

    await expect(readBoundedBitqueryResponseText(response, 4))
      .rejects.toMatchObject({ kind: "invalid-body" });
    expect(body.locked).toBe(false);
  });

  it("rejects a response without a readable body", async () => {
    await expect(readBoundedBitqueryResponseText(new Response(null), 4))
      .rejects.toMatchObject({
        name: "BitqueryResponseBodyError",
        kind: "unavailable",
      });
  });
});
