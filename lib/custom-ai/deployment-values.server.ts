import "server-only";
import { encodeAbiParameters, getAddress, parseEther, zeroAddress, type AbiParameter, type Address } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, type ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import { checkedGeneralDeploymentBlueprint, type DeploymentValue } from "./deployment-blueprint";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP, parseCoinSetupPatch, type CoinSetup } from "./coin-setup";
import { builderChain } from "./execution-routing";
import { CustomAIError } from "./types";
import { checkedObservedOpeningPreparation, type ObservedOpeningPreparation } from "./opening-inputs.server";

type PackerValue = string | boolean | PackerValue[] | { target: string };
const invalid = (): never => { throw new CustomAIError("launch-deployment", "The saved deployment does not match this source, wallet or coin settings. Update the design before preparing it.", 422); };
const uint = (value: string) => /^(?:0|[1-9][0-9]{0,77})$/u.test(value) && BigInt(value) < 2n ** 256n;

/** Resolve an owned declaration into canonical packer inputs. No fixture, model
 * output or ABI encoding here can confer launch authority. The actual source,
 * runtime, graph and admission are still checked by the existing backend. */
export function resolveGeneralDeploymentValues(project: ContractProject, compilation: CompiledProject,
  selected: { controller: Address; settings: CoinSetup; nativeFundingWei?: string; opening?: ObservedOpeningPreparation }) {
  try {
    projectCompilerInput(project);
    if (!project.production || !project.deployment || selected.settings.chainId !== project.chainId) return invalid();
    const controller = getAddress(selected.controller);
    if (BigInt(controller) <= 2n) return invalid();
    const { artifactHash, ...body } = compilation;
    if (!compilation.compiled || compilation.projectHash !== project.hash || compilation.launchReady !== false
      || compilation.verification !== "not-run" || compilation.diagnostics.some(item => item.severity === "error")
      || artifactHash !== canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body)) return invalid();
    const production = project.production, recipe = checkedGeneralDeploymentBlueprint(project.deployment, project.entrypoints, production, project.intent);
    if (selected.opening && !recipe.openingPrice) return invalid();
    const opening = recipe.openingPrice ? checkedObservedOpeningPreparation(production,
      { projectHash: project.hash, artifactHash, ...recipe.openingPrice }, selected.opening) : undefined;
    const settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, parseCoinSetupPatch(selected.settings));
    if (!settings.name || !settings.symbol) return invalid();
    const native = builderChain(project.chainId).currency, nativePair = settings.pairToken === native;
    const quote = nativePair ? zeroAddress : getAddress(settings.pairToken);
    let funding: string | undefined;
    const fundingValue = () => {
      if (funding !== undefined) return funding;
      if (nativePair) {
        // parseEther rounds excessive decimals. Reject them before conversion;
        // a quote-token amount is never silently interpreted as native currency.
        if (!/^(?:0|[1-9][0-9]{0,38})(?:\.[0-9]{1,18})?$/u.test(settings.initialBuy)) return invalid();
        funding = parseEther(settings.initialBuy).toString();
        if (selected.nativeFundingWei !== undefined && selected.nativeFundingWei !== funding) return invalid();
      } else {
        if (selected.nativeFundingWei === undefined) return invalid();
        funding = selected.nativeFundingWei;
      }
      if (!uint(funding)) return invalid();
      return funding;
    };
    const bindings: Record<string, unknown> = { "pool-manager": production.poolManager.address,
      "launch-executor": production.executor.address, "fee-recipient": production.tradeFee.recipient,
      "graph-factory": production.graphProfile?.graphFactory, "permit-authority": production.graphProfile?.permitAuthority,
      "funding-token": production.graphProfile?.fundingToken,
      "swap-router":production.protectionBindings?.swapRouter.address,"swap-router-runtime-hash":production.protectionBindings?.swapRouter.runtimeCodeHash,
      "native-usd-feed":production.protectionBindings?.nativeUsdFeed.address,"native-usd-feed-runtime-hash":production.protectionBindings?.nativeUsdFeed.runtimeCodeHash,
      "sequencer-uptime-feed":production.protectionBindings?.sequencerUptimeFeed,
      "opening-tick":opening?.inputs.initialTick.toString(),"opening-sqrt-price-x96":opening?.inputs.sqrtPriceX96 };
    const resolve = (value: DeploymentValue): PackerValue => {
      if (Array.isArray(value)) return value.map(resolve);
      if (typeof value === "string" || typeof value === "boolean") return value;
      if ("target" in value) return { target: value.target };
      if ("binding" in value) {
        const literal = bindings[value.binding];
        if (typeof literal !== "string") return invalid();
        if (value.binding === "opening-tick" || value.binding === "opening-sqrt-price-x96") return literal;
        if(value.binding==="swap-router-runtime-hash"||value.binding==="native-usd-feed-runtime-hash") {
          if(!/^0x(?!0{64}$)[a-f0-9]{64}$/u.test(literal))return invalid();return literal;
        }
        return getAddress(literal);
      }
      switch (value.input) {
        case "controller": return controller;
        case "name": return settings.name;
        case "symbol": return settings.symbol;
        case "quote": return quote;
        case "funding": return fundingValue();
      }
    };
    const childDefinitions = recipe.version === 2 ? recipe.constructorChildren : [];
    const placeholders = new Map([...recipe.targets, ...childDefinitions].map((target, index) => [target.id, `0x${(0x1000 + index).toString(16).padStart(40, "0")}` as Address]));
    function abiValue(param: AbiParameter, value: PackerValue): unknown {
      const array = /^(.*)\[([0-9]*)\]$/u.exec(param.type);
      if (array) {
        if (!Array.isArray(value) || value.length > 128 || array[2] !== "" && value.length !== Number(array[2])) return invalid();
        return value.map(item => abiValue({ ...param, type: array[1] } as AbiParameter, item));
      }
      if (param.type === "tuple") {
        const components = (param as AbiParameter & { components: readonly AbiParameter[] }).components;
        if (!Array.isArray(value) || value.length !== components.length) return invalid();
        return components.map((component, index) => abiValue(component, value[index]));
      }
      if (param.type === "address") {
        if (typeof value === "object" && value !== null && !Array.isArray(value) && "target" in value) {
          return placeholders.get(value.target) ?? invalid();
        }
        if (typeof value !== "string") return invalid(); return getAddress(value);
      }
      if (typeof value === "object") return invalid();
      if (param.type === "bool") { if (typeof value !== "boolean") return invalid(); return value; }
      if (/^u?int(?:[0-9]+)?$/u.test(param.type)) {
        if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]{0,77})$/u.test(value)) return invalid(); return BigInt(value);
      }
      if (typeof value !== "string") return invalid();
      if (param.type !== "string" && !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) return invalid();
      return value;
    }
    function check(inputs: readonly AbiParameter[], values: PackerValue[]) {
      if (inputs.length !== values.length) return invalid();
      encodeAbiParameters(inputs, inputs.map((input, index) => abiValue(input, values[index])));
    }
    const targets = recipe.targets.map(target => {
      const matches = compilation.contracts.filter(contract => contract.source === target.source && contract.contract === target.contract && contract.role === target.role);
      if (matches.length !== 1) return invalid(); const artifact = matches[0];
      const constructors = artifact.abi.filter(item => item.type === "constructor");
      if (constructors.length > 1) return invalid();
      const constructorArguments = target.constructorArguments.map(resolve);
      check(constructors[0]?.inputs ?? [], constructorArguments);
      const deploymentValueWei = target.deploymentValue === "0" ? "0" : fundingValue();
      if (BigInt(deploymentValueWei) > 0n && constructors[0]?.stateMutability !== "payable") return invalid();
      const initializerValueWei = target.initializerValue === "0" ? "0" : fundingValue();
      let initializer: { function: string; arguments: PackerValue[] } | null = null;
      if (target.initializer) {
        const functions = artifact.abi.filter(item => item.type === "function" && item.name === target.initializer!.function);
        if (functions.length !== 1 || functions[0].type !== "function"
          || BigInt(initializerValueWei) > 0n && functions[0].stateMutability !== "payable") return invalid();
        initializer = { function: target.initializer.function, arguments: target.initializer.arguments.map(resolve) };
        check(functions[0].inputs, initializer.arguments);
      }
      return { id: target.id, source: target.source, contract: target.contract, role: target.role, constructorArguments, initializer,
        deploymentValueWei, initializerValueWei, hookPermissions: target.hookPermissions };
    });
    const constructorChildren = childDefinitions.map(child => {
      const matches = compilation.contracts.filter(contract => contract.source === child.source && contract.contract === child.contract && contract.role === child.role);
      if (matches.length !== 1) return invalid(); const artifact = matches[0], constructors = artifact.abi.filter(item => item.type === "constructor");
      if (constructors.length > 1) return invalid();
      const constructorArguments = child.constructorArguments.map(resolve); check(constructors[0]?.inputs ?? [], constructorArguments);
      const valueWei = typeof child.value === "string" ? child.value : fundingValue();
      if (!uint(valueWei) || BigInt(valueWei) > 0n && constructors[0]?.stateMutability !== "payable") return invalid();
      return { id: child.id, source: child.source, contract: child.contract, role: child.role, parent: child.parent, creation: child.creation,
        nonce: child.nonce, constructorArguments, valueWei };
    });
    const nativeValueWei = targets.reduce((sum, target) => sum + BigInt(target.deploymentValueWei) + BigInt(target.initializerValueWei), 0n).toString();
    if (constructorChildren.some(child => BigInt(child.valueWei) > targets.reduce((sum, target) => sum + BigInt(target.deploymentValueWei), 0n))) return invalid();
    return { version: recipe.version, projectHash: project.hash, artifactHash, productionId: production.id, deploymentId: recipe.id,
      ...(opening ? { opening } : {}),
      chainId: project.chainId, controller, settings, quoteCurrency: quote, nativeValueWei, targets,
      ...(recipe.version === 2 ? { constructorChildren } : {}),
      pool: { ...recipe.pool, quoteCurrency: quote }, launchReady: false as const };
  } catch (error) {
    if (error instanceof CustomAIError) throw error;
    return invalid();
  }
}
