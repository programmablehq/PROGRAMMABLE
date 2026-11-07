import "server-only";
import { productionAIPool } from "../store.server";
import { productionPlatformStore, productionPlatformArtifacts } from "./production.server";
import { productionRunStore } from "./run-production.server";
import { createSandboxExecutor } from "./sandbox-executor.server";
import { vercelSandboxProvider } from "./sandbox-provider.server";
import { createProjectChecks } from "./builds.server";
import { createProjectTools } from "./tools.server";
import { contractProjectTools } from "./legacy-contract-build.server";
import { chooseProjectAction } from "./model.server";
import { createProjectAgent } from "./agent.server";
import { productionConnections,productionConnectionService } from "./connection-production.server";
import { connectionTools } from "./connection-tools.server";
import { productionAppJobs,productionAppReleases } from "./runtime-production.server";
import { runtimeTools } from "./runtime-tools.server";
import { productionGameEvents } from "./event-production.server";
import { gameEventTools } from "./event-tools.server";
import { productionRepositoryImporter,productionRepositoryDelivery } from "./repository-production.server";
import { repositoryTools } from "./repository-tools.server";

export function productionProjectChecks() {
  const projects = productionPlatformStore();
  return createProjectChecks(productionAIPool(), projects, createSandboxExecutor(productionAIPool(), projects, vercelSandboxProvider));
}
export function productionProjectAgent() {
  const projects = productionPlatformStore(), checks = productionProjectChecks();
  const sandbox = createSandboxExecutor(productionAIPool(), projects, vercelSandboxProvider);
  const releases=productionAppReleases();
  return createProjectAgent({ runs: productionRunStore(), projects, choose: chooseProjectAction, assess: async ref=>{
    const result=await checks.assess(ref);
    const published=(await releases.list(ref)).some(release=>release.revisionId===ref.revisionId&&release.state==="published"&&release.observedAt);
    return {...result,level:published?"deployed":result.level};
  },tools: [...createProjectTools(projects,sandbox,checks), ...contractProjectTools(productionPlatformArtifacts(),checks),...connectionTools(productionConnections(),productionConnectionService()),...runtimeTools(releases,productionAppJobs()),...gameEventTools(productionGameEvents()),...repositoryTools(projects,productionRepositoryImporter(),productionRepositoryDelivery())] });
}
