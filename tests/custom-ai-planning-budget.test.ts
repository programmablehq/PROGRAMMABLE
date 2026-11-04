import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {runCustomAI} from "../lib/custom-ai/service.server";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";
import {designOnlyRequest} from "../lib/custom-ai/build-command";
import {prepareSurplusSchema} from "../lib/custom-ai/surplus-schema.server";
import {callSurplus} from "../lib/custom-ai/surplus.server";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

const content="Design a coin called River (RIV) on Ethereum. Split collected project fees: 30% into liquidity, 30% into an equal-claim pool for eligible holders, and 40% into a reserve vault. Holders become eligible after holding for one day; use daily snapshots and one claim per wallet per day. Keep mandatory platform fees separate. Any rounding stays in the reserve. I only want to shape the design now, not build or launch it. Propose the complete product, including anything needed offchain, and ask only for decisions that affect how it works.";
describe("planning request size",()=>{
  it("respects an explicit design-only instruction without treating quotations as a command",()=>{
    const request=(content:string)=>({intent:"chat" as const,messages:[{role:"user" as const,content}]});
    expect(designOnlyRequest(request(content))).toBe(true);
    expect(designOnlyRequest(request("Erstmal besprechen, noch nicht bauen."))).toBe(true);
    expect(designOnlyRequest(request('Explain this text: "Do not build yet"'))).toBe(false);
    expect(designOnlyRequest(request("Build the complete saved design now."))).toBe(false);
    expect(designOnlyRequest(request("Build a hook, but do not build a separate vault."))).toBe(false);
    expect(designOnlyRequest(request("Build it without building a separate backend."))).toBe(false);
    expect(designOnlyRequest(request("Don't just plan it, build the coin."))).toBe(false);
  });
  it("captures the real first design envelope without a model or network request",async()=>{
    let captured:ClaudeInput|undefined;
    const call=vi.fn(async(input:ClaudeInput)=>{captured=input;throw Error("captured");});
    await expect(runCustomAI({id:"planning-budget-00001",intent:"chat",messages:[{role:"user",content}]},undefined,
      {call,compile:vi.fn()},{owner:"owned-test",dataAdapters:{owner:"owned-test",create:vi.fn(),read:vi.fn(),list:vi.fn()} as never})).rejects.toThrow("captured");
    expect(call).toHaveBeenCalledOnce();expect(captured?.task).toBe("planning");
    expect(captured!.system.length+JSON.stringify(captured!.schema).length).toBeLessThan(36000);
    expect(captured!.effort).toBe("low");
    expect(captured!.structuredTransport).toBeUndefined();
    expect(captured!.system).toContain("one complete JSON object");
    const properties=(captured!.schema as {properties:Record<string,unknown>}).properties;
    expect(properties.action).toEqual({type:"string",enum:["answer","clarify"]});
    expect(properties).not.toHaveProperty("feeChecks");expect(properties).not.toHaveProperty("composable");
    expect(captured!.maxTokens).toBe(8000);
    expect(()=>prepareSurplusSchema(captured!.schema,true).decode("River splits fees between liquidity, holders and reserves.")).toThrow();

  });
  it("keeps the entire proposed product and applies metadata without compiling source",async()=>{
    const compile=vi.fn(),requirements=[{id:"split",text:"30% liquidity, 30% holder rewards and 40% reserve; rounding stays in reserve",kind:"behavior",instruction:"",open:null},
      {id:"holders",text:"Daily snapshots; held for one day; equal rewards and one claim per day",kind:"behavior",instruction:"",open:null}];
    const productPlan={components:[
      {id:"reserve",kind:"vault",name:"Reserve",purpose:"Receive project fees and retain the reserve share",requirementIds:["split"],dependsOn:[]},
      {id:"liquidity",kind:"vault",name:"Liquidity",purpose:"Add the liquidity share",requirementIds:["split"],dependsOn:["reserve"]},
      {id:"rewards",kind:"vault",name:"Holder rewards",purpose:"Record daily eligible claims",requirementIds:["holders"],dependsOn:["reserve"]}],
      assets:[{id:"eth",kind:"native",name:"ETH"}],flows:[
        {id:"collect",source:"trader",target:"reserve",asset:"eth",trigger:"swap",purpose:"Collect project fees",requirementIds:["split"],allocationGroup:null,shareBps:null},
        ...[["lp","liquidity",3000],["holders","rewards",3000],["keep","reserve",4000]].map(([id,target,shareBps])=>({id,source:"reserve",target,asset:"eth",trigger:"swap",purpose:"Split collected fees",requirementIds:["split"],allocationGroup:"fees",shareBps}))],
      services:[],interfaceActions:[{id:"claim",target:"rewards",kind:"claim",requirementIds:["holders"]}]};
    const call=vi.fn(async(input:ClaudeInput)=>{
      const value={reply:"River keeps a reserve and pays eligible holders daily. We can settle the snapshot mechanism before building.",replyLocale:"en",executionRoute:"custom-contract",intentMode:"revise",intentRequirements:requirements,
        productPlan,ruleEdits:[],action:"answer",memory:"River. Design only.",launchRequested:false,reviseChecks:false,
        setupPatch:{name:"River",symbol:"RIV",chainId:1,pairToken:null,initialBuy:null,description:null,website:null,x:null,socialPost:null},lookups:[]};
      vi.stubEnv("SURPLUS_API_KEY","synthetic-test-only");
      const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{
        const wire=JSON.parse(String(options?.body));
        expect(wire.response_format).toMatchObject({type:"json_schema",json_schema:{strict:true}});
        expect(wire.messages[0].content).toContain("one complete JSON object");
        return Response.json({choices:[{message:{content:JSON.stringify(value)},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1}});
      });
      vi.stubGlobal("fetch",fetcher);
      const reply=await callSurplus(input);expect(fetcher).toHaveBeenCalledOnce();return reply;
    });
    const result=await runCustomAI({id:"planning-product-00001",intent:"chat",messages:[{role:"user",content}]},undefined,{call,compile});
    expect(result.productBlueprint?.components).toHaveLength(3);expect(result.productBlueprint?.flows).toHaveLength(4);
    expect(result.intent?.requirements.map(rule=>rule.id)).toEqual(["split","holders"]);
    expect(result.intent?.requirements.every(rule=>rule.origin.kind==="message"&&rule.origin.quote===content)).toBe(true);
    expect(result.setupPatch).toMatchObject({name:"River",symbol:"RIV"});expect(result.generalProject).toBeUndefined();expect(result.draft).toBeUndefined();
    expect(compile).not.toHaveBeenCalled();expect(call).toHaveBeenCalledOnce();
  });
});
