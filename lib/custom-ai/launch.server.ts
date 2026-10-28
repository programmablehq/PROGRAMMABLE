import "server-only";
import { createHash } from "node:crypto";
import { planComposablePrograms, readComposableProgramBinding } from "./composable-program.server";
import { assertReadyTicket } from "./launch-preparation.server";
import { assertComposableAvailable } from "./composable-release.server";
import { composableModuleSource, ruleSpecHash } from "../../scripts/custom-ai/composable-module.mjs";
import { artifactHash } from "../../scripts/custom-ai/artifact-hash.mjs";
import { decodeFunctionResult, encodeFunctionData, getAddress, getCreateAddress, getCreate2Address, keccak256,
  parseAbi, toHex, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAnyQuoteUsdPriceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { bytesV1, quantityV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { customAIChain, asHash, type CustomAIChain } from "./chain.server";
import { currentCustomAIDeployment, verifyCustomAIDeployment, type CoreDeployment } from "./deployment.server";
import { CustomAIError, type Draft } from "./types";
import { coinBio } from "./coin-setup";
import { parseCoinSettings, type CoinSettings } from "./preview";
import { checkedQuote } from "./preview.server";
import { inspectCustomAIQuote } from "./quote.server";
import { matchesRuntime } from "./runtime";
import { bindCustomAILaunch, customAIPlanHash, customAIPriceTypedData, customAIFactoryAbi,
  planCustomAIPrice, predictCustomAIToken, CUSTOM_AI_BUNDLE_HASH, type LaunchParameters, type LaunchPrice } from "./launch-plan";
import { encodeLaunchValue, decodeLaunchValue } from "./wallet";
import { readCustomAILaunchState } from "./recovery.server";
import { type LaunchSession, type LaunchStep, type StoredLaunchSession } from "./launch-session";
import type { AIStore } from "./store.server";
import { reconcileWalletStep } from "./reconcile-step.server";
import { pendingNonce, receiptState, makeStep } from "./transaction.server";
import { prepareEventFeed } from "./feed.server";
import { eventModuleSource } from "../../scripts/custom-ai/event-module.mjs";
import { checkProgram, programArtifact, programInitCode } from "./program.server";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => JSON.parse(encodeLaunchValue(value));
const zeroModule = { instance: zeroAddress, runtimeHash: zeroHash, configurationHash: zeroHash };
const tokenABI = parseAbi(["function deposit() payable", "function approve(address,uint256) returns (bool)"]);
const hookABI = parseAbi([
  "struct ModuleBinding { address instance; bytes32 runtimeHash; bytes32 configurationHash; }",
  "struct Rewards { address creatorRecipient; uint16 creatorShareBps; ModuleBinding module; }",
  "function initCodeHash(address manager,address factory,address token,address quote,int24 tick,ModuleBinding module,Rewards rewards) pure returns (bytes32)",
]);

export async function loadLaunch(store: AIStore, owner: string, id: string): Promise<StoredLaunchSession> {
  const saved = await store.readObject(owner, "launch", id);
  if (!saved) throw new CustomAIError("missing", "This launch could not be found.", 404);
  return { revision: saved.revision, session: decodeLaunchValue(JSON.stringify(saved.value)) as LaunchSession };
}
export async function saveLaunch(store: AIStore, owner: string, saved: StoredLaunchSession) {
  saved.revision = await store.saveWalletAction(owner, "launch", json(saved.session), saved.revision);
  return saved;
}
async function checkedDraft(store: AIStore, owner: string, id: string): Promise<Draft> {
  const job = await store.read(owner, id), draft = job?.result?.draft;
  if (job?.state !== "completed" || !draft?.artifact || !draft.hookSummary || draft.validation?.status !== "passed"
    || draft.lifecycle?.status !== "passed" || draft.lifecycle.bundleHash !== CUSTOM_AI_BUNDLE_HASH
    || artifactHash(draft.artifact) !== draft.validation.artifactHash
    || createHash("sha256").update(draft.source).digest("hex") !== draft.sourceHash) {
    throw new CustomAIError("draft", "Build your hook in the chat before creating the coin.", 422);
  }
  checkProgram(draft);
  if (draft.composable && (draft.composable.specHash !== ruleSpecHash(draft.composable.spec) || draft.source.trim() !== composableModuleSource(draft.composable.spec, draft.composable.feeds).trim())) throw new CustomAIError("rules", "The saved combined rules changed. Recheck the design.", 422);
  if (draft.feed && draft.source.replace(/\n?\/\/ @programmable-program-v1 [^\n]*/g, "").trim() !== eventModuleSource(draft.feed).trim()) throw new CustomAIError("feed", "The saved event rule differs from its checked source.", 422);
  return draft;
}
export async function checkedDeployment(chain: CustomAIChain, account: Address): Promise<CoreDeployment> {
  const deployment = currentCustomAIDeployment(chain.chainId);
  const canary = process.env.CUSTOM_AI_CANARY_WALLETS?.split(",").map(value => value.trim().toLowerCase()).includes(account.toLowerCase());
  if (!deployment || deployment.status !== "active" && !canary
    || deployment.status === "active" && !/^[a-f0-9]{64}$/.test(deployment.acceptanceEvidenceHash ?? "")) {
    throw new CustomAIError("deployment", "Coin creation is not available on this network yet.", 503);
  }
  await verifyCustomAIDeployment(chain, deployment);
  return deployment;
}

export async function createLaunchSession(store: AIStore, owner: string, wallets: readonly Address[], input: {
  id: string; account: string; draftId: string; imageId: string; settings: CoinSettings;
  reviewedSourceHash?: string; readyTicket?: string;
}): Promise<StoredLaunchSession> {
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(input.id)) throw new CustomAIError("input", "Invalid launch request.");
  const account = getAddress(input.account);
  if (!wallets.some(wallet => wallet.toLowerCase() === account.toLowerCase())) throw new CustomAIError("wallet", "Select a wallet connected to this account.", 403);
  const settings = parseCoinSettings(input.settings);
  const inputHash = digest({ account, draftId: input.draftId, imageId: input.imageId, settings });
  const existing = await store.readObject(owner, "launch", input.id);
  if (existing) {
    const saved = await loadLaunch(store, owner, input.id);
    if (saved.session.inputHash !== inputHash) throw new CustomAIError("conflict", "This launch already has different settings.", 409);
    return saved;
  }
  const image = await store.readObject<{ url: string }>(owner, "image", input.imageId);
  if (!image || image.value.url !== settings.imageURI) throw new CustomAIError("image", "Choose and upload your coin image first.");
  const draft = await checkedDraft(store, owner, input.draftId);
  if (input.readyTicket) await assertReadyTicket(store, owner, input.readyTicket, { draftId: input.draftId, account, imageId: input.imageId, settings }, draft.sourceHash);
  if (draft.verification?.status !== "passed" || draft.verification.sourceHash !== draft.sourceHash
    || !draft.verification.checks.length || draft.verification.cases !== draft.verification.checks.length * 4
    || input.reviewedSourceHash !== draft.sourceHash) {
    throw new CustomAIError("rules", "Finish checking this exact draft in the chat before launching.", 422);
  }
  if (draft.composable) await assertComposableAvailable(draft.composable);
  if (draft.feed) {
    if (draft.feed.chainId !== settings.chainId) throw new CustomAIError("feed", "Recheck the event rule after changing its network.", 422);
    if (process.env.CUSTOM_AI_EVENTS_ENABLED !== "true"
      && !process.env.CUSTOM_AI_CANARY_WALLETS?.toLowerCase().split(",").map(value => value.trim()).includes(account.toLowerCase())) throw new CustomAIError("feed", "Event launches are prepared for testing; public launch is not enabled yet.", 503);
    const current = await prepareEventFeed(draft.feed.rule, settings.chainId);
    if (current.runtimeHash !== draft.feed.runtimeHash || current.address !== draft.feed.address) throw new CustomAIError("feed", "The selected feed changed. Recheck the draft.", 422);
  }
  if (draft.program) {
    if (draft.program.chainId !== settings.chainId || draft.program.quote.toLowerCase() !== settings.quote.toLowerCase()) {
      throw new CustomAIError("program", "Recheck the program in the chat after changing its network or pair.", 422);
    }
    if (process.env.CUSTOM_AI_PROGRAMS_ENABLED !== "true"
      && !process.env.CUSTOM_AI_CANARY_WALLETS?.toLowerCase().split(",").map(value => value.trim()).includes(account.toLowerCase())) {
      throw new CustomAIError("program", "Funded programs are prepared for testing; public launch is not enabled yet.", 503);
    }
  }
  const chain = await customAIChain(settings.chainId);
  await checkedDeployment(chain, account);
  const quote = await inspectCustomAIQuote(settings.chainId, settings.quote, chain, account);
  if (quote.status !== "compatible") throw new CustomAIError("quote", quote.message || "This pair token could not be verified.", 422);
  const priced = await launchPrice(settings, chain);
  if (priced.checked.quote.decimals !== quote.decimals) throw new CustomAIError("quote", "The pair token changed during preparation.", 409);
  const amount = BigInt(priced.checked.quote.initialBuyRaw);
  const balance = BigInt(await chain.call(settings.quote, "function balanceOf(address) view returns (uint256)", [account]) as bigint);
  const native = BigInt(await chain.agreed("eth_getBalance", [account, chain.reference], value => quantityV1(value).toString()));
  if (balance < amount && (settings.quote.toLowerCase() !== chain.profile.wrappedEth.address.toLowerCase() || native <= amount - balance)) {
    throw new CustomAIError("balance", "Your wallet needs enough for the initial buy and network fees.", 422);
  }
  await chain.finish();
  const description = coinBio(settings.name, draft.hookSummary);
  if (Buffer.byteLength(description) > 280) throw new CustomAIError("bio", "The coin description is too long. Ask for a shorter hook description.");
  const session: LaunchSession = { id: input.id, inputHash, account, chainId: settings.chainId, settings, description,
    draftId: input.draftId, imageId: input.imageId, sourceHash: draft.sourceHash, artifactHash: draft.validation!.artifactHash,
    coreBundleHash: CUSTOM_AI_BUNDLE_HASH, launchSalt: keccak256(toHex(`${owner}:${input.id}`)), state: "preparing", steps: [],
    ...(draft.program ? { program: draft.program } : {}),
    ...(draft.composable ? { composable: draft.composable } : {}),
    ...(quote.message ? { quoteNotice: quote.message } : {}), priceEvidence: priced.evidence };
  await store.createLaunch(owner, input.id, json(session), `${settings.chainId}:${account.toLowerCase()}`);
  return loadLaunch(store, owner, input.id);
}

export async function launchPrice(settings: CoinSettings, chain: CustomAIChain) {
  const wrapped = chain.profile.wrappedEth.address;
  const quotePromise = readAnyQuoteUsdPriceV1({ quoteAsset: settings.quote }, { chainId: chain.chainId, pricePurpose: "module-launch" });
  const [quoteReference, ethReference] = await Promise.all([quotePromise,
    settings.quote.toLowerCase() === wrapped.toLowerCase() ? quotePromise
      : readAnyQuoteUsdPriceV1({ quoteAsset: wrapped }, { chainId: chain.chainId, pricePurpose: "module-launch" })]);
  return { checked: checkedQuote(quoteReference, ethReference, settings, Math.floor(Date.now()/1000)),
    evidence: { quoteReference, ethReference } };
}

async function prepareFinalOrder(chain: CustomAIChain, deployment: CoreDeployment, session: LaunchSession) {
  const key = process.env.CUSTOM_AI_PRICE_SIGNER_KEY;
  if (!key || !/^0x[0-9a-f]{64}$/i.test(key)) throw new CustomAIError("signer", "Launch pricing is temporarily unavailable.", 503);
  const signer = privateKeyToAccount(key as Hex);
  if (signer.address.toLowerCase() !== deployment.priceSigner.toLowerCase()) throw Error("Incorrect launch signer");
  const { checked: priced, evidence } = await launchPrice(session.settings, chain);
  session.priceEvidence = evidence;
  // observedAt is the independently checked chain observation supporting this
  // attestation. Original oracle round timestamps remain in the price evidence.
  const price: LaunchPrice = { quoteUsdE18: BigInt(priced.quote.usdE18), ethUsdE18: BigInt(priced.quote.ethUsdE18),
    observedAt: BigInt(chain.block.timestamp), validUntil: BigInt(Math.min(priced.expiresAt, Number(chain.block.timestamp)+120)) };
  const parameters: LaunchParameters = { metadata: { name: session.settings.name, symbol: session.settings.symbol,
    description: session.description, imageURI: session.settings.imageURI, website: "", socialData: "0x" },
    quote: session.settings.quote, quoteDecimals: priced.quote.decimals, initialTick: 0, launchSalt: session.launchSalt, hookSalt: zeroHash,
    feeModule: session.module!, rewards: { creatorRecipient: session.account, creatorShareBps: session.composable ? session.composable.spec.creatorShareBps : 10000 - (session.program?.spec.rewardShareBps ?? 0), module: session.rewardModule ?? zeroModule },
    initialBuyQuote: BigInt(priced.quote.initialBuyRaw), minimumBuyTokens: 1n, maximumFeeBps: 1500, deadline: price.validUntil };
  const token = predictCustomAIToken(deployment.factory.address, session.account, parameters);
  parameters.initialTick = planCustomAIPrice(token, parameters.quote, parameters.quoteDecimals, price.quoteUsdE18).initialTick;
  const data = encodeFunctionData({ abi: hookABI, functionName: "initCodeHash", args: [chain.profile.infrastructure.poolManager.address,
    deployment.factory.address, token, parameters.quote, parameters.initialTick, parameters.feeModule, parameters.rewards] });
  const bytecodeHash = decodeFunctionResult({ abi: hookABI, functionName: "initCodeHash", data:
    await chain.agreed("eth_call", [{ to: deployment.hookDeployer.address, data }, chain.reference], bytesV1) });
  let found = false;
  for (let i = 0; i < 1_000_000; i++) {
    const salt = toHex(BigInt(i), { size: 32 });
    const address = getCreate2Address({ from: deployment.hookDeployer.address, bytecodeHash, salt });
    if ((BigInt(address) & 16383n) === 8396n) { parameters.hookSalt = salt; found = true; break; }
  }
  if (!found) throw new CustomAIError("salt", "The hook address could not be prepared. Try again.", 503);
  const sign = async () => bindCustomAILaunch({
    ...(session.composable && session.programPlan && session.rewardModule ? { rewardProgram: { version: "composable-v2" as const,
      specHash: session.composable.specHash, bundleHash: session.programPlan.bundleHash, binding: session.rewardModule, creatorShareBps: parameters.rewards.creatorShareBps } } : {}),
    ...(session.program && session.rewardModule ? { rewardProgram: { bundleHash: session.program.bundleHash,
      binding: session.rewardModule, creatorShareBps: parameters.rewards.creatorShareBps } } : {}), chainId: chain.chainId, factory: deployment.factory.address, account: session.account,
    sourceHash: session.sourceHash, artifactHash: session.artifactHash, coreBundleHash: session.coreBundleHash, predictedToken: token,
    parameters, price, priceSigner: signer.address, signature: await signer.signTypedData(customAIPriceTypedData(chain.chainId,
      deployment.factory.address, customAIPlanHash(chain.chainId, deployment.factory.address, session.account, parameters), price)) }, BigInt(Math.floor(Date.now()/1000)));
  const trial = await sign();
  const simulated = decodeFunctionResult({ abi: customAIFactoryAbi, functionName: "launch", data:
    await chain.agreed("eth_call", [{ from: session.account, to: deployment.factory.address, data: trial.transaction.data, value: "0x0" }, chain.reference], bytesV1) });
  if (simulated.token.toLowerCase() !== token.toLowerCase() || simulated.initialBuyTokens <= 1n) throw new CustomAIError("simulation", "The initial buy could not be verified.", 422);
  parameters.minimumBuyTokens = simulated.initialBuyTokens * 99n / 100n;
  session.order = await sign();
  return {...await makeStep(chain, session, "launch", deployment.factory.address, session.order.transaction.data, 0n, Number(price.validUntil)),launchOrder:session.order};
}

export async function advanceLaunch(store: AIStore, owner: string, saved: StoredLaunchSession): Promise<StoredLaunchSession> {
  const session = saved.session;
  if (["confirmed","failed"].includes(session.state)) return saved;
  const chain = await customAIChain(session.chainId);
  const deployment = await checkedDeployment(chain, session.account);
  if (session.coreBundleHash !== CUSTOM_AI_BUNDLE_HASH) throw new CustomAIError("core", "This launch uses an earlier core. Keep it for recovery.", 409);
  if (await reconcileWalletStep(chain,session)) {
    const recovered=session.steps.at(-1);
    if (recovered?.launchOrder) session.order=recovered.launchOrder;
    saved=await saveLaunch(store,owner,saved);
    if (session.state==="failed") return saved;
  }
  const last = session.steps.at(-1);
  if (last?.state === "dispatching" && !last.hash) {
    last.state="prepared";session.state="ready";
    saved=await saveLaunch(store,owner,saved);
  }
  if (last?.state === "dispatching" || last?.state === "submitted") {
    const state = await receiptState(chain, last);
    if (state === "pending") { session.state = "waiting"; return saved; }
    last.state = state;
    if (state === "failed") { session.state = "failed"; return saveLaunch(store, owner, saved); }
    if (last.kind === "launch") {
      const canonical = await readCustomAILaunchState(session.order!, { version: 1, order: session.order!,
        state: "submitted", transactionHash: last.hash!, updatedAt: Date.now() }, chain);
      if (canonical.state !== "confirmed") { last.state = "submitted"; session.state = "waiting"; return saved; }
      session.state = "confirmed"; session.token = session.order!.predictedToken;
      return saveLaunch(store, owner, saved);
    }
    // Persist observed completion before any further price/simulation call.
    saved = await saveLaunch(store, owner, saved);
  }
  if (last?.state === "prepared" && last.expiresAt > Math.floor(Date.now()/1000) + 10) return saved;
  const draft = await checkedDraft(store, owner, session.draftId);
  if (draft.sourceHash !== session.sourceHash || draft.validation!.artifactHash !== session.artifactHash) throw Error("Draft changed");
  if (draft.composable?.spec.actions.length) {
    const release = await assertComposableAvailable(draft.composable);
    const decimals = Number(await chain.call(session.settings.quote, "function decimals() view returns (uint8)"));
    const plan = session.programPlan ?? await planComposablePrograms(draft.composable, chain, { programFactory: getAddress(release.programFactory),
      coreFactory: deployment.factory.address, account: session.account, launchSalt: session.launchSalt, quote: session.settings.quote, quoteDecimals: decimals });
    session.programPlan = plan;
    const completed = session.steps.find(step => step.kind === "program" && step.state === "confirmed");
    if (!completed) {
      const next = await makeStep(chain, session, "program", plan.factory, plan.data);
      if (last?.state === "prepared") last.state = "rejected";
      session.steps.push(next); session.state = "ready"; return saveLaunch(store, owner, saved);
    }
    if (completed.transaction.to !== plan.factory || completed.transaction.data !== plan.data) throw new CustomAIError("program", "The saved program request differs from this design.", 409);
    session.rewardModule = await readComposableProgramBinding(chain, plan);
  }
  if (draft.program) {
    const decimals = Number(await chain.call(session.settings.quote, "function decimals() view returns (uint8)"));
    const data = programInitCode(draft, { factory: deployment.factory.address, account: session.account,
      launchSalt: session.launchSalt, quote: session.settings.quote, quoteDecimals: decimals });
    const completedProgram = session.steps.find(step => step.kind === "program" && step.state === "confirmed");
    if (!completedProgram) {
      const next = await makeStep(chain, session, "program", null, data);
      if (last?.state === "prepared") last.state = "rejected";
      session.steps.push(next); session.state = "ready";
      return saveLaunch(store, owner, saved);
    }
    if (completedProgram.transaction.data !== data) throw new CustomAIError("program", "The program configuration changed. Keep this launch for recovery.", 409);
    const instance = getCreateAddress({ from: session.account, nonce: BigInt(completedProgram.transaction.nonce) });
    const code = await chain.code(instance);
    if (!matchesRuntime(code, programArtifact)) throw new CustomAIError("program", "The deployed reward program differs from the checked template.", 409);
    session.rewardModule = { instance, runtimeHash: keccak256(code),
      configurationHash: asHash(await chain.call(instance, "function configurationHash() view returns (bytes32)")) };
  }
  const moduleStep = session.steps.find(step => step.kind === "module" && step.state === "confirmed");
  let next: LaunchStep;
  if (!moduleStep) next = await makeStep(chain, session, "module", null, draft.artifact!.initCode);
  else {
    const instance = getCreateAddress({ from: session.account, nonce: BigInt(moduleStep.transaction.nonce) });
    const code = await chain.code(instance);
    if (!matchesRuntime(code, draft.artifact!)) throw new CustomAIError("module", "The deployed hook differs from your checked draft.", 409);
    const configurationHash = asHash(await chain.call(instance, "function configurationHash() view returns (bytes32)"));
    session.module = { instance, runtimeHash: keccak256(code), configurationHash };
    const quote = await inspectCustomAIQuote(session.chainId, session.settings.quote, chain, session.account);
    if (quote.status !== "compatible") throw new CustomAIError("quote", quote.message || "This pair could not be checked.", 422);
    const { initialBuyRaw } = await import("./preview");
    const amount = BigInt(initialBuyRaw(session.settings.initialBuy, quote.decimals));
    const balance = BigInt(await chain.call(session.settings.quote, "function balanceOf(address) view returns (uint256)", [session.account]) as bigint);
    if (balance < amount && session.settings.quote.toLowerCase() === chain.profile.wrappedEth.address.toLowerCase()) {
      next = await makeStep(chain, session, "wrap", session.settings.quote, encodeFunctionData({ abi: tokenABI, functionName: "deposit" }), amount-balance);
    } else if (balance < amount) throw new CustomAIError("balance", "Your wallet needs more of the selected pair token for the initial buy.", 422);
    else {
      const allowance = BigInt(await chain.call(session.settings.quote, "function allowance(address,address) view returns (uint256)", [session.account, deployment.factory.address]) as bigint);
      if (allowance < amount) next = await makeStep(chain, session, allowance ? "reset-approval" : "approve", session.settings.quote,
        encodeFunctionData({ abi: tokenABI, functionName: "approve", args: [deployment.factory.address, allowance ? 0n : amount] }));
      else next = await prepareFinalOrder(chain, deployment, session);
    }
  }
  // Keep expired/rejected entries in the journal; only an unsent step may be replaced.
  if (last?.state === "prepared") last.state = "rejected";
  session.steps.push(next); session.state = "ready";
  return saveLaunch(store, owner, saved);
}

export async function dispatchLaunchStep(store: AIStore, owner: string, saved: StoredLaunchSession, stepId: string) {
  const step = saved.session.steps.at(-1);
  if (!step || step.id !== stepId || step.state !== "prepared" || step.expiresAt <= Math.floor(Date.now()/1000)+5) {
    throw new CustomAIError("step", "Refresh this launch before opening your wallet.", 409);
  }
  const chain = await customAIChain(saved.session.chainId);
  await checkedDeployment(chain, saved.session.account);
  if (await pendingNonce(chain, saved.session.account) !== BigInt(step.transaction.nonce)) throw new CustomAIError("nonce", "Your wallet changed. Refresh this launch.", 409);
  // Re-run the exact request immediately before reserving the wallet dispatch.
  const gasEstimates = await Promise.all(chain.rpcs.map(async rpc => quantityV1(await rpc("eth_estimateGas", [{ ...step.transaction, chainId: toHex(chain.chainId), ...(step.transaction.to === null ? { to: undefined } : {}) }]))));
  if (gasEstimates.some(gas => gas > BigInt(step.transaction.gas))) throw new CustomAIError("gas", "Refresh the launch gas estimate before signing.", 409);
  step.state = "dispatching"; step.walletRejected=false; step.dispatchedAt ??= Date.now(); saved.session.state = "waiting";
  return saveLaunch(store, owner, saved);
}
