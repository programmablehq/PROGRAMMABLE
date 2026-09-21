import { getAddress, getContractAddress, keccak256, sha256, stringToHex, toHex, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { computeExpectedGraphResultHashV2, computeStampRequestHashV2, decodeCustomGraphRouteV2, decodeLaunchAndStampV2, encodeLaunchAndStampV2, permitDigestV2 } from "./multi-role-router-codec-v2";
import { verifySafeWalletReviewV1 } from "./safe-wallet-review-v1";
import { verifyStampWalletReviewV1 } from "./stamp-wallet-review-v1";
import { verifyAtomicWalletReviewV2 } from "./atomic-wallet-review-v2";
import { verifyLaunchPlanReleaseAuthorityV1 } from "./launch-plan-release-authority-v1";
import { multiRoleOriginalTransactionHintV3 } from "./multi-role-finality-version-v3";
import { projectionAddress, projectionHash, projectionObject, projectionUint } from "./launch-projection-v1";
import type { LaunchPlanRecordV1, LaunchEffectV1 } from "./launch-plan-v1";
import type { LaunchSendAttemptV1 } from "./launch-send-journal-v1";

export type UniversalLaunchSource = "multi_role_v2" | "custom_launch_plan_v1";
export type LaunchWalletProviderV1 = { request(input: { method: string; params?: readonly unknown[] }): Promise<unknown> };
export type UniversalLaunchWalletInputV1 = {
  sourceVersion: UniversalLaunchSource; reviewedResource: unknown; stepId?: string;
  loadFreshResource(): Promise<unknown>; loadFreshCapabilities(): Promise<unknown>;
  action: "review" | "send" | "recover" | "switch_chain"; reviewed?: UniversalLaunchWalletReviewV1;
  recoveryHash?: Hex;
};
export type UniversalLaunchWalletReviewV1 = {
  sourceVersion: UniversalLaunchSource; launchId: string; stepId: string;
  transaction: { chainId: "0x1237"; from: Address; to?: Address; data: Hex; value: Hex; gas: Hex; nonce?: Hex; type?: "0x2" };
  controllerNonce?: Hex;
  createdAddress?: Address;
  binding: string; maxGasCostWei: string; valueWei: string; deadline: string;
  controllerKind: "eoa" | "delegated_eoa_v1" | "erc1271" | "smart_account";
  decodedOperation?: unknown;
  controllerAuthorization?: unknown;
  admissionAuthority?: { releaseId: string; receiptHash: string; policyBindingHash: string };
  preconditions: readonly unknown[]; postconditions: readonly unknown[];
};
const fail = (message = "The launch transaction changed. Refresh its exact wallet review."): never => { throw new Error(message); };
const record = (value: unknown) => projectionObject(value) ? value : fail();
const data = (value: unknown): Hex => typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value) ? value as Hex : fail();
const address = (value: unknown): Address => projectionAddress(value) ? getAddress(value) : fail();
const uint = (value: unknown) => projectionUint(value) ? BigInt(value) : fail();
const quantity = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : fail();
const equal = (left: unknown, right: unknown) => canonicalBrowserJsonV2(left) === canonicalBrowserJsonV2(right);
const plainHash = (value: unknown) => `sha256:${sha256(stringToHex(canonicalBrowserJsonV2(value))).slice(2)}`;
const without = (value: Record<string, unknown>, field: string) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));

export function launchPlanWalletUrlV1(planId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) return fail("The launch identifier is invalid.");
  return `https://programmable.market/developers/api-keys?view=history&chainId=4663&launchId=${planId}`;
}

