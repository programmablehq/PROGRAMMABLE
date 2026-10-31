import { AIRequestError, aiRequest, resumeAIChat, sendAIChat, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ChatProgress, ChatRequest, ChatResult } from "@/lib/custom-ai/types";

export type ReplyTask = {
  request: ChatRequest; beforeSend?: () => Promise<void>;
  onResult: (result: ChatResult) => void; onFailure: (error: unknown) => void; onSettled: () => void;
};
type Active = ReplyTask & { controller: AbortController; stopController?: AbortController; disposed: boolean; delivered: boolean; stopping: boolean; settled: boolean };
export type ReplySignals = {
  busy: (value: boolean) => void; stopping: (value: boolean) => void;
  phase: (value: ChatProgress & { type: "phase" }) => void; partial: (value: string | null) => void;
  error: (value: string) => void; notice: (value: string) => void;
};

/** One actor per mounted coin/chat. Disposing a receiver never cancels the
 * durable account job. Stopping is a separate acknowledged server operation. */
export function createAIReplyController(headers: AISessionHeaders, localPreview: boolean, signals: ReplySignals) {
  let active:Active|null=null,disposed=false;
  const current=(task:Active)=>active===task&&!task.disposed&&!disposed;
  function dispose(){
    disposed=true;
    if(active){active.disposed=true;active.controller.abort();active.stopController?.abort();active=null;}
  }
  function settle(task:Active){
    if(!current(task)||task.settled)return;
    task.settled=true;active=null;
    signals.busy(false);signals.stopping(false);signals.partial(null);task.onSettled();
  }
  function deliver(task:Active,result:ChatResult){
    if(!current(task)||task.delivered)return;
    if(!result||typeof result.reply!=="string")throw Error("The saved reply could not be read. Your design is kept.");
    task.onResult(result);task.delivered=true;
  }
  async function run(input:ReplyTask,resume=false){
    if(active||disposed)return false;
    const task:Active={...input,controller:new AbortController(),disposed:false,delivered:false,stopping:false,settled:false};
    active=task;
    signals.busy(true);signals.stopping(false);signals.error("");signals.notice("");signals.partial(null);
    signals.phase({type:"phase",phase:resume?"reconnecting":"thinking"});
    try{
      await task.beforeSend?.();task.controller.signal.throwIfAborted();
      const progress=(event:ChatProgress)=>{
        if(!current(task)||task.stopping)return;
        if(event.type==="reply")signals.partial(event.text);else signals.phase(event);
      };
      const result=await (resume?resumeAIChat:sendAIChat)(task.request,headers,task.controller.signal,progress);
      if(current(task)&&!task.stopping)deliver(task,result);
    }catch(error){
      if(current(task)&&!task.stopping){
        task.onFailure(error);
        signals.error(error instanceof Error?error.message:"The reply could not finish. Your saved design is kept.");
      }
    }finally{if(current(task)&&!task.stopping)settle(task);}
    return true;
  }
  async function stop(){
    const task=active;if(!task||task.stopping)return;
    task.stopping=true;task.controller.abort();task.stopController=new AbortController();
    signals.stopping(true);signals.partial(null);signals.notice("Confirming your stop request…");
    try{
      if(localPreview){
        task.onFailure(new AIRequestError("Stopped.",409,0,"cancelled","failed"));
        signals.notice("Stopped. Your last draft is unchanged.");
      }else{
        const job=await aiRequest<{id:string;state:string;result?:ChatResult;errorCode?:string}>("/cancel",headers,{id:task.request.id},task.stopController.signal);
        if(!current(task))return;
        if(job.id!==task.request.id)throw Error("The stop acknowledgement did not match this request.");
        if(job.state==="completed"&&job.result){deliver(task,job.result);signals.notice("The reply finished before the stop arrived.");}
        else if(job.state==="failed"){
          task.onFailure(new AIRequestError("The reply ended.",409,0,job.errorCode??"interrupted","failed"));
          signals.notice(job.errorCode==="cancelled"?"Stopped. Your last draft is unchanged.":"The reply already ended. Your last draft is kept.");
        }else throw Error("The stop could not be confirmed. Reconnect to the saved reply to check its result.");
      }
    }catch(error){
      if(current(task)){
        task.onFailure(error);signals.notice("");
        signals.error("The stop could not be confirmed. The saved reply can be checked again.");
      }
    }finally{if(current(task))settle(task);}
  }
  return {run,stop,isActive:()=>active!==null,dispose,isDisposed:()=>disposed};
}
