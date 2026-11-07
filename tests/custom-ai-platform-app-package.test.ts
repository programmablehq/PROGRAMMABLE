import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {validateAppPackage} from "../lib/custom-ai/platform/app-package.server";
const b64=(s:string)=>Buffer.from(s).toString("base64");
const valid=()=>({".vercel/output/config.json":b64('{"version":3}'),".vercel/output/static/index.html":b64('<h1>Hi</h1>'),".vercel/output/functions/api/hello.func/.vc-config.json":b64('{"runtime":"nodejs24.x","handler":"index.cjs","launcherType":"Nodejs","maxDuration":30}'),".vercel/output/functions/api/hello.func/index.cjs":b64('module.exports=(req,res)=>res.end("hello")')});
describe("prebuilt application artifacts",()=>{
 it("pins runtime limits and adds source-bound health without accepting external paths",()=>{
  const files=validateAppPackage(valid(),"sha256:"+"a".repeat(64));expect(files[".vercel/output/functions/api/_programmable.func/index.cjs"]).toContain("sha256:");
  expect(()=>validateAppPackage({...valid(),"../../other":b64("bad")},"sha256:"+"a".repeat(64))).toThrow();
 });
 it("rejects unbounded or externally mapped function configuration",()=>{
  const files=valid();files[".vercel/output/functions/api/hello.func/.vc-config.json"]=b64('{"runtime":"nodejs24.x","handler":"../../server","maxDuration":800,"filePathMap":{"private":"/etc/secret"}}');
  expect(()=>validateAppPackage(files,"sha256:"+"a".repeat(64))).toThrow();
 });
});
