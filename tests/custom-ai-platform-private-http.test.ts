import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { validateConnectorURL, redactConnectorData } from "../lib/custom-ai/platform/private-http.server";

describe("connector endpoint boundaries",()=>{
 it("rejects credentials, non-public authorities and metadata endpoints",()=>{
  for(const url of ["http://api.scores.com","https://127.0.0.1/","https://[::1]/","https://user:secret@api.scores.com/","https://metadata.google.internal/","https://api.scores.com/?api_key=secret"])
   expect(()=>validateConnectorURL(url)).toThrow();
  expect(validateConnectorURL("https://api.scores.com/v1").hostname).toBe("api.scores.com");
 });
 it("redacts nested tokens and literal secrets without dropping ordinary data",()=>{
  const result=redactConnectorData({score:3,nested:{authorization:"Bearer abc",note:"secret123 echoed"}},["secret123"]);
  expect(result).toEqual({score:3,nested:{authorization:"[redacted]",note:"[redacted] echoed"}});
 });
 it("redacts literal credentials in object keys without overwriting ordinary keys",()=>{
  const secret="synthetic-connector-credential";
  const result=redactConnectorData({[secret]:1,"[redacted-key-0]":2,nested:[{["field:"+secret]:3,score:0,ok:false}]},[secret]) as Record<string,unknown>;
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result["[redacted-key-0]"]).toBe(2);
  expect(Object.values(result)).toContain(1);
  const nested=(result.nested as Record<string,unknown>[])[0];
  expect(Object.values(nested)).toContain(3);expect(nested.score).toBe(0);expect(nested.ok).toBe(false);
 });
});
