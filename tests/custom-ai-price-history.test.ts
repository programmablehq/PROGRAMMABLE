import { describe, expect, it } from "vitest";
import { appendPriceObservation, checkedExecutionPrice } from "../ops/custom-ai-worker/price-history";
const observation = (n: number, price = "100000") => ({ blockNumber: String(n), blockHash:`0x${String(n).padStart(64,"0")}`, timestamp: n*30, sqrtPriceX96: price });
const policy={minimumObservations:3,minimumHistorySeconds:60,maxAgeSeconds:120,deviationBps:100};
describe("history-backed execution prices", () => {
  it("requires independent historical observations and rejects a single manipulated spot", () => {
    const h=[observation(1),observation(2),observation(3)];
    expect(checkedExecutionPrice(h,policy,90).sqrtPriceX96).toBe("100000");
    expect(()=>checkedExecutionPrice(h.slice(1),policy,90)).toThrow("Insufficient");
    expect(()=>checkedExecutionPrice([...h.slice(0,2),observation(3,"150000")],policy,90)).toThrow("outlier");
  });
  it("does not turn duplicate reads into history and rejects reorg conflicts", () => {
    const h=[observation(1)];expect(appendPriceObservation(h,h[0])).toHaveLength(1);
    expect(()=>appendPriceObservation(h,{...h[0],blockHash:`0x${"f".repeat(64)}`})).toThrow("reorganization");
    expect(()=>checkedExecutionPrice([observation(1),observation(2),observation(3)],policy,1000)).toThrow();
  });
});
