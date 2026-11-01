import { describe, expect, it } from "vitest";
import { cachedGeneralProjectView, type GeneralProjectView } from "../lib/custom-ai/project-view";
import { cachedProjectOverview, overviewFromView } from "../lib/custom-ai/project-overview";
const view:GeneralProjectView={version:1,projectHash:`sha256:${"a".repeat(64)}`,artifactHash:`sha256:${"b".repeat(64)}`,chainId:999,intentRevision:"c".repeat(64),summary:"Saved source",
  compiler:{version:"0.8.26+commit.8a97fa7a",optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}],
  sourceFiles:1,sourceBytes:240,compiled:true,diagnostics:[],requirementCoverage:"proposed",verification:"not-run",launchReady:false};
describe("advisory browser source metadata",()=>{
  it("restores bounded source metadata without adopting blobs or launch authority",()=>{
    expect(cachedGeneralProjectView({...view,sources:{"Unexpected.sol":{content:"not a chat restore"}}})).toEqual(view);
    expect(cachedGeneralProjectView({...view,launchReady:true})).toBeUndefined();
    expect(cachedGeneralProjectView({...view,verification:"passed"})).toBeUndefined();
  });
  it("rejects corrupt hashes, unknown compiler/chain and oversized diagnostics without throwing",()=>{
    for(const patch of [{projectHash:"broken"},{chainId:56},{entrypoints:null},{summary:{}},{compiler:{...view.compiler,version:"latest"}},
      {diagnostics:[{severity:"error",message:"x".repeat(801)}]}])expect(cachedGeneralProjectView({...view,...patch})).toBeUndefined();
  });
  it("distinguishes a saved source without an artifact from compiler diagnostics",()=>{
    const overview=overviewFromView("saved-source-request-0001",view);
    expect(cachedProjectOverview(overview)).toEqual(overview);
    const pending={...overview,compilation:"pending",artifactHash:undefined};expect(cachedProjectOverview(pending)).toEqual(pending);
    expect(cachedProjectOverview({...pending,compilation:"diagnostics"})).toBeUndefined();
  });
});
