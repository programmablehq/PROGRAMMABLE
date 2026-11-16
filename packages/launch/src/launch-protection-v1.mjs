import { protectedOpeningPriceV1 } from './protected-opening-price.mjs';
export { protectedOpeningPriceV1, protectedSqrtPriceAtTickV1 } from './protected-opening-price.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeJson } from './canonical-json.mjs';
import { createHash } from 'node:crypto';
import { concatHex, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, getContractAddress,
  getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';

const ZERO = '0x0000000000000000000000000000000000000000';
import { PROTECTED_LAUNCH_POLICY_V1, PROTECTED_LAUNCH_CHAIN_PINS_V1 } from './launch-protection-pins-v1.mjs';
export { PROTECTED_LAUNCH_POLICY_V1, PROTECTED_LAUNCH_CHAIN_PINS_V1 } from './launch-protection-pins-v1.mjs';
const names = { initializer: 'ProtectedNativeInitializerV1', token: 'ProtectedLaunchTokenV1', hook: 'ProtectedNative30HookV1',
  module: 'LaunchProtectionModuleV1', feeVault: 'EthereumNativeFeeVaultV3', openingTaxVault: 'EthereumNativeFeeVaultV3' };
const kitUrl = new URL('../contracts/launch-protection-v1/', import.meta.url);
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const word = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : toHex(BigInt(value), { size: 32 });
function positive(value, max = (1n << 127n) - 1n) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > max) throw new TypeError('A positive bounded decimal amount is required');
  return BigInt(value);
}
function fee(value = 0) {
  if (!Number.isInteger(value) || value < 0 || value > 1000) throw new TypeError('Creator fee must be 0..1000 bps');
  return value;
}
export function protectedLaunchExemptionsV1(developer, extra = []) {
  const owner = getAddress(developer);
  if (!Array.isArray(extra) || extra.length > PROTECTED_LAUNCH_POLICY_V1.maximumAdditionalTaxExemptWallets) throw new TypeError('At most six additional exempt wallets');
  const result = extra.map(address => getAddress(address));
  if (result.some(a => a === owner || a === ZERO) || new Set(result).size !== result.length) throw new TypeError('Exempt wallets must be distinct and nonzero, excluding developer');
  return [...result, ...Array(PROTECTED_LAUNCH_POLICY_V1.maximumAdditionalTaxExemptWallets - result.length).fill(ZERO)];
}

