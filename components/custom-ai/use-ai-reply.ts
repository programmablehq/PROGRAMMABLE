"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { createAIReplyController, type ReplySignals } from "@/lib/custom-ai/reply-controller";

type Controller=ReturnType<typeof createAIReplyController>;
export function useAIReply(headers:AISessionHeaders,localPreview:boolean,signals:ReplySignals){
  const latest=useRef({headers,localPreview,signals});
  useLayoutEffect(()=>{latest.current={headers,localPreview,signals};},[headers,localPreview,signals]);
  const create=useCallback(()=>createAIReplyController(()=>latest.current.headers(),latest.current.localPreview,{
    busy:value=>latest.current.signals.busy(value),stopping:value=>latest.current.signals.stopping(value),
    phase:value=>latest.current.signals.phase(value),partial:value=>latest.current.signals.partial(value),
    error:value=>latest.current.signals.error(value),notice:value=>latest.current.signals.notice(value),
  }),[]);
  const controller=useRef<Controller|null>(null);
  useEffect(()=>{
    const active=create();controller.current=active;return()=>active.dispose();
  },[create]);
  return useMemo(()=>({
    run:(...args:Parameters<Controller["run"]>)=>controller.current?.run(...args)??Promise.resolve(false),
    stop:()=>controller.current?.stop()??Promise.resolve(),isActive:()=>controller.current?.isActive()??false,
  }),[]);
}
