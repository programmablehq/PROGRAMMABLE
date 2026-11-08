"use client";
import {useRef,useState} from "react";
import {aiRequest,type AISessionHeaders} from "@/lib/custom-ai/client";
export function LegacyProjectImport({requestId,account,conversationId,headers,onImported}:{requestId:string;account:string;conversationId:string;headers:AISessionHeaders;onImported:(projectId:string)=>void}){
  const projectId=useRef(crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function importProject(){setBusy(true);setError("");try{await aiRequest("/platform/import",headers,{projectId:projectId.current,requestId,account,conversationId});onImported(projectId.current);}catch(cause){setError(cause instanceof Error?cause.message:"The saved contract could not be imported.");}finally{setBusy(false);}}
  return <div><button type="button" disabled={busy} onClick={()=>void importProject()}>Open saved contract in projects</button>{error&&<p role="alert">{error}</p>}</div>;
}
