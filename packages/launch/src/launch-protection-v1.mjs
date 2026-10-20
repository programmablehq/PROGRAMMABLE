import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeJson } from './canonical-json.mjs';
import { createHash } from 'node:crypto';
import { concatHex, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, getContractAddress,
  getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';

const ZERO = '0x0000000000000000000000000000000000000000';
export const PROTECTED_LAUNCH_POLICY_V1 = Object.freeze({ minimumFdvUsd: '15000', walletLimitBps: 200,
  buyerLimitBps: 200, protectionSeconds: 300, openingTotalFeePpm: 990000, openingFeeSeconds: 30,
  maximumAdditionalTaxExemptWallets: 6, treasury: '0xD88539d3c4C460136a733A3Fd60cf6BF269079da' });
export const PROTECTED_LAUNCH_CHAIN_PINS_V1 = Object.freeze({
  8453: Object.freeze({manager:'0x498581fF718922c3f8e6A244956aF099B2652b2b',
    router:'0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40',routerCodeHash:'0x816c75fe7f6ccf8fe8b14825091e8dff301fe7ffd4b962f89b2981a747facc08',
    feed:'0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',feedCodeHash:'0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2',maxAge:3600n,
    sequencerFeed:'0xBCF85224fc0756B9Fa45aA7892530B47e10b6433'}),
  1: Object.freeze({ manager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    router: '0xd92A36B0000531EF3063dEd4De20A0783308446C',
    routerCodeHash: '0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49',
    feed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    feedCodeHash: '0x4b79b5c8aee6da0f7b393e8b53e6265ef7320a1d16184c65bd3841b5aa3d700d', maxAge: 3600n }),
  4663: Object.freeze({ manager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    router: '0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99',
    routerCodeHash: '0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5',
    feed: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9',
    feedCodeHash: '0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2', maxAge: 86400n }),
});
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

// Uniswap TickMath constants, preserving the same upward sqrt rounding as Core.
const RATIOS = ['fffcb933bd6fad37aa2d162d1a594001','fff97272373d413259a46990580e213a','fff2e50f5f656932ef12357cf3c7fdcc',
 'ffe5caca7e10e4e61c3624eaa0941cd0','ffcb9843d60f6159c9db58835c926644','ff973b41fa98c081472e6896dfb254c0',
 'ff2ea16466c96a3843ec78b326b52861','fe5dee046a99a2a811c461f1969c3053','fcbe86c7900a88aedcffc83b479aa3a4',
 'f987a7253ac413176f2b074cf7815e54','f3392b0822b70005940c7a398e4b70f3','e7159475a2c29b7443b29c7fa6e889d9',
 'd097f3bdfd2022b8845ad8f792aa5825','a9f746462d870fdf8a65dc1f90e061e5','70d869a156d2a1b890bb3df62baf32f7',
 '31be135f97d08fd981231505542fcfa6','9aa508b5b7a84e1c677de54f3e99bc9','5d6af8dedb81196699c329225ee604','2216e584f5fa1ea926041bedfe98','48a170391f7dc42444e8fa2'];
export function protectedSqrtPriceAtTickV1(tick) {
  if (!Number.isInteger(tick) || Math.abs(tick) > 887272) throw new TypeError('Invalid tick');
  const t = Math.abs(tick); let ratio = 1n << 128n;
  for (let i = 0; i < RATIOS.length; i++) if (t & (1 << i)) ratio = ratio * BigInt('0x' + RATIOS[i]) >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}
export function protectedOpeningPriceV1({ supply, answer, feedDecimals = 8, targetFdvUsd = '15000' }) {
  const amount = positive(supply), target = positive(targetFdvUsd);
  if (target < BigInt(PROTECTED_LAUNCH_POLICY_V1.minimumFdvUsd) || answer <= 0n || !Number.isInteger(feedDecimals) || feedDecimals < 0 || feedDecimals > 18) throw new TypeError('Invalid USD floor or feed');
  const value = tick => { const sqrt = protectedSqrtPriceAtTickV1(tick); return (((1n << 192n) * amount / (sqrt * sqrt)) * answer) / (10n ** BigInt(18 + feedDecimals)); };
  let lo = -14786, hi = 14786;
  if (value(lo * 60) < target) throw new TypeError('Valuation outside tick range');
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (value(mid * 60) >= target) lo = mid; else hi = mid - 1; }
  const initialTick = lo * 60;
  return { initialTick, sqrtPriceX96: protectedSqrtPriceAtTickV1(initialTick), openingFdvUsd: value(initialTick) };
}
async function kit(chainId) {
  const baseKit = Number(chainId) === 8453;
  const root = baseKit ? new URL('../contracts/base-launch-protection-v1/', import.meta.url) : kitUrl;
  const contractNames = baseKit ? { ...names, initializer: 'BaseProtectedNativeInitializerV1', hook:'BaseProtectedNative30HookV1', module:'BaseLaunchProtectionModuleV1' } : names;
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
  additionalTaxExemptWallets = [], targetFdvUsd = '15000', initialBuyWei, minimumTokensOut, deriveRootAddress }) {
  const pins = PROTECTED_LAUNCH_CHAIN_PINS_V1[chainId];
  if (!pins || await client.getChainId() !== Number(chainId)) throw new TypeError('Unsupported or mismatched chain');
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
  const k = await kit(chainId), a = k.artifacts;
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
  const hook = root('hook', [pins.manager, config, owner, pins.router, pins.routerCodeHash, exemptions], 0x20cc);
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
      creatorSellFeeBps: sellBps, module: protectionModule, moduleCodeHash: moduleMaterialized.runtimeCodeHash, maxModuleLpFeePips: 0, feeVault, openingTaxVault }, hook.args, hook.address),
    module: moduleMaterialized,
    feeVault: materialize(a.feeVault, { poolManager: pins.manager, kernel: hook.address, creatorRecipient: owner }, [pins.manager, owner], feeVault),
    openingTaxVault: materialize(a.openingTaxVault, { poolManager: pins.manager, kernel: hook.address, creatorRecipient: PROTECTED_LAUNCH_POLICY_V1.treasury }, [pins.manager, PROTECTED_LAUNCH_POLICY_V1.treasury], openingTaxVault),
  };
  const initializeData = encodeFunctionData({ abi: a.initializer.abi, functionName: 'initialize', args: [hook.address, token.address, price.initialTick, owner, minimum] });
  return { chainId: String(chainId), developer: owner, factory, factoryCodeHash: keccak256(factoryCode), authority, contracts,
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
      { dependencyId: 'swap-router', chainId: '4663', address: PROTECTED_LAUNCH_CHAIN_PINS_V1[4663].router, runtimeCodeHash: PROTECTED_LAUNCH_CHAIN_PINS_V1[4663].routerCodeHash }],
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
