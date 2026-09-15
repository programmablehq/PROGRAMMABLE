import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { Actions, V4Planner, URVersion } from "@uniswap/v4-sdk";
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { FOUNDATION_CHAIN_ID, FOUNDATION_INFRASTRUCTURE, FOUNDATION_INT128_MAX, FOUNDATION_LP_FEE, FOUNDATION_TICK_SPACING } from "./constants";

export interface FoundationPoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export interface FoundationPool { token: Address; quote: Address; hook: Address; poolId: Hex }
const executeAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);

export function foundationPoolKey(pool: Omit<FoundationPool, "poolId">): FoundationPoolKey {
  const token = getAddress(pool.token), quote = getAddress(pool.quote), hook = getAddress(pool.hook);
  if (BigInt(token) === 0n || BigInt(quote) === 0n || BigInt(hook) === 0n || token === quote || token === hook || quote === hook) throw new Error("Invalid launch pool identity.");
  return { currency0: BigInt(token) < BigInt(quote) ? token : quote,
    currency1: BigInt(token) < BigInt(quote) ? quote : token, fee: FOUNDATION_LP_FEE,
    tickSpacing: FOUNDATION_TICK_SPACING, hooks: hook };
}

export function foundationPoolId(key: FoundationPoolKey): Hex {
  if (BigInt(key.currency0) >= BigInt(key.currency1)) throw new Error("Pool currencies must be ordered.");
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

/** Single-pool official UR 2.1.1 route. Existing router donations cannot fund a user's swap. */
export function buildFoundationExactInput(input: { pool: FoundationPool; owner: Address; recipient: Address;
  side: "buy" | "sell"; amountIn: bigint; minimumOutput: bigint; deadline: bigint; now?: bigint }) {
  const now = input.now ?? BigInt(Math.floor(Date.now() / 1_000));
  if ((input.side !== "buy" && input.side !== "sell") || input.amountIn <= 0n || input.amountIn > FOUNDATION_INT128_MAX
    || input.minimumOutput <= 0n || input.minimumOutput > FOUNDATION_INT128_MAX
    || input.deadline <= now || input.deadline > now + 300n) throw new Error("Invalid trade amounts or deadline.");
  const owner = getAddress(input.owner), recipient = getAddress(input.recipient);
  const key = foundationPoolKey(input.pool);
  if (foundationPoolId(key).toLowerCase() !== input.pool.poolId.toLowerCase()) throw new Error("Pool identity does not match its key.");
  if (BigInt(owner) <= 2n || BigInt(recipient) <= 2n) throw new Error("A wallet address is required.");
  const currencyIn = input.side === "buy" ? getAddress(input.pool.quote) : getAddress(input.pool.token);
  const currencyOut = input.side === "buy" ? getAddress(input.pool.token) : getAddress(input.pool.quote);
  const v4 = new V4Planner();
  v4.addAction(Actions.SWAP_EXACT_IN_SINGLE, [[
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], currencyIn === key.currency0,
    input.amountIn.toString(), input.minimumOutput.toString(), "0", "0x",
  ]], URVersion.V2_1_1);
  v4.addAction(Actions.SETTLE, [currencyIn, input.amountIn.toString(), true], URVersion.V2_1_1);
  v4.addAction(Actions.TAKE, [currencyOut, recipient, "0"], URVersion.V2_1_1);
  const router = new RoutePlanner();
  router.addCommand(CommandType.V4_SWAP, [v4.finalize()], false, UniversalRouterVersion.V2_1_1);
  const commands = router.commands as Hex, inputs = router.inputs as Hex[];
  return { chainId: FOUNDATION_CHAIN_ID, routerVersion: "2.1.1" as const, poolId: input.pool.poolId, currencyIn, currencyOut,
    commands, inputs, deadline: input.deadline, minimumOutput: input.minimumOutput,
    transaction: { from: owner, to: FOUNDATION_INFRASTRUCTURE.universalRouter.address,
      data: encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, inputs, input.deadline] }), value: 0n },
    approval: { owner, token: currencyIn, spender: FOUNDATION_INFRASTRUCTURE.permit2.address,
      permit2Spender: FOUNDATION_INFRASTRUCTURE.universalRouter.address, amount: input.amountIn, expiration: input.deadline },
  };
}
