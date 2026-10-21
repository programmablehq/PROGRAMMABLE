import customV2Release from "../vendor/custom-v2-release.json" with { type: "json" };
import {
  CLASSIC_LAUNCHERS,
  CLAIMS,
  CUSTOM_EVENT_TOPICS,
  CUSTOM_REGISTRY,
  CUSTOM_V2_POLICY,
  CUSTOM_V2_RELEASE_PATH,
  CUSTOM_V2_SELECTORS,
  HOOKS,
  LAUNCH_STAMP_ROUTER,
  LAUNCH_STAMP_SELECTORS,
  LAUNCH_STAMP_TOPICS,
  MAINNET_CHAIN_ID,
  ROUTER_CUSTOM_CLAIM_PROFILES,
  SELECTORS,
  TREASURY,
  WALLET_CLAIM_BATCH_LIMIT,
  atomicCapabilityStatus,
  buildWalletSendCalls,
  confirmedBatchReceiptProof,
  confirmedTransactionReceiptMatches,
  createLatestOperationGuard,
  createRefreshQueue,
  customClaimDefinitionClassification,
  customLaunchClassification,
  customLaunchStateData,
  customV2Bytes32ReadData,
  customV2IndexedReadData,
  customV2SourceClassification,
  decodeAddress,
  decodeBool,
  decodeBytes4,
  decodeBytes32,
  decodeCustomLaunchState,
  decodeCustomV2SourceState,
  decodeLaunchStampProof,
  decodeLaunchStampRecord,
  decodeUint256,
  encodeAddressArgument,
  exactRouterFinalizedCheckpoint,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  launchStampAddressReadData,
  launchStampBytes32ReadData,
  launchStampLogSetFingerprint,
  launchStampPoolReadData,
  normalizeBatchId,
  nextWalletClaimBatch,
  metaMaskProviderFrom,
  parseCustomV2Release,
  poolManagerBalanceOfData,
  readAccruedData,
  reduceClassicLaunchLogs,
  reduceCustomRegistryLogs,
  reduceLaunchStampLogs,
  requireAtomicClaimCapability,
  routerFinalizedBoundary,
  shortAddress,
  toQuantityHex,
  routerCustomClaimClassification,
  routerClaimCoverage,
  validatedAtomicBatchStatus,
  walletSendDefinitelyNotSubmitted,
  walletSendDuplicateBatchId,
  withTimeout,
} from "../vendor/logic.mjs";

import { mapLimit, legacyReader } from "./rpc.mjs";
import { claimData } from "../vendor/logic.mjs";

