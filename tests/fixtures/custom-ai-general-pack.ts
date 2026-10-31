import { createHash } from "node:crypto";
import sharp from "sharp";
import captured from "./custom-ai-launch-discovery.json";
import protection from "./custom-ai-launch-protection.json";
import { PROGRAMMABLE_TOKEN_IMAGE_HOST } from "../../lib/token-image";
import { projectLaunchProductionContext } from "../../lib/custom-ai/launch-production.server";
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../../lib/custom-ai/check-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../../lib/custom-ai/contract-project";
import { compileContractProject } from "../../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios } from "../../lib/custom-ai/behavior-checks.server";
import { checkedGeneralLaunchSource } from "../../lib/custom-ai/general-launch-source.server";
import { generalProjectView } from "../../lib/custom-ai/project-view";
import { selectExecutionRoute, type BuilderChainId } from "../../lib/custom-ai/execution-routing";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../../lib/custom-ai/coin-setup";
import { createGeneralPublicSource, generalSourcePublicUri } from "../../lib/custom-ai/public-launch-source.server";
import type { LaunchIntent } from "../../lib/custom-ai/launch-intent";
import type { GeneralPackInput } from "../../lib/custom-ai/general-pack-config.server";

/** Actual compiler + isolated declared examples, never an LP, fee, protected
 * review or mainnet acceptance fixture. It intentionally lacks those proofs. */
