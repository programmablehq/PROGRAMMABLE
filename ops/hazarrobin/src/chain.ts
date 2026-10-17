import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  keccak256,
  pad,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from "viem";
import {
  CHAIN_HEX,
  CLAIM_CALLDATA,
  CONTRACT_URL,
  EXPECTED_CLAIM_CALLDATA,
  EXPECTED_LIQUIDITY,
  EXPLORER_URL,
  FALLBACK_RPC_URL,
  FEE_RECIPIENT,
  HOOK,
  LOCKER,
  MAX_UINT256,
  POOL_ID,
  POOL_MANAGER,
  POSITION_MANAGER,
  RPC_URL,
  STATE_VIEW,
  TICK_LOWER,
  TICK_UPPER,
  TOKEN,
  TOKEN_ID,
  ZERO_ADDRESS,
  hookAbi,
  lockerAbi,
  positionManagerAbi,
  robinhoodChain,
  stateViewAbi,
  tokenAbi,
} from "./config";
import {
  calculateFeesOwed,
  validateSnapshot,
  type ContractCheck,
} from "./domain";
import { verifyPendingClaim } from './pending';

export interface ChainSnapshot {
  blockNumber: bigint;
  claimableEth: bigint;
  claimableV4: bigint;
  recipientEthBalance: bigint;
  recipientV4Balance: bigint;
  checks: ContractCheck[];
  trusted: boolean;
}

export interface WalletConnection {
  account: Address;
  provider: EIP1193Provider;
}

export interface ClaimProgress {
  stage: "wallet" | "submitted" | "replaced" | "confirmed";
  hash?: Hash;
  gas?: bigint;
  estimatedGasCost?: bigint;
  nonce?: number;
}

export interface ClaimResult {
  hash: Hash;
  claimedEth: bigint;
  claimedV4: bigint;
  gasUsed: bigint;
}

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  batch: {
    multicall: { wait: 12 },
  },
  transport: fallback([
    http("/api/rpc?chainId=4663&provider=primary", { batch: true, retryCount: 2, timeout: 12_000 }),
    http("/api/rpc?chainId=4663&provider=secondary", { batch: true, retryCount: 1, timeout: 12_000 }),
  ]),
});

