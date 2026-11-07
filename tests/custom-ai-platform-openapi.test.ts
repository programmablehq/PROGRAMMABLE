import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {importOpenAPI} from "../lib/custom-ai/platform/openapi.server";
describe("reviewed OpenAPI import",()=>{
 it("keeps path/query/body bindings and reports unsupported actions",()=>{
  const document={openapi:"3.1.0",servers:[{url:"https://api.scores.com/v1"}],paths:{
    "/players/{id}":{get:{operationId:"getPlayer",parameters:[
      {in:"path",name:"id",required:true,schema:{type:"string"}},
      {in:"query",name:"expand",schema:{type:"boolean"}},
    ],responses:{"200":{content:{"application/json":{schema:{type:"object"}}}}}}},
    "/other":{get:{parameters:[{in:"cookie",name:"session",schema:{type:"string"}}],responses:{}}},
  }};
  const result=importOpenAPI(document,{name:"Scores"});
  expect(result.manifest.actions[0]).toMatchObject({id:"getPlayer",path:"/v1/players/{id}",effect:"read",bindings:{path:["id"],query:["expand"],body:false}});
  expect(result.warnings).toHaveLength(1);
 });
 it("does not follow external references or accept private endpoint servers",()=>{
  expect(()=>importOpenAPI({openapi:"3.0.0",servers:[{url:"http://127.0.0.1"}],paths:{}},{name:"Bad"})).toThrow();
  expect(()=>importOpenAPI({openapi:"3.0.0",servers:[{url:"https://api.scores.com"}],paths:{"/x":{$ref:"https://untrusted.com/path"}}},{name:"Bad"})).toThrow();
 });
});
