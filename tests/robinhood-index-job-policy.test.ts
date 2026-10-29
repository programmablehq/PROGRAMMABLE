import { describe, expect, it } from "vitest";
import { indexFailureDetails, selectIndexLanes } from "@/lib/server/robinhood-index/job-policy";

describe("bounded Robinhood source scheduling", () => {
  const lanes = Array.from({ length: 9 }, (_, i) => ({ releaseDigest: `release-${i}` }));
  it("a permanently failing oldest source cannot starve the other generations", () => {
    const observed = new Set<string>();
    for (let minute = 0; minute < 4; minute++) {
      const selected = selectIndexLanes(lanes, 3, minute * 60_000);
      expect(selected).toHaveLength(3);
      expect(new Set(selected).size).toBe(3);
      expect(selected[0]).toBe(lanes[0]);
      selected.forEach(lane => observed.add(lane.releaseDigest));
    }
    expect(observed.size).toBe(lanes.length);
  });
  it("rotates every source when only one slot is affordable", () => {
    const selected = lanes.map((_, minute) => selectIndexLanes(lanes, 1, minute * 60_000)[0]);
    expect(new Set(selected).size).toBe(lanes.length);
  });
  it("does not add work to small inventories or change the supplied order", () => {
    expect(selectIndexLanes(lanes.slice(0, 2), 3, 0)).toEqual(lanes.slice(0, 2));
    expect(selectIndexLanes([], 3, 0)).toEqual([]);
    expect(selectIndexLanes(lanes, 0, 0)).toEqual([]);
    expect(lanes[0].releaseDigest).toBe("release-0");
  });
});

describe("safe provider diagnostics", () => {
  it("keeps useful nested transport details without credentials or request data", () => {
    const error = Object.assign(new Error("secret response text"), { name: "HttpRequestError", cause: {
      status: 429, code: -32005, url: "https://robinhood-mainnet.g.alchemy.com/v2/private-key?token=secret",
      body: "private request", headers: { authorization: "secret" },
    } });
    expect(indexFailureDetails(error)).toEqual({ errorName: "HttpRequestError", httpStatus: 429, rpcCode: -32005,
      providerHost: "robinhood-mainnet.g.alchemy.com" });
    expect(JSON.stringify(indexFailureDetails(error))).not.toMatch(/secret|private/);
  });
  it("bounds cyclic errors and omits untrusted hosts and arbitrary text", () => {
    const error = { cause: null as unknown, url: "https://secret.attacker.invalid/", status: "secret", code: "secret" };
    error.cause = error;
    expect(indexFailureDetails(error)).toEqual({ errorName: "unknown" });
  });
});
