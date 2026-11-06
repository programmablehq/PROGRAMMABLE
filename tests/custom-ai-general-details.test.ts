import {expect,it} from "vitest";
import {EMPTY_COIN_SETUP} from "../lib/custom-ai/coin-setup";
import {generalLaunchDetailIssue,generalPresentationIssue} from "../lib/custom-ai/general-details";

const coin={...EMPTY_COIN_SETUP,name:"Example",symbol:"EX",website:"https://example.org"};
it("does not reject blank optional Robinhood publication fields",()=>{
 const plan={...coin,chainId:4663 as const};
 expect(generalLaunchDetailIssue(plan,true)).toBeNull();
 expect(generalPresentationIssue(plan,"description")).toBe("");
 expect(generalPresentationIssue(plan,"x")).toBe("");
 expect(generalLaunchDetailIssue({...plan,website:""},true)?.field).toBe("website");
});
it("keeps Graph publication fields required and validates supplied optional links",()=>{
 expect(generalLaunchDetailIssue(coin,true)?.field).toBe("description");
 expect(generalPresentationIssue(coin,"x")).not.toBe("");
 expect(generalLaunchDetailIssue({...coin,chainId:4663,description:"",x:"bad-link"},true)?.field).toBe("x");
});