export function readLaunchPlanResourceV1(value: unknown): LaunchPlanRecordV1 {
  const resource = record(value);
  const plan = record(resource.plan);
  if (resource.schemaVersion !== "programmable.custom-launch-plan-resource.v1" || plan.schemaVersion !== "programmable.custom-launch-plan.v1"
    || plan.chainId !== "4663" || typeof resource.planId !== "string" || !Array.isArray(resource.steps)
    || resource.manifestDigest !== plan.manifestDigest || resource.planHash !== canonicalBrowserSha256V2("programmable.custom-launch-plan.v1", plan)
    || !projectionObject(plan.controller) || !projectionAddress(plan.controller.address)
    || !["eoa", "delegated_eoa_v1", "erc1271", "smart_account"].includes(String(plan.controller.kind))
    || !["atomic_graph_v2", "atomic_execute_and_stamp_v2", "controller_multi_step_v1", "observe_and_stamp_v1"].includes(String(plan.executor))
    || !Array.isArray(plan.components) || !Array.isArray(plan.actions) || !Array.isArray(plan.dependencies)
    || !Array.isArray(plan.expectedEffects) || !Array.isArray(plan.markets) || !projectionObject(plan.budgets)) return fail();
  if (resource.walletUrl !== undefined && resource.walletUrl !== launchPlanWalletUrlV1(resource.planId)) return fail("The website handoff does not match this launch.");
  if (resource.continuation !== undefined) {
    const continuation = record(resource.continuation);
    if (Object.keys(continuation).sort().join(",") !== "currentManifestDigest,originalManifestDigest,replanUrl,schemaVersion,status"
      || continuation.schemaVersion !== "programmable.custom-launch-plan-continuation.v1" || continuation.status !== "replan_required"
      || continuation.originalManifestDigest !== resource.manifestDigest
      || typeof continuation.currentManifestDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(continuation.currentManifestDigest)
      || continuation.currentManifestDigest === resource.manifestDigest
      || continuation.replanUrl !== `/v4/chains/4663/custom-launch-plans/${resource.planId}:replan`) return fail("The continuation notice does not match this launch.");
  }
  for (const step of resource.steps) {
    const row = record(step);
    if (!equal(row.controller, plan.controller) || !Array.isArray(row.actionIds) || row.actionIds.length < 1 || !Array.isArray(row.preconditions) || !Array.isArray(row.postconditions)) return fail();
    const expected = canonicalBrowserSha256V2("programmable.custom-launch-plan-transaction.v1", {
      stepId: row.stepId, actionIds: row.actionIds, controller: row.controller,
      transaction: row.transaction, preconditions: row.preconditions, postconditions: row.postconditions,
    });
    if (row.transactionDigest !== expected) return fail();
  }
  return resource as unknown as LaunchPlanRecordV1;
}

async function assertAuthority(provider: LaunchWalletProviderV1, account: Address, kind: UniversalLaunchWalletReviewV1["controllerKind"], runtime?: string, authoritySnapshot?: unknown) {
  const [chain, accounts, code] = await Promise.all([
    provider.request({ method: "eth_chainId" }), provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_getCode", params: [account, "latest"] }),
  ]);
  if (chain !== "0x1237" || !Array.isArray(accounts) || !accounts.length || address(accounts[0]) !== account) {
    return fail("Connect the exact controller account on Robinhood Chain before continuing.");
  }
  const actual = data(code);
  if (kind === "eoa" ? actual !== "0x" : !projectionHash(runtime) || keccak256(actual).toLowerCase() !== runtime.toLowerCase()) {
    return fail("The controller runtime or account type changed. Refresh the authority snapshot.");
  }
  if (kind === "delegated_eoa_v1") {
    const snapshot = record(authoritySnapshot);
    if (Object.keys(snapshot).sort().join(",") !== "chainId,delegate,delegateRuntimeCodeHash,schemaVersion"
      || snapshot.schemaVersion !== "programmable.delegated-eoa-authority.v1" || snapshot.chainId !== "4663"
      || !projectionAddress(snapshot.delegate) || !projectionHash(snapshot.delegateRuntimeCodeHash)
      || actual.toLowerCase() !== `0xef0100${snapshot.delegate.slice(2).toLowerCase()}`) return fail("The existing wallet delegation changed. Reconcile the controller authority before continuing.");
    const code = data(await provider.request({ method: "eth_getCode", params: [snapshot.delegate, "latest"] }));
    if (code === "0x" || keccak256(code).toLowerCase() !== snapshot.delegateRuntimeCodeHash.toLowerCase()) return fail("The existing wallet delegate runtime changed. Reconcile the controller authority before continuing.");
  }
}

async function assertRuntime(provider: LaunchWalletProviderV1, target: Address, hash: unknown) {
  if (!projectionHash(hash)) return fail("This target has no bound runtime. Refresh the launch plan.");
  const code = data(await provider.request({ method: "eth_getCode", params: [target, "latest"] }));
  if (keccak256(code).toLowerCase() !== hash.toLowerCase()) return fail("The transaction target runtime changed.");
}

