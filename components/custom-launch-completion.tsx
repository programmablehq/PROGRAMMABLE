"use client";
import { useState } from "react";
import { CustomLaunchSuccessActions } from "./custom-launch-success-actions";
import { launchDestinationIdentity, parseLaunchDestination } from "@/lib/launch-destination";
import { useLaunchStatusPolling } from "./use-launch-status-polling";
import styles from "./custom-launch-completion.module.css";

export function CustomLaunchCompletion({chainId,launchId,controller,transactionHash}: {
  chainId:"1"|"4663";launchId:string|null;controller:string;transactionHash:string|null;
}) {
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
  },15000,true);
  return <div className={styles.completion}>
    {!href ? <p role="status">Your launch is confirmed. Your coin will appear here once it is indexed on Explore.</p> : null}
    {href?<CustomLaunchSuccessActions href={href} />:null}
  </div>;
}