export async function scanLegacyEthereum({clients, progress=()=>{}, balanceBlockNumber, excludedTokens=new Set()}) {
 const state={balanceBlockTag:balanceBlockNumber?'0x'+balanceBlockNumber.toString(16):null,claims:new Map(),hooks:new Map(),custom:{launches:[]},customV2:{sources:[]},router:{launches:[]},classic:{launches:[]},confirmedBatch:null};
 const EVENT_LOG_CHUNK_SIZE=10000n, MAX_ROUTER_LAUNCHES=4096;
 const renderSummary=()=>progress("Ethereum: ältere Gebührenverträge werden geprüft…");
 const request=legacyReader(clients[0]);
 const routerQuorumRequest=(method,params=[])=>Promise.all(clients.map(c=>c.request({method,params})));
function hookVerified(claim) {
  if (claim.kind === "custom") {
    if (claim.origin === "launch-stamp-router")
      return (
        claim.provenanceVerified === true &&
        claim.runtimeVerified === true &&
        claim.claimBindingVerified === true
      );
    return claim.bindingVerified === true;
  }
  return state.hooks.get(claim.hookId)?.verified === true;
}

function claimHasOpenAmount(claim) {
  return (
    (typeof claim?.amount === "bigint" && claim.amount > 0n) ||
    (typeof claim?.secondaryAmount === "bigint" &&
      claim.secondaryAmount > 0n)
  );
}

function allClaimDefinitions() {
  return [
    ...CLAIMS,
    ...state.custom.launches.filter(
      ({ standardClaimBindingVerified }) =>
        standardClaimBindingVerified === true,
    ),
    ...state.customV2.sources,
    ...state.router.launches.flatMap((launch) => {
      if (launch.launchKind !== 1 || launch.claimMode !== "manual") return [];
      return Array.isArray(launch.claimDefinitions)
        ? launch.claimDefinitions
        : [launch];
    }),
  ];
}

function claimableClaims({ ignoreConfirmedBatch = false } = {}) {
  if (state.confirmedBatch && !ignoreConfirmedBatch) return [];
  return allClaimDefinitions().filter((claim) => {
    const current = state.claims.get(claim.id);
    if (claim.kind === "custom") {
      const classification = customClaimDefinitionClassification(
        claim,
        current,
      );
      if (classification !== "ready") return false;
    }
    return (
      hookVerified(claim) &&
      current?.recipientMatches === true &&
      claimHasOpenAmount(current)
    );
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function claimSafetyError({ ignoreConfirmedBatch = false } = {}) {
  if (state.confirmedBatch && !ignoreConfirmedBatch)
    return "Ein bestätigter Claim-Batch wartet noch auf einen finalisierten Onchain-Stand";
  if (state.router.status !== "ready" || state.router.verified !== true)
    return "Der Launch-Stamp-Router ist nicht vollständig verifiziert";
  if (
    state.classic.status !== "ready" ||
    state.classic.launchersVerified !== true
  )
    return "Die Classic-Launchliste ist nicht vollständig verifiziert";
  if (
    !["ready", "retired"].includes(state.custom.status) ||
    state.custom.registryVerified !== true
  )
    return "Die Custom Registry ist nicht vollständig verifiziert";
  if (!["ready", "hold"].includes(state.customV2.status))
    return "Das Custom-V2-Release ist nicht vollständig verifiziert";
  if (
    state.custom.launches.some((launch) =>
      ["adapter-required", "blocked"].includes(
        customLaunchClassification(launch),
      ),
    )
  )
    return "Mindestens eine Custom-V1-Feequelle ist nicht sicher claimbar";
  if (
    state.customV2.sources.some(
      (source) => customV2SourceClassification(source) === "blocked",
    )
  )
    return "Mindestens eine Custom-V2-Source-Bindung stimmt nicht";
  if (routerClaimCoverage(state.router.launches).blocked.length > 0)
    return "Mindestens eine Router-Claim-Bindung konnte nicht verifiziert werden";
  if (HOOKS.some(({ id }) => state.hooks.get(id)?.verified !== true))
    return "Mindestens eine Classic- oder Stock-Bindung stimmt nicht";
  if (CLAIMS.some(({ id }) => state.claims.get(id)?.status === "failed"))
    return "Mindestens ein bekanntes Guthaben konnte nicht gelesen werden";
  return null;
}

async function readCustomRegistryLogs(blockTag) {
  const latest = BigInt(blockTag);
  const topics = [Object.values(CUSTOM_EVENT_TOPICS)];
  const logs = [];
  for (
    let fromBlock = CUSTOM_REGISTRY.startBlock;
    fromBlock <= latest;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const toBlock =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < latest
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : latest;
    logs.push(
      ...(await request("eth_getLogs", [
        {
          address: CUSTOM_REGISTRY.address,
          fromBlock: toQuantityHex(fromBlock),
          toBlock: toQuantityHex(toBlock),
          topics,
        },
      ])),
    );
  }
  return logs;
}

async function readClassicLauncherLogs(launcher, blockTag) {
  const latest=BigInt(blockTag),ranges=[];
  for(let first=launcher.startBlock;first<=latest;first+=EVENT_LOG_CHUNK_SIZE)
    ranges.push({address:launcher.address,fromBlock:toQuantityHex(first),
      toBlock:toQuantityHex(first+EVENT_LOG_CHUNK_SIZE-1n<latest?first+EVENT_LOG_CHUNK_SIZE-1n:latest),topics:[launcher.eventTopic]});
  return (await mapLimit(ranges,6,filter=>request("eth_getLogs",[filter]))).flat();
}

async function readClassicLaunches(blockTag) {
  state.classic = {
    status: "loading",
    launchersVerified: false,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const launcherResults = await Promise.all(
      CLASSIC_LAUNCHERS.map(async (launcher) => {
        const [runtimeCode, logs] = await Promise.all([
          request("eth_getCode", [launcher.address, blockTag]),
          readClassicLauncherLogs(launcher, blockTag),
        ]);
        if (
          keccak256Hex(runtimeCode).toLowerCase() !==
          launcher.runtimeCodeHash.toLowerCase()
        )
          throw new Error(`${launcher.name} Launcher stimmt nicht`);
        return logs.map((log) => ({ launcher, log }));
      }),
    );
    const launches = reduceClassicLaunchLogs(launcherResults.flat());
    state.classic = {
      status: "ready",
      launchersVerified: true,
      launches,
      error: null,
    };
  } catch (error) {
    state.classic = {
      status: "failed",
      launchersVerified: false,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Classic Launches konnten nicht gelesen werden",
    };
  }
}

async function readLaunchStampLogs(toBlock) {
  const ranges=[];
  for(let first=LAUNCH_STAMP_ROUTER.startBlock;first<=toBlock;first+=EVENT_LOG_CHUNK_SIZE)
    ranges.push({address:LAUNCH_STAMP_ROUTER.address,fromBlock:toQuantityHex(first),
      toBlock:toQuantityHex(first+EVENT_LOG_CHUNK_SIZE-1n<toBlock?first+EVENT_LOG_CHUNK_SIZE-1n:toBlock),topics:[LAUNCH_STAMP_TOPICS.launchStamped]});
  const pages=await mapLimit(ranges,6,async filter=>{
    const responses=await routerQuorumRequest("eth_getLogs",[filter]);
    const fingerprints=responses.map(launchStampLogSetFingerprint);
    if(new Set(fingerprints).size!==1)throw new Error("Die Router-Loghistorie stimmt im RPC-Quorum nicht überein");
    return responses[0];
  });
  const logs=pages.flat();
  if(logs.length>MAX_ROUTER_LAUNCHES)throw new Error("Die Router-Launchliste überschreitet das sichere Scan-Limit");
  return logs;
}

async function readRouterQuorumBlock(blockTag) {
  const blocks = await routerQuorumRequest("eth_getBlockByNumber", [
    blockTag,
    false,
  ]);
  return exactRouterFinalizedCheckpoint(
    blocks,
    LAUNCH_STAMP_ROUTER.startBlock,
  );
}

async function readRouterFinalizedBoundary() {
  const blocks = await routerQuorumRequest("eth_getBlockByNumber", [
    LAUNCH_STAMP_ROUTER.finalizedTag,
    false,
  ]);
  return routerFinalizedBoundary(
    blocks,
    LAUNCH_STAMP_ROUTER.startBlock,
    LAUNCH_STAMP_ROUTER.maximumFinalizedSpread,
  );
}

async function verifyLaunchStampInfrastructure(blockTag) {
  const [
    routerCode,
    chainIdWord,
    permitAuthorityWord,
    permitAuthorityRuntimeWord,
    graphFactoryWord,
    graphFactoryRuntimeWord,
    poolManagerWord,
    poolManagerRuntimeWord,
  ] = await Promise.all([
    request("eth_getCode", [LAUNCH_STAMP_ROUTER.address, blockTag]),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.permitAuthority,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.permitAuthorityRuntimeCodeHash,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.graphFactory,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.graphFactoryRuntimeCodeHash,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.poolManager,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.poolManagerRuntimeCodeHash,
      blockTag,
    ),
  ]);
  const permitAuthority = decodeAddress(permitAuthorityWord);
  const graphFactory = decodeAddress(graphFactoryWord);
  const poolManager = decodeAddress(poolManagerWord);
  if (
    keccak256Hex(routerCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.runtimeCodeHash ||
    decodeUint256(chainIdWord) !== 1n ||
    permitAuthority.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.permitAuthority.address.toLowerCase() ||
    decodeBytes32(permitAuthorityRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.permitAuthority.runtimeCodeHash ||
    graphFactory.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.graphFactory.address.toLowerCase() ||
    decodeBytes32(graphFactoryRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.graphFactory.runtimeCodeHash ||
    poolManager.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
    decodeBytes32(poolManagerRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.poolManager.runtimeCodeHash
  )
    throw new Error("Launch-Stamp-Router-Bindung stimmt nicht");

  const [permitCode, graphCode, poolManagerCode] = await Promise.all([
    request("eth_getCode", [permitAuthority, blockTag]),
    request("eth_getCode", [graphFactory, blockTag]),
    request("eth_getCode", [poolManager, blockTag]),
  ]);
  if (
    keccak256Hex(permitCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.permitAuthority.runtimeCodeHash ||
    keccak256Hex(graphCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.graphFactory.runtimeCodeHash ||
    keccak256Hex(poolManagerCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.poolManager.runtimeCodeHash
  )
    throw new Error("Launch-Stamp-Infrastruktur-Runtime stimmt nicht");
}

function routerProfileBindingMatches(launch, profile) {
  return profile.bindings.some(
    ({ launchId, token, source, runtimeCodeHash }) =>
      launch.launchId === launchId &&
      (!token || launch.token.toLowerCase() === token.toLowerCase()) &&
      launch.hook.toLowerCase() === source.toLowerCase() &&
      launch.runtimeCodeHash === runtimeCodeHash,
  );
}

function routerFeeVaultBinding(launch, profile) {
  return profile.bindings.find(
    ({ launchId, token, hook, hookRuntimeCodeHash }) =>
      launch.launchId === launchId &&
      launch.token.toLowerCase() === token.toLowerCase() &&
      launch.hook.toLowerCase() === hook.toLowerCase() &&
      launch.runtimeCodeHash === hookRuntimeCodeHash,
  );
}

async function verifyRouterProfileComponent(launch, binding, blockTag) {
  const [launchIdWord, proofValue, runtimeWord, runtimeCode] =
    await Promise.all([
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.launchIdByComponent,
          binding.source,
        ),
        blockTag,
      ),
      request("eth_call", [
        {
          to: LAUNCH_STAMP_ROUTER.address,
          data: launchStampAddressReadData(
            LAUNCH_STAMP_SELECTORS.stampProof,
            binding.source,
          ),
        },
        blockTag,
      ]),
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.componentRuntimeCodeHash,
          binding.source,
        ),
        blockTag,
      ),
      request("eth_getCode", [binding.source, blockTag]),
    ]);
  const proof = decodeLaunchStampProof(proofValue);
  const runtimeCodeHash = decodeBytes32(runtimeWord);
  if (
    decodeBytes32(launchIdWord) !== launch.launchId ||
    proof.launchId !== launch.launchId ||
    proof.stampHash !== launch.stampHash ||
    runtimeCodeHash !== binding.sourceRuntimeCodeHash ||
    keccak256Hex(runtimeCode).toLowerCase() !==
      binding.sourceRuntimeCodeHash.toLowerCase()
  )
    throw new Error("Custom-Vault-Stamp oder Runtime stimmt nicht");
}

async function tryRouterClaimProfile(
  launch,
  runtimeCode,
  profile,
  blockTag,
) {
  if (!routerProfileBindingMatches(launch, profile)) return null;
  try {
    const [
      recipientWord,
      feeWord,
      accruedWord,
      feeDenominatorWord,
      poolManagerWord,
      boundTokenWord,
      nftWord,
      initializedWord,
    ] = await Promise.all([
      readContractWord(launch.hook, profile.recipient, blockTag),
      readContractWord(launch.hook, profile.feeBps, blockTag),
      readContractWord(launch.hook, profile.accrued, blockTag),
      profile.feeDenominatorBps
        ? readContractWord(launch.hook, profile.feeDenominatorBps, blockTag)
        : null,
      profile.poolManager
        ? readContractWord(launch.hook, profile.poolManager, blockTag)
        : null,
      profile.boundToken
        ? readContractWord(launch.hook, profile.boundToken, blockTag)
        : null,
      profile.nft ? readContractWord(launch.hook, profile.nft, blockTag) : null,
      profile.initialized
        ? readContractWord(launch.hook, profile.initialized, blockTag)
        : null,
    ]);
    const amount = decodeUint256(accruedWord);
    if (
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feeWord) !== profile.expectedFeeBps ||
      (feeDenominatorWord !== null &&
        decodeUint256(feeDenominatorWord) !==
          profile.expectedFeeDenominatorBps) ||
      (poolManagerWord !== null &&
        decodeAddress(poolManagerWord).toLowerCase() !==
          LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase()) ||
      (boundTokenWord !== null &&
        decodeAddress(boundTokenWord).toLowerCase() !==
          launch.token.toLowerCase()) ||
      (nftWord !== null &&
        decodeAddress(nftWord).toLowerCase() !==
          profile.expectedNft.toLowerCase()) ||
      (initializedWord !== null && !decodeBool(initializedWord))
    )
      return null;
    if (amount > 0n) {
      const simulated = await readContractWord(
        launch.hook,
        profile.claim,
        blockTag,
        TREASURY,
      );
      if (decodeUint256(simulated) !== amount)
        throw new Error("Custom-Claim-Simulation stimmt nicht");
    }
    return {
      ...launch,
      id: `router-custom:${launch.launchId}`,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      kind: "custom",
      origin: "launch-stamp-router",
      address: launch.hook,
      claimMode: "manual",
      claimProfile: profile.id,
      readData: profile.accrued,
      claimData: profile.claim,
      claimBindingVerified: true,
      recipientMatches: true,
      amount,
      status: "ready",
    };
  } catch {
    return null;
  }
}

async function tryRouterFeeVaultProfile(launch, profile, blockTag) {
  const binding = routerFeeVaultBinding(launch, profile);
  if (!binding) return null;
  try {
    await verifyRouterProfileComponent(launch, binding, blockTag);
    const nativeAsset = CUSTOM_V2_POLICY.nativeAsset;
    const nativeReadData = `${profile.accrued}${encodeAddressArgument(nativeAsset)}`;
    const tokenReadData = `${profile.accrued}${encodeAddressArgument(launch.token)}`;
    const nativeClaimData = `${profile.claim}${encodeAddressArgument(nativeAsset)}`;
    const tokenClaimData = `${profile.claim}${encodeAddressArgument(launch.token)}`;
    const [
      hookVaultWord,
      recipientWord,
      feePpmWord,
      feeDenominatorWord,
      poolManagerWord,
      authorizedAdapterWord,
      authorizedAdapterCodeHashWord,
      bindingAuthorityWord,
      nativeAmountWord,
      tokenAmountWord,
    ] = await Promise.all([
      readContractWord(launch.hook, profile.hookFeeVault, blockTag),
      readContractWord(binding.source, profile.recipient, blockTag),
      readContractWord(binding.source, profile.feePpm, blockTag),
      readContractWord(binding.source, profile.feeDenominatorPpm, blockTag),
      readContractWord(binding.source, profile.poolManager, blockTag),
      readContractWord(binding.source, profile.authorizedAdapter, blockTag),
      readContractWord(
        binding.source,
        profile.authorizedAdapterCodeHash,
        blockTag,
      ),
      readContractWord(binding.source, profile.bindingAuthority, blockTag),
      readContractWord(binding.source, nativeReadData, blockTag),
      readContractWord(binding.source, tokenReadData, blockTag),
    ]);
    if (
      decodeAddress(hookVaultWord).toLowerCase() !==
        binding.source.toLowerCase() ||
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feePpmWord) !== profile.expectedFeePpm ||
      decodeUint256(feeDenominatorWord) !==
        profile.expectedFeeDenominatorPpm ||
      decodeAddress(poolManagerWord).toLowerCase() !==
        LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
      decodeAddress(authorizedAdapterWord).toLowerCase() !==
        launch.hook.toLowerCase() ||
      decodeBytes32(authorizedAdapterCodeHashWord) !==
        binding.hookRuntimeCodeHash ||
      decodeAddress(bindingAuthorityWord) !== nativeAsset
    )
      throw new Error("Custom-Vault-Claim-Bindung stimmt nicht");

    const amount = decodeUint256(nativeAmountWord);
    const secondaryAmount = decodeUint256(tokenAmountWord);
    await Promise.all(
      [
        { amount, claimData: nativeClaimData },
        { amount: secondaryAmount, claimData: tokenClaimData },
      ].map(async (leg) => {
        if (leg.amount === 0n) return;
        const simulated = await readContractWord(
          binding.source,
          leg.claimData,
          blockTag,
          TREASURY,
        );
        if (decodeUint256(simulated) !== leg.amount)
          throw new Error("Custom-Vault-Claim-Simulation stimmt nicht");
      }),
    );

    const id = `router-custom:${launch.launchId}`;
    const common = {
      launchId: launch.launchId,
      token: launch.token,
      hook: launch.hook,
      launchKind: launch.launchKind,
      kind: "custom",
      origin: "launch-stamp-router",
      address: binding.source,
      provenanceVerified: true,
      runtimeVerified: true,
      sourceRuntimeVerified: true,
      claimMode: "manual",
      claimProfile: profile.id,
      claimBindingVerified: true,
      recipientMatches: true,
      status: "ready",
    };
    const claimDefinitions = [
      {
        ...common,
        id: `${id}:native`,
        name: "Custom · Router",
        detail: `${shortAddress(launch.token)} · ETH`,
        unit: "ETH",
        decimals: 18,
        readData: nativeReadData,
        claimData: nativeClaimData,
        amount,
      },
      {
        ...common,
        id: `${id}:${launch.token.toLowerCase()}`,
        name: "Custom · Router",
        detail: `${shortAddress(launch.token)} · ${profile.secondaryUnit}`,
        asset: launch.token,
        unit: profile.secondaryUnit,
        decimals: profile.secondaryDecimals,
        readData: tokenReadData,
        claimData: tokenClaimData,
        amount: secondaryAmount,
      },
    ];
    return {
      ...launch,
      ...common,
      id,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      secondaryAsset: launch.token,
      secondaryUnit: profile.secondaryUnit,
      secondaryDecimals: profile.secondaryDecimals,
      amount,
      secondaryAmount,
      claimDefinitions,
    };
  } catch {
    return null;
  }
}

async function readRouterCustomClaim(launch, runtimeCode, blockTag) {
  for (const profile of [
    ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1,
    ROUTER_CUSTOM_CLAIM_PROFILES.shardLauncherFeesV1,
    ROUTER_CUSTOM_CLAIM_PROFILES.protocolFeeSourceV1,
  ]) {
    const claim = await tryRouterClaimProfile(
      launch,
      runtimeCode,
      profile,
      blockTag,
    );
    if (claim) return claim;
  }

  const feeVaultClaim = await tryRouterFeeVaultProfile(
    launch,
    ROUTER_CUSTOM_CLAIM_PROFILES.isolatedAfterSwapFeeVaultV2,
    blockTag,
  );
  if (feeVaultClaim) return feeVaultClaim;

  const redeemer = ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1;
  try {
    if (!routerProfileBindingMatches(launch, redeemer))
      throw new Error("Kein freigegebenes Mehrwährungs-Claim-Profil");
    const [
      recipientWord,
      feePipsWord,
      poolManagerWord,
      currency0Word,
      currency1Word,
      poolIdWord,
      nativeAmountWord,
      tokenAmountWord,
    ] = await Promise.all([
      readContractWord(launch.hook, redeemer.recipient, blockTag),
      readContractWord(launch.hook, redeemer.feePips, blockTag),
      readContractWord(launch.hook, redeemer.poolManager, blockTag),
      readContractWord(launch.hook, redeemer.currency0, blockTag),
      readContractWord(launch.hook, redeemer.currency1, blockTag),
      readContractWord(launch.hook, redeemer.poolId, blockTag),
      readContractWord(
        LAUNCH_STAMP_ROUTER.poolManager.address,
        poolManagerBalanceOfData(
          redeemer.balanceOf,
          launch.hook,
          CUSTOM_V2_POLICY.nativeAsset,
        ),
        blockTag,
      ),
      readContractWord(
        LAUNCH_STAMP_ROUTER.poolManager.address,
        poolManagerBalanceOfData(
          redeemer.balanceOf,
          launch.hook,
          launch.token,
        ),
        blockTag,
      ),
    ]);
    if (
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feePipsWord) !== redeemer.expectedFeePips ||
      decodeAddress(poolManagerWord).toLowerCase() !==
        LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
      decodeAddress(currency0Word).toLowerCase() !==
        CUSTOM_V2_POLICY.nativeAsset.toLowerCase() ||
      decodeAddress(currency1Word).toLowerCase() !==
        launch.token.toLowerCase() ||
      decodeBytes32(poolIdWord) !== launch.poolId
    )
      throw new Error("Mehrwährungs-Claim-Bindung stimmt nicht");
    const amount = decodeUint256(nativeAmountWord);
    const secondaryAmount = decodeUint256(tokenAmountWord);
    if (amount > 0n || secondaryAmount > 0n) {
      const simulated = await request("eth_call", [
        { from: TREASURY, to: launch.hook, data: redeemer.claim },
        blockTag,
      ]);
      if (simulated !== "0x")
        throw new Error("Mehrwährungs-Claim-Simulation stimmt nicht");
    }
    return {
      ...launch,
      id: `router-custom:${launch.launchId}`,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      secondaryAsset: launch.token,
      secondaryUnit: redeemer.secondaryUnit,
      secondaryDecimals: redeemer.secondaryDecimals,
      kind: "custom",
      origin: "launch-stamp-router",
      address: launch.hook,
      claimMode: "manual",
      claimProfile: redeemer.id,
      claimData: redeemer.claim,
      claimBindingVerified: true,
      recipientMatches: true,
      amount,
      secondaryAmount,
      status: "ready",
    };
  } catch {
    // Continue to the explicit unsupported disposition below.
  }

  return {
    ...launch,
    id: `router-custom:${launch.launchId}`,
    name: "Custom · Router",
    detail: shortAddress(launch.token),
    unit: "ETH",
    decimals: 18,
    kind: "custom",
    origin: "launch-stamp-router",
    address: launch.hook,
    claimMode: "unsupported",
    claimProfile: null,
    claimBindingVerified: false,
    recipientMatches: false,
    amount: 0n,
    status: "failed",
  };
}

async function readVerifiedRouterLaunch(candidate, finalizedTag) {
  const [recordValue, tokenLaunchIdWord, poolLaunchIdWord, tokenProofValue] =
    await Promise.all([
    request("eth_call", [
      {
        to: LAUNCH_STAMP_ROUTER.address,
        data: launchStampBytes32ReadData(
          LAUNCH_STAMP_SELECTORS.launchStamp,
          candidate.launchId,
        ),
      },
      finalizedTag,
    ]),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      launchStampAddressReadData(
        LAUNCH_STAMP_SELECTORS.launchIdByToken,
        candidate.token,
      ),
      finalizedTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      launchStampPoolReadData(
        LAUNCH_STAMP_SELECTORS.launchIdByPool,
        candidate.poolManager,
        candidate.poolId,
      ),
      finalizedTag,
    ),
    request("eth_call", [
      {
        to: LAUNCH_STAMP_ROUTER.address,
        data: launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.stampProof,
          candidate.token,
        ),
      },
      finalizedTag,
    ]),
  ]);
  const record = decodeLaunchStampRecord(recordValue);
  const tokenProof = decodeLaunchStampProof(tokenProofValue);
  if (
    decodeBytes32(tokenLaunchIdWord) !== candidate.launchId ||
    decodeBytes32(poolLaunchIdWord) !== candidate.launchId ||
    tokenProof.launchId !== candidate.launchId ||
    tokenProof.stampHash !== candidate.stampHash ||
    record.token.toLowerCase() !== candidate.token.toLowerCase() ||
    record.hook.toLowerCase() !== candidate.hook.toLowerCase() ||
    record.poolManager.toLowerCase() !== candidate.poolManager.toLowerCase() ||
    record.poolId !== candidate.poolId ||
    record.stampHash !== candidate.stampHash
  )
    throw new Error("Launch-Stamp-Record stimmt nicht mit dem Event überein");

  const routeCode = await request("eth_getCode", [
    record.routeLauncher,
    finalizedTag,
  ]);
  if (
    keccak256Hex(routeCode).toLowerCase() !==
    record.routeLauncherRuntimeCodeHash
  )
    throw new Error("Launch-Route-Runtime ist gedriftet");

  const verified = {
    ...candidate,
    ...record,
    launchKind: record.kind,
    provenanceVerified: true,
    runtimeVerified: true,
  };
  if (record.kind === 2) {
    const knownHook = HOOKS.find(
      ({ address }) => address.toLowerCase() === record.hook.toLowerCase(),
    );
    return {
      ...verified,
      claimMode: knownHook ? "covered-by-known-hook" : "unsupported",
      claimProfile: knownHook?.id ?? null,
      claimBindingVerified: Boolean(knownHook),
      amount: 0n,
    };
  }

  const [hookLaunchIdWord, hookProofValue, recordedRuntimeWord, hookCode] =
    await Promise.all([
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.launchIdByComponent,
          record.hook,
        ),
        finalizedTag,
      ),
      request("eth_call", [
        {
          to: LAUNCH_STAMP_ROUTER.address,
          data: launchStampAddressReadData(
            LAUNCH_STAMP_SELECTORS.stampProof,
            record.hook,
          ),
        },
        finalizedTag,
      ]),
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.componentRuntimeCodeHash,
          record.hook,
        ),
        finalizedTag,
      ),
      request("eth_getCode", [record.hook, finalizedTag]),
    ]);
  const hookProof = decodeLaunchStampProof(hookProofValue);
  const recordedRuntime = decodeBytes32(recordedRuntimeWord);
  if (
    decodeBytes32(hookLaunchIdWord) !== candidate.launchId ||
    hookProof.launchId !== candidate.launchId ||
    hookProof.stampHash !== candidate.stampHash ||
    /^0x0{64}$/i.test(recordedRuntime) ||
    keccak256Hex(hookCode).toLowerCase() !== recordedRuntime
  )
    throw new Error("Custom-Hook-Stamp oder Runtime stimmt nicht");

  return readRouterCustomClaim(
    { ...verified, runtimeCodeHash: recordedRuntime },
    hookCode,
    state.balanceBlockTag??finalizedTag,
  );
}

