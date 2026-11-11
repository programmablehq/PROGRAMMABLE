import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {validateAppPackage} from "../lib/custom-ai/platform/app-package.server";
const b64=(s:string)=>Buffer.from(s).toString("base64");
const valid=()=>({".vercel/output/config.json":b64('{"version":3}'),".vercel/output/static/index.html":b64('<h1>Hi</h1>'),".vercel/output/functions/api/hello.func/.vc-config.json":b64('{"runtime":"nodejs24.x","handler":"index.cjs","launcherType":"Nodejs","maxDuration":30}'),".vercel/output/functions/api/hello.func/index.cjs":b64('module.exports=(req,res)=>res.end("hello")')});
describe("prebuilt application artifacts",()=>{
 it.each(["/app.js","/styles.css"])("rejects a preview whose public output omits %s",asset=>{
  const html=asset.endsWith(".js")?`<script type="module" src="${asset}"></script>`:`<link rel="stylesheet" href="${asset}">`;
  expect(()=>validateAppPackage({...valid(),".vercel/output/static/index.html":b64(html)},"sha256:"+"a".repeat(64))).toThrow(/public output is missing/);
 });
 it("keeps emitted frontend assets while allowing remote styles and application routes",()=>{
  const files=validateAppPackage({...valid(),".vercel/output/static/index.html":b64('<a href="/tasks">Tasks</a><script src="./app.js?v=1"></script><link rel="stylesheet" href="https://fonts.example/styles.css">'),".vercel/output/static/app.js":b64('console.log("ready")')},"sha256:"+"a".repeat(64));
  expect(files[".vercel/output/static/app.js"]).toContain('console.log');
  expect(JSON.parse(files[".vercel/output/config.json"] as string).routes).toContainEqual({handle:"filesystem"});
 });
 it("pins runtime limits and adds source-bound health without accepting external paths",()=>{
  const files=validateAppPackage(valid(),"sha256:"+"a".repeat(64));expect(files[".vercel/output/functions/api/_programmable.func/index.cjs"]).toContain("sha256:");
  expect(()=>validateAppPackage({...valid(),"../../other":b64("bad")},"sha256:"+"a".repeat(64))).toThrow();
 });
 it("rejects unbounded or externally mapped function configuration",()=>{
  const files=valid();files[".vercel/output/functions/api/hello.func/.vc-config.json"]=b64('{"runtime":"nodejs24.x","handler":"../../server","maxDuration":800,"filePathMap":{"private":"/etc/secret"}}');
  expect(()=>validateAppPackage(files,"sha256:"+"a".repeat(64))).toThrow();
 });
});