const tokenSalt = toHex(TOKEN_ID, { size: 32 });
const expectedRecipientTopic = pad(FEE_RECIPIENT, { size: 32 }).toLowerCase();
const feesForwardedTopic =
  "0x0e03635ec70be68229afa80a4b17402fce91d60e7fd3499d709c4271ba408840";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const nativeTransferAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export async function readSnapshot(): Promise<ChainSnapshot> {
  const blockNumber = await publicClient.getBlockNumber();
  const [
    lockerCode,
    positionManagerCode,
    feeRecipient,
    positionManager,
    operator,
    timelockBlockNumber,
    owner,
    approved,
    subscriber,
    liquidity,
    linkedPoolManager,
    lpFeePips,
    positionInfo,
    feeGrowthInside,
    recipientEthBalance,
    recipientV4Balance,
  ] = await Promise.all([
    publicClient.getBytecode({ address: LOCKER, blockNumber }),
    publicClient.getBytecode({ address: POSITION_MANAGER, blockNumber }),
    publicClient.readContract({
      address: LOCKER,
      abi: lockerAbi,
      functionName: "feeRecipient",
      blockNumber,
    }),
    publicClient.readContract({
      address: LOCKER,
      abi: lockerAbi,
      functionName: "positionManager",
      blockNumber,
    }),
    publicClient.readContract({
      address: LOCKER,
      abi: lockerAbi,
      functionName: "operator",
      blockNumber,
    }),
    publicClient.readContract({
      address: LOCKER,
      abi: lockerAbi,
      functionName: "timelockBlockNumber",
      blockNumber,
    }),
    publicClient.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: "ownerOf",
      args: [TOKEN_ID],
      blockNumber,
    }),
    publicClient.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: "getApproved",
      args: [TOKEN_ID],
      blockNumber,
    }),
    publicClient.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: "subscriber",
      args: [TOKEN_ID],
      blockNumber,
    }),
    publicClient.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: "getPositionLiquidity",
      args: [TOKEN_ID],
      blockNumber,
    }),
    publicClient.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: "poolManager",
      blockNumber,
    }),
    publicClient.readContract({
      address: HOOK,
      abi: hookAbi,
      functionName: "currentLPFeePips",
      blockNumber,
    }),
    publicClient.readContract({
      address: STATE_VIEW,
      abi: stateViewAbi,
      functionName: "getPositionInfo",
      args: [POOL_ID, POSITION_MANAGER, TICK_LOWER, TICK_UPPER, tokenSalt],
      blockNumber,
    }),
    publicClient.readContract({
      address: STATE_VIEW,
      abi: stateViewAbi,
      functionName: "getFeeGrowthInside",
      args: [POOL_ID, TICK_LOWER, TICK_UPPER],
      blockNumber,
    }),
    publicClient.getBalance({ address: FEE_RECIPIENT, blockNumber }),
    publicClient.readContract({
      address: TOKEN,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [FEE_RECIPIENT],
      blockNumber,
    }),
  ]);

  if (!lockerCode || !positionManagerCode) {
    throw new Error("Contract Bytecode fehlt auf Robinhood Chain.");
  }

  const [stateLiquidity, lastGrowth0, lastGrowth1] = positionInfo;
  const [currentGrowth0, currentGrowth1] = feeGrowthInside;
  const checks = validateSnapshot({
    lockerRuntimeHash: keccak256(lockerCode),
    positionManagerRuntimeHash: keccak256(positionManagerCode),
    feeRecipient,
    positionManager,
    operator,
    timelockBlockNumber,
    owner,
    approved,
    subscriber,
    liquidity,
    stateLiquidity,
    linkedPoolManager,
    lpFeePips: BigInt(lpFeePips),
  });

  return {
    blockNumber,
    claimableEth: calculateFeesOwed(currentGrowth0, lastGrowth0, stateLiquidity),
    claimableV4: calculateFeesOwed(currentGrowth1, lastGrowth1, stateLiquidity),
    recipientEthBalance,
    recipientV4Balance,
    checks,
    trusted: checks.every((check) => check.passed),
  };
}

export function getInjectedProvider(): EIP1193Provider | null {
  return window.ethereum ?? null;
}

export async function connectWallet(): Promise<WalletConnection> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("Keine Browser Wallet gefunden. Öffne die Seite in MetaMask oder einer EVM Wallet.");
  }

  await ensureRobinhoodChain(provider);
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts[0];
  if (!account) throw new Error("Die Wallet hat kein Konto freigegeben.");

  return { account, provider };
}

export async function ensureRobinhoodChain(provider: EIP1193Provider): Promise<void> {
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (chainId.toLowerCase() === CHAIN_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
  } catch (error) {
    const code = Number((error as { code?: unknown })?.code);
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        },
      ],
    });
  }

  const confirmedChainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (confirmedChainId.toLowerCase() !== CHAIN_HEX) {
    throw new Error("Robinhood Chain ist in der Wallet nicht aktiv.");
  }
}