async function verifyPrecondition(provider: LaunchWalletProviderV1, effect: LaunchEffectV1, resource: LaunchPlanRecordV1) {
  const resolve = (ref: { address: Address } | { componentId: string }) => "address" in ref ? ref.address
    : resource.plan.components.find(component => component.componentId === ref.componentId)?.expectedAddress ?? fail();
  if (effect.kind === "runtime") return assertRuntime(provider, resolve(effect.target), effect.runtimeCodeHash);
  if (effect.kind === "child") {
    const component = resource.plan.components.find(item => item.componentId === effect.componentId) ?? fail();
    return assertRuntime(provider, component.expectedAddress, effect.runtimeCodeHash);
  }
  if (effect.kind === "storage") {
    const value = await provider.request({ method: "eth_getStorageAt", params: [resolve(effect.target), effect.slot, "latest"] });
    if (data(value).toLowerCase() !== effect.expected.toLowerCase()) return fail("A required storage precondition changed.");
  } else if (effect.kind === "callResult") {
    const value = await provider.request({ method: "eth_call", params: [{ to: resolve(effect.target), data: effect.data }, "latest"] });
    if (data(value).toLowerCase() !== effect.expected.toLowerCase()) return fail("A required read precondition changed.");
  } else if (effect.kind === "balance") {
    const target = resolve(effect.target);
    const result = /^0x0{40}$/i.test(effect.asset)
      ? await provider.request({ method: "eth_getBalance", params: [target, "latest"] })
      : await provider.request({ method: "eth_call", params: [{ to: effect.asset, data: `0x70a08231${target.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] });
    const value = quantity(result);
    if (value < BigInt(effect.minimum) || value > BigInt(effect.maximum)) return fail("A required balance precondition changed.");
  }
}

export async function prepareUniversalLaunchWalletV1(provider: LaunchWalletProviderV1, account: string, input: UniversalLaunchWalletInputV1,
  atSeconds?: bigint): Promise<UniversalLaunchWalletReviewV1> {
  const controller = address(account);
  const [fresh, capabilities] = await Promise.all([input.loadFreshResource(), input.loadFreshCapabilities()]);
  const nowMilliseconds = atSeconds === undefined ? Date.now() : Number(atSeconds) * 1000;
  const nowSeconds = atSeconds ?? BigInt(Math.floor(nowMilliseconds / 1000));
  const cap = record(capabilities);
  let review: Omit<UniversalLaunchWalletReviewV1, "maxGasCostWei">;
  let admissionExpiresAt: number | undefined;
  if (input.sourceVersion === "custom_launch_plan_v1") {
    const original = readLaunchPlanResourceV1(input.reviewedResource);
    const current = readLaunchPlanResourceV1(fresh);
    if (current.continuation) return fail("This launch needs an updated plan. Ask your bot to replan using the existing completed steps.");
    if (original.planId !== current.planId || original.planHash !== current.planHash || current.plan.controller.address.toLowerCase() !== controller.toLowerCase()
      || !["wallet_action_ready", "broadcast", "mined"].includes(current.status)) return fail();
    const release = await verifyLaunchPlanReleaseAuthorityV1(current, cap, nowMilliseconds);
    admissionExpiresAt = Date.parse(current.admission!.expiresAt);
    const admissionAuthority = { releaseId: release.releaseId, receiptHash: current.admission!.receiptHash,
      policyBindingHash: release.binding.policyBindingHash };
    if (input.action === "send" && !equal(input.reviewed?.admissionAuthority ?? null, admissionAuthority)) return fail("The original admission authority changed. Review this launch again before sending.");
    const step = current.steps.find(item => item.stepId === input.stepId) ?? current.steps.find(item => item.status === "wallet_action_ready") ?? fail();
    const oldStep = original.steps.find(item => item.stepId === step.stepId) ?? fail();
    if (step.status !== "wallet_action_ready" || oldStep.transactionDigest !== step.transactionDigest
      || current.steps.slice(0, current.steps.indexOf(step)).some(item => item.status !== "final")) return fail("Wait for the previous step to become final, then refresh this step.");
    const tx = step.transaction;
    if (tx.chainId !== "4663" || address(tx.from) !== controller || tx.deadline !== current.plan.budgets.deadline
      || nowSeconds < uint(current.plan.budgets.validAfter) || nowSeconds >= uint(tx.deadline)) return fail("The wallet plan is not in its valid time window.");
    const target = tx.to === null ? null : address(tx.to);
    const resolve = (value: { address: Address } | { componentId: string }) => "address" in value ? value.address
      : current.plan.components.find(component => component.componentId === value.componentId)?.expectedAddress ?? fail();
    let platform = false; let decodedOperation: unknown; let createdAddress: Address | undefined;
    let reviewDeadline = tx.deadline;
    const atomic = current.plan.executor === "atomic_execute_and_stamp_v2";
    if (atomic) {
      const binding = release.atomicBinding ?? fail("This original release has no combined launch executor.");
      const execution = release.execution.atomic;
      if (!execution || !target || address(binding.address) !== target || tx.data.slice(0, 10) !== execution.selector) return fail();
      const decoded = verifyAtomicWalletReviewV2(current, step, binding, nowSeconds);
      decodedOperation = decoded;
      reviewDeadline = decoded.order.deadline;
      await Promise.all([assertRuntime(provider, target, binding.runtimeCodeHash),
        assertRuntime(provider, binding.permitAuthority, binding.permitAuthorityRuntimeCodeHash),
        assertRuntime(provider, binding.poolManager, binding.poolManagerRuntimeCodeHash)]);
    }
    for (const id of atomic ? [] : step.actionIds) {
      if (id === "platform:stampPlanV1") { platform = true; continue; }
      const action = current.plan.actions.find(item => item.actionId === id) ?? fail();
      if (action.kind === "deployEoaCreate") {
        const component = current.plan.components.find(item => item.componentId === action.componentId) ?? fail();
        const expected = getContractAddress({ from: controller, nonce: uint(tx.nonce) });
        if (target !== null || !["eoa", "delegated_eoa_v1"].includes(current.plan.controller.kind) || current.plan.executor !== "controller_multi_step_v1"
          || step.actionIds.length !== 1 || action.authority.kind !== "controller" || action.nonce !== tx.nonce
          || action.execution.target !== null || action.execution.data !== tx.data || tx.data === "0x"
          || action.execution.value !== tx.value || action.execution.gasLimit !== tx.gasLimit
          || address(component.expectedAddress) !== expected) return fail("The direct deployment changed. Reconcile its creator, nonce and expected address.");
        const existing = data(await provider.request({ method: "eth_getCode", params: [expected, "latest"] }));
        if (existing !== "0x") return fail("The deployment address already has code. Recover the original transaction before continuing.");
        createdAddress = expected;
        decodedOperation = { operation: "deployEoaCreate", constructorSender: controller, expectedAddress: expected, initCodeHash: keccak256(tx.data) };
        continue;
      }
      if (action.authority.kind === "platform") {
        if (action.authority.binding !== "launch_stamp" || action.authority.operation !== "stampPlanV1" || action.kind !== "call"
          || address(resolve(action.execution.target)) !== target || action.execution.value !== "0" || action.execution.data !== "0x") return fail();
        platform = true; continue;
      }
      if (!("execution" in action) || address(resolve(action.execution.target)) !== target || action.execution.data !== tx.data
        || action.execution.value !== tx.value || action.execution.gasLimit !== tx.gasLimit) return fail();
    }
    const runtime = current.plan.components.find(item => address(item.expectedAddress) === target)?.runtimeCodeHash
      ?? current.plan.dependencies.find(item => address(item.address) === target)?.runtimeCodeHash;
    if (platform) {
      const stamp = release.execution.stamp;
      if (!target || step.actionIds.length !== 1 || current.steps.at(-1) !== step || address(stamp.address) !== target || typeof stamp.selector !== "string" || tx.data.slice(0, 10) !== stamp.selector) return fail("The stamp is not bound to the published platform operation.");
      decodedOperation = await verifyStampWalletReviewV1(provider, current, step, release.binding, nowSeconds);
      await Promise.all([assertRuntime(provider, target, stamp.runtimeCodeHash),
        assertRuntime(provider, release.binding.permitAuthority, release.binding.permitAuthorityRuntimeCodeHash)]);
    } else if (atomic) { /* The combined executor and its release roots were checked above. */ }
    else if (target) await assertRuntime(provider, target, runtime);
    else if (!createdAddress) return fail("A creation transaction requires its explicit EOA deployment action.");
    if (current.steps.reduce((sum, item) => sum + uint(item.transaction.value), 0n) > uint(current.plan.budgets.maxTotalValue)
      || current.steps.reduce((sum, item) => sum + uint(item.transaction.gasLimit), 0n) > uint(current.plan.budgets.maxTotalGas)) return fail("The total launch budget changed.");
    for (const id of step.preconditions) await verifyPrecondition(provider, current.plan.expectedEffects.find(effect => effect.effectId === id) ?? fail(), current);
    await assertAuthority(provider, controller, current.plan.controller.kind, current.plan.controller.runtimeCodeHash, current.plan.controller.authoritySnapshot);
    const controllerAuthorization = ["eoa", "delegated_eoa_v1"].includes(current.plan.controller.kind) ? undefined : await verifySafeWalletReviewV1(provider, current, step);
    const nonce = controllerAuthorization ? uint(tx.nonce) : quantity(await provider.request({ method: "eth_getTransactionCount", params: [controller, "pending"] }));
    if (nonce !== uint(tx.nonce)) return fail("The controller nonce changed. Reconcile the existing plan before sending.");
    review = { sourceVersion: input.sourceVersion, launchId: current.planId, stepId: step.stepId,
      transaction: { chainId: "0x1237", from: controller, ...(target ? { to: target } : {}), data: data(tx.data), value: toHex(uint(tx.value)), gas: toHex(uint(tx.gasLimit)), ...(controllerAuthorization ? {} : { nonce: toHex(nonce) }),
        ...(current.plan.controller.kind === "delegated_eoa_v1" ? { type: "0x2" as const } : {}) },
      controllerNonce: toHex(nonce), ...(createdAddress ? { createdAddress } : {}),
      ...(decodedOperation ? { decodedOperation } : {}), ...(controllerAuthorization ? { controllerAuthorization } : {}), admissionAuthority,
      binding: step.transactionDigest, valueWei: tx.value, deadline: reviewDeadline, controllerKind: current.plan.controller.kind,
      preconditions: step.preconditions.map(id => current.plan.expectedEffects.find(effect => effect.effectId === id) ?? fail()),
      postconditions: step.postconditions.map(id => current.plan.expectedEffects.find(effect => effect.effectId === id) ?? fail()) };
  } else {
    const original = record(input.reviewedResource); const current = record(fresh);
    if (multiRoleOriginalTransactionHintV3(original).version !== multiRoleOriginalTransactionHintV3(current).version) return fail();
    if (current.schemaVersion !== "programmable.multi-role-custom-launch-resource.v2" || current.launchId !== original.launchId
      || current.requestHash !== original.requestHash || current.artifactHash !== original.artifactHash
      || !equal(current.commitments, original.commitments) || !equal(current.context, original.context) || !equal(cap.context, current.context)
      || record(cap.readiness).status !== "ready" || !["authorized", "awaiting_wallet_signature", "wallet_action_required"].includes(String(current.status))) return fail();
    const artifact = record(current.preparedArtifact); const wallet = record(current.wallet); const tx = record(wallet.walletTransaction);
    if (plainHash(without(artifact, "artifactHash")) !== current.artifactHash || plainHash(without(tx, "transactionPreimageHash")) !== tx.transactionPreimageHash
      || tx.transactionPreimageHash !== current.walletTransactionPreimageHash || tx.artifactHash !== current.artifactHash
      || !equal(wallet.context, current.context) || !equal(wallet.commitments, current.commitments)
      || !equal(tx.chainBindings, artifact.chainBindings) || !equal(tx.chainBindings, record(current.context).chainBindings)) return fail();
    const calldata = data(tx.calldata); const decoded = decodeLaunchAndStampV2(calldata);
    const route = decodeCustomGraphRouteV2(decoded.routePayload);
    if (encodeLaunchAndStampV2(decoded) !== calldata || tx.chainId !== "4663" || address(tx.from) !== controller
      || address(tx.to) !== address(decoded.permit.router) || address(decoded.permit.launchWallet) !== controller || decoded.permit.chainId !== 4663n
      || decoded.permit.value !== uint(tx.valueWei) || decoded.permit.validAfter !== uint(tx.validAfter) || decoded.permit.deadline !== uint(tx.deadline)
      || nowSeconds < decoded.permit.validAfter || nowSeconds >= decoded.permit.deadline
      || decoded.permit.routePayloadHash !== keccak256(decoded.routePayload)
      || decoded.permit.stampRequestHash !== computeStampRequestHashV2(decoded.stampRequest)
      || decoded.permit.expectedResultHash !== computeExpectedGraphResultHashV2(route.expectedOutputs, route.expectedGraphDeploymentHash)
      || tx.permitDigest !== permitDigestV2(decoded.permit) || artifact.permitDigest !== tx.permitDigest
      || computeStampRequestHashV2(artifact.stampRequest as typeof decoded.stampRequest) !== decoded.permit.stampRequestHash || record(artifact.route).routePayload !== decoded.routePayload) return fail();
    await assertAuthority(provider, controller, "eoa");
    await assertRuntime(provider, address(tx.to), record(tx.chainBindings).routerRuntimeCodeHash);
    const nonce = quantity(await provider.request({ method: "eth_getTransactionCount", params: [controller, "pending"] }));
    review = { sourceVersion: input.sourceVersion, launchId: String(current.launchId), stepId: "multi-role-v2",
      transaction: { chainId: "0x1237", from: controller, to: address(tx.to), data: calldata, value: toHex(uint(tx.valueWei)), gas: "0x0", nonce: toHex(nonce) },
      binding: String(tx.transactionPreimageHash), valueWei: String(tx.valueWei), deadline: String(tx.deadline), controllerKind: "eoa",
      preconditions: [], postconditions: decoded.stampRequest.components };
  }
  const { gas: declaredGas, ...call } = review.transaction;
  await provider.request({ method: "eth_call", params: [call, "latest"] });
  const [estimate, gasPrice] = await Promise.all([provider.request({ method: "eth_estimateGas", params: [call] }), provider.request({ method: "eth_gasPrice" })]);
  const estimateGas = quantity(estimate);
  const gas = input.sourceVersion === "multi_role_v2" ? (estimateGas * 120n + 99n) / 100n : BigInt(declaredGas);
  if (estimateGas > gas) return fail("The exact transaction exceeds its gas budget.");
  const completedAt = atSeconds === undefined ? Date.now() : nowMilliseconds;
  if (admissionExpiresAt !== undefined && completedAt >= admissionExpiresAt
    || BigInt(Math.floor(completedAt / 1000)) >= uint(review.deadline)) return fail("The wallet review expired while its current bindings were checked. Refresh before continuing.");
  return { ...review, transaction: { ...review.transaction, gas: toHex(gas) }, maxGasCostWei: (gas * quantity(gasPrice)).toString() };
}

/** Recovery never re-simulates or refreshes an expired permit. It checks the original signed call. */
export async function recoverUniversalLaunchTransactionV1(provider: LaunchWalletProviderV1, attempt: LaunchSendAttemptV1, hash: Hex): Promise<Hex> {
  if (!projectionHash(hash)) return fail("Enter the transaction hash from the original wallet activity.");
  if (await provider.request({ method: "eth_chainId" }) !== "0x1237") return fail("Switch to Robinhood Chain to check the original transaction.");
  const value = await provider.request({ method: "eth_getTransactionByHash", params: [hash] });
  if (!projectionObject(value)) return fail("This provider has not found the transaction. The original send remains unresolved; check the wallet activity or explorer and try again.");
  const expected = attempt.transaction;
  const targetMatches = expected.to ? projectionAddress(value.to) && address(value.to) === address(expected.to) : value.to === null;
  if (!projectionHash(value.hash) || value.hash.toLowerCase() !== hash.toLowerCase()
    || !projectionAddress(value.from) || address(value.from) !== address(attempt.controller)
    || quantity(value.nonce) !== quantity(attempt.nonce) || !targetMatches
    || data(value.input ?? value.data).toLowerCase() !== expected.data.toLowerCase() || quantity(value.value) !== quantity(expected.value)
    || quantity(value.gas) !== quantity(expected.gas) || value.chainId !== undefined && quantity(value.chainId) !== 4663n
    || value.type !== undefined && quantity(value.type) > 2n || Array.isArray(value.authorizationList) && value.authorizationList.length > 0) {
    return fail("This transaction does not match the saved launch call and nonce. Keep the launch paused while its original transaction is reconciled.");
  }
  return hash.toLowerCase() as Hex;
}
