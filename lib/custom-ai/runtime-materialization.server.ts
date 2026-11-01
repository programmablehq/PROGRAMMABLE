import "server-only";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { concatHex, encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, type Address, type Hex } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import { resolveGeneralDeploymentValues } from "./deployment-values.server";
import type { CoinSetup } from "./coin-setup";
import { CustomAIError } from "./types";
import { ROBINHOOD_PLAN_DEPLOYER } from "./plan-deployer";
import { constructorDependencyState, type ObservedConstructorDependencies } from "./dependency-witness";
import type { LaunchProductionContext } from "./launch-production";
import type { LaunchDependencyObservation } from "./dependency-observations.server";
import type { ObservedOpeningPreparation } from "./opening-inputs.server";

export type GeneralDeploymentPrediction = { targetId: string; predictedAddress: Address; effectiveSalt: Hex; resolvedConstructorArguments: Hex };
export type GeneralRuntimeDependencyResolver = (production: LaunchProductionContext, caller: Address, signal?: AbortSignal, pinned?: LaunchDependencyObservation) => Promise<ObservedConstructorDependencies>;
type RuntimeResult = { status: "materialized" | "needs-context"; passes: number; gasUsed: string; failures: { target: string; code: string }[];
  contracts: { id: string; runtimeCode: Hex; runtimeCodeHash: Hex; runtimeImmutables: { immutableId: string; abiType: "bytes32"; literal: Hex }[] }[];
  children?: { id: string; parent: string; nonce: string; address: Address; runtimeCode: Hex; runtimeCodeHash: Hex; runtimeImmutables: { immutableId: string; abiType: "bytes32"; literal: Hex }[] }[];
  constructionGas?: {targetId:string;maximumGasUsed:string}[];
  openingState?: { token: Address; hook: Address; supply: string; decimals: 18; sqrtPriceX96: string; passes: 2 } };
const invalid = (): never => { throw new CustomAIError("runtime-context", "The launch details changed. Refresh this preparation. Your design is saved.", 409); };
export class GeneralRuntimeContextIncomplete extends CustomAIError {
  readonly findings: readonly Readonly<{ target: string; code: string }>[];
  constructor(findings: RuntimeResult["failures"]) {
    super("runtime-dependency", findings.some(finding=>finding.code.startsWith("opening-state-"))
      ? "The token amount or opening price does not match this saved design. Update it before preparing the launch."
      : "This contract needs additional network information before launch preparation. Your design is saved.", 422);
    this.findings = Object.freeze(findings.slice(0, 16).map(finding => Object.freeze({ target: finding.target, code: finding.code })));
  }
}