async function kit(chainId, automatic = false, automaticV2 = false) {
  const baseKit = Number(chainId) === 8453;
  const hyperKit = Number(chainId) === 999;
  const elysiumKit = Number(chainId) === 99901;
  const root = automaticV2 ? new URL('../contracts/automatic-platform-fees-v2/', import.meta.url) : automatic ? new URL('../contracts/automatic-platform-fees-v1/', import.meta.url) : elysiumKit ? new URL('../contracts/elysium-launch-protection-v1/', import.meta.url) : hyperKit ? new URL('../contracts/hyperevm-launch-protection-v1/', import.meta.url) : baseKit ? new URL('../contracts/base-launch-protection-v1/', import.meta.url) : kitUrl;
  const prefix=elysiumKit?'Elysium':hyperKit?'HyperEvm':baseKit?'Base':null;
  const contractNames = automaticV2 ? { ...names, initializer:prefix?prefix+'ProtectedNativeInitializerV1':names.initializer, hook:'AutomaticProtectedNative30HookV2', feeVault:'AutomaticNativeFeeVaultV2', openingTaxVault:'AutomaticNativeFeeVaultV2', module:'AutomaticLaunchProtectionModuleV2' } : automatic ? { ...names, hook:'AutomaticProtectedNative30HookV1', feeVault:'AutomaticNativeFeeVaultV1' } : prefix ? { ...names, initializer: prefix+'ProtectedNativeInitializerV1', hook:prefix+'ProtectedNative30HookV1', module:prefix+'LaunchProtectionModuleV1' } : names;
  const standardJsonBytes = await readFile(new URL('standard-json.json', root));
  const artifacts = Object.fromEntries(await Promise.all(Object.entries(contractNames).map(async ([role, name]) =>
    [role, JSON.parse(await readFile(new URL(name + '.artifact.json', root), 'utf8'))])));
  for (const a of Object.values(artifacts)) if (a.sourceArtifactHash !== digest(standardJsonBytes)) throw new TypeError('Protected source package changed');
  return { artifacts, standardJsonBytes, sourceArtifactHash: digest(standardJsonBytes) };
}
function materialize(a, values, args, address) {
  let runtime = a.runtimeTemplateHex;
  const immutables = [];
  for (const w of a.immutableWords) {
    if (values[w.name] === undefined) throw new TypeError('Missing immutable ' + w.name);
    const value = word(values[w.name]);
    for (const offset of w.byteOffsets) runtime = runtime.slice(0, 2 + offset * 2) + value.slice(2) + runtime.slice(2 + offset * 2 + 64);
    immutables.push({ immutableId: a.immutableIds[w.name], abiType: 'bytes32', literal: value });
  }
  const references = Object.entries(a.deployedBytecode.immutableReferences).map(([immutableId, ranges]) => ({ immutableId, ranges }))
    .sort((x, y) => Number(BigInt(x.immutableId) - BigInt(y.immutableId)));
  immutables.sort((x, y) => Number(BigInt(x.immutableId) - BigInt(y.immutableId)));
  const inputs = a.abi.find(x => x.type === 'constructor')?.inputs ?? [];
  return { address, runtime, runtimeCodeHash: keccak256(runtime), creationCode: a.creationBytecode,
    initCode: encodeDeployData({ abi: a.abi, bytecode: a.creationBytecode, args }),
    source: { compilationUnitId: 'launch-protection-v1', sourcePath: a.sourcePath, contractName: a.contractName,
      constructorArguments: encodeAbiParameters(inputs, args), runtimeMaterialization: { immutableReferences: references,
        runtimeImmutables: immutables, deployedRuntimeCodeBase64: Buffer.from(runtime.slice(2), 'hex').toString('base64'), deployedRuntimeCodeHash: keccak256(runtime) } } };
}