export async function generalPackFixture(chain: BuilderChainId = 1, unstable = false, extraTargets = 0): Promise<GeneralPackInput> {
  if(!Number.isSafeInteger(extraTargets)||extraTargets<0||extraTargets>13)throw Error("Bounded fixture target count exceeded");
  const owner = "pack-fixture-owner", controller = `0x${"11".repeat(20)}` as const, conversation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "general-pack-source-00001";
  const production = projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain, protection);
  const intent: LaunchIntent = { version: 1, id: "pack-fixture", revision: "a".repeat(64), changes: [], unresolved: [], requirements: [
    { id: "marker", text: "The declared public marker returns42", kind: "behavior", open: null, origin: { kind: "legacy" } },
    { id: "surface", text: "Only the declared public interfaces exist", kind: "constraint", open: null, origin: { kind: "legacy" } },
  ] };
  const declaration = { targets: [
    { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [{ input: "name" }, { input: "symbol" }, { input: "controller" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
    { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: [{ binding: "pool-manager" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: 8192 },
    { id: "initializer", source: "Project.sol", contract: "Initializer", constructorArguments: [], initializer: { function: "initialize", arguments: [] }, deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
  ], pool: { token: "token", hook: "hook", initializer: "initializer", platformFeeBinding: "hook", fee: 0, tickSpacing: 60 },
  fees: { buyPpm: 30000, sellPpm: 0 }, liquidityModel: "external-concentrated-liquidity" };
  const contracts = [
    { id: "token", source: "Project.sol", contract: "Token", role: "token", arguments: ["Pack Fixture", "PACK", { account: "creator" }],
      functions: ["function name() view returns(string)", "function symbol() view returns(string)", "function controller() view returns(address)", ...(unstable ? ["function start() view returns(uint256)"] : [])], allowReceive: false, allowFallback: false, surfaceRequirements: ["surface"] },
    { id: "hook", source: "Project.sol", contract: "Hook", role: "hook", arguments: [{ account: "creator" }],
      functions: ["function poolManager() view returns(address)", "function beforeInitialize(address,(address,address,uint24,int24,address),uint160) view returns(bytes4)", "function arbitraryProjectMethod() pure returns(uint256)"], allowReceive: false, allowFallback: false, surfaceRequirements: ["surface"] },
    { id: "initializer", source: "Project.sol", contract: "Initializer", role: "liquidity", arguments: [], functions: ["function initialize() payable"], allowReceive: false, allowFallback: false, surfaceRequirements: ["surface"] },
  ];
  for(let index=0;index<extraTargets;index++){
    declaration.targets.push({id:`aux${index}`,source:"Project.sol",contract:`Aux${index}`,constructorArguments:[],initializer:null,
      deploymentValue:"0",initializerValue:"0",hookPermissions:null});
    contracts.push({id:`aux${index}`,source:"Project.sol",contract:`Aux${index}`,role:"auxiliary",arguments:[],functions:[],allowReceive:false,allowFallback:false,surfaceRequirements:["surface"]});
  }
  const blueprint = createGeneralCheckBlueprint({ contracts, allowedCalls: [], deployment: declaration, steps: [
    { id: "marker", contract: "hook", signature: "arbitraryProjectMethod()", arguments: [], from: "trader-a", afterSeconds: 0, value: "0", read: true,
      requirementIds: ["marker"], expect: { status: "success", returns: ["42"] } },
  ] }, intent, chain, "paris", production);
  const content = `pragma solidity 0.8.26;
contract Token { string public name; string public symbol; address public immutable controller;
${unstable ? "uint256 public immutable start;" : ""}
constructor(string memory name_,string memory symbol_,address controller_) { name=name_;symbol=symbol_;controller=controller_;${unstable ? "start=block.timestamp;" : ""} } }
contract Hook { address public immutable poolManager; constructor(address manager_) {poolManager=manager_;}
struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
function beforeInitialize(address,PoolKey calldata,uint160) external view returns(bytes4) { require(msg.sender==poolManager);return this.beforeInitialize.selector; }
function arbitraryProjectMethod() external pure returns(uint256) {return 42;} }
contract Initializer { function initialize() external payable {} }
`+Array.from({length:extraTargets},(_,index)=>`contract Aux${index} {}\n`).join("");
  const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "paris" },
    sources: { "Project.sol": { content } }, entrypoints: blueprint.entrypoints }, intent, chain, production, blueprint.deployment);
  const compilation = await compileContractProject(project);
  if (!compilation.compiled) throw Error("Pack fixture did not compile");
  const scenarios = await checkGeneralScenarios(project, compilation, bindGeneralCheckBlueprint(blueprint, project));
  if (!scenarios.passed) throw Error(`Pack fixture examples failed: ${scenarios.failures.map(f => f.code).join()}`);
  const view = generalProjectView({ version: 1, reply: "Fixture source saved", summary: "Declared marker", project, compilation, scenarios,
    blueprintId: blueprint.id, selection: selectExecutionRoute(intent, chain), requirementCoverage: "proposed", launchReady: false });
  const imageBytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#607050" } }).webp().toBuffer();
  const hash = createHash("sha256").update(imageBytes).digest("hex"), imageId = createHash("sha256").update(`${owner}:${hash}`).digest("hex");
  const settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: chain, name: "Pack Fixture", symbol: "PACK", initialBuy: "0.01",
    description: "An exact-source local compiler and package fixture.", website: "https://example.com/", x: "https://x.com/fixture_coin" });
  const result = { reply: "Fixture source saved", intent, generalProject: view, change: "applied" as const }, request = { id, intent: "build" as const,
    conversation: { id: conversation, account: controller, revision: 1 }, coin: settings, messages: [{ role: "user" as const, content: "Private packing fixture request must not be public" }] };
  const source = checkedGeneralLaunchSource(owner, { id, account: controller, conversation, studioRevision: 1, chainId: chain,
    projectHash: project.hash, artifactHash: compilation.artifactHash, intentRevision: intent.revision }, {
    conversation: { id: conversation, account: controller, archived: false, title: "Private packing fixture",
      createdAt: "2026-10-31T00:00:00.000Z" }, studioRevision: 1,
    studio: { settings, draftId: id, contextId: id, messages: request.messages, image: { id: imageId, hash, url: `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/custom-ai-${imageId}.webp` } },
    sourceJob: { state: "completed", payloadHash: "b".repeat(64), request, result }, contextJob: { state: "completed", request, result },
    checkpoint: { version: 1, requestId: id, payloadHash: "b".repeat(64), project, compilation, scenarios, blueprintId: blueprint.id },
    declared: { version: 1, requestId: id, payloadHash: "b".repeat(64), intent, blueprint },
  });
  const exported = createGeneralPublicSource(source), now = Math.floor(Date.now() / 1000);
  return { source, exported, url: generalSourcePublicUri(exported.id), controller, imageBytes,
    identity: { nonce: `0x${"22".repeat(32)}`, sourceLineageNonce: "1", validAfter: String(now), deadline: String(now + 600), checkedAt: new Date(now * 1000).toISOString() } };
}
