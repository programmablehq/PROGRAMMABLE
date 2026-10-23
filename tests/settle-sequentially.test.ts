import { describe, expect, it } from "vitest";
import { settleSequentially } from "../lib/settle-sequentially";

describe("settleSequentially", () => {
  it("keeps one read in flight and preserves successful and failed results", async () => {
    let active = 0;
    let maximumActive = 0;

    const results = await settleSequentially(["first", "second", "third"], async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (value === "second") throw new Error("temporary upstream failure");
      return value.toUpperCase();
    });

    expect(maximumActive).toBe(1);
    expect(results).toEqual([
      { status: "fulfilled", value: "FIRST" },
      { status: "rejected", reason: expect.any(Error) },
      { status: "fulfilled", value: "THIRD" },
    ]);
  });
});
