import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import fixtures from "./custom-ai-general-wallet-v1.json";
import type { GeneralWalletSubject } from "@/lib/custom-ai/general-wallet";

/** Synthetic finality delivery for the real owned-resource consumer. No
 * provider was observed and no transaction is signed or submitted here. */
export function graphFinalityFixture(chainId: "1" | "8453" | "999" = "1") {
  const original = structuredClone(fixtures.fixtures[chainId]), hash = `0x${"aa".repeat(32)}` as Hex;
  const [permit, stamp] = decodeAbiParameters(parseAbiParameters(
    "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes"),
  `0x${original.resource.output.actionRequired.transaction.calldata.slice(10)}`);
  const checkpointHash = `0x${"cc".repeat(32)}`, blockHash = `0x${"bb".repeat(32)}`;
  const onchain = { schemaVersion: "programmable.custom-launch-onchain-evidence.v1", finalityState: "finalized", chainId,
    router: original.resource.output.actionRequired.transaction.to, onchainLaunchId: stamp[0], transactionHash: hash,
    blockNumber: "10", blockHash, logIndex: 0, token: stamp[1], hook: stamp[3][4], poolManager: `0x${"33".repeat(20)}`,
    poolId: `0x${"44".repeat(32)}`, stampHash: `0x${"55".repeat(32)}`, confirmationDepth: "90", requiredConfirmationDepth: "64", observedAtBlockNumber: "100",
    finalizedCheckpoint: { schemaVersion: chainId === "999" ? "programmable.hyperevm-launch-finalized-checkpoint-quorum.v1" : chainId === "8453" ? "programmable.base-launch-finalized-checkpoint-quorum.v1" : "programmable.ethereum-finalized-checkpoint-quorum.v1",
      blockNumber: "90", blockHash: checkpointHash, quorumSize: 2, observations: [
        { provider: "primary", finalizedBlockNumber: "100", finalizedBlockHash: blockHash, commonBlockHash: checkpointHash },
        { provider: "secondary", finalizedBlockNumber: "90", finalizedBlockHash: checkpointHash, commonBlockHash: checkpointHash },
      ] } };
  const resource = { ...original.resource, status: "finalized", onchainLaunchId: stamp[0], walletHandoffUrl: null, expiresAt: null, secondsRemaining: null,
    output: { ...original.resource.output, stage: "onchain-observation", actionRequired: null, onchain,
      artifact: { ...original.resource.output.artifact, permit: { chainId: permit[0].toString(), launchWallet: permit[2] }, stampRequest: { launchId: stamp[0] } } } };
  return { subject: original.subject as GeneralWalletSubject, resource, hash };
}
