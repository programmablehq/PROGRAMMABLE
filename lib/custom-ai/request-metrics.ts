export type ModelCallMetric={model:string;durationMs:number;inputTokens:number|null;outputTokens:number|null;completed:boolean};
export type RequestMetrics={startedAt:number;durationMs:number;state:"completed"|"failed";calls:ModelCallMetric[];tokenAccountingComplete:boolean};
export function requestMetrics(startedAt:number,calls:ModelCallMetric[],completed:boolean,now=Date.now()):RequestMetrics {
  return {startedAt,durationMs:Math.max(0,now-startedAt),state:completed?"completed":"failed",calls:calls.slice(0,8),
    tokenAccountingComplete:calls.length<=8&&calls.every(c=>c.completed&&c.inputTokens!==null&&c.outputTokens!==null)};
}
export function summarizeRequestMetrics(rows:RequestMetrics[]){
  const recent=rows.slice(0,100),durations=recent.filter(r=>r.state==="completed").map(r=>r.durationMs).sort((a,b)=>a-b);
  return {scope:"most-recent-100-account-requests" as const,count:recent.length,completed:durations.length,
    failed:recent.length-durations.length,medianDurationMs:durations.length?(durations[Math.floor(durations.length/2)]+durations[Math.floor((durations.length-1)/2)])/2:null,
    modelCalls:recent.reduce((n,r)=>n+r.calls.length,0),knownInputTokens:recent.reduce((n,r)=>n+r.calls.reduce((m,c)=>m+(c.inputTokens??0),0),0),
    knownOutputTokens:recent.reduce((n,r)=>n+r.calls.reduce((m,c)=>m+(c.outputTokens??0),0),0),
    incompleteTokenRecords:recent.filter(r=>!r.tokenAccountingComplete).length,latest:recent[0]??null};
}
export type RequestMetricsSummary=ReturnType<typeof summarizeRequestMetrics>;
