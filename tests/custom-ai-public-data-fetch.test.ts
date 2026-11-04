import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
const mocks=vi.hoisted(()=>({lookup:vi.fn(),request:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("node:dns/promises",()=>({lookup:mocks.lookup}));
vi.mock("node:https",()=>({request:mocks.request}));
import { readPublicJSON } from "../lib/custom-ai/feed-adapters/public-json.server";

let status:number,headers:Record<string,string>,chunks:Buffer[];
beforeEach(()=>{
  mocks.lookup.mockReset().mockResolvedValue([{address:"8.8.8.8",family:4}]);
  status=200;headers={"content-type":"application/json"};chunks=[Buffer.from('{"value":9007199254740993}')];
  mocks.request.mockReset().mockImplementation((_options,onResponse)=>{
    const outgoing=Object.assign(new EventEmitter(),{end(){queueMicrotask(()=>onResponse(Object.assign(Readable.from(chunks),{statusCode:status,headers})));}});
    return outgoing;
  });
});

describe("bounded public JSON fetching",()=>{
  it("pins the checked address while retaining the TLS identity and exact numeric text",async()=>{
    const result=await readPublicJSON("https://data.example.com/pin");
    expect(result).toEqual({value:"9007199254740993"});
    expect(mocks.request.mock.calls[0][0]).toMatchObject({hostname:"8.8.8.8",servername:"data.example.com",rejectUnauthorized:true,method:"GET",agent:false,path:"/pin",headers:{Host:"data.example.com"}});
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });
  it("rejects mixed public/private DNS before opening any connection",async()=>{
    mocks.lookup.mockResolvedValue([{address:"8.8.8.8",family:4},{address:"127.0.0.1",family:4}]);
    await expect(readPublicJSON("https://data.example.com/mixed")).rejects.toThrow("public addresses");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("shares concurrent public reads and returns independent cached objects",async()=>{
    const [one,two]=await Promise.all([readPublicJSON("https://data.example.com/shared"),readPublicJSON("https://data.example.com/shared")]);
    (one as {value:string}).value="changed";
    expect(two).toEqual({value:"9007199254740993"});
    expect(await readPublicJSON("https://data.example.com/shared")).toEqual(two);
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("honors a source freshness window shorter than the shared ten-second cache",async()=>{
    const clock=vi.spyOn(Date,"now").mockReturnValue(1000000);
    try{
      await readPublicJSON("https://data.example.com/short-freshness",undefined,1000);
      clock.mockReturnValue(1001001);
      await readPublicJSON("https://data.example.com/short-freshness",undefined,1000);
      expect(mocks.request).toHaveBeenCalledTimes(2);
    }finally{clock.mockRestore();}
  });
  it("does not follow redirects or accept compressed and oversized bodies",async()=>{
    status=302;headers.location="http://169.254.169.254/latest/meta-data";
    await expect(readPublicJSON("https://data.example.com/redirect")).rejects.toThrow("status 200");
    expect(mocks.request).toHaveBeenCalledOnce();
    status=200;headers={"content-type":"application/json","content-encoding":"gzip"};
    await expect(readPublicJSON("https://data.example.com/compressed")).rejects.toThrow();
    headers={"content-type":"application/json"};chunks=[Buffer.alloc(128001,32)];
    await expect(readPublicJSON("https://data.example.com/oversized")).rejects.toThrow("size limit");
  });
  it("keeps a cancelled subscriber from cancelling another caller",async()=>{
    const controller=new AbortController();
    const first=readPublicJSON("https://data.example.com/cancel",controller.signal);
    const second=readPublicJSON("https://data.example.com/cancel");controller.abort(Error("stopped"));
    await expect(first).rejects.toThrow("stopped");
    await expect(second).resolves.toEqual({value:"9007199254740993"});
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
