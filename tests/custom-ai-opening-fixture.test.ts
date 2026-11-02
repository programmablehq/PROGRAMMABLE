import {describe,it,expect} from "vitest";
import {openingFixtureInputs,resolveOpeningFixture,resolveOpeningFixtureValue} from "../lib/custom-ai/opening-fixture";
import {protectedSqrtPriceAtTickV1} from "../packages/launch/src/protected-opening-price.mjs";
const proposal=()=>({contracts:[{arguments:[{opening:"sqrtPriceX96"}]}],world:{kind:"v4-protected-native-token-v1",sqrtPriceX96:"from-opening-inputs",nativeUsdAnswer:"300000000000"},deployment:{openingPrice:{supply:"1000000000000000000000000000",targetFdvUsd:"15000"}}});
describe("independent synthetic opening calculations",()=>{
 it("uses the same pinned price math as launch preparation without a provider call",()=>{
  const input=proposal(),result=resolveOpeningFixture(input,8453),values=result.inputs!;
  expect(BigInt(values.fdvUsd)).toBeGreaterThanOrEqual(15000n);
  expect(BigInt(values.sqrtPriceX96)).toBe(protectedSqrtPriceAtTickV1(Number(values.tick)));
  expect((result.proposal.world as {sqrtPriceX96:string}).sqrtPriceX96).toBe(values.sqrtPriceX96);
  expect(result.proposal.contracts).toEqual([{arguments:[values.sqrtPriceX96]}]);
  expect(input.world.sqrtPriceX96).toBe("from-opening-inputs");
  expect(result.proposal.deployment).toEqual(input.deployment);
  expect(resolveOpeningFixtureValue([{opening:"tick"},{opening:"fdvUsd"}],values)).toEqual([values.tick,values.fdvUsd]);
 });
 it("keeps explicit different test prices and never silently reprices them",()=>{
  const input=proposal();input.world.sqrtPriceX96="79228162514264337593543950336";
  const result=resolveOpeningFixture(input,8453);
  expect(result.proposal).toEqual(input);expect(result.inputs).toBeUndefined();
  expect(()=>resolveOpeningFixtureValue({opening:"tick"},result.inputs)).toThrow();
 });
 it("normalizes the 18-decimal HyperEVM synthetic feed without changing the valuation",()=>{
  const input=proposal(),base=openingFixtureInputs(input,8453);input.world.nativeUsdAnswer="3000000000000000000000";
  expect(openingFixtureInputs(input,999)?.sqrtPriceX96).toBe(base?.sqrtPriceX96);
  expect(()=>resolveOpeningFixtureValue({opening:"execute"},base)).toThrow();
 });
});
