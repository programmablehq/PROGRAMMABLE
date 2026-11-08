import {readFile} from "node:fs/promises";
import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {gameEventTools} from "../lib/custom-ai/platform/event-tools.server";
import code from "../lib/custom-ai/platform/game-events-code.json";

describe("game source choices available to ordinary projects",()=>{
 it("makes the individual-player implementation readable from its pinned source package",async()=>{
  const library=gameEventTools({} as never).find(tool=>tool.id==="event.library")!;
  const path="src/custom-ai/ProjectPlayerGameFeeModuleV1.sol";
  const result=await library.execute({} as never,{paths:[path]}) as {files:Record<string,string>;available:string[]};
  expect(result.files[path]).toBe(await readFile("contracts/"+path,"utf8"));
  expect(result.available).toContain("src/custom-ai/ProjectGameEventsV1.sol");
  expect(result.available).toContain("src/custom-ai/ProjectPlayerGameEventsV1.sol");
  expect(result.available).toContain("src/custom-ai/ProjectGameFeeModuleV1.sol");
 });
 it("retains the community contract and publishes a separate constructor for the player policy",()=>{
  const artifacts=code.artifacts as Record<string,{abi:{type:string;inputs?:unknown[]}[]}>;
  expect(artifacts.ProjectGameEventsV1).toBeDefined();
  expect(artifacts.ProjectGameFeeModuleV1).toBeDefined();
  expect(artifacts.ProjectPlayerGameFeeModuleV1?.abi.find(item=>item.type==="constructor")?.inputs).toHaveLength(5);
 });
});
