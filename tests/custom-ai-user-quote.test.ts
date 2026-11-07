import {expect,it} from "vitest";
import {literalUserQuote} from "../lib/custom-ai/user-quote";

it("preserves exact source offsets after non-BMP characters",()=>{
  expect(literalUserQuote("use base now","A note 🔥: Use Base now, please.")).toBe("Use Base now");
});
it("never repairs changed economics or omitted economic constraints",()=>{
  expect(literalUserQuote("Use a 5% fee","Use a 2% fee")).toBeUndefined();
  expect(literalUserQuote("Use Base. Keep the fee.","Use Base. Do not increase the fee. Keep the fee.")).toBeUndefined();
});
