// Trusted harness; generated EVM bytecode runs only in this networkless VM.
import { createHash } from "node:crypto";

export async function simulateLifecycle(requireTool, artifact, bundle) {
  const { createVM } = requireTool("@ethereumjs/vm");
  const { createCustomCommon, Mainnet, Hardfork } = requireTool("@ethereumjs/common");
  const { createBlock } = requireTool("@ethereumjs/block");
  const { createAddressFromString, bytesToHex, hexToBytes } = requireTool("@ethereumjs/util");
  const { encodeDeployData, encodeFunctionData, decodeFunctionResult, decodeEventLog, encodeAbiParameters,
    getCreate2Address, keccak256, toHex, zeroAddress, zeroHash, stringToHex } = requireTool("viem");
  const { privateKeyToAccount } = requireTool("viem/accounts");
  const { bundleHash, ...payload } = bundle;
  if (createHash("sha256").update(JSON.stringify(payload)).digest("hex") !== bundleHash) throw Error("Core bundle integrity failed");
  const core = bundle.contracts;
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`); // Public fixture key; holds no funds on any network.
  const caller = account.address;
  const other = "0x2000000000000000000000000000000000000002";
  const recipient = "0x3000000000000000000000000000000000000003";
  const treasury = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
  const dead = "0x000000000000000000000000000000000000dEaD";
  const supply = 10n ** 27n, max = (1n << 256n) - 1n;
  const startedAt = 1_800_000_000n;
  const coreVersion = keccak256(stringToHex("programmable.custom-ai.core.v1"));
  const scenarios = [];
  let stage = "setup", cases = 0;
  const check = (condition, message) => { if (!condition) throw Error(message); cases++; };
  try {
    for (const chainId of [1, 4663]) for (const decimals of [18, 6]) {
      const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Cancun });
      const vm = await createVM({ common });
      let timestamp = startedAt - 172800n, blockNumber = 1n, maxSwapExecutionGas = 0n;
      const unit = 10n ** BigInt(decimals);
      const run = async ({ to, data, from = caller, read = false, revert = false }) => {
        await vm.evm.journal.cleanup();
        vm.stateManager.originalStorageCache.clear();
        const result = await vm.evm.runCall({ caller: createAddressFromString(from),
          ...(to ? { to: createAddressFromString(to) } : {}), data: hexToBytes(data),
          gasLimit: 25_000_000n, isStatic: read, skipNonceIncrement: read,
          block: createBlock({ header: { number: blockNumber++, timestamp, gasLimit: 30_000_000n } }, { common }) });
        if (revert) { check(!!result.execResult.exceptionError, "Expected execution to revert"); return result; }
        if (result.execResult.exceptionError) throw Error(`Execution reverted (${bytesToHex(result.execResult.returnValue).slice(0, 10)})`);
        return result;
      };
      const deploy = async (name, args = []) => {
        stage = `${chainId}/${decimals}: deploy ${name}`;
        const a = name === "GeneratedFeeModule" ? artifact : core[name];
        const result = await run({ data: encodeDeployData({ abi: a.abi, bytecode: a.initCode, args }) });
        if (!result.createdAddress) throw Error("Missing deployed address");
        return result.createdAddress.toString();
      };
      const call = async (name, to, functionName, args = [], options = {}) => {
        const abi = name === "GeneratedFeeModule" ? artifact.abi : core[name].abi;
        const result = await run({ to, data: encodeFunctionData({ abi, functionName, args }), ...options });
        if (options.revert) return result;
        return { value: decodeFunctionResult({ abi, functionName, data: bytesToHex(result.execResult.returnValue) }), result };
      };
      const read = async (name, to, fn, args = []) => (await call(name, to, fn, args, { read: true })).value;
      const balance = (asset, owner) => read("SimulationQuote", asset, "balanceOf", [owner]);
      const manager = await deploy("PoolManager", [caller]);
      const hookDeployer = await deploy("CustomAIHookDeployerV1");
      const liquidityDeployer = await deploy("CustomAILiquidityDeployerV1");
      const router = await deploy("CustomAISwapRouterV1", [manager]);
      const factory = await deploy("CustomAIFactoryV1", [manager, hookDeployer, liquidityDeployer, router, caller]);
      const quote = await deploy("SimulationQuote", [decimals]);
      const feeModule = await deploy("GeneratedFeeModule");
      const moduleRuntimeHash = keccak256(await vm.stateManager.getCode(createAddressFromString(feeModule)));
      const configurationHash = await read("GeneratedFeeModule", feeModule, "configurationHash");
      timestamp = startedAt; // The coin launches two days after module deployment.
      await call("SimulationQuote", quote, "mint", [caller, 1_000_000n * unit]);
      await call("SimulationQuote", quote, "approve", [factory, max]);
      await call("SimulationQuote", quote, "approve", [router, max]);
      const emptyModule = { instance: zeroAddress, runtimeHash: zeroHash, configurationHash: zeroHash };
      const params = { metadata: { name: "Custom AI simulation", symbol: "SIM", description: "", imageURI: "ipfs://simulation", website: "", socialData: "0x" },
        quote, quoteDecimals: decimals, initialTick: 0, launchSalt: zeroHash, hookSalt: zeroHash,
        feeModule: { instance: feeModule, runtimeHash: moduleRuntimeHash, configurationHash },
        rewards: { creatorRecipient: recipient, creatorShareBps: 10_000, module: emptyModule },
        initialBuyQuote: decimals === 6 ? 100_000n * unit : 30n * unit, minimumBuyTokens: 1n,
        maximumFeeBps: 1500, deadline: timestamp + 120n };
      const tokenInitHash = keccak256(encodeDeployData({ abi: core.CustomAITokenV1.abi, bytecode: core.CustomAITokenV1.initCode, args: [params.metadata, quote] }));
      let predicted;
      for (let salt = 1; salt < 100; salt++) {
        params.launchSalt = toHex(salt, { size: 32 });
        predicted = getCreate2Address({ from: factory, salt: keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [caller, params.launchSalt])), bytecodeHash: tokenInitHash });
        if ((BigInt(predicted) < BigInt(quote)) === (decimals === 18)) break;
      }
      const token0 = BigInt(predicted) < BigInt(quote);
      check(token0 === (decimals === 18), "Both token orderings must be covered");
      params.initialTick = (decimals === 18 ? 111060 : 387360) * (token0 ? -1 : 1);
      check((await read("CustomAIFactoryV1", factory, "predictTokenAddress", [caller, params])).toLowerCase() === predicted.toLowerCase(), "Token prediction differs from factory");
      const hookHash = await read("CustomAIHookDeployerV1", hookDeployer, "initCodeHash", [manager, factory, predicted, quote, params.initialTick, params.feeModule, params.rewards]);
      stage = `${chainId}/${decimals}: hook address`;
      let hook;
      for (let salt = 0; salt < 1_000_000; salt++) {
        params.hookSalt = toHex(salt, { size: 32 });
        hook = getCreate2Address({ from: hookDeployer, salt: params.hookSalt, bytecodeHash: hookHash });
        if ((BigInt(hook) & 16383n) === 8396n) break;
      }
      check((BigInt(hook) & 16383n) === 8396n, "No valid hook salt");
      const parameterType = core.CustomAIFactoryV1.abi.find(x => x.type === "function" && x.name === "launch").inputs[0];
      const planHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, parameterType],
        [coreVersion, BigInt(chainId), factory, caller, params]));
      check(planHash === await read("CustomAIFactoryV1", factory, "hashPlan", [caller, params]), "Offchain plan hash differs from factory");
      const price = { quoteUsdE18: 10n ** 18n, ethUsdE18: 3000n * 10n ** 18n, observedAt: timestamp, validUntil: timestamp + 120n };
      const signature = await account.signTypedData({ domain: { name: "Programmable Custom AI Launch", version: "1", chainId, verifyingContract: factory },
        types: { LaunchPrice: [{ name: "planHash", type: "bytes32" }, { name: "quoteUsdE18", type: "uint256" }, { name: "ethUsdE18", type: "uint256" }, { name: "observedAt", type: "uint64" }, { name: "validUntil", type: "uint64" }] },
        primaryType: "LaunchPrice", message: { planHash, ...price } });
      stage = `${chainId}/${decimals}: signed launch`;
      await call("CustomAIFactoryV1", factory, "launch", [{ ...params, maximumFeeBps: 1499 }, price, signature], { revert: true });
      const { value: launched, result: launchResult } = await call("CustomAIFactoryV1", factory, "launch", [params, price, signature]);
      check(launched.planHash === planHash && launched.token.toLowerCase() === predicted.toLowerCase() && launched.hook.toLowerCase() === hook.toLowerCase(), "Launch differs from plan");
      check(await read("CustomAIHookV1", launched.hook, "launchTimestamp") === startedAt, "Schedule did not start at launch");
      check(await read("CustomAITokenV1", launched.token, "totalSupply") === supply, "Supply changed");
      check(await balance(launched.token, factory) === 0n && await balance(quote, factory) === 0n, "Factory retained assets");
      check(await read("SimulationQuote", quote, "allowance", [factory, router]) === 0n, "Initial buy left an allowance");
      check(await balance(launched.token, caller) === launched.initialBuyTokens, "Initial buy accounting differs");
      check(decimals !== 6 || launched.initialBuyTokens > supply / 2n, "Creator buy was capped");
      const launchEvent = launchResult.execResult.logs.map(([, topics, data]) => {
        try { return decodeEventLog({ abi: core.CustomAIFactoryV1.abi, topics: topics.map(bytesToHex), data: bytesToHex(data) }); } catch { return null; }
      }).find(x => x?.eventName === "Launched");
      check(!!launchEvent && launchEvent.args.initialFdvLowerUsdE18 >= 15000n * 10n ** 18n
        && launchEvent.args.initialFdvUpperUsdE18 <= 150915n * 10n ** 17n, "Start FDV is outside the fixed range");
      const key = await read("CustomAIHookV1", launched.hook, "poolKey");
      check(key.fee === 0 && key.tickSpacing === 60, "Unexpected pool configuration");
      const positionBefore = await read("CustomAILiquidityVaultV1", launched.liquidityVault, "position");
      check(await read("CustomAILiquidityVaultV1", launched.liquidityVault, "initialized"), "Liquidity was not initialized");
      await call("CustomAILiquidityVaultV1", launched.liquidityVault, "initialize", [key, params.initialTick], { revert: true });
      await call("CustomAITokenV1", launched.token, "approve", [router, max]);
      const swaps = [];
      const trade = async (buy, exactInput, amount, trader = caller, shouldRevert = false) => {
        const zeroForOne = buy === (BigInt(quote) < BigInt(launched.token));
        const swap = { zeroForOne, amountSpecified: exactInput ? -amount : amount,
          sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n };
        const beforeQuote = await balance(quote, trader), beforeToken = await balance(launched.token, trader);
        const beforeP = await read("CustomAIFeeLedgerV1", launched.ledger, "platformReceived");
        const beforeA = await read("CustomAIFeeLedgerV1", launched.ledger, "additionalReceived");
        const { value, result } = await call("CustomAISwapRouterV1", router, "swap", [key, swap, exactInput ? 1n : max / 2n, 1500, trader, timestamp + 60n],
          { from: trader, revert: shouldRevert });
        if (shouldRevert) {
          check(await balance(quote, trader) === beforeQuote && await balance(launched.token, trader) === beforeToken, "Failed trade changed balances");
          return;
        }
        const [paid, received] = value;
        const platform = await read("CustomAIFeeLedgerV1", launched.ledger, "platformReceived") - beforeP;
        const additional = await read("CustomAIFeeLedgerV1", launched.ledger, "additionalReceived") - beforeA;
        const gross = buy ? paid : received + platform + additional;
        const quoteResult = await read("GeneratedFeeModule", feeModule, "quoteFee", [{ poolId: launched.poolId, router, buy, exactInput, launchTimestamp: startedAt, specifiedAmount: amount }]);
        check(platform === gross * 50n / 10_000n, "Platform fee differs from 0.5%");
        check(additional === gross * (50n + BigInt(quoteResult[1])) / 10_000n - platform, "Settled fee differs from the generated module");
        check((platform + additional) * 10_000n <= gross * 1500n, "Total fee exceeds 15%");
        check((exactInput ? paid : received) === amount, "Trade was not filled exactly");
        check(await balance(quote, trader) === (buy ? beforeQuote - paid : beforeQuote + received), "Quote balance mismatch");
        check(await balance(launched.token, trader) === (buy ? beforeToken + received : beforeToken - paid), "Token balance mismatch");
        check(await read("PoolManager", manager, "balanceOf", [launched.ledger, BigInt(quote)]) === await read("CustomAIFeeLedgerV1", launched.ledger, "outstandingBacking"), "Fee claims are not fully backed");
        maxSwapExecutionGas = result.execResult.executionGasUsed > maxSwapExecutionGas ? result.execResult.executionGasUsed : maxSwapExecutionGas;
        swaps.push({ afterSeconds: Number(timestamp - startedAt), buy, exactInput, totalFeeBps: Number(quoteResult[1]) + 50 });
      };
      for (const offset of [0n, 86399n, 86400n, 86401n]) {
        timestamp = startedAt + offset;
        stage = `${chainId}/${decimals}: trading at +${offset}s`;
        await trade(true, true, 100n * unit);
        await trade(false, true, await balance(launched.token, caller) / 20n);
        await trade(true, false, 1000n * 10n ** 18n);
        await trade(false, false, unit);
      }
      stage = `${chainId}/${decimals}: fresh-wallet sell and transfer guards`;
      await call("CustomAITokenV1", launched.token, "transfer", [other, await balance(launched.token, caller) / 10n]);
      await call("CustomAITokenV1", launched.token, "approve", [router, max], { from: other });
      await trade(false, true, await balance(launched.token, other), other);
      check(await balance(launched.token, other) === 0n, "Fresh wallet could not sell all tokens");
      await call("SimulationQuote", quote, "setTaxed", [true]);
      await trade(true, true, unit, caller, true);
      await trade(false, true, 1000n * 10n ** 18n, caller, true);
      await call("SimulationQuote", quote, "setTaxed", [false]);
      stage = `${chainId}/${decimals}: replay and claims`;
      const savedQuote = await balance(quote, caller), savedToken = await balance(launched.token, caller);
      const replay = (await call("CustomAIFactoryV1", factory, "launch", [params, price, "0x"])).value;
      check(replay.planHash === planHash && replay.token === launched.token, "Retry created a different launch");
      check(await balance(quote, caller) === savedQuote && await balance(launched.token, caller) === savedToken, "Retry repeated the initial buy");
      await call("CustomAIFactoryV1", factory, "launch", [{ ...params, minimumBuyTokens: params.minimumBuyTokens + 1n }, price, signature], { revert: true });
      const platform = await read("CustomAIFeeLedgerV1", launched.ledger, "platformReceived");
      const additional = await read("CustomAIFeeLedgerV1", launched.ledger, "additionalReceived");
      await call("CustomAIFeeLedgerV1", launched.ledger, "claimPlatform", [], { from: other });
      if (additional > 0n) {
        await call("CustomAIFeeLedgerV1", launched.ledger, "claimAdditional", [], { from: other });
        await call("CustomAIRewardVaultV1", launched.rewardVault, "claimCreator", [], { from: other });
      }
      check(await balance(quote, treasury) === platform && await balance(quote, recipient) === additional, "Claims did not reach fixed recipients");
      check(await read("CustomAIFeeLedgerV1", launched.ledger, "outstandingBacking") === 0n, "Fee claims did not settle");
      for (const address of [router, factory, launched.liquidityVault]) check(await balance(quote, address) === 0n && await balance(launched.token, address) === 0n, "Unexpected residual custody");
      const positionsEqual = JSON.stringify(positionBefore, (_, v) => typeof v === "bigint" ? v.toString() : v)
        === JSON.stringify(await read("CustomAILiquidityVaultV1", launched.liquidityVault, "position"), (_, v) => typeof v === "bigint" ? v.toString() : v);
      check(positionsEqual, "Locked liquidity position changed");
      check(await balance(launched.token, caller) + await balance(launched.token, other) + await balance(launched.token, manager) + await balance(launched.token, dead) === supply, "Token conservation failed");
      check(await balance(quote, caller) + await balance(quote, other) + await balance(quote, manager) + await balance(quote, treasury) + await balance(quote, recipient) === 1_000_000n * unit, "Quote conservation failed");
      scenarios.push({ chainId, quoteDecimals: decimals, token0, initialBuy: params.initialBuyQuote.toString(),
        moduleRuntimeHash, configurationHash, launchExecutionGas: launchResult.execResult.executionGasUsed.toString(),
        maxSwapExecutionGas: maxSwapExecutionGas.toString(), swaps, fixedRecipientsPaid: true, replayWithoutPayment: true });
    }
    return { status: "passed", scope: "isolated-core-with-synthetic-quotes", bundleHash, cases, scenarios, diagnostics: [] };
  } catch (error) {
    return { status: "blocked", scope: "isolated-core-with-synthetic-quotes", bundleHash, cases, scenarios,
      diagnostics: [`${stage}: ${error.message}`] };
  }
}
