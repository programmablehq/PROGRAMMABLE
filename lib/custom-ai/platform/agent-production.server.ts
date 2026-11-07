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

export function productionProjectChecks() {
  const projects = productionPlatformStore();
  return createProjectChecks(productionAIPool(), projects, createSandboxExecutor(productionAIPool(), projects, vercelSandboxProvider));
}
export function productionProjectAgent() {
  const projects = productionPlatformStore(), checks = productionProjectChecks();
  const sandbox = createSandboxExecutor(productionAIPool(), projects, vercelSandboxProvider);
  return createProjectAgent({ runs: productionRunStore(), projects, choose: chooseProjectAction, assess: checks.assess,
    tools: [...createProjectTools(projects,sandbox,checks), ...contractProjectTools(productionPlatformArtifacts(),checks)] });
}
