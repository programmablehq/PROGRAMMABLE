import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {mcpInputHeaders,discoverMCP,callMCP} from "../lib/custom-ai/platform/mcp.server";
import type {ConnectionManifest} from "../lib/custom-ai/platform/connections.server";
const schema={type:"object",properties:{region:{type:"string","x-mcp-header":"Region"}},required:["region"],additionalProperties:false};
const manifest:ConnectionManifest={name:"Test MCP",kind:"mcp",baseUrl:"https://api.scores.com/mcp",protocol:"2026-07-28",auth:{kind:"none"},actions:[]};
describe("project-scoped MCP",()=>{
 it("mirrors modern protocol metadata and safely encodes parameter headers",async()=>{
  const transport=vi.fn(async input=>{const body=JSON.parse(input.body);return {status:200,headers:{"content-type":"application/json"},text:JSON.stringify({jsonrpc:"2.0",id:body.id,result:body.method==="tools/list"?{tools:[{name:"score",description:"Read score",inputSchema:schema}]}:{content:[{type:"text",text:"3"}]}})}});
  const discovered=await discoverMCP(manifest,{},transport);expect(discovered).toHaveLength(1);
  await callMCP({...manifest,actions:discovered},discovered[0],{region:"Hello, 世界"},{},transport);
  const call=transport.mock.calls.at(-1)![0];const body=JSON.parse(call.body);
  expect(call.headers).toMatchObject({"MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/call","Mcp-Name":"score","Mcp-Param-Region":"=?base64?SGVsbG8sIOS4lueVjA==?="});
  expect(body.params._meta["io.modelcontextprotocol/protocolVersion"]).toBe("2026-07-28");
  expect(transport.mock.calls.some(([input])=>JSON.parse(input.body).method==="initialize")).toBe(false);
 });
 it("rejects invalid or duplicate header annotations",()=>{
  expect(()=>mcpInputHeaders({anyOf:[{type:"string","x-mcp-header":"Foo"}]},{})).toThrow();
  expect(()=>mcpInputHeaders({type:"object",properties:{a:{type:"string","x-mcp-header":"Foo"},b:{type:"string","x-mcp-header":"foo"}}},{})).toThrow();
  expect(mcpInputHeaders(schema,{region:"line1\nline2"})).toEqual({"Mcp-Param-Region":"=?base64?bGluZTEKbGluZTI=?="});
 });
 it("blocks changed tool contracts before invocation",async()=>{
  const transport=vi.fn(async input=>{const body=JSON.parse(input.body);return {status:200,headers:{"content-type":"application/json"},text:JSON.stringify({jsonrpc:"2.0",id:body.id,result:{tools:[{name:"score",description:"Changed capability",inputSchema:schema}]}})}});
  const action={id:"score",description:"Original capability",method:"POST" as const,path:"/mcp",effect:"write" as const,inputSchema:schema,outputSchema:{type:"object"}};
  await expect(callMCP({...manifest,actions:[action]},action,{region:"us"},{},transport)).rejects.toMatchObject({code:"mcp-changed"});
  expect(transport).toHaveBeenCalledOnce();
 });
});
