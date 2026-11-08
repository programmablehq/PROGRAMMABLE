import Ajv from "ajv";
import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {gameEventTools} from "../lib/custom-ai/platform/event-tools.server";
import type {ToolContext} from "../lib/custom-ai/platform/agent.server";

const config={gameId:"maze",chainId:4663,issuer:"0x1111111111111111111111111111111111111111",maxAge:300,maximumScore:"1"};
const context={ownerId:"fixture-owner-a",projectId:"11111111-1111-4111-8111-111111111111",revision:{revisionId:`sha256:${"a".repeat(64)}`}} as ToolContext;
// Fixed independently from the canonical v1 JSON fields, rather than from the tool under test.
const expected="0xd3c1f6fb51d417a1c9bee301992782de379908d4608e8d8374111cf4a4401091";
function fixture(){
 const events={list:vi.fn(),ingest:vi.fn()};
 const tool=gameEventTools(events as never).find(item=>item.id==="event.identity");
 expect(tool,"A project must be able to plan its binding before deploying a receiver").toBeDefined();
 return {tool:tool!,events};
}
describe("normal project game identity planning",()=>{
 it("returns the owner-bound canonical identity without registering a receiver",async()=>{
  const {tool,events}=fixture();
  const result=await tool.execute(context,config);
  expect(result).toEqual({bindingId:expected,revisionId:context.revision.revisionId,configuration:config,registered:false});
  expect(events.list).not.toHaveBeenCalled();expect(events.ingest).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(context.ownerId);
 });
 it("keeps the configured identity across source revisions and identifies the current revision",async()=>{
  const {tool}=fixture(),next={...context,revision:{revisionId:`sha256:${"b".repeat(64)}`}} as ToolContext;
  expect(await tool.execute(next,config)).toMatchObject({bindingId:expected,revisionId:next.revision.revisionId,registered:false});
 });
 it("separates owners, projects, chains, issuers and game policy",async()=>{
  const {tool}=fixture();
  const cases:[ToolContext,typeof config][]=[
   [context,config],[{...context,ownerId:"fixture-owner-b"},config],
   [{...context,projectId:"22222222-2222-4222-8222-222222222222"},config],
   [context,{...config,chainId:1}],[context,{...config,issuer:`0x${"22".repeat(20)}`}],
   [context,{...config,gameId:"other-game"}],[context,{...config,maxAge:301}],
   [context,{...config,maximumScore:"2"}],
  ];
  const results=await Promise.all(cases.map(([scope,input])=>tool.execute(scope,input)));
  expect(new Set(results.map(value=>(value as {bindingId:string}).bindingId)).size).toBe(cases.length);
 });
 it.each([
  {gameId:""},{gameId:"Upper Case"},{chainId:8453},{issuer:`0x${"00".repeat(20)}`},
  {maxAge:0},{maxAge:86401},{maximumScore:"0"},{maximumScore:"1000000001"},
 ])("rejects invalid game configuration %j",async patch=>{
  const {tool}=fixture();await expect(tool.execute(context,{...config,...patch})).rejects.toMatchObject({code:"game-event"});
 });
 it("declares complete arguments and refuses injected ownership or authority fields",()=>{
  const {tool}=fixture(),validate=new Ajv({strict:false}).compile(tool.schema);
  expect(validate(config)).toBe(true);
  for(const patch of [{ownerId:"other"},{projectId:"other"},{privateKey:"never"},{target:`0x${"33".repeat(20)}`}])expect(validate({...config,...patch})).toBe(false);
  const {issuer,...missing}=config;void issuer;expect(validate(missing)).toBe(false);
 });
});