async function readLaunchStampRouter() {
  for (const key of state.claims.keys()) {
    if (key.startsWith("router-custom:")) state.claims.delete(key);
  }
  state.router = {
    status: "loading",
    verified: false,
    finalizedBlock: null,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const finalizedBlock = await readRouterFinalizedBoundary();
    const finalizedTag = toQuantityHex(finalizedBlock);
    const openingBlock = await readRouterQuorumBlock(finalizedTag);
    await verifyLaunchStampInfrastructure(finalizedTag);
    const candidates = reduceLaunchStampLogs(
      await readLaunchStampLogs(finalizedBlock),
    ).filter(candidate=>!excludedTokens.has(candidate.token.toLowerCase()));
    progress(candidates.length + " Ethereum-Launches werden geprüft…");
    let verified=0;
    const launches = await mapWithConcurrency(candidates, 8, async candidate => {
      const launch=await readVerifiedRouterLaunch(candidate,finalizedTag);
      verified++;if(verified%50===0)progress("Ethereum-Launches: "+verified+"/"+candidates.length);
      return launch;
    });
    const closingBlock = await readRouterQuorumBlock(finalizedTag);
    if (
      closingBlock.number !== openingBlock.number ||
      closingBlock.hash !== openingBlock.hash
    )
      throw new Error("Finalisierter Router-Block hat sich während des Scans geändert");
    for (const launch of launches) {
      if (launch.launchKind !== 1 || launch.claimMode !== "manual") continue;
      state.claims.set(launch.id, {
        amount: launch.amount,
        secondaryAmount: launch.secondaryAmount,
        recipientMatches: launch.recipientMatches,
        status: launch.status,
      });
      for (const claim of launch.claimDefinitions ?? []) {
        state.claims.set(claim.id, {
          amount: claim.amount,
          recipientMatches: claim.recipientMatches,
          status: claim.status,
        });
      }
    }
    state.router = {
      status: "ready",
      verified: true,
      finalizedBlock,
      launches,
      error: null,
    };
  } catch (error) {
    state.router = {
      status: "failed",
      verified: false,
      finalizedBlock: null,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Launch-Stamp-Router konnte nicht gelesen werden",
    };
  }
}

