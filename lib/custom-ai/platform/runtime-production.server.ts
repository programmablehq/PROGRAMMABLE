import "server-only";
import {productionAIPool} from "../store.server";
import {productionPlatformStore,productionPlatformArtifacts} from "./production.server";
import {readProjectKeyring,createProjectSecretBox} from "./secrets.server";
import {createRuntimeDataStore} from "./runtime-data.server";
import {createProjectReleases} from "./releases.server";
import {createVercelHostingProvider} from "./hosting-provider.server";
import {createSandboxExecutor} from "./sandbox-executor.server";
import {vercelSandboxProvider} from "./sandbox-provider.server";
import {createProjectChecks} from "./builds.server";
import {createAppPackager,createAppPackageLoader} from "./app-package.server";
import {createAppJobs} from "./jobs.server";
import {privateConnectorHTTP} from "./private-http.server";
export function productionRuntimeData(){return createRuntimeDataStore(productionAIPool(),createProjectSecretBox(readProjectKeyring()));}
export function productionAppJobs(){return createAppJobs(productionAIPool(),productionRuntimeData(),privateConnectorHTTP);}
export function productionAppReleases(){
 const projects=productionPlatformStore(),sandbox=createSandboxExecutor(productionAIPool(),projects,vercelSandboxProvider);
 return createProjectReleases(productionAIPool(),{projects,data:productionRuntimeData(),pack:createAppPackager(sandbox,productionPlatformArtifacts()),loadPackage:createAppPackageLoader(productionPlatformArtifacts()),
   assess:createProjectChecks(productionAIPool(),projects,sandbox).assess,
   provider:createVercelHostingProvider({token:process.env.PROJECT_HOSTING_VERCEL_TOKEN??"",teamId:process.env.PROJECT_HOSTING_TEAM_ID??"team_x9QVubeZTF27TMYRLZWRvltj"}),
   platformOrigin:process.env.PROJECT_PUBLIC_ORIGIN??"https://programmable.market"});
}
