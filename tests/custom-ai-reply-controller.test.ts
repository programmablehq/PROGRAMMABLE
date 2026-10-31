import { beforeEach, describe, expect, it, vi } from "vitest";
const transport=vi.hoisted(()=>({send:vi.fn(),resume:vi.fn(),cancel:vi.fn()}));
vi.mock("../lib/custom-ai/client",async original=>({...await original<object>(),sendAIChat:transport.send,resumeAIChat:transport.resume,aiRequest:transport.cancel}));
import { createAIReplyController, type ReplySignals, type ReplyTask } from "../lib/custom-ai/reply-controller";
import type { ChatResult } from "../lib/custom-ai/types";

const request={id:"controller-request-001",intent:"chat" as const,messages:[{role:"user" as const,content:"Build my coin."}]};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const task=():ReplyTask=>({request,onResult:vi.fn(),onFailure:vi.fn(),onSettled:vi.fn()});
const signals=():ReplySignals=>({busy:vi.fn(),stopping:vi.fn(),phase:vi.fn(),partial:vi.fn(),error:vi.fn(),notice:vi.fn()});
beforeEach(()=>vi.resetAllMocks());

describe("one mounted reply receiver",()=>{
  it("serializes a double send before any cache or model work starts",async()=>{
    const pending=deferred<ChatResult>();transport.send.mockReturnValue(pending.promise);
    const actor=createAIReplyController(async()=>({}),false,signals()),first=task(),second={...task(),beforeSend:vi.fn()};
    const running=actor.run(first);expect(await actor.run(second)).toBe(false);
    expect(second.beforeSend).not.toHaveBeenCalled();pending.resolve({reply:"One reply"});await running;
    expect(transport.send).toHaveBeenCalledTimes(1);expect(first.onResult).toHaveBeenCalledTimes(1);
  });
  it("keeps an acknowledged cancellation terminal when the model returns late",async()=>{
    const pending=deferred<ChatResult>();transport.send.mockReturnValue(pending.promise);transport.cancel.mockResolvedValue({id:request.id,state:"failed",errorCode:"cancelled"});
    const ui=signals(),actor=createAIReplyController(async()=>({}),false,ui),input=task();
    const running=actor.run(input);await Promise.resolve();await actor.stop();pending.resolve({reply:"Late reply"});await running;
    expect(input.onResult).not.toHaveBeenCalled();expect(input.onFailure).toHaveBeenCalledTimes(1);expect(input.onSettled).toHaveBeenCalledTimes(1);
    expect(ui.notice).toHaveBeenLastCalledWith("Stopped. Your last draft is unchanged.");
  });
  it("delivers an already completed server reply once even when stopping the stream",async()=>{
    const pending=deferred<ChatResult>();transport.send.mockReturnValue(pending.promise);transport.cancel.mockResolvedValue({id:request.id,state:"completed",result:{reply:"Finished first"}});
    const input=task(),actor=createAIReplyController(async()=>({}),false,signals());
    const running=actor.run(input);await Promise.resolve();await actor.stop();pending.resolve({reply:"Finished first"});await running;
    expect(input.onResult).toHaveBeenCalledExactlyOnceWith({reply:"Finished first"});expect(input.onFailure).not.toHaveBeenCalled();expect(input.onSettled).toHaveBeenCalledTimes(1);
  });
  it("does not claim a stop or apply a result from another request",async()=>{
    const pending=deferred<ChatResult>();transport.send.mockReturnValue(pending.promise);transport.cancel.mockResolvedValue({id:"another-request-001",state:"completed",result:{reply:"Wrong coin"}});
    const ui=signals(),input=task(),actor=createAIReplyController(async()=>({}),false,ui);
    const running=actor.run(input);await Promise.resolve();await actor.stop();pending.resolve({reply:"Late"});await running;
    expect(input.onResult).not.toHaveBeenCalled();expect(ui.error).toHaveBeenLastCalledWith("The stop could not be confirmed. The saved reply can be checked again.");
    expect(ui.notice).not.toHaveBeenCalledWith("Stopped. Your last draft is unchanged.");
  });
  it("does not claim a stop when its acknowledgement is lost",async()=>{
    const pending=deferred<ChatResult>();transport.send.mockReturnValue(pending.promise);transport.cancel.mockRejectedValue(new TypeError("Connection lost"));
    const ui=signals(),input=task(),actor=createAIReplyController(async()=>({}),false,ui);
    const running=actor.run(input);await Promise.resolve();await actor.stop();pending.resolve({reply:"Saved elsewhere"});await running;
    expect(input.onResult).not.toHaveBeenCalled();expect(input.onFailure).toHaveBeenCalledTimes(1);expect(ui.notice).not.toHaveBeenCalledWith("Stopped. Your last draft is unchanged.");
  });
  it("disposes an old receiver without delivering into a new coin",async()=>{
    const pending=deferred<ChatResult>();transport.send.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({reply:"New coin reply"});
    const oldSignals=signals(),oldTask=task(),old=createAIReplyController(async()=>({}),false,oldSignals);
    const running=old.run(oldTask);await Promise.resolve();old.dispose();
    transport.send.mock.calls[0][3]({type:"reply",text:"Old partial"});
    const currentTask={...task(),request:{...request,id:"controller-request-002"}},current=createAIReplyController(async()=>({}),false,signals());
    await current.run(currentTask);pending.resolve({reply:"Old coin reply"});await running;
    expect(oldTask.onResult).not.toHaveBeenCalled();expect(oldTask.onFailure).not.toHaveBeenCalled();expect(oldTask.onSettled).not.toHaveBeenCalled();
    expect(oldSignals.partial).not.toHaveBeenCalledWith("Old partial");expect(currentTask.onResult).toHaveBeenCalledExactlyOnceWith({reply:"New coin reply"});
  });
  it("does not dispatch after a stop while the local cache is still writing",async()=>{
    const cache=deferred<void>();transport.cancel.mockResolvedValue({id:request.id,state:"failed",errorCode:"cancelled"});
    const input={...task(),beforeSend:()=>cache.promise},actor=createAIReplyController(async()=>({}),false,signals());
    const running=actor.run(input);await actor.stop();cache.resolve();await running;
    expect(transport.send).not.toHaveBeenCalled();expect(input.onFailure).toHaveBeenCalledTimes(1);
  });
  it("never dispatches if the request could not be saved first",async()=>{
    const input={...task(),beforeSend:vi.fn(async()=>{throw Error("Storage full");})},actor=createAIReplyController(async()=>({}),false,signals());
    await actor.run(input);expect(transport.send).not.toHaveBeenCalled();expect(input.onFailure).toHaveBeenCalledTimes(1);expect(actor.isActive()).toBe(false);
  });
  it("uses the read-only resume transport for a saved request",async()=>{
    transport.resume.mockResolvedValue({reply:"Stored"});const input=task(),actor=createAIReplyController(async()=>({}),false,signals());
    await actor.run(input,true);expect(transport.resume).toHaveBeenCalledTimes(1);expect(transport.send).not.toHaveBeenCalled();expect(input.onResult).toHaveBeenCalledExactlyOnceWith({reply:"Stored"});
  });
});
