import { describe, it, expect } from "vitest";
import { EMPTY_COIN_SETUP, applyCoinSetupPatch, coinPresentationIssue, parseCoinSetupPatch } from "../lib/custom-ai/coin-setup";
import { generalLaunchDetailIssue } from "../lib/custom-ai/general-details";
import { sameGeneralEditor, type GeneralPreparationView } from "../lib/custom-ai/general-preparation";
const settings = {...EMPTY_COIN_SETUP,name:"Example",symbol:"EX",description:"A coin with a transparent fee allocation.",website:"https://example.org",x:"https://x.com/example",socialPost:"https://x.com/example/status/123"};
describe("separate public post metadata",()=>{
 it("preserves the exact post and the separately supplied profile",()=>{
  const patch=parseCoinSetupPatch({socialPost:settings.socialPost});
  expect(applyCoinSetupPatch(settings,patch)).toMatchObject({x:settings.x,socialPost:settings.socialPost});
  expect(generalLaunchDetailIssue(settings,true)).toBeNull();
 });
 it("does not disguise a post as the required profile or accept unsafe links",()=>{
  expect(coinPresentationIssue({...settings,x:settings.socialPost},"x")).not.toBe("");
  for(const socialPost of ["javascript:alert(1)","https://user:pass@x.com/example/status/123","https://x.com/example","https://example.org/not-a-post"])
    expect(coinPresentationIssue({...settings,socialPost},"socialPost")).not.toBe("");
  expect(coinPresentationIssue({...settings,socialPost:""},"socialPost")).toBe("");
 });
 it("invalidates the prepared metadata when only the post changes",()=>{
  const saved={editor:{settings,imageId:"image"}} as GeneralPreparationView;
  expect(sameGeneralEditor(saved,settings,"image")).toBe(true);
  expect(sameGeneralEditor(saved,{...settings,socialPost:"https://x.com/example/status/456"},"image")).toBe(false);
 });
});
