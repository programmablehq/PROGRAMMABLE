import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import { artifactHash } from "../../scripts/custom-ai/artifact-hash.mjs";
import { CUSTOM_AI_BUNDLE_HASH } from "./launch-plan";
import { CustomAIError } from "./types";
import { parseCoinSettings, type CoinSettings } from "./preview";
import type { AIStore } from "./store.server";
import type { LaunchPreparation } from "./readiness";
import { customAIChain } from "./chain.server";
import { checkedDeployment, launchPrice } from "./launch.server";
import { quantityV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { inspectCustomAIQuote } from "./quote.server";
import { makeStep } from "./transaction.server";
import { assertComposableAvailable } from "./composable-release.server";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export type LaunchInputs = { draftId: string; settings: CoinSettings; account: Address; imageId: string };
type Ticket = { input: LaunchInputs; revision: string; sourceHash: string; expiresAt: number };
export async function prepareLaunch(store: AIStore, owner: string, input: LaunchInputs): Promise<LaunchPreparation> {
  const settings = parseCoinSettings(input.settings), account = getAddress(input.account);
  const draft = (await store.read(owner, input.draftId))?.result?.draft;
  if (!draft?.artifact || draft.validation?.status !== "passed" || draft.verification?.status !== "passed" || draft.lifecycle?.status !== "passed"
    || draft.lifecycle.bundleHash !== CUSTOM_AI_BUNDLE_HASH || draft.verification.sourceHash !== draft.sourceHash
    || artifactHash(draft.artifact) !== draft.validation.artifactHash || hashSource(draft.source) !== draft.sourceHash) throw new CustomAIError("rules", "Finish checking this design in the chat first.", 422);
  if (draft.composable) await assertComposableAvailable(draft.composable);
  if (draft.feed && process.env.CUSTOM_AI_EVENTS_ENABLED !== "true" || draft.program && process.env.CUSTOM_AI_PROGRAMS_ENABLED !== "true") throw new CustomAIError("deployment", "This design needs a capability that is not active on this network yet.", 503);
  const image = await store.readObject<{ url: string }>(owner, "image", input.imageId);
  if (image?.value.url !== settings.imageURI) throw new CustomAIError("image", "Choose a coin image first.", 422);
  const revision = hash({ input: { ...input, account, settings }, sourceHash: draft.sourceHash });
  const cached = await store.readObject<Ticket>(owner, "ready-ticket", revision);
  if (cached && cached.value.expiresAt > Date.now() + 15000) return { state: "ready", message: "Ready to launch", revision: draft.sourceHash, ticket: revision, expiresAt: cached.value.expiresAt };
  const chain = await customAIChain(settings.chainId);
  await checkedDeployment(chain, account);
  const [quote, price] = await Promise.all([inspectCustomAIQuote(settings.chainId, settings.quote, chain, account), launchPrice(settings, chain)]);
  if (quote.status !== "compatible" || price.checked.quote.decimals !== quote.decimals) throw new CustomAIError("quote", "The selected pair is not ready for this launch.", 422);
  // Estimate the exact first wallet transaction. Later dependent steps retain
  // their existing nonce, balance and gas checks immediately before signing.
  const step = await makeStep(chain, { id: randomUUID(), account, chainId: settings.chainId, state: "preparing", steps: [] }, "module", null, draft.artifact.initCode);
  const [native, gasPrice, balance] = await Promise.all([
    chain.agreed("eth_getBalance", [account, chain.reference], value => quantityV1(value).toString()),
    chain.agreed("eth_gasPrice", [], value => quantityV1(value).toString()),
    chain.call(settings.quote, "function balanceOf(address) view returns (uint256)", [account]),
  ]);
  const needed = BigInt(price.checked.quote.initialBuyRaw), owned = BigInt(String(balance));
  const wrapped = settings.quote.toLowerCase() === chain.profile.wrappedEth.address.toLowerCase();
  const shortfall = needed > owned ? needed - owned : 0n;
  if ((!wrapped && shortfall > 0n) || BigInt(native) < BigInt(step.transaction.gas) * BigInt(gasPrice) + (wrapped ? shortfall : 0n)) {
    throw new CustomAIError("balance", "Your wallet needs enough for the initial buy and network fees.", 422);
  }
  await chain.finish();
  const expiresAt = Math.min(Date.now() + 45000, price.checked.expiresAt * 1000);
  if (expiresAt <= Date.now()) throw new CustomAIError("price", "Refreshing the price for your launch.", 503);
  await store.saveObject(owner, "ready-ticket", revision, { input: { ...input, account, settings }, sourceHash: draft.sourceHash, revision, expiresAt }, cached?.revision ?? 0);
  return { state: "ready", message: "Ready to launch", revision: draft.sourceHash, ticket: revision, expiresAt };
}
const hashSource = (source: string) => createHash("sha256").update(source).digest("hex");
export async function assertReadyTicket(store: AIStore, owner: string, ticket: string, input: LaunchInputs, sourceHash: string) {
  const saved = await store.readObject<Ticket>(owner, "ready-ticket", ticket);
  if (!saved || saved.value.expiresAt <= Date.now() || saved.value.sourceHash !== sourceHash || saved.value.revision !== hash({ input: { ...input, account: getAddress(input.account), settings: parseCoinSettings(input.settings) }, sourceHash })) {
    throw new CustomAIError("readiness", "Your launch details changed. Refresh the preparation before signing.", 409);
  }
  return saved.value;
}
