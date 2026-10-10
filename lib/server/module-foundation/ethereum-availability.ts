import "server-only";
import { getAddress, keccak256, type Address } from "viem";
import { ETHEREUM_MODULE_BINDING, ETHEREUM_MODULE_SOURCE } from "@/lib/module-foundation/ethereum-release";
import { FOUNDATION_AVAILABILITY_SCHEMA_V5, unavailableFoundation } from "@/lib/module-foundation/availability";
import { foundationMainnetReadClient, foundationMainnetRpcs } from "./rpc";
import { getOnchainDeployment } from "@/lib/onchain/config";
import { readFinalizedRouterCustomIdentitySnapshotCoreV1 } from "@/lib/alchemy/router-custom-public.server";
import { readFoundationEthereumGraphLaunch } from "./ethereum-graph";
import { withFoundationOwnerCatalogV1 } from "./owner-catalog";
import { readEthereumMissingIndexReason } from "./ethereum-stamp-status";
import release from "@/contracts/deployments/ethereum-module-release-v1.json";

const reads = new Map<string, { expires: number; value: Promise<unknown> }>();
export function readEthereumFoundationAvailability(token?: Address): Promise<unknown> {
  if (process.env.PROGRAMMABLE_ETHEREUM_MODULE_MODE !== "enabled") return Promise.resolve(unavailableFoundation(FOUNDATION_AVAILABILITY_SCHEMA_V5, 1));
  const key = token?.toLowerCase() ?? "launch", cached = reads.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = current(token).catch(error => { reads.delete(key); throw error; });
  if (reads.size >= 128) reads.delete(reads.keys().next().value!);
  reads.set(key, { expires: Date.now() + 15_000, value });
  return value;
}
async function current(token?: Address) {
  // Share the existing per-provider budget with quotes instead of sending a
  // burst of archive reads every time a token's authority is checked.
  const rpcs = foundationMainnetRpcs();
  const clients = [foundationMainnetReadClient(rpcs[0]), foundationMainnetReadClient(rpcs[1])] as const;
  const heads = await Promise.all(clients.map(async client => {
    const [chainId, head] = await Promise.all([client.getChainId(), client.getBlock({ blockTag: "finalized" })]);
    if (chainId !== 1) throw new Error("The module RPC is not Ethereum.");
    return head;
  }));
  const number = heads[0].number < heads[1].number ? heads[0].number : heads[1].number;
  if (number < ETHEREUM_MODULE_SOURCE.startBlock) throw new Error("The Ethereum module deployment is not finalized.");
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber: number })));
  if (!blocks[0].hash || blocks[0].hash !== blocks[1].hash) throw new Error("Ethereum module providers disagree.");
  const pins = [ETHEREUM_MODULE_BINDING.factory, ETHEREUM_MODULE_BINDING.hookDeployer,
    ...release.payload.modules.map(m => ({ address: getAddress(m.factory), runtimeCodeHash: m.factoryCodeHash }))];
  await Promise.all(clients.map(client => Promise.all(pins.map(async pin => {
    const code = await client.getCode({ address: pin.address, blockNumber: number });
    if (!code || keccak256(code) !== pin.runtimeCodeHash) throw new Error("The Ethereum module deployment differs from its source.");
  }))));
  let binding = ETHEREUM_MODULE_BINDING;
  if (token) {
    const snapshot = await readFinalizedRouterCustomIdentitySnapshotCoreV1({ signal: AbortSignal.timeout(12_000) });
    const entry = snapshot.entries.find(e => e.tokenAddress.toLowerCase() === token.toLowerCase());
    const p = entry?.launchStampProvenance;
    const deployment = getOnchainDeployment("production");
    if (deployment.status !== "ready") throw new Error("The Ethereum deployment is unavailable.");
    if (!p) return { ...unavailableFoundation(FOUNDATION_AVAILABILITY_SCHEMA_V5, 1), token: token.toLowerCase(),
      reason: await readEthereumMissingIndexReason({ clients, token, blockNumber: number }) };
    const checked = await readFoundationEthereumGraphLaunch({ client: clients[0], deployment, source: ETHEREUM_MODULE_SOURCE,
      anchor: { launchId: p.launchId, token, hook: p.poolKey.hooks, poolManager: p.poolManagerAddress,
        poolId: p.poolId, stampHash: p.stampHash, blockNumber: BigInt(p.blockNumber), blockHash: p.blockHash,
        transactionHash: p.transactionHash, transactionIndex: p.transactionIndex, logIndex: p.launchLogIndex } });
    binding = { ...checked.binding, ethereumGraph: ETHEREUM_MODULE_SOURCE };
  }
  const envelope = await withFoundationOwnerCatalogV1({ schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V5, chainId: 1,
    available: true, reason: null, binding, ...(token ? { token: token.toLowerCase() as Address } : {}),
    catalog: unavailableFoundation().catalog });
  return JSON.parse(JSON.stringify({ ...envelope, evidence: { kind: "owner-source-runtime-v1", providerCount: 2,
    releaseDigest: binding.releaseDigest, checkedAt: new Date().toISOString(), blockHash: blocks[0].hash, blockNumber: String(number) } },
  (_, value) => typeof value === "bigint" ? value.toString() : value));
}
