"use client";

import { useEffect, useState } from "react";

function ago(at: string, now: number) {
  const hours = Math.max(0,Math.floor((now-Date.parse(at))/3600000));
  if (hours < 1) return "<1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours/24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
export function AnalyticsRelativeTime({ at, renderedAt }: { at:string; renderedAt:number }) {
  const [now,setNow] = useState(renderedAt);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const first = setTimeout(refresh,0);
    const interval = setInterval(refresh,60000);
    return () => { clearTimeout(first); clearInterval(interval); };
  },[]);
  return <time dateTime={at} title={new Date(at).toUTCString()}>{ago(at,now)}</time>;
}
