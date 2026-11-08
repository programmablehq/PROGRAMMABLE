import "server-only";
import {productionAIPool} from "../store.server";
import {productionAccountDependencies} from "./production.server";
import {createConnectionStore} from "./connections.server";
import {createConnectionService} from "./connector-service.server";
import {createProjectOAuth} from "./oauth.server";
import {createProjectWebhooks} from "./webhooks.server";
import {createConnectionRoutes} from "./connection-http.server";
import {ProjectError} from "./types";
let connections:ReturnType<typeof createConnectionStore>|undefined;
export function productionConnections(){
  if(connections)return connections;
  try{
    const raw=JSON.parse(process.env.PROJECT_CONNECTION_KEYRING??"{}");
    if(typeof raw.active!=="string"||!raw.keys||typeof raw.keys!=="object")throw Error();
    const keys=Object.fromEntries(Object.entries(raw.keys).map(([version,value])=>{if(!/^[A-Za-z0-9-]{1,32}$/.test(version)||typeof value!=="string")throw Error();const bytes=Buffer.from(value,"base64");if(bytes.length!==32||bytes.toString("base64")!==value)throw Error();return [version,bytes];}));
    return connections=createConnectionStore(productionAIPool(),{active:raw.active,keys});
  }catch{throw new ProjectError("connection-configuration","Private connections are temporarily unavailable.",503);}
}
export const productionProjectOAuth=()=>createProjectOAuth(productionConnections(),process.env.PROJECT_PUBLIC_ORIGIN??"https://programmable.market");
export const productionConnectionService=()=>createConnectionService(productionConnections(),undefined,productionProjectOAuth().refresh);
export const productionProjectWebhooks=()=>createProjectWebhooks(productionAIPool(),productionConnections());
export const productionConnectionRoutes=()=>createConnectionRoutes({...productionAccountDependencies(),store:productionConnections,service:productionConnectionService,oauth:productionProjectOAuth,webhooks:productionProjectWebhooks});
