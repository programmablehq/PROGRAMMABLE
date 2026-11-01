import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { keccak256, toHex, type Address, type Hex } from "viem";
import type { LaunchDependencyObservation } from "./dependency-observations.server";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";

export type DependencyWitnessAccount = { address: Address; runtimeCode: Hex; runtimeCodeHash: Hex; storage: { slot: Hex; value: Hex }[] };
export type NativeFeedConstructorWitness = {
  version: 1; id: `sha256:${string}`; authority: "two-provider-prestate-observation";
  observationId: LaunchDependencyObservation["id"]; productionId: LaunchDependencyObservation["productionId"];
  chainId: LaunchDependencyObservation["chainId"]; block: LaunchDependencyObservation["block"];
  call: { from: Address; to: Address; data: "0x313ce567"; value: "0" };
  expectedOutput: Hex; accounts: DependencyWitnessAccount[]; expiresAt: number; launchReady: false;
};
export type NativeFeedConstructorRead = {
  version: 1; witness: NativeFeedConstructorWitness;
  replay: { status: "replayed"; passes: 2; output: string; gasUsed: string };
  launchReady: false; id: `sha256:${string}`;
};
export type ObservedConstructorDependencies = { observation: LaunchDependencyObservation; read: NativeFeedConstructorRead };
const invalid = (): never => { throw new TypeError("The native feed state witness is incomplete or inconsistent."); };
const address = /^0x(?!0{40}$)[a-f0-9]{40}$/iu, word = /^0x[a-f0-9]{64}$/iu;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  return value as Record<string, unknown>;
};

/** Only code and explicitly observed storage are admitted. Balance/nonce-only
 * trace entries are irrelevant because the isolated reader forbids those
 * dependencies. An omitted storage slot is never interpreted as observed zero. */
export function dependencyWitnessAccounts(raw: unknown): DependencyWitnessAccount[] {
  const entries = Object.entries(object(raw));
  if (!entries.length || entries.length > 16) return invalid();
  const seen = new Set<string>(); let bytes = 0, slots = 0;
  const accounts: DependencyWitnessAccount[] = [];
  for (const [key, value] of entries) {
    if (!/^0x[a-f0-9]{40}$/iu.test(key) || seen.has(key.toLowerCase())) return invalid(); seen.add(key.toLowerCase());
    const account = object(value);
    if (Object.keys(account).some(key => !["balance", "nonce", "code", "codeHash", "storage"].includes(key))) return invalid();
    const code = account.code ?? "0x";
    if (typeof code !== "string" || !/^0x(?:[a-f0-9]{2})*$/iu.test(code) || code.length > 49_154) return invalid();
    if (account.codeHash !== undefined && (typeof account.codeHash !== "string" || !word.test(account.codeHash)
      || account.codeHash.toLowerCase() !== keccak256(code as Hex))) return invalid();
    const storage = Object.entries(object(account.storage ?? {}));
    if (code === "0x") { if (storage.length) return invalid(); continue; }
    if (!address.test(key)) return invalid();
    bytes += (code.length - 2) / 2; slots += storage.length;
    if (bytes > 131_072 || slots > 64) return invalid();
    const observed = new Set<string>();
    const words = storage.map(([slot, value]) => {
      if (!word.test(slot) || typeof value !== "string" || !word.test(value) || observed.has(slot.toLowerCase())) return invalid();
      observed.add(slot.toLowerCase()); return { slot: slot.toLowerCase() as Hex, value: value.toLowerCase() as Hex };
    }).sort((a, b) => a.slot.localeCompare(b.slot));
    accounts.push({ address: key.toLowerCase() as Address, runtimeCode: code.toLowerCase() as Hex, runtimeCodeHash: keccak256(code as Hex), storage: words });
  }
  if (!accounts.length || accounts.length > 8) return invalid();
  return accounts.sort((a, b) => a.address.localeCompare(b.address));
}

export function checkNativeFeedObservation(observation: LaunchDependencyObservation, caller: Address, now: number) {
  const { id, ...body } = observation;
  if (canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1", body) !== id
    || observation.version !== 1 || observation.authority !== "two-provider-observation" || observation.launchReady !== false
    || !Number.isSafeInteger(now) || now < observation.observedAt || now >= observation.expiresAt
    || !address.test(caller) || !Number.isSafeInteger(observation.nativeUsdFeed.decimals)
    || observation.nativeUsdFeed.decimals < 0 || observation.nativeUsdFeed.decimals > 18) return invalid();
}