/** Builds exact bytes only; no account, signature or transaction is sent. The supplied reader must be on the intended chain. */
export async function prepareProtectedNativeContractsV1({ client, chainId, developer, deploymentFactory, initializerAuthority,
  nonce, name, symbol, supply = '1000000000000000000000000000', creatorBuyFeeBps = 0, creatorSellFeeBps = 0,
  additionalTaxExemptWallets = [], targetFdvUsd = '15000', initialBuyWei, minimumTokensOut, deriveRootAddress, platformFeePolicy, capabilities }) {
  const pins = PROTECTED_LAUNCH_CHAIN_PINS_V1[chainId];
  platformFeePolicy ??= capabilities?.automaticPlatformFees;
  if (platformFeePolicy && (!['programmable.automatic-platform-fees.v1','programmable.automatic-platform-fees.v2'].includes(platformFeePolicy.policyId) || platformFeePolicy.status !== 'active'
    || String(platformFeePolicy.chainId) !== String(chainId) || platformFeePolicy.platformFeeBps !== 30
    || platformFeePolicy.nativePayoutBps !== (Number(chainId)===4663?2000:10000))) throw new TypeError('Unsupported automatic fee policy');
  const automaticV2 = platformFeePolicy?.policyId === 'programmable.automatic-platform-fees.v2';
  const automatic = automaticV2 || platformFeePolicy?.policyId === 'programmable.automatic-platform-fees.v1';
  if (automatic && (!(automaticV2?[1,4663,8453,999,99901]:[1,4663]).includes(Number(chainId)) || platformFeePolicy.teamWallet !== '0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62'
    || platformFeePolicy.buybackBps !== (Number(chainId)===4663?8000:0))) throw new TypeError('Automatic fee policy differs');
  if (!pins || await client.getChainId() !== Number(chainId)) throw new TypeError('Unsupported or mismatched chain');
  if(automatic && Number(chainId)===4663 && !platformFeePolicy.router) throw new TypeError('Automatic fee router missing');
  const platformRouter = automatic && Number(chainId)===4663 ? getAddress(platformFeePolicy.router.address) : ZERO;
  const platformRouterHash = automatic && Number(chainId)===4663 ? platformFeePolicy.router.runtimeCodeHash : '0x'+'00'.repeat(32);
  if (automatic && Number(chainId)===4663 && (!/^0x[0-9a-f]{64}$/i.test(platformRouterHash) || !platformRouterHash.match(/[1-9a-f]/i)
    || keccak256(await client.getCode({address:platformRouter})) !== platformRouterHash)) throw new TypeError('Automatic fee router is not the published deployment');
  const owner = getAddress(developer), factory = getAddress(deploymentFactory), authority = getAddress(initializerAuthority);
  if (owner === ZERO || factory === ZERO || authority === ZERO || !/^0x(?!0{64}$)[0-9a-f]{64}$/i.test(nonce)
    || typeof name !== 'string' || Buffer.byteLength(name) < 1 || Buffer.byteLength(name) > 64
    || typeof symbol !== 'string' || Buffer.byteLength(symbol) < 1 || Buffer.byteLength(symbol) > 16) throw new TypeError('Invalid protected launch identity');
  const amount = positive(supply); if (amount < 50n) throw new TypeError('Supply is too small');
  const initialBuy = positive(initialBuyWei), minimum = positive(minimumTokensOut);
  if (minimum > amount / 50n) throw new TypeError('Initial buy minimum exceeds the 2% limit');
  const buyBps = fee(creatorBuyFeeBps), sellBps = fee(creatorSellFeeBps), exemptions = protectedLaunchExemptionsV1(owner, additionalTaxExemptWallets);
  const block = await client.getBlock();
  const [feedCode, routerCode, factoryCode, round, decimals] = await Promise.all([
    client.getCode({ address: pins.feed, blockNumber: block.number }), client.getCode({ address: pins.router, blockNumber: block.number }),
    client.getCode({ address: factory, blockNumber: block.number }),
    client.readContract({ address: pins.feed, abi: parseAbi(['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']), functionName: 'latestRoundData', blockNumber: block.number }),
    client.readContract({ address: pins.feed, abi: parseAbi(['function decimals() view returns(uint8)']), functionName: 'decimals', blockNumber: block.number }),
  ]);
  if (!feedCode || keccak256(feedCode) !== pins.feedCodeHash || !routerCode || keccak256(routerCode) !== pins.routerCodeHash || !factoryCode || factoryCode === '0x') throw new TypeError('Trusted infrastructure runtime differs');
  if (round[0] === 0n || round[1] <= 0n || round[3] === 0n || round[3] > block.timestamp || block.timestamp - round[3] > pins.maxAge || round[4] < round[0]) throw new TypeError('USD feed is invalid or expired');
  const price = protectedOpeningPriceV1({ supply, answer: round[1], feedDecimals: decimals, targetFdvUsd });
  let sequencerFeedCodeHash;
  if (pins.sequencerFeed) {
    const code = await client.getCode({address:pins.sequencerFeed,blockNumber:block.number});
    const seq = await client.readContract({address:pins.sequencerFeed,abi:parseAbi(['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']),functionName:'latestRoundData',blockNumber:block.number});
    if(!code || code==='0x' || seq[1]!==0n || seq[2]===0n || seq[2]>=block.timestamp || block.timestamp-seq[2]<=3600n) throw new TypeError('Base sequencer is unavailable or recovering');
    sequencerFeedCodeHash=keccak256(code);
  }
  const k = await kit(chainId, automatic, automaticV2), a = k.artifacts;
  const salt = (role, attempt = 0n) => keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,bytes32,string,uint256'), [BigInt(chainId), owner, nonce, role, attempt]));
  const root = (role, args, flags) => {
    const initCode = encodeDeployData({ abi: a[role].abi, bytecode: a[role].creationBytecode, args });
    const initCodeHash = keccak256(initCode);
    for (let attempt = 0n; attempt < 262144n; attempt++) {
      const applicantSalt = salt(role, attempt);
      const derived = deriveRootAddress?.({ role, initCode, initCodeHash, applicantSalt });
      const s = derived?.salt ?? applicantSalt;
      const address = derived?.address ?? getCreate2Address({ from: factory, salt: s, bytecodeHash: initCodeHash });
      if (flags === undefined || (BigInt(address) & 0x3fffn) === BigInt(flags)) return { address, salt: s, applicantSalt, args, initCode };
    }
    throw new TypeError('Hook address search exhausted');
  };
  const init = root('initializer', [pins.manager, authority, pins.feed, pins.feedCodeHash]);
  const token = root('token', [name, symbol, amount, init.address, pins.manager]);
  const config = [token.address, 0, 60, price.sqrtPriceX96, init.address, owner, buyBps, sellBps, ZERO, 0];
  const hook = root('hook', [pins.manager, config, owner, pins.router, pins.routerCodeHash, exemptions, ...(automatic?[platformRouter,platformRouterHash]:[])], 0x20cc);
  const feeVault = getContractAddress({ from: hook.address, nonce: 1n }), protectionModule = getContractAddress({ from: hook.address, nonce: 2n }), openingTaxVault = getContractAddress({ from: hook.address, nonce: 3n });
  const moduleArgs = [hook.address, token.address, owner, pins.router, pins.routerCodeHash, buyBps, exemptions];
  const moduleMaterialized = materialize(a.module, { kernel: hook.address, token: token.address, developer: owner,
    router: pins.router, routerCodeHash: pins.routerCodeHash, normalBuyFeePpm: (30 + buyBps) * 100 }, moduleArgs, protectionModule);
  const contracts = {
    initializer: materialize(a.initializer, { poolManager: pins.manager, graphFactory: authority, nativeUsdFeed: pins.feed,
      feedCodeHash: pins.feedCodeHash, feedDecimals: decimals, MAX_FEED_AGE: pins.maxAge, sequencerFeedCodeHash }, init.args, init.address),
    token: materialize(a.token, { initializer: init.address, poolManager: pins.manager, launchSupply: amount, walletTokenLimit: amount / 50n }, token.args, token.address),
    hook: materialize(a.hook, { poolManager: pins.manager, CANONICAL_POOL_MANAGER: pins.manager, CHAIN_ID: chainId, token: token.address,
      lpFee: 0, tickSpacing: 60, initialSqrtPriceX96: price.sqrtPriceX96, initializer: init.address, creatorBuyFeeBps: buyBps,
      creatorSellFeeBps: sellBps, module: protectionModule, moduleCodeHash: moduleMaterialized.runtimeCodeHash, maxModuleLpFeePips: 0, feeVault, openingTaxVault, ...(automaticV2?{OPENING_TAX_RECIPIENT:Number(chainId)!==4663?platformFeePolicy.teamWallet:platformRouter}:{}), ...(automatic?{platformFeeRouter:Number(chainId)!==4663?platformFeePolicy.teamWallet:platformRouter,PLATFORM_RECIPIENT:Number(chainId)!==4663?platformFeePolicy.teamWallet:platformRouter,platformFeeRouterCodeHash:platformRouterHash}:{}) }, hook.args, hook.address),
    module: moduleMaterialized,
    feeVault: materialize(a.feeVault, { poolManager: pins.manager, kernel: hook.address, creatorRecipient: owner, ...(automatic?{PLATFORM_RECIPIENT:Number(chainId)!==4663?platformFeePolicy.teamWallet:platformRouter,platformRouterCodeHash:platformRouterHash}:{}) }, [pins.manager, owner, ...(automatic?[platformRouter,platformRouterHash]:[])], feeVault),
    openingTaxVault: materialize(a.openingTaxVault, { poolManager: pins.manager, kernel: hook.address, creatorRecipient: automaticV2?platformFeePolicy.teamWallet:PROTECTED_LAUNCH_POLICY_V1.treasury, ...(automaticV2?{PLATFORM_RECIPIENT:Number(chainId)!==4663?platformFeePolicy.teamWallet:platformRouter,platformRouterCodeHash:platformRouterHash}:{}) }, [pins.manager, automaticV2?platformFeePolicy.teamWallet:PROTECTED_LAUNCH_POLICY_V1.treasury, ...(automaticV2?[platformRouter,platformRouterHash]:[])], openingTaxVault),
  };
  const initializeData = encodeFunctionData({ abi: a.initializer.abi, functionName: 'initialize', args: [hook.address, token.address, price.initialTick, owner, minimum] });
  return { chainId: String(chainId), developer: owner, factory, factoryCodeHash: keccak256(factoryCode), authority, contracts, ...(automatic?{automaticPlatformFees:platformFeePolicy}:{}),
    deployments: Object.fromEntries([['initializer', init], ['token', token], ['hook', hook]]), initialBuy, initializeData,
    supply: amount, walletTokenLimit: amount / 50n, exemptions, price, oracle: { address: pins.feed, runtimeCodeHash: pins.feedCodeHash,
      blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp, round }, ...k };
}