export async function materializeGeneralRuntime(project: ContractProject, compilation: CompiledProject,
  selected: { controller: Address; settings: CoinSetup; nativeFundingWei?: string; opening?: ObservedOpeningPreparation;
    planDeployer?: typeof ROBINHOOD_PLAN_DEPLOYER; observedDependencies?: ObservedConstructorDependencies;
    resolveObservedDependencies?: GeneralRuntimeDependencyResolver }, predictions: GeneralDeploymentPrediction[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  project = structuredClone(project); compilation = structuredClone(compilation); predictions = structuredClone(predictions);
  selected = { ...selected, settings: structuredClone(selected.settings),
    ...(selected.opening ? { opening: structuredClone(selected.opening) } : {}),
    ...(selected.planDeployer ? { planDeployer: structuredClone(selected.planDeployer) } : {}),
    ...(selected.observedDependencies ? { observedDependencies: structuredClone(selected.observedDependencies) } : {}) };
  if (selected.observedDependencies && selected.resolveObservedDependencies) return invalid();
  const values = resolveGeneralDeploymentValues(project, compilation, selected);
  const production = project.production!;
  // The Atomic executor calls an external deployment proxy. Its own address
  // is not a CREATE2 factory and must never stand in for that dependency.
  if (production.route === "plan-v1" ? !selected.planDeployer
    || selected.planDeployer.address !== ROBINHOOD_PLAN_DEPLOYER.address
    || selected.planDeployer.runtimeCodeHash !== ROBINHOOD_PLAN_DEPLOYER.runtimeCodeHash
    || selected.planDeployer.transport !== ROBINHOOD_PLAN_DEPLOYER.transport : selected.planDeployer !== undefined) return invalid();
  const factory = production.route === "plan-v1" ? selected.planDeployer!.address : production.graphProfile?.graphFactory;
  if (typeof factory !== "string" || !/^0x(?!0{40}$)[a-f0-9]{40}$/iu.test(factory)) return invalid();
  const deployer = getAddress(factory);
  if (!Array.isArray(predictions) || predictions.length !== values.targets.length
    || predictions.some(value => !value || typeof value.targetId !== "string" || typeof value.predictedAddress !== "string" || !/^0x(?!0{40}$)[a-f0-9]{40}$/iu.test(value.predictedAddress))
    || new Set(predictions.map(value => value.targetId)).size !== predictions.length
    || new Set(predictions.map(value => value.predictedAddress.toLowerCase())).size !== predictions.length) return invalid();
  const byId = new Map(predictions.map(value => [value.targetId, value]));
  const addressById = new Map(predictions.map(value => [value.targetId, value.predictedAddress]));
  function resolve(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      if (Object.keys(value).join() !== "target" || !("target" in value) || typeof value.target !== "string") return invalid();
      return addressById.get(value.target) ?? invalid();
    }
    return value;
  }
  const targets = values.targets.map(target => {
    const prediction = byId.get(target.id), artifact = compilation.contracts.find(artifact => artifact.source === target.source && artifact.contract === target.contract)!;
    if (!prediction || !/^0x[a-f0-9]{64}$/u.test(prediction.effectiveSalt) || !/^0x(?:[a-f0-9]{2})*$/u.test(prediction.resolvedConstructorArguments)) return invalid();
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: target.constructorArguments.map(resolve) });
    if (initCode !== concatHex([artifact.creationBytecode, prediction.resolvedConstructorArguments])
      || getCreate2Address({ from: deployer, salt: prediction.effectiveSalt, bytecodeHash: keccak256(initCode) }).toLowerCase() !== prediction.predictedAddress.toLowerCase()
      || target.role === "hook" && Number(BigInt(prediction.predictedAddress) & 16383n) !== target.hookPermissions) return invalid();
    return { id: target.id, address: prediction.predictedAddress, salt: prediction.effectiveSalt, initCode, value: target.deploymentValueWei,
      runtimeTemplate: artifact.runtimeBytecode, immutableReferences: artifact.immutableReferences };
  });
  const constructorChildren = (values.constructorChildren ?? []).map(child => {
    const parent = addressById.get(child.parent), artifact = compilation.contracts.find(contract => contract.source === child.source && contract.contract === child.contract);
    if (!parent || !artifact) return invalid();
    const address = getContractAddress({ from: parent, nonce: BigInt(child.nonce) });
    if ([...addressById.values()].some(known => known.toLowerCase() === address.toLowerCase())) return invalid();
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: child.constructorArguments.map(resolve) });
    addressById.set(child.id, address);
    return { id: child.id, parent: child.parent, creation: child.creation, nonce: child.nonce, address, initCode,
      constructorArguments: `0x${initCode.slice(artifact.creationBytecode.length)}` as Hex, value: child.valueWei,
      source: child.source, contract: child.contract, runtimeTemplate: artifact.runtimeBytecode, immutableReferences: artifact.immutableReferences };
  });
  const withChildren = project.deployment?.version === 2;
  if (withChildren !== Boolean(constructorChildren.length)) return invalid();
  const opening = values.opening;
  const openingState = opening ? {
    token: addressById.get(values.pool.token) ?? invalid(), hook: addressById.get(values.pool.hook) ?? invalid(),
    supply: opening.inputs.supply, decimals: 18 as const, sqrtPriceX96: opening.inputs.sqrtPriceX96, passes: 2 as const,
  } : undefined;
  const initializerId = values.targets.find(target => target.role === "liquidity")?.id;
  const initializer = initializerId ? byId.get(initializerId)?.predictedAddress : undefined;
  let observedDependencies: ReturnType<typeof constructorDependencyState> | undefined;
  const resolvedDependencies = selected.observedDependencies ?? ((withChildren || opening) && production.protectionBindings && initializer && selected.resolveObservedDependencies
    ? await selected.resolveObservedDependencies(structuredClone(production), initializer, signal, opening?.observation) : undefined);
  signal?.throwIfAborted();
  if (resolvedDependencies) {
    if ((!withChildren && !opening) || !initializer || opening && resolvedDependencies.observation.id !== opening.observation.id) return invalid();
    try { observedDependencies = constructorDependencyState(resolvedDependencies, production, initializer, Date.now()); }
    catch { return invalid(); }
  }
  if (opening && !observedDependencies) return invalid();
  // Snapshot the complete bounded input before waiting for any worker. A later
  // caller mutation cannot change source or constructor data behind the receipt.
  const payload = JSON.stringify({ chainId: project.chainId, evmVersion: project.compiler.evmVersion, controller: values.controller, deployer, targets,
    ...(observedDependencies ? { dependencies: { accounts: observedDependencies.accounts, call: observedDependencies.call } } : {}),
    ...(production.route === "plan-v1" ? {includeConstructionGas:true}:{}), ...((withChildren || opening) ? { constructorChildren } : {}),
    ...(openingState ? { openingState } : {}) });
  if (Buffer.byteLength(payload) > 6_000_000) return invalid();
  const sourceBinding = { chainId: values.chainId, projectHash: project.hash, artifactHash: compilation.artifactHash, productionId: values.productionId, deploymentId: values.deploymentId,
    settingsHash: canonicalBrowserSha256V2("programmable.custom-ai-runtime-settings.v1", values.settings),
    initializationHash: canonicalBrowserSha256V2("programmable.custom-ai-runtime-initialization.v1", values.targets.map(target => ({ id: target.id, initializer: target.initializer, value: target.initializerValueWei }))),
    controller: values.controller, deployer,
    ...(observedDependencies ? { dependencyContext: observedDependencies.context, dependencyProduction: production, dependencyInitializerId: initializerId! } : {}),
    ...(opening ? { openingInputs: opening.inputs } : {}),
    ...(production.route === "plan-v1" ? {deployerRuntimeCodeHash:selected.planDeployer!.runtimeCodeHash}:{}),
    targets: targets.map(target => ({ id: target.id, address: target.address, salt: target.salt,
      initCodeHash: keccak256(target.initCode), value: target.value })),
    ...((withChildren || opening) ? { constructorChildren: constructorChildren.map(child => ({ id: child.id, parent: child.parent, nonce: child.nonce, address: child.address,
      source: child.source, contract: child.contract, constructorArguments: child.constructorArguments, initCodeHash: keccak256(child.initCode), value: child.value })) } : {}) };
  let toolchain: string;
  try { toolchain = await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR ?? join(process.cwd(), "scripts/custom-ai/toolchain")); }
  catch { throw new CustomAIError("runtime-worker", "Launch preparation is temporarily unavailable. Your design is saved.", 503); }
  const worker = join(process.cwd(), withChildren || opening ? "scripts/custom-ai/general-runtime-v2-worker.mjs" : "scripts/custom-ai/general-runtime-worker.mjs");
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${toolchain}`, `--allow-fs-read=${worker}`, "--max-old-space-size=384", worker, toolchain],
      { env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 35_000, maxBuffer: 4_000_000, signal }, (error, stdout) => error
        ? reject(new CustomAIError("runtime-worker", "Launch preparation did not finish. Your design is saved.", 503)) : resolve(stdout));
    child.stdin?.on("error", () => undefined); child.stdin?.end(payload);
  });
  signal?.throwIfAborted();
  const result = JSON.parse(output) as RuntimeResult;
  if (result.status !== "materialized" || result.passes !== 2 || result.failures.length || result.contracts.length !== targets.length)
    throw new GeneralRuntimeContextIncomplete(result.failures);
  for (const target of targets) {
    const contract = result.contracts.find(contract => contract.id === target.id);
    if (!contract || keccak256(contract.runtimeCode) !== contract.runtimeCodeHash) return invalid();
  }
  if ((withChildren || opening) && (!Array.isArray(result.children) || result.children.length !== constructorChildren.length || constructorChildren.some(child => {
    const actual = result.children!.find(candidate => candidate.id === child.id);
    return !actual || actual.parent !== child.parent || actual.nonce !== child.nonce || actual.address !== child.address || keccak256(actual.runtimeCode) !== actual.runtimeCodeHash;
  }))) return invalid();
  if (openingState && canonicalBrowserSha256V2("programmable.custom-ai-opening-state.v1", result.openingState)
    !== canonicalBrowserSha256V2("programmable.custom-ai-opening-state.v1", openingState)) return invalid();
  if (production.route === "plan-v1" && (!Array.isArray(result.constructionGas) || result.constructionGas.length!==targets.length
    || targets.some(target=>result.constructionGas!.filter(gas=>gas.targetId===target.id&&/^[0-9]{1,12}$/u.test(gas.maximumGasUsed)
      &&BigInt(gas.maximumGasUsed)>0n&&BigInt(gas.maximumGasUsed)<=200_000_000n).length!==1))) return invalid();
  if (observedDependencies && observedDependencies.context.observation.expiresAt <= Date.now()) return invalid();
  const body = { ...(observedDependencies ? { version: 3 as const, scope: "observed-constructor-runtime-v3" as const }
    : withChildren ? { version: 2 as const, scope: "isolated-constructor-runtime-v2" as const } : { version: 1 as const, scope: "isolated-constructor-runtime-v1" as const }),
    ...sourceBinding, ...result, launchReady: false as const };
  return { ...body, hash: canonicalBrowserSha256V2(`programmable.custom-ai-runtime-materialization.v${body.version}`, body) };
}
