"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { launchDestinationIdentity, parseLaunchDestination } from "@/lib/launch-destination";
import { useLaunchStatusPolling } from "./use-launch-status-polling";
import styles from "./custom-launch-completion.module.css";

export function CustomLaunchCompletion({chainId,launchId,controller,transactionHash,openAutomatically}: {
  chainId:"1"|"4663";launchId:string|null;controller:string;transactionHash:string|null;openAutomatically:boolean;
}) {
  const router=useRouter(), navigated=useRef(false);
  const query=new URLSearchParams({chainId,launchId:launchId??"",controller,transactionHash:transactionHash??""});
  const identity=launchDestinationIdentity(query);
  const [resolved,setResolved]=useState<{scope:string;href:string}|null>(null);
  const scope=query.toString(), href=resolved?.scope===scope?resolved.href:null;
  useLaunchStatusPolling(scope,!!identity&&!href,async signal=>{
    if (!identity) return;
    const response=await fetch(`/api/launch-destination?${scope}`,{cache:"no-store",redirect:"error",signal});
    if (response.status===202) return;
    if (!response.ok) throw Error("Index pending");
    const destination=parseLaunchDestination(await response.json(),identity);
    if (!destination || signal.aborted) return;
    setResolved({scope,href:destination.href});
    if (openAutomatically&&!navigated.current) {navigated.current=true;router.push(destination.href);}
  },15000,true);
  return <div className={styles.completion}>
    <p role="status">{href?"Your coin is live on Explore.":"Your launch is confirmed. Your coin will open as soon as it appears on Explore."}</p>
    {href?<a href={href}>Open coin</a>:null}
  </div>;
}
