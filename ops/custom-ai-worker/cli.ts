import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createAIStore } from "../../lib/custom-ai/store.server";
import { parseWorkerConfig } from "./config";
import { createWorkerRuntime } from "./runtime.server";

async function main(){
  const [mode,path]=process.argv.slice(2);
  if(!["--check","--once","--run"].includes(mode)||!path||process.argv.length!==4)throw Error("Use --check, --once or --run with an operator configuration file");
  const networks=parseWorkerConfig(await readFile(path,"utf8"));
  if(mode==="--check"){
    console.log(JSON.stringify({valid:true,networks:networks.map(n=>({chainId:n.chainId,feeds:n.feeds.length,transactionLimitWei:String(n.transactionLimitWei),dailyLimitWei:String(n.dailyLimitWei)})),broadcast:false}));return;
  }
  if(process.env.CUSTOM_AI_WORKER_ACTIVE!=="true")throw Error("Worker execution requires explicit activation");
  const connectionString=process.env.CUSTOM_AI_DATABASE_URL;
  if(!connectionString)throw Error("The worker database is not configured");
  const url=new URL(connectionString);
  if(!["postgres:","postgresql:"].includes(url.protocol)||!url.username||!url.password||url.hash||[...url.searchParams.keys()].some(k=>/ssl|options|role/i.test(k)))throw Error("Invalid worker database connection");
  const pool=new Pool({connectionString,max:4,ssl:{rejectUnauthorized:true,servername:url.hostname,...(process.env.CUSTOM_AI_DATABASE_CA?{ca:process.env.CUSTOM_AI_DATABASE_CA}:{})},connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
  pool.on("error",()=>undefined);
  const store=createAIStore(pool,{hourlyUnits:25,dailyUnits:100,globalDailyUnits:5,concurrent:1});
  const runtime=createWorkerRuntime(pool,store,networks);
  const stop=new AbortController();process.once("SIGTERM",()=>stop.abort());process.once("SIGINT",()=>stop.abort());
  try{
    do{
      try{console.log(JSON.stringify({type:"tick",at:new Date().toISOString(),...await runtime.tick()}));}
      catch{console.error(JSON.stringify({type:"tick-failed",at:new Date().toISOString(),message:"The worker could not verify its dependencies. No replacement transaction was signed."}));if(mode==="--once")throw Error("Worker tick failed");}
      if(mode==="--once"||stop.signal.aborted)break;
      await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);stop.signal.removeEventListener("abort",finish);resolve();};const timer=setTimeout(finish,30000);stop.signal.addEventListener("abort",finish,{once:true});});
    }while(!stop.signal.aborted);
  }finally{await pool.end();}
}
main().catch(()=>{console.error("Custom AI worker stopped. Check its configuration and saved transaction journal.");process.exitCode=1;});
