import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runCustomAI } from "../lib/custom-ai/service.server";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { createLaunchProductionContext } from "../lib/custom-ai/launch-production";
import { configuredProvider } from "../lib/custom-ai/provider-config.server";

const production=createLaunchProductionContext({version:1,chainId:1,route:"graph-v3",profileVersion:"3.6.0",graphProfile:{},manifestDigest:null,
  poolManager:{address:`0x${"1".repeat(40)}`,runtimeCodeHash:`0x${"2".repeat(64)}`},executor:{address:`0x${"3".repeat(40)}`,runtimeCodeHash:`0x${"4".repeat(64)}`},
  tradeFee:{policyVersion:"test.v1",ratePpm:3000,recipient:`0x${"5".repeat(40)}`,collection:"programmable-routed-native"},protections:null});
const plan=(rules:unknown[]=[],reply="The weather rule needs an external feed.")=>({reply,replyLocale:"en",action:"answer",intentMode:"revise",executionRoute:"custom-contract",intentRequirements:rules,
  setupPatch:{},lookups:[],productPlan:null,ruleEdits:[],memory:""});
const rule=(id:string,text:string,open:string|null=null)=>({id,text,open,kind:"behavior",instruction:""});
const response=(value:unknown)=>({text:JSON.stringify(value),inputTokens:1,outputTokens:1});
const request=(content:string)=>({id:"complete-design-request-001",intent:"chat" as const,coin:EMPTY_COIN_SETUP,messages:[{role:"user" as const,content}]});

describe("complete discussion proposals",()=>{
  const weather="Nur besprechen, noch nichts bauen: Die Gesamtgebühr soll bei Regen in London 2 % betragen, sonst das Plattformminimum. Wetterdaten täglich aktualisieren. Was fehlt?";
  it("uses the stronger planning role with strict local JSON validation",async()=>{
    const call=vi.fn().mockResolvedValue(response(plan([rule("fee","Total fee is 2%.")])));
    await runCustomAI(request("Nur besprechen: Plane einen Coin mit 2 % Gesamtgebühr."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(call.mock.calls[0][0]).toMatchObject({task:"planning",model:configuredProvider().models.build,effort:"medium",structuredTransport:"json-object"});
  });
  it("repairs an empty normal answer before accepting a concrete proposal",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response(plan())).mockResolvedValue(response(plan([
      rule("weather","Total fee is 2% during London rain; otherwise the platform minimum.","A weather feed is required."),
      rule("daily","Refresh weather once per day."),
    ])));
    const value=await runCustomAI(request(weather),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(call).toHaveBeenCalledTimes(2);
    expect(value.intent?.requirements).toHaveLength(2);
    expect(value.unresolved).toEqual(["A weather feed is required."]);
  });
  it("never accepts a second empty answer as a saved proposal",async()=>{
    const call=vi.fn().mockResolvedValue(response(plan()));
    await expect(runCustomAI(request(weather),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production})).rejects.toMatchObject({code:"plan-policy"});
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("keeps a purely informational question free of invented requirements",async()=>{
    const call=vi.fn().mockResolvedValue(response(plan([],"The platform fee on this route is 0.3%.")));
    const value=await runCustomAI(request("Nur besprechen: Wie hoch ist die Plattformgebühr?"),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(call).toHaveBeenCalledOnce();expect(value.intent).toBeUndefined();
  });
  it("records a concrete coin brief without requiring an imperative planning verb",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response(plan())).mockResolvedValue(response(plan([rule("fee","Total fee starts at 2% and falls over 24 hours.")])));
    const value=await runCustomAI(request("Nur besprechen, noch nichts bauen: Ein Coin auf Ethereum, Gesamtgebühr 2 %, linear über 24 Stunden bis zum Minimum."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(call).toHaveBeenCalledTimes(2);expect(value.intent?.requirements).toHaveLength(1);
  });
});

describe("already settled fee questions",()=>{
  it("does not reopen total versus project after an explicit total-fee request",async()=>{
    const question="Bestätigen, ob 2 % Gesamt- oder Zusatzgebühr gemeint sind.";
    const call=vi.fn().mockResolvedValue(response(plan([rule("fee","Die Gesamtgebühr startet bei 2 % inklusive Plattformanteil.",question)],
      "Die Gesamtgebühr startet bei 2 %. Offen ist nur, ob 2 % Gesamt- oder Zusatzgebühr gemeint sind.")));
    const value=await runCustomAI(request("Nur besprechen: Die normale Gesamtgebühr soll bei 2 % starten. Noch nichts bauen."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(value.intent?.requirements[0].open).toBeNull();expect(value.unresolved).toBeUndefined();
    expect(value.reply).not.toContain("Offen ist");expect(call).toHaveBeenCalledOnce();
  });
  it("does not turn equal terminal total/project amounts into a choice",async()=>{
    const question="Soll die Gesamtgebühr bei 0,3 % bleiben oder die Projektgebühr auf 0 % fallen?";
    const call=vi.fn().mockResolvedValue(response(plan([rule("fee","Die Gesamtgebühr fällt auf das Plattformminimum von 0,3 %.",question)],
      `Die Gesamtgebühr fällt auf 0,3 %. ${question}`)));
    const value=await runCustomAI(request("Nur besprechen: Die Gesamtgebühr soll von 2 % auf das Plattformminimum fallen."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(value.intent?.requirements[0].open).toBeNull();expect(value.reply).not.toContain("Soll die");
  });
  it("preserves a real unresolved choice between different total rates",async()=>{
    const question="Soll die Gesamtgebühr bei 1 % oder 2 % starten?";
    const call=vi.fn().mockResolvedValue(response(plan([rule("fee","Choose the starting total fee.",question)],question)));
    const value=await runCustomAI(request("Nur besprechen: Plane einen Coin mit einer sinkenden Gesamtgebühr."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(value.intent?.requirements[0].open).toBe(question);expect(value.reply).toBe(question);
  });
  it("does not invent a later phase after the requested ramp reaches its endpoint",async()=>{
    const question="Soll die Gebühr nach 24 Stunden bei 0,3 % bleiben oder weiter verändert werden?";
    const call=vi.fn().mockResolvedValue(response(plan([rule("fee","Total fee falls linearly to 0.3% over 24 hours.",question)],`Die Gebühr fällt auf 0,3 %. ${question}`)));
    const value=await runCustomAI(request("Nur besprechen: Plane eine Gesamtgebühr von 2 %, die linear über 24 Stunden auf das Plattformminimum fällt."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(value.unresolved).toBeUndefined();expect(value.intent?.requirements[0].open).toBeNull();
  });
  it("keeps unset launch form details out of a first discussion's economic choices",async()=>{
    const call=vi.fn().mockResolvedValue(response(plan([
      rule("fee","Total fee starts at 2%."),
      {...rule("metadata","Coin name, ticker and initial buy amount are not yet chosen.","Name, ticker and initial buy amount are needed before launch."),kind:"decision"},
    ])));
    const value=await runCustomAI(request("Discuss first, no build yet: plan a coin with a 2% total fee."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(value.intent?.requirements).toHaveLength(1);expect(value.unresolved).toBeUndefined();expect(value.change).toBe("applied");
  });
  it("retains a real contract rule even when its open question is a name",async()=>{
    const call=vi.fn().mockResolvedValue(response(plan([rule("metadata","The token name must never be mutable after deployment.","Choose the coin name.")])));
    const value=await runCustomAI(request("Discuss first, no build yet: plan a coin whose metadata cannot be changed."),undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
    expect(value.intent?.requirements).toHaveLength(1);expect(value.intent?.requirements[0].text).toContain("never be mutable");
  });
});
