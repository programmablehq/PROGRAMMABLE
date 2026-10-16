import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeAbiParameters, getCreate2Address, keccak256, parseAbiParameters, stringToHex } from 'viem';
import { prepareProtectedNativeContractsV1, PROTECTED_LAUNCH_POLICY_V1, PROTECTED_LAUNCH_CHAIN_PINS_V1 } from './launch-protection-v1.mjs';
import { buildLaunch } from './pack.mjs';
import { buildSourceBundle } from './source-bundle.mjs';
import { deriveRouteNamespace } from './graph.mjs';
import { resolveDirectNativeProfile } from './profile-direct-native-v1.mjs';
import { GRAPH_TARGET_SALT_TYPE, LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS } from './constants.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const kitUrl = new URL('../contracts/launch-protection-v1/', import.meta.url);
const contracts = { initializer: 'ProtectedNativeInitializerV1', token: 'ProtectedLaunchTokenV1', hook: 'ProtectedNative30HookV1' };
async function exactFile(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  try { const previous = await readFile(file); if (!previous.equals(Buffer.from(content))) throw new Error('Refusing to overwrite a different project source: ' + file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(file, content); }
}
/** Builds the current Ethereum API request. It never submits, signs or sends a transaction. */
export async function buildProtectedEthereumLaunchV1({ projectRoot, client, capabilities, input, permitWindow }) {
  if (capabilities.chain?.id !== '1' || capabilities.profile?.profileVersion !== '3.6.0'
    || capabilities.profile?.productionLaunchAuthorized !== true) throw new TypeError('Current Ethereum capabilities are required');
  const root = path.resolve(projectRoot), metadata = input.projectMetadata;
  const selection = { schemaVersion: 'programmable.direct-native-hook-graph-profile-selection.v3',
    profileId: 'programmable.direct-native-hook-graph.v1', profileRevision: 3,
    targetRoles: { tokenTargetId: 'token', hookTargetId: 'hook', initializerTargetId: 'initializer', platformFeeBindingTargetId: 'hook' },
    fundingMode: 'wallet-transaction-value', accountingMode: 'inclusive-selected-total',
    assessmentBase: 'executed-gross-declared-quote', feeCurrency: 'declared-quote-currency',
    claimMode: 'immutable-payout-recipient', payoutRecipient: PROTECTED_LAUNCH_POLICY_V1.treasury,
    applicantSelectedBuyHundredthsOfBip: String(((input.creatorBuyFeeBps ?? 0) + 30) * 100),
    applicantSelectedSellHundredthsOfBip: String(((input.creatorSellFeeBps ?? 0) + 30) * 100),
    liquidityModel: { schemaVersion: 'programmable.direct-native-liquidity-model-intent.v1', model: 'launch-seeded-concentrated-liquidity',
      declaredLaunchState: 'assessment_required', liquidityTargetId: 'initializer', assessment: {
        schemaVersion: 'programmable.direct-native-liquidity-model-assessment.v1', status: 'required', requestClaimsExecution: false,
        requiredVectorIds: [...LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS] } },
  };
  const profile = resolveDirectNativeProfile(selection, { profileVersion: '3.6.0', programmableTradeFeePolicy: capabilities.programmableTradeFeePolicy?.policy });
  const standardBytes = await readFile(new URL('standard-json.json', kitUrl));
  const standard = JSON.parse(standardBytes);
  for (const [source, value] of Object.entries(standard.sources)) await exactFile(path.join(root, source), value.content);
  await exactFile(path.join(root, 'protection/standard-json.json'), standardBytes);
  for (const [role, name] of Object.entries(contracts)) await exactFile(path.join(root, `protection/artifacts/${role}.json`),
    await readFile(new URL(name + '.artifact.json', kitUrl)));
  await exactFile(path.join(root, 'protection/evidence.json'), JSON.stringify({ schemaVersion: 'programmable.launch-protection-build.v1',
    policy: PROTECTED_LAUNCH_POLICY_V1, signing: false, broadcast: false }) + '\n');
  const sourcePaths = ['src', 'lib', 'protection'];
  const bundlePaths = [...sourcePaths, ...(metadata.presentation.image?.sourcePath ? [metadata.presentation.image.sourcePath] : [])];
  const source = await buildSourceBundle(root, bundlePaths);
  const namespace = deriveRouteNamespace(source.bundleContentSha256, input.launchWallet, profile);
  const saltType = keccak256(stringToHex(GRAPH_TARGET_SALT_TYPE));
  const prepared = await prepareProtectedNativeContractsV1({ ...input, client, chainId: 1, developer: input.launchWallet,
    name: metadata.token.name, symbol: metadata.token.symbol, deploymentFactory: profile.graphFactory,
    initializerAuthority: profile.graphFactory,
    deriveRootAddress({ role, initCodeHash, applicantSalt }) {
      const field = Buffer.from(role), length = Buffer.alloc(4); length.writeUInt32BE(field.length);
      const targetIdHash = keccak256('0x' + Buffer.concat([Buffer.from('programmable.create2-graph-target-id.v1'), Buffer.from([0]), length, field]).toString('hex'));
      const salt = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address'),
        [saltType, 1n, profile.graphFactory, namespace, input.nonce, targetIdHash, applicantSalt, profile.router]));
      return { salt, address: getCreate2Address({ from: profile.graphFactory, salt, bytecodeHash: initCodeHash }) };
    } });
  const base = role => ({ targetId: role, compilationUnitId: 'launch-protection-v1', artifact: `protection/artifacts/${role}.json`,
    applicantSalt: prepared.deployments[role].applicantSalt, deploymentValueWei: '0', initializerValueWei: '0',
    initializer: null, componentKind: role === 'initializer' ? 'other' : role, declaredHookPermissions: null,
    runtimeImmutables: prepared.contracts[role].source.runtimeMaterialization.runtimeImmutables });
  const pins = { manager: profile.poolManager, feed: prepared.oracle.address, feedHash: prepared.oracle.runtimeCodeHash };
  const targets = [
    { ...base('initializer'), constructorArguments: [pins.manager, profile.graphFactory, pins.feed, pins.feedHash],
      initializer: { function: 'initialize', arguments: [{ target: 'hook' }, { target: 'token' }, prepared.price.initialTick, input.launchWallet, input.minimumTokensOut] }, initializerValueWei: input.initialBuyWei },
    { ...base('token'), constructorArguments: [metadata.token.name, metadata.token.symbol, String(prepared.supply), { target: 'initializer' }, pins.manager] },
    { ...base('hook'), constructorArguments: [pins.manager, [{ target: 'token' }, 0, 60, String(prepared.price.sqrtPriceX96), { target: 'initializer' }, input.launchWallet,
      input.creatorBuyFeeBps ?? 0, input.creatorSellFeeBps ?? 0, ZERO, 0], input.launchWallet,
      PROTECTED_LAUNCH_CHAIN_PINS_V1[1].router,
      PROTECTED_LAUNCH_CHAIN_PINS_V1[1].routerCodeHash, prepared.exemptions],
      declaredHookPermissions: ['beforeInitialize', 'beforeSwap', 'afterSwap', 'beforeSwapReturnDelta', 'afterSwapReturnDelta'] },
  ];
  const config = { schemaVersion: 'programmable.launch-pack-config.v3', profileVersion: '3.6.0', chainId: '1', launchWallet: input.launchWallet,
    nonce: input.nonce, source: { root: '.', paths: sourcePaths, sourceLineageNonce: input.sourceLineageNonce ?? '1', publicOrigin: input.publicOrigin },
    compilationUnits: [{ compilationUnitId: 'launch-protection-v1', standardJson: 'protection/standard-json.json' }], targets,
    pool: { tokenTargetId: 'token', hookTargetId: 'hook', fee: 0, tickSpacing: 60, quoteCurrency: ZERO }, projectMetadata: metadata,
    launchProfile: selection, permitWindow,
    agentAttestation: { agentId: 'programmable-launch-protection-v1', checkedAt: input.checkedAt ?? new Date().toISOString(),
      checks: [{ checkId: 'protected-source-package', evidence: 'protection/evidence.json' }] } };
  const configPath = path.join(root, 'protected-launch.config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const built = await buildLaunch({ configPath, directNativeTradeFeePolicy: capabilities.programmableTradeFeePolicy?.policy });
  for (const role of Object.keys(contracts)) if (built.predictions.find(x => x.targetId === role)?.predictedAddress.toLowerCase() !== prepared.contracts[role].address.toLowerCase()) {
    throw new TypeError('Protected graph prediction differs for ' + role);
  }
  return { configPath, config, built, prepared };
}
