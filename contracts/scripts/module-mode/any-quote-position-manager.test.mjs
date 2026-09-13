import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress } from 'viem';
import { OFFICIAL } from './core.mjs';
import { engineResourceCommitment } from './launch-source-profiles.mjs';
import { readAnyQuotePositionManagerCustody } from './verify-launch-source.mjs';
import { ANY_QUOTE_LP_CUSTODY_SCHEMA_ID, ANY_QUOTE_POSITION_MANAGER_ENGINE, ANY_QUOTE_POSITION_MANAGER_RESOURCES_ABI,
  ANY_QUOTE_POSITION_PERMIT2, isAnyQuotePositionManagerEngine } from './any-quote-position-manager.mjs';

// Runtime bytes are an agreed canonical capture. All positions, calls and events below are
// synthetic adversarial fixtures; they are not launch or lifecycle evidence.
const code = JSON.parse(await readFile(new URL('./fixtures/any-quote-position-manager-code.json', import.meta.url), 'utf8'));
const addr = n => toHex(n, { size: 20 }), h = n => toHex(n, { size: 32 });
const pm = OFFICIAL.positionManager.address, permit2 = ANY_QUOTE_POSITION_PERMIT2.address;
const reads = parseAbi([
  'function poolManager() view returns (address)', 'function permit2() view returns (address)',
  'function ownerOf(uint256) view returns (address)', 'function getApproved(uint256) view returns (address)',
  'function getPoolAndPositionInfo(uint256) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)',
  'function getPositionLiquidity(uint256) view returns (uint128)',
  'function allowance(address,address,address) view returns (uint160,uint48,uint48)',
]);
const events = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)',
]);
function fixture() {
  const launch = { engine: addr(111), token: addr(10), quoteAsset: addr(9), resourcesHash: h(0) };
  const release = { sourceVersion: 'module-engine-any-quote-v1', contracts: { poolManager: OFFICIAL.poolManager, sharedHook: { address: addr(88) } } };
  const key = { currency0: launch.quoteAsset, currency1: launch.token, fee: 0, tickSpacing: 200, hooks: addr(88) };
  const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), Object.values(key)));
  const config = { schemaId: keccak256(toHex('programmable.any-quote.configuration.v1')), poolManager: OFFICIAL.poolManager.address,
    poolManagerCodeHash: OFFICIAL.poolManager.runtimeCodeHash, sharedHook: key.hooks, quoteAsset: launch.quoteAsset,
    initialTick: -1200, validUntil: 100n, priceEvidenceHash: h(33) };
  const configuration = encodeAbiParameters(parseAbiParameters('(bytes32 schemaId,address poolManager,bytes32 poolManagerCodeHash,address sharedHook,address quoteAsset,int24 initialTick,uint64 validUntil,bytes32 priceEvidenceHash)'), [config]);
  const state = { LP_CUSTODY_SCHEMA_ID: ANY_QUOTE_LP_CUSTODY_SCHEMA_ID, positionManager: pm, positionTokenId: 42n,
    poolId, initialTick: -1200, tickLower: -887200, tickUpper: -1200, lockedLiquidity: 10000n, lockedTokenDust: 1n, quoteDecimals: 36 };
  const tuple = [state.LP_CUSTODY_SCHEMA_ID, pm, state.positionTokenId, poolId, state.tickLower, state.tickUpper, state.lockedLiquidity, state.lockedTokenDust, state.quoteDecimals];
  launch.resourcesHash = keccak256(encodeAbiParameters(ANY_QUOTE_POSITION_MANAGER_RESOURCES_ABI, tuple));
  const identity = { launch, parameters: { configuration, launchData: '0x' }, anyQuoteRelease: release,
    manifest: { catalogDefinition: { interface: 'quote-shared-v1' }, source: { engine: { ...ANY_QUOTE_POSITION_MANAGER_ENGINE } } } };
  const positionInfo = (BigInt(poolId) & ~((1n << 56n) - 1n)) | (BigInt.asUintN(24, BigInt(state.tickUpper)) << 32n) | (BigInt.asUintN(24, BigInt(state.tickLower)) << 8n);
  const returned = { poolManager: OFFICIAL.poolManager.address, permit2, ownerOf: launch.engine, getApproved: zeroAddress,
    getPoolAndPositionInfo: [key, positionInfo], getPositionLiquidity: state.lockedLiquidity, allowance: [0n, 100n, 0n] };
  const receipt = { transactionHash: h(909), blockHash: code.checkpoint.hash, blockNumber: toHex(BigInt(code.checkpoint.number)), logs: [] };
  const log = (eventName, args, data, logIndex, address) => ({ address, removed: false, transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, logIndex: toHex(logIndex),
    topics: encodeEventTopics({ abi: events, eventName, args }), data });
  receipt.logs = [log('Transfer', { from: zeroAddress, to: launch.engine, tokenId: state.positionTokenId }, '0x', 1, pm),
    log('ModifyLiquidity', { id: poolId, sender: pm }, encodeAbiParameters(parseAbiParameters('int24,int24,int256,bytes32'),
      [state.tickLower, state.tickUpper, state.lockedLiquidity, h(state.positionTokenId)]), 2, OFFICIAL.poolManager.address)];
  const calls = [], block = { blockHash: receipt.blockHash, requireCanonical: true }, runtimes = { [pm]: code.contracts.positionManager.runtime, [permit2]: code.contracts.permit2.runtime };
  const request = async batch => batch.map(({ method, params }) => {
    calls.push({ method, params }); assert.deepEqual(params[1], block);
    if (method === 'eth_getCode') return runtimes[params[0]];
    assert.equal(method, 'eth_call'); const r = decodeFunctionData({ abi: reads, data: params[0].data });
    if (r.functionName === 'allowance') { assert.equal(params[0].to, permit2); assert.deepEqual(r.args.map(x => x.toLowerCase()), [launch.engine, launch.token, pm]); }
    else { assert.equal(params[0].to, pm); if (r.args) assert.deepEqual(r.args, [state.positionTokenId]); }
    return encodeFunctionResult({ abi: reads, functionName: r.functionName, result: returned[r.functionName] });
  });
  return { identity, state, receipt, returned, calls, runtimes, block, run: () => readAnyQuotePositionManagerCustody(identity, state, receipt, { logIndex: '0x3' }, request, block) };
}

