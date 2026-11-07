import "server-only";
import {productionAIPool} from "../store.server";
import {productionPlatformStore} from "./production.server";
import {productionConnections,productionProjectOAuth} from "./connection-production.server";
import {createGitHubRepositoryClient} from "./github.server";
import {createRepositoryImporter,type RepositoryRequest} from "./repository-import.server";
import {createRepositoryDelivery} from "./repository-delivery.server";
import type {ProjectScope} from "./types";
const client=(scope:ProjectScope,input:RepositoryRequest,signal?:AbortSignal)=>createGitHubRepositoryClient({scope,repository:input.repository,signal,
 ...(input.connectionId&&input.connectionVersion?{connection:{id:input.connectionId,version:input.connectionVersion},store:productionConnections(),refresh:productionProjectOAuth().refresh}:{})});
export const productionRepositoryImporter=()=>createRepositoryImporter(productionPlatformStore(),async(scope,input,signal)=>client(scope,input,signal));
export const productionRepositoryDelivery=()=>createRepositoryDelivery(productionAIPool(),productionPlatformStore(),async(scope,input,signal)=>client(scope,input,signal));
