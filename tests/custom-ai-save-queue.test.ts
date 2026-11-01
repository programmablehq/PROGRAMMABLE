import { describe, expect, it } from "vitest";
import { createLatestSaveQueue } from "../lib/custom-ai/latest-save-queue";

describe("draft writes on a slow connection", () => {
  it("finishes the active write and saves only the newest of 100 waiting edits", async () => {
    const queue = createLatestSaveQueue(), written: number[] = [];
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const first = queue.enqueue(async () => { written.push(0); await delayed; });
    await Promise.resolve(); await Promise.resolve();
    for (let value = 1; value <= 100; value++) void queue.enqueue(async () => { written.push(value); });
    release(); await first; await queue.idle();
    expect(written).toEqual([0, 100]);
  });

  it("drops a pending snapshot when newer edits have not reached the debounce yet", async () => {
    const queue = createLatestSaveQueue(), written: string[] = [];
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    void queue.enqueue(async () => { written.push("active"); await delayed; });
    await Promise.resolve(); await Promise.resolve();
    void queue.enqueue(async () => { written.push("obsolete"); });
    queue.invalidate(); release(); await queue.idle();
    await queue.enqueue(async () => { written.push("latest"); });
    expect(written).toEqual(["active", "latest"]);
  });

  it("lets a later save recover after a reported failure", async () => {
    const queue = createLatestSaveQueue(), written: string[] = [];
    await expect(queue.enqueue(async () => { throw Error("Offline"); })).rejects.toThrow("Offline");
    await queue.enqueue(async () => { written.push("recovered"); });
    expect(written).toEqual(["recovered"]);
  });
});