export function protectedVerificationBundleV1(prepared) {
  return { schemaVersion: 'programmable.exact-source-verification-bundle.v2', compilationUnits: [{
    compilationUnitId: 'launch-protection-v1', compilerVersion: '0.8.26+commit.8a97fa7a',
    standardJsonInputBase64: prepared.standardJsonBytes.toString('base64'), standardJsonInputSha256: prepared.sourceArtifactHash,
  }], components: Object.entries(prepared.contracts).map(([targetId, c]) => ({ targetId, ...c.source }))
    .sort((a, b) => a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0) };
}

/** Robinhood's current plan transport supports exact generic source, including constructor-created children. */
export function protectedRobinhoodPlanV1(prepared, { manifestDigest, controller, validAfter, deadline, publication, maxTotalGas = '16000000' }) {
  if (prepared.chainId !== '4663' || getAddress(controller.address) !== prepared.developer || !/^sha256:[0-9a-f]{64}$/.test(manifestDigest)) throw new TypeError('Plan authority does not match protected launch');
  if (!/^[0-9]+$/.test(validAfter) || !/^[0-9]+$/.test(deadline) || BigInt(deadline) <= BigInt(validAfter)) throw new TypeError('The plan validity window must be positive');
  const names = ['initializer', 'token', 'hook'];
  const effects = Object.entries(prepared.contracts).map(([role, c]) => ({ effectId: role + '-runtime', kind: 'runtime', criticality: 'critical', target: { componentId: role }, runtimeCodeHash: c.runtimeCodeHash }));
  const actions = names.map((role, i) => ({ actionId: 'deploy-' + role, kind: 'deployCreate2', componentId: role,
    factory: { address: prepared.factory }, salt: prepared.deployments[role].salt, initCode: prepared.contracts[role].initCode,
    execution: { target: { address: prepared.factory }, data: concatHex([prepared.deployments[role].salt, prepared.contracts[role].initCode]), value: '0', gasLimit: role === 'hook' ? '6500000' : '2500000' },
    dependsOn: i ? ['deploy-' + names[i - 1]] : [], authority: { kind: 'controller' }, preconditions: [],
    postconditions: role === 'hook' ? ['hook-runtime', 'module-runtime', 'feeVault-runtime', 'openingTaxVault-runtime'] : [role + '-runtime'] }));
  effects.push({ effectId: 'initialized', kind: 'callResult', criticality: 'critical', target: { componentId: 'initializer' },
    data: encodeFunctionData({ abi: parseAbi(['function initialized() view returns(bool)']), functionName: 'initialized' }), expected: encodeAbiParameters(parseAbiParameters('bool'), [true]) });
  actions.push({ actionId: 'initialize-and-buy', kind: 'call', execution: { target: { componentId: 'initializer' }, data: prepared.initializeData,
    value: String(prepared.initialBuy), gasLimit: '2500000' }, dependsOn: ['deploy-hook'], authority: { kind: 'controller' }, preconditions: [], postconditions: ['initialized'] });
  for (const [role, nonce] of [['feeVault', '1'], ['module', '2'], ['openingTaxVault', '3']]) effects.push({ effectId: role + '-child', kind: 'child', criticality: 'critical',
    componentId: role, derivation: { kind: 'create', parent: { componentId: 'hook' }, nonce }, runtimeCodeHash: prepared.contracts[role].runtimeCodeHash });
  return { schemaVersion: 'programmable.custom-launch-plan.v1', chainId: '4663', manifestDigest, controller,
    executor: 'atomic_execute_and_stamp_v2', admissionPolicy: 'programmable.custom-launch-policy.provenance.v1',
    verificationBundle: protectedVerificationBundleV1(prepared), components: Object.entries(prepared.contracts).map(([componentId, c]) => ({ componentId, artifactId: componentId, expectedAddress: c.address, runtimeCodeHash: c.runtimeCodeHash })),
    actions, markets: [{ marketId: 'primary', kind: 'uniswap_v4', poolManager: PROTECTED_LAUNCH_CHAIN_PINS_V1[4663].manager,
      currency0: { address: ZERO }, currency1: { componentId: 'token' }, fee: 0, tickSpacing: 60, hooks: { componentId: 'hook' } }],
    hookBindings: [{ componentId: 'hook', poolManager: PROTECTED_LAUNCH_CHAIN_PINS_V1[4663].manager, permissions: 0x20cc,
      callbackAbi: prepared.artifacts.hook.abi.filter(x => x.type === 'function' && ['beforeInitialize', 'beforeSwap', 'afterSwap'].includes(x.name)) }],
    dependencies: [{ dependencyId: 'create2-factory', chainId: '4663', address: prepared.factory, runtimeCodeHash: prepared.factoryCodeHash },
      { dependencyId: 'usd-feed', chainId: '4663', address: prepared.oracle.address, runtimeCodeHash: prepared.oracle.runtimeCodeHash },
      { dependencyId: 'swap-router', chainId: '4663', address: PROTECTED_LAUNCH_CHAIN_PINS_V1[4663].router, runtimeCodeHash: PROTECTED_LAUNCH_CHAIN_PINS_V1[4663].routerCodeHash },
      ...(prepared.automaticPlatformFees?.router?[{dependencyId:'platform-fee-router',chainId:'4663',...prepared.automaticPlatformFees.router}]:[])],
    expectedEffects: effects, budgets: { maxTotalValue: String(prepared.initialBuy), maxTotalGas, validAfter, deadline },
    feeObligations: [], claimDescriptors: [], distributionPreferences: [], publication: { visibility: 'listed',
      primaryComponentId: 'token', primaryMarketId: 'primary', ...publication } };
}

export async function writeProtectedNativeBundleV1(directory, prepared) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'standard-json.json'), prepared.standardJsonBytes);
  for (const [role, contract] of Object.entries(prepared.contracts)) await writeFile(path.join(directory, role + '.json'), JSON.stringify(contract, null, 2) + '\n');
}

/** Exact JSON bytes for POST custom-launch-plans and its preflight. */
export function protectedRobinhoodPlanBytesV1(plan) {
  if (plan?.schemaVersion !== 'programmable.custom-launch-plan.v1' || plan.chainId !== '4663') throw new TypeError('A Robinhood launch plan is required');
  return Buffer.from(canonicalizeJson(plan));
}