test('PositionManager resource commitment binds the reviewed artifact and canonical NFT identity', () => {
  const f = fixture(); assert.equal(engineResourceCommitment(f.identity, f.state), f.identity.launch.resourcesHash);
  for (const change of [s => { s.positionTokenId++; }, s => { s.positionManager = addr(12); }, s => { s.LP_CUSTODY_SCHEMA_ID = h(14); },
    s => { s.lockedLiquidity++; }, s => { s.quoteDecimals = 37; }, s => { s.positionTokenId = 0n; }]) {
    const s = structuredClone(f.state); change(s); assert.throws(() => engineResourceCommitment(f.identity, s));
  }
  for (const field of ['sourcePath', 'contractName']) {
    const identity = structuredClone(f.identity); identity.manifest.source.engine[field] += 'spoof';
    assert.equal(isAnyQuotePositionManagerEngine(identity.manifest.source.engine), false);
    assert.throws(() => engineResourceCommitment(identity, f.state), /resources hash/);
  }
  const legacy = structuredClone(f.identity); delete legacy.manifest.source;
  legacy.launch.resourcesHash = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,int24,int24,uint128,uint256,uint8'),
    [f.state.poolId, f.state.tickLower, f.state.tickUpper, f.state.lockedLiquidity, f.state.lockedTokenDust, f.state.quoteDecimals]));
  assert.equal(engineResourceCommitment(legacy, f.state), legacy.launch.resourcesHash, 'Old custody commitment stays unchanged');
});

test('canonical NFT readback binds independent ownership, pool state, mint receipt and revoked allowance', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.positionTokenId, '42'); assert.equal(result.owner.toLowerCase(), f.identity.launch.engine);
  assert.equal(result.permit2Amount, '0'); assert.equal(result.mintLogIndex, '0x1'); assert.equal(result.liquidityLogIndex, '0x2');
  assert.equal(f.calls.length, 9); assert.ok(f.calls.every(c => c.method === 'eth_call' || c.method === 'eth_getCode'));
});

test('engine self-reports cannot substitute for canonical NFT custody', async () => {
  for (const change of [f => { f.returned.ownerOf = addr(3); }, f => { f.returned.getApproved = addr(4); },
    f => { f.returned.getPositionLiquidity--; }, f => { f.returned.allowance[0] = 1n; },
    f => { f.returned.poolManager = addr(5); }, f => { f.returned.permit2 = addr(6); },
    f => { f.returned.getPoolAndPositionInfo[1] ^= 1n; }, f => { f.returned.getPoolAndPositionInfo[1] ^= 1n << 8n; },
    f => { f.returned.getPoolAndPositionInfo[1] ^= 1n << 100n; }, f => { f.returned.getPoolAndPositionInfo[0].hooks = addr(5); },
    f => { f.runtimes[pm] = '0x00'; }, f => { f.runtimes[permit2] = '0x00'; }]) {
    const f = fixture(); change(f); await assert.rejects(f.run(), /canonical PositionManager custody differs/);
  }
});

test('NFT and liquidity events must originate in the exact launch receipt before the launch record', async () => {
  for (const change of [f => { f.receipt.logs.shift(); }, f => { f.receipt.logs[0].removed = true; },
    f => { f.receipt.logs[0].transactionHash = h(999); }, f => { f.receipt.logs[0].topics[2] = h(99); },
    f => { f.receipt.logs[1].topics[2] = h(99); }, f => { f.receipt.logs[1].logIndex = '0x4'; },
    f => { f.receipt.logs[1].data = encodeAbiParameters(parseAbiParameters('int24,int24,int256,bytes32'), [-887200, -1200, 10000n, h(43)]); },
    f => { f.receipt.logs.push({ ...f.receipt.logs[0], logIndex: '0x2' }); }]) {
    const f = fixture(); change(f); await assert.rejects(f.run());
  }
});
