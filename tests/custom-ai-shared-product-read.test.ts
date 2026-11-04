import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {sharedProductRead} from "../lib/custom-ai/product/shared-read.server";
afterEach(()=>vi.useRealTimers());
describe("shared product reads",()=>{
  it("keeps another caller alive when the first leaves",async()=>{
    let finish!:(value:string)=>void,signal!:AbortSignal;
    const shared=sharedProductRead<string>(current=>{signal=current;return new Promise(resolve=>{finish=resolve;});},1000);
    const a=new AbortController(),b=new AbortController(),first=shared.wait(a.signal).catch(error=>error),second=shared.wait(b.signal);
    await Promise.resolve();a.abort();expect((await first as Error).name).toBe("AbortError");expect(signal.aborted).toBe(false);
    finish("observed");expect(await second).toBe("observed");
  });
  it("stops provider work when the last caller leaves",async()=>{
    let signal!:AbortSignal;
    const shared=sharedProductRead(current=>{signal=current;return new Promise((_resolve,reject)=>current.addEventListener("abort",()=>reject(current.reason),{once:true}));},1000);
    const controller=new AbortController(),pending=shared.wait(controller.signal).catch(error=>error);
    await Promise.resolve();controller.abort();await pending;expect(signal.aborted).toBe(true);
  });
  it("bounds all subscribers by the shared operation deadline",async()=>{
    vi.useFakeTimers();
    const shared=sharedProductRead(signal=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true})),1000);
    const pending=shared.wait(new AbortController().signal).catch(error=>error);
    await vi.advanceTimersByTimeAsync(1000);expect((await pending as Error).name).toBe("TimeoutError");expect(vi.getTimerCount()).toBe(0);
  });
});