async function readCustomLaunch(launch, blockTag) {
  const [runtimeCode, launchStateWord] = await Promise.all([
    request("eth_getCode", [launch.primaryContract, blockTag]),
    request("eth_call", [
      {
        to: CUSTOM_REGISTRY.address,
        data: customLaunchStateData(launch.launchId),
      },
      blockTag,
    ]),
  ]);
  const current = decodeCustomLaunchState(launchStateWord);
  const base = {
    ...launch,
    currentStatus: current.status,
    stateVerified:
      current.feePolicyHash === launch.feePolicy?.feePolicyHash &&
      ((current.status === 2 && launch.finalized && !launch.revoked) ||
        (current.status === 3 && launch.revoked) ||
        (current.status === 1 && !launch.finalized && !launch.revoked)),
    runtimeVerified:
      typeof launch.primaryRuntimeCodeHash === "string" &&
      keccak256Hex(runtimeCode).toLowerCase() ===
        launch.primaryRuntimeCodeHash.toLowerCase(),
  };
  if (
    customLaunchClassification(base) === "no-market" ||
    base.currentStatus !== 2 ||
    base.stateVerified !== true ||
    base.runtimeVerified !== true
  )
    return base;

  try {
    const [recipientWord, accruedWord, totalClaimedWord, feeBpsWord] =
      await Promise.all([
        readContractWord(
          launch.primaryContract,
          CUSTOM_V2_SELECTORS.programmableFeeRecipient,
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          readAccruedData({ kind: "custom" }),
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          `${CUSTOM_V2_SELECTORS.totalProgrammableFeesClaimed}${"0".repeat(64)}`,
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
          blockTag,
        ),
      ]);
    const amount = decodeUint256(accruedWord);
    const feeBps = decodeUint256(feeBpsWord);
    const standardClaimBindingVerified =
      isTreasury(decodeAddress(recipientWord)) &&
      isTreasury(launch.feePolicy.programmableRecipient) &&
      feeBps === BigInt(launch.feePolicy.programmableShareBps);
    return {
      ...base,
      id: `custom-v1-standard:${launch.launchId}`,
      hookId: "custom-v1-standard",
      name: `Custom Launch ${launch.registrationSequence.toString()}`,
      detail: shortAddress(launch.primaryContract),
      unit: "ETH",
      decimals: 18,
      kind: "custom",
      address: launch.primaryContract,
      asset: CUSTOM_V2_POLICY.nativeAsset,
      bindingVerified: standardClaimBindingVerified,
      standardClaimBindingVerified,
      registered: true,
      quarantined: false,
      executable: true,
      recipient: decodeAddress(recipientWord),
      recipientMatches: standardClaimBindingVerified,
      amount,
      totalClaimed: decodeUint256(totalClaimedWord),
      programmableFeeBps: feeBps,
      status: "ready",
    };
  } catch {
    return { ...base, standardClaimBindingVerified: false };
  }
}