export async function claimFees(
  connection: WalletConnection,
  onProgress: (progress: ClaimProgress) => void,
): Promise<ClaimResult> {
  await ensureRobinhoodChain(connection.provider);
  const accounts = (await connection.provider.request({ method: "eth_accounts" })) as Address[];
  const activeAccount = accounts[0];
  if (!activeAccount || activeAccount.toLowerCase() !== connection.account.toLowerCase()) {
    throw new Error("Das aktive Wallet Konto hat sich geändert. Bitte neu verbinden.");
  }
  if (CLAIM_CALLDATA.toLowerCase() !== EXPECTED_CLAIM_CALLDATA) {
    throw new Error("Der gebundene Claim Call stimmt nicht mit dem geprüften Call überein.");
  }

  const freshSnapshot = await readSnapshot();
  if (!freshSnapshot.trusted) {
    throw new Error("Die Live Contract Prüfung ist fehlgeschlagen. Claim wurde gestoppt.");
  }
  if (freshSnapshot.claimableEth === 0n && freshSnapshot.claimableV4 === 0n) {
    throw new Error("Aktuell sind keine LP Fees offen. Es wurde keine Transaktion gestartet.");
  }

  const [simulation, gas, gasPrice, nonce] = await Promise.all([
    publicClient.simulateContract({
      account: connection.account,
      address: LOCKER,
      abi: lockerAbi,
      functionName: "collectFees",
      args: [TOKEN_ID],
    }),
    publicClient.estimateContractGas({
      account: connection.account,
      address: LOCKER,
      abi: lockerAbi,
      functionName: "collectFees",
      args: [TOKEN_ID],
    }),
    publicClient.getGasPrice(),
    publicClient.getTransactionCount({ address: connection.account, blockTag: 'pending' }),
  ]);

  onProgress({
    stage: "wallet",
    gas,
    estimatedGasCost: gas * gasPrice,
    nonce,
  });

  const walletClient = createWalletClient({
    account: connection.account,
    chain: robinhoodChain,
    transport: custom(connection.provider),
  });
  let activeHash = await walletClient.writeContract({ ...simulation.request, nonce });
  onProgress({ stage: "submitted", hash: activeHash });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: activeHash,
    confirmations: 1,
    timeout: 180_000,
    onReplaced: ({ transaction }) => {
      activeHash = transaction.hash;
      onProgress({ stage: "replaced", hash: activeHash });
    },
  });

  if (receipt.status !== "success") {
    throw new Error("Die Claim Transaktion wurde bestätigt, ist aber fehlgeschlagen.");
  }

  const verification = await verifyPendingClaim({ chainId: 4663, account: connection.account,
    to: LOCKER, data: CLAIM_CALLDATA, nonce, created: Date.now(), hash: receipt.transactionHash },
    receipt.transactionHash, ['primary', 'secondary'].map(provider => createPublicClient({
      chain: robinhoodChain, transport: http(`/api/rpc?chainId=4663&provider=${provider}`),
    })));
  if (verification.outcome !== 'confirmed') {
    throw new Error("Die bestätigte Transaktion stimmt nicht mit dem gebundenen Claim überein.");
  }

  const forwarded = receipt.logs.some(
    (log) =>
      log.address.toLowerCase() === LOCKER.toLowerCase() &&
      log.topics[0]?.toLowerCase() === feesForwardedTopic &&
      log.topics[1]?.toLowerCase() === expectedRecipientTopic,
  );
  if (!forwarded) {
    throw new Error("Bestätigung ohne erwartetes FeesForwarded Event. Bitte Blockscout prüfen.");
  }

  const claimedEth = transferAmount(receipt.logs, nativeTransferAddress);
  const claimedV4 = transferAmount(receipt.logs, TOKEN);
  const liquidityAfter = await publicClient.readContract({
    address: POSITION_MANAGER,
    abi: positionManagerAbi,
    functionName: "getPositionLiquidity",
    args: [TOKEN_ID],
  });
  if (liquidityAfter !== EXPECTED_LIQUIDITY) {
    throw new Error("Claim bestätigt, aber der erwartete Liquiditätswert stimmt nicht mehr.");
  }

  onProgress({ stage: "confirmed", hash: receipt.transactionHash });
  return {
    hash: receipt.transactionHash,
    claimedEth,
    claimedV4,
    gasUsed: receipt.gasUsed,
  };
}

function transferAmount(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  tokenAddress: string,
): bigint {
  return logs.reduce((total, log) => {
    if (
      log.address.toLowerCase() !== tokenAddress.toLowerCase() ||
      log.topics[0]?.toLowerCase() !== transferTopic ||
      topicAddress(log.topics[1]) !== POOL_MANAGER.toLowerCase() ||
      topicAddress(log.topics[2]) !== FEE_RECIPIENT.toLowerCase()
    ) {
      return total;
    }
    return total + BigInt(log.data);
  }, 0n);
}

function topicAddress(topic: Hex | undefined): string {
  if (!topic || topic.length !== 66) return ZERO_ADDRESS;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export function transactionUrl(hash: Hash): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export { CONTRACT_URL, MAX_UINT256 };
