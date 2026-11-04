import { describe, expect, it } from "vitest";
import { cachedGeneralProjectView, type GeneralProjectView } from "../lib/custom-ai/project-view";
import { cachedProjectOverview, overviewFromView } from "../lib/custom-ai/project-overview";
import { GENERAL_PROJECT_LIMITS } from "../lib/custom-ai/contract-project";
const view:GeneralProjectView={version:1,projectHash:`sha256:${"a".repeat(64)}`,artifactHash:`sha256:${"b".repeat(64)}`,chainId:999,intentRevision:"c".repeat(64),summary:"Saved source",
  compiler:{version:"0.8.26+commit.8a97fa7a",optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}],
  sourceFiles:1,sourceBytes:240,compiled:true,diagnostics:[],requirementCoverage:"proposed",verification:"not-run",launchReady:false};
describe("advisory browser source metadata",()=>{
  it.each([48,49,GENERAL_PROJECT_LIMITS.files])("restores a %i-file project and recovery overview without losing local input",sourceFiles=>{
    const local={input:"Unsent local edit",project:{...view,sourceFiles}};
    const restored={...local,project:cachedGeneralProjectView(JSON.parse(JSON.stringify(local.project)))};
    expect(restored).toEqual(local);
    const overview=overviewFromView("saved-source-request-0001",restored.project!);
    expect(cachedProjectOverview(overview)).toEqual(overview);
  });
  it("retains compiler file and byte bounds during restoration",()=>{
    for(const patch of [{sourceFiles:GENERAL_PROJECT_LIMITS.files+1},{sourceBytes:GENERAL_PROJECT_LIMITS.sourceBytes+1}]){
      expect(cachedGeneralProjectView({...view,...patch})).toBeUndefined();
      expect(cachedProjectOverview({...overviewFromView("saved-source-request-0001",view),...patch})).toBeUndefined();
    }
  });
  it("restores advisory coin eligibility without promoting legacy or malformed metadata",()=>{
    const coinPreparation={eligible:false,missing:["coin-deployment"]};
    expect(cachedGeneralProjectView({...view,coinPreparation})?.coinPreparation).toEqual(coinPreparation);
    expect(cachedGeneralProjectView(view)?.coinPreparation).toBeUndefined();
    for(const invalid of [{eligible:true,missing:["coin-deployment"]},{eligible:false,missing:[]},{eligible:false,missing:["unknown"]}])
      expect(cachedGeneralProjectView({...view,coinPreparation:invalid})).toBeUndefined();
  });
  it("keeps a negative source review visible without granting launch authority",()=>{
    for(const sourceReview of ["passed","changes_required"] as const){
      const result=cachedGeneralProjectView({...view,sourceReview});
      expect(result?.sourceReview).toBe(sourceReview);expect(result?.launchReady).toBe(false);
    }
    expect(cachedGeneralProjectView({...view,sourceReview:"approved"})).toBeUndefined();
  });
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
