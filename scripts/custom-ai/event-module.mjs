// Trusted template only. Submitted source cannot opt itself into external calls.
export function eventModuleSource(feed) {
  const r = feed.rule;
  if (!/^0x[0-9a-fA-F]{40}$/.test(feed.address) || !/^0x[0-9a-fA-F]{64}$/.test(feed.runtimeHash)
    || !/^-?\d{1,30}$/.test(r.threshold) || [r.belowBuyBps,r.belowSellBps,r.aboveBuyBps,r.aboveSellBps].some(n => !Number.isInteger(n) || n < 50 || n > 1500)) throw Error("Invalid event template input");
  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { ICustomAIFeeModuleV1 } from "./ICustomAIFeeModuleV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
contract GeneratedFeeModule is ICustomAIFeeModuleV1 {
    address public immutable feed = address(uint160(${BigInt(feed.address)}));
    bytes32 public immutable feedCodeHash = ${feed.runtimeHash};
    int256 public immutable threshold = ${r.threshold};
    uint16 public immutable belowBuy = ${r.belowBuyBps - 50};
    uint16 public immutable belowSell = ${r.belowSellBps - 50};
    uint16 public immutable aboveBuy = ${r.aboveBuyBps - 50};
    uint16 public immutable aboveSell = ${r.aboveSellBps - 50};
    bytes32 public immutable configurationHash;
    constructor() { configurationHash = keccak256(abi.encode(T.VERSION_ID, feed, feedCodeHash, threshold, belowBuy, belowSell, aboveBuy, aboveSell)); }
    function quoteFee(T.SwapContext calldata c) external view returns (bytes4, uint16, uint64, bytes32) {
        uint16 fee;
        if (feed.codehash == feedCodeHash) {
            (bool ok, bytes memory data) = feed.staticcall{gas: 30000}(abi.encodeWithSignature("latest()"));
            if (ok && data.length == 64) {
                (int256 value, bool fresh) = abi.decode(data, (int256, bool));
                if (fresh) fee = value < threshold ? (c.buy ? belowBuy : belowSell) : (c.buy ? aboveBuy : aboveSell);
            }
        }
        return (this.quoteFee.selector, fee, type(uint64).max, configurationHash);
    }
}
`;
}

// Install the exact checked feed runtime and synthetic observations in the
// networkless EVM. CustomAIDataFeedV1 inherits two EIP712 fallback slots;
// sequence/value/packed timestamps occupy slots 2/3/4 (checked in tests).
export async function seedEventFeed(requireTool, vm, feed, timestamp, value = feed.rule.threshold, fresh = true) {
  const { createAddressFromString, hexToBytes } = requireTool("@ethereumjs/util");
  const address = createAddressFromString(feed.address);
  const word = n => hexToBytes(`0x${BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64,"0")}`);
  await vm.stateManager.putCode(address, hexToBytes(feed.runtimeCode));
  await vm.stateManager.putStorage(address, word(2), word(1));
  await vm.stateManager.putStorage(address, word(3), word(value));
  const observed = BigInt(timestamp) - (fresh ? 0n : BigInt(feed.maxAge) + 1n);
  const expires = fresh ? BigInt(timestamp) + BigInt(feed.maxAge) : BigInt(timestamp) - 1n;
  await vm.stateManager.putStorage(address, word(4), word(observed | expires << 64n));
}