async function readCustomRegistry(blockTag) {
  void blockTag;
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v1-standard:")) state.claims.delete(key);
  }
  state.custom = {
    status: "retired",
    registryVerified: true,
    launches: [],
    error: null,
  };
  renderSummary();
}

async function readContractWord(address, data, blockTag, from = null) {
  const call = { to: address, data };
  if (from) call.from = from;
  const value = await request("eth_call", [call, blockTag]);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`Ungültige Contract-Antwort von ${shortAddress(address)}`);
  return value;
}

async function verifyCustomV2Infrastructure(release, blockTag) {
  if (release.startBlock > BigInt(blockTag))
    throw new Error("Custom-V2-Deployment-Block liegt in der Zukunft");
  const contractEntries = Object.values(release.contracts);
  const runtimeResults = await Promise.all(
    contractEntries.map(async (contract) => ({
      contract,
      actual: keccak256Hex(
        await request("eth_getCode", [contract.address, blockTag]),
      ).toLowerCase(),
    })),
  );
  if (
    runtimeResults.some(
      ({ contract, actual }) =>
        actual !== contract.runtimeCodeHash.toLowerCase(),
    )
  )
    throw new Error("Custom-V2-Contract-Runtime stimmt nicht");

  const { sourceRegistry, customRegistryV2, customRegistrar, launchStampRouter } =
    release.contracts;
  const [
    registrarChain,
    registrarSourceRegistry,
    registrarCustomRegistry,
    registrarLaunchStampRouter,
    registryChain,
    registryGeneration,
    registryFinality,
    registrySourceRegistry,
    launchStampChain,
    sourceChain,
    sourceDelay,
    sourceRewardWallet,
    sourceClaimSelector,
    sourceInterfaceId,
  ] = await Promise.all([
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.supportedChainId,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.sourceRegistry,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.customRegistryV2,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.launchStampRouter,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.registryGeneration,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.minimumFinalityBlocks,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.sourceRegistry,
      blockTag,
    ),
    readContractWord(
      launchStampRouter.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.minimumActivationDelayBlocks,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.rewardWallet,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.claimSelector,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.sourceInterfaceId,
      blockTag,
    ),
  ]);

  if (
    decodeUint256(registrarChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeAddress(registrarSourceRegistry).toLowerCase() !==
      sourceRegistry.address.toLowerCase() ||
    decodeAddress(registrarCustomRegistry).toLowerCase() !==
      customRegistryV2.address.toLowerCase() ||
    decodeAddress(registrarLaunchStampRouter).toLowerCase() !==
      launchStampRouter.address.toLowerCase() ||
    decodeUint256(registryChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(registryGeneration) <
      CUSTOM_V2_POLICY.minimumRegistryGeneration ||
    decodeUint256(registryFinality) < CUSTOM_V2_POLICY.minimumFinalityBlocks ||
    decodeAddress(registrySourceRegistry).toLowerCase() !==
      sourceRegistry.address.toLowerCase() ||
    decodeUint256(launchStampChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(sourceChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(sourceDelay) < CUSTOM_V2_POLICY.minimumFinalityBlocks ||
    !isTreasury(decodeAddress(sourceRewardWallet)) ||
    decodeBytes4(sourceClaimSelector) !== CUSTOM_V2_POLICY.claimSelector ||
    decodeBytes4(sourceInterfaceId) !== CUSTOM_V2_POLICY.sourceInterfaceId
  )
    throw new Error("Custom-V2-Infrastruktur-Bindung stimmt nicht");
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

async function readCustomV2Source(release, indexed, blockTag) {
  const sourceRegistry = release.contracts.sourceRegistry.address;
  const registrar = release.contracts.customRegistrar.address;
  const stateWord = await request("eth_call", [
    {
      to: sourceRegistry,
      data: customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.sourceState,
        indexed.sourceId,
      ),
    },
    blockTag,
  ]);
  const source = decodeCustomV2SourceState(stateWord);
  const [
    executableWord,
    indexedLaunchWord,
    runtimeCode,
    recipientWord,
    accruedWord,
    totalClaimedWord,
    feeBpsWord,
  ] = await Promise.all([
    readContractWord(
      registrar,
      customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.isFinalizedExecutable,
        indexed.launchId,
      ),
      blockTag,
    ),
    readContractWord(
      registrar,
      customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.launchIdForSource,
        indexed.sourceId,
      ),
      blockTag,
    ),
    request("eth_getCode", [source.source, blockTag]),
    readContractWord(
      source.source,
      CUSTOM_V2_SELECTORS.programmableFeeRecipient,
      blockTag,
    ),
    readContractWord(source.source, readAccruedData({ kind: "custom" }), blockTag),
    readContractWord(
      source.source,
      `${CUSTOM_V2_SELECTORS.totalProgrammableFeesClaimed}${"0".repeat(64)}`,
      blockTag,
    ),
    readContractWord(
      source.source,
      `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
      blockTag,
    ),
  ]);

  const executable = decodeBool(executableWord);
  const amount = decodeUint256(accruedWord);
  const bindingVerified =
    source.sourceId === indexed.sourceId &&
    decodeBytes32(indexedLaunchWord) === indexed.launchId &&
    source.registered &&
    source.asset.toLowerCase() === CUSTOM_V2_POLICY.nativeAsset &&
    source.claimSelector === CUSTOM_V2_POLICY.claimSelector &&
    isTreasury(source.recipient) &&
    source.activationBlock <= BigInt(blockTag) &&
    keccak256Hex(runtimeCode).toLowerCase() === source.runtimeCodeHash &&
    isTreasury(decodeAddress(recipientWord)) &&
    decodeUint256(feeBpsWord) === CUSTOM_V2_POLICY.programmableFeeBps;

  return Object.freeze({
    id: `custom-v2:${indexed.sourceId}`,
    hookId: "custom-v2",
    index: indexed.index,
    launchId: indexed.launchId,
    sourceId: indexed.sourceId,
    name: "Custom V2",
    detail: shortAddress(source.source),
    unit: "ETH",
    decimals: 18,
    kind: "custom",
    address: source.source,
    asset: CUSTOM_V2_POLICY.nativeAsset,
    runtimeCodeHash: source.runtimeCodeHash,
    activationBlock: source.activationBlock,
    registered: source.registered,
    quarantined: source.quarantined,
    executable,
    bindingVerified,
    amount,
    totalClaimed: decodeUint256(totalClaimedWord),
    recipientMatches: bindingVerified,
    status: bindingVerified ? "ready" : "failed",
  });
}

async function readCustomV2(blockTag) {
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v2:")) state.claims.delete(key);
  }
  state.customV2 = {
    status: "loading",
    release: null,
    sources: [],
    error: null,
  };
  renderSummary();
  try {
    const response = {ok:true,json:async()=>customV2Release};
    if (!response.ok) throw new Error("Custom-V2-Release-Datei fehlt");
    const release = parseCustomV2Release(await response.json());
    if (!release.active) {
      state.customV2 = {
        status: "hold",
        release,
        sources: [],
        error: null,
      };
      return;
    }

    await verifyCustomV2Infrastructure(release, blockTag);
    const count = decodeUint256(
      await readContractWord(
        release.contracts.customRegistrar.address,
        CUSTOM_V2_SELECTORS.finalizedSourceCount,
        blockTag,
      ),
    );
    if (count > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Custom-V2-Source-Liste ist zu groß");
    const indices = Array.from({ length: Number(count) }, (_, index) => index);
    const indexed = await mapWithConcurrency(indices, 24, async (index) => {
      const [sourceIdWord, launchIdWord] = await Promise.all([
        readContractWord(
          release.contracts.customRegistrar.address,
          customV2IndexedReadData(
            CUSTOM_V2_SELECTORS.finalizedSourceIdAt,
            BigInt(index),
          ),
          blockTag,
        ),
        readContractWord(
          release.contracts.customRegistrar.address,
          customV2IndexedReadData(
            CUSTOM_V2_SELECTORS.finalizedLaunchIdAt,
            BigInt(index),
          ),
          blockTag,
        ),
      ]);
      return {
        index,
        sourceId: decodeBytes32(sourceIdWord),
        launchId: decodeBytes32(launchIdWord),
      };
    });
    if (
      new Set(indexed.map(({ sourceId }) => sourceId)).size !== indexed.length ||
      new Set(indexed.map(({ launchId }) => launchId)).size !== indexed.length
    )
      throw new Error("Custom-V2-Registrar enthält doppelte Einträge");
    const sources = await mapWithConcurrency(indexed, 12, (entry) =>
      readCustomV2Source(release, entry, blockTag),
    );
    for (const source of sources)
      state.claims.set(source.id, {
        amount: source.amount,
        recipientMatches: source.recipientMatches,
        status: source.status,
      });
    state.customV2 = {
      status: "ready",
      release,
      sources,
      error: null,
    };
  } catch (error) {
    state.customV2 = {
      status: "failed",
      release: null,
      sources: [],
      error:
        error instanceof Error
          ? error.message
          : "Custom V2 konnte nicht gelesen werden",
    };
  }
}

async function readHook(hook, blockTag) {
  const [code, recipientWord] = await Promise.all([
    request("eth_getCode", [hook.address, blockTag]),
    request("eth_call", [
      { to: hook.address, data: SELECTORS.launcherFeeRecipient },
      blockTag,
    ]),
  ]);
  const actualCodeHash = keccak256Hex(code);
  const recipient = decodeAddress(recipientWord);
  return {
    actualCodeHash,
    recipient,
    verified:
      actualCodeHash.toLowerCase() === hook.runtimeCodeHash.toLowerCase() &&
      isTreasury(recipient),
  };
}

async function readClaim(claim, blockTag) {
  const amountWord = await request("eth_call", [
    { to: claim.address, data: readAccruedData(claim) },
    blockTag,
  ]);
  const hook = state.hooks.get(claim.hookId);
  return {
    amount: decodeUint256(amountWord),
    recipient: hook?.recipient,
    recipientMatches: hook?.verified === true,
    status: "ready",
  };
}

 await readLaunchStampRouter();
 if(state.router.status!=='ready') throw new Error(state.router.error||'Ethereum-Launch-Historie nicht verfügbar');
 const blockTag=state.balanceBlockTag??toQuantityHex(state.router.finalizedBlock);
 await Promise.all([readCustomRegistry(blockTag),readCustomV2(blockTag),readClassicLaunches(blockTag)]);
 await Promise.all(HOOKS.map(async hook=>state.hooks.set(hook.id,await readHook(hook,blockTag))));
 await Promise.all(CLAIMS.map(async claim=>state.claims.set(claim.id,await readClaim(claim,blockTag))));
 const error=claimSafetyError(); if(error) throw new Error(error);
 const claims=claimableClaims().map(def=>({...def,...state.claims.get(def.id),to:def.address,data:claimData(def),recipient:TREASURY,
  // EthCreatorFeeHookV2.claimLauncherFees pays its immutable treasury for any
  // caller. Its pinned runtime and recipient were verified by readHook above.
  permissionless:def.hookId==='classic-v2'&&state.hooks.get('classic-v2')?.verified===true&&claimData(def)===SELECTORS.claimLauncherFees}));
 return {claims, blockNumber:state.router.finalizedBlock, launches:state.router.launches, unsupported:routerClaimCoverage(state.router.launches).unsupported, launchCount:state.router.launches.length+state.classic.launches.length};
}