export function createNativeFeedConstructorWitness(observation: LaunchDependencyObservation, caller: Address,
  first: unknown, second: unknown, now: number): NativeFeedConstructorWitness {
  checkNativeFeedObservation(observation, caller, now);
  const id = observation.id;
  const firstAccounts = dependencyWitnessAccounts(first), other = new Map(dependencyWitnessAccounts(second).map(account => [account.address, account]));
  // Tracers can include unrelated fee-recipient accounts or extra untouched
  // slots. Only common, identical observations enter the witness. The VM then
  // refuses any actual read that this intersection cannot substantiate.
  const accounts = firstAccounts.flatMap(account => {
    const same = other.get(account.address); if (!same) return [];
    if (account.runtimeCode !== same.runtimeCode || account.runtimeCodeHash !== same.runtimeCodeHash) return invalid();
    const slots = new Map(same.storage.map(slot => [slot.slot, slot.value]));
    const storage = account.storage.filter(slot => {
      const value = slots.get(slot.slot);
      if (value !== undefined && value !== slot.value) return invalid();
      return value !== undefined;
    });
    return [{ ...account, storage }];
  });
  const feed = accounts.find(account => account.address === observation.nativeUsdFeed.address.toLowerCase());
  if (!feed || feed.runtimeCodeHash !== observation.nativeUsdFeed.runtimeCodeHash
    || feed.runtimeCode !== observation.nativeUsdFeed.runtimeCode || accounts.some(account => account.address === caller.toLowerCase())) return invalid();
  const witness = { version: 1 as const, authority: "two-provider-prestate-observation" as const,
    observationId: id, productionId: observation.productionId, chainId: observation.chainId, block: structuredClone(observation.block),
    call: { from: caller.toLowerCase() as Address, to: feed.address, data: "0x313ce567" as const, value: "0" as const },
    expectedOutput: toHex(observation.nativeUsdFeed.decimals, { size: 32 }), accounts, expiresAt: observation.expiresAt, launchReady: false as const };
  return { ...witness, id: canonicalBrowserSha256V2("programmable.custom-ai-native-feed-witness.v1", witness) };
}

/** Validate the server-produced observation and replay against this exact
 * production profile and predicted initializer before the constructor worker.
 * This is integrity checking for an owned preparation, not public admission. */
export function constructorDependencyState(value: ObservedConstructorDependencies, production: LaunchProductionContext,
  caller: Address, now: number) {
  production = checkedLaunchProductionContext(production, production.chainId);
  const context = structuredClone(value), { observation, read } = context;
  if (production.version !== 3 || !production.protectionBindings || observation.productionId !== production.id
    || observation.chainId !== production.chainId || read.version !== 1 || read.launchReady !== false) return invalid();
  checkNativeFeedObservation(observation, caller, now);
  const { id, ...body } = read;
  if (canonicalBrowserSha256V2("programmable.custom-ai-native-feed-constructor-read.v1", body) !== id
    || read.replay.status !== "replayed" || read.replay.passes !== 2 || read.replay.output !== read.witness.expectedOutput
    || !/^[0-9]{1,7}$/u.test(read.replay.gasUsed) || BigInt(read.replay.gasUsed) > 4_000_000n) return invalid();
  const raw = Object.fromEntries(read.witness.accounts.map(account => [account.address, {
    code: account.runtimeCode, storage: Object.fromEntries(account.storage.map(slot => [slot.slot, slot.value])),
  }]));
  const rebuilt = createNativeFeedConstructorWitness(observation, caller, raw, raw, now);
  if (rebuilt.id !== read.witness.id) return invalid();
  const pins = production.protectionBindings;
  const fixed = [
    [observation.poolManager, production.poolManager], [observation.swapRouter, pins.swapRouter],
    [observation.nativeUsdFeed, pins.nativeUsdFeed],
  ] as const;
  for (const [observed, expected] of fixed) {
    if (observed.address.toLowerCase() !== expected.address.toLowerCase() || observed.runtimeCodeHash !== expected.runtimeCodeHash
      || keccak256(observed.runtimeCode) !== expected.runtimeCodeHash) return invalid();
  }
  if (production.chainId === 8453 ? !observation.sequencer || observation.sequencer.address.toLowerCase() !== pins.sequencerUptimeFeed?.toLowerCase()
    : observation.sequencer !== null) return invalid();
  const accounts = new Map(read.witness.accounts.map(account => [account.address.toLowerCase(), account]));
  for (const known of [observation.poolManager, observation.swapRouter, ...(observation.sequencer ? [observation.sequencer] : [])]) {
    const key = known.address.toLowerCase(), existing = accounts.get(key);
    if (keccak256(known.runtimeCode) !== known.runtimeCodeHash || existing && existing.runtimeCode !== known.runtimeCode) return invalid();
    if (!existing) accounts.set(key, { address: key as Address, runtimeCode: known.runtimeCode, runtimeCodeHash: known.runtimeCodeHash, storage: [] });
  }
  return { accounts: [...accounts.values()], call: { ...read.witness.call, output: read.witness.expectedOutput }, context };
}
