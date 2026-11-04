import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneralProjectView } from "../lib/custom-ai/project-view";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";

const mock = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], prepare: vi.fn(), submit: vi.fn() }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { mock.effects.push(effect); },
}));
vi.mock("../components/custom-ai/use-general-launch", () => ({ useGeneralLaunch: () => ({
  loaded: true, locked: false, busy: false, phase: "idle", preparation: null,
  prepare: mock.prepare, submit: mock.submit,
}) }));
import { GeneralLaunchControls } from "../components/custom-ai/general-launch-controls";

const intent: LaunchIntent = {version:1,id:"test-coin-intent",revision:"c".repeat(64),changes:[],unresolved:[],requirements:[]};
const project: GeneralProjectView = {
  version:1,projectHash:`sha256:${"a".repeat(64)}`,artifactHash:`sha256:${"b".repeat(64)}`,chainId:1,
  intentRevision:intent.revision,summary:"Saved source",compiler:{version:"0.8.26+commit.8a97fa7a",optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},
  entrypoints:[{source:"Marker.sol",contract:"Marker",role:"auxiliary"}],sourceFiles:1,sourceBytes:240,
  compiled:true,sourceReview:"passed",diagnostics:[],requirementCoverage:"proposed",verification:"not-run",launchReady:false,
  scenarios:{passed:true} as GeneralProjectView["scenarios"],
  coinPreparation:{eligible:false,missing:["coin-deployment"]},
};
function render(value: GeneralProjectView) {
  const html=renderToStaticMarkup(<GeneralLaunchControls enabled account={`0x${"11".repeat(20)}`}
    conversationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" scope="test" headers={async()=>({})}
    project={value} intent={intent} draftId="test-source-launch-0001"
    settings={{...EMPTY_COIN_SETUP,chainId:1,name:"Example",symbol:"EX",description:"Example coin with a saved source declaration.",website:"https://example.com",
      x:"https://x.com/example",socialPost:"https://x.com/example/status/123456789"}} imageId={"d".repeat(64)}
    disabled={false} editor={{current:null}} flush={async()=>({revision:1})} onLaunchLocked={()=>{}} />);
  const cleanups=mock.effects.splice(0).map(effect=>effect());
  vi.advanceTimersByTime(601);
  cleanups.forEach(cleanup=>cleanup?.());
  return html;
}
afterEach(()=>{mock.effects=[];vi.clearAllMocks();vi.useRealTimers();});
describe("coin preparation controls",()=>{
  it("does not offer Launch coin or auto-prepare an auxiliary source",()=>{
    vi.useFakeTimers();const html=render(project);
    expect(html).not.toContain("Launch coin");expect(html).toContain("Source saved");
    expect(mock.prepare).not.toHaveBeenCalled();expect(mock.submit).not.toHaveBeenCalled();
  });
  it("requires server eligibility and a passed source review before preparing",()=>{
    vi.useFakeTimers();
    const cases:GeneralProjectView[]=[{...project,coinPreparation:undefined},{...project,coinPreparation:{eligible:true,missing:[]},sourceReview:undefined}];
    for(const value of cases){
      expect(render(value)).not.toContain("Launch coin");
    }
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("offers preparation for a server-validated coin",()=>{
    vi.useFakeTimers();
    const html=render({...project,coinPreparation:{eligible:true,missing:[]},entrypoints:[
      {source:"Token.sol",contract:"Token",role:"token"},{source:"Hook.sol",contract:"Hook",role:"hook"},
      {source:"Initializer.sol",contract:"Initializer",role:"liquidity"},
    ]});
    expect(html).toContain("Launch coin");expect(mock.prepare).toHaveBeenCalledOnce();
    expect(mock.submit).not.toHaveBeenCalled();
  });
});
