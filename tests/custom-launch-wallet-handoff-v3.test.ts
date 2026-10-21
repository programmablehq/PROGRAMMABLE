import { BASE_CUSTOM_ROOTS_V1 } from "../lib/custom-launch/base-release-v1";
import baseFeed from "./fixtures/base-finalized-custom-launch-metadata-feed-v1.json";
import { describe, expect, it } from "vitest";
import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  sha256,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
  CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
} from "../lib/custom-launch/wallet-handoff-v1";
import { customLaunchWalletTransactionPreimageHashV2 } from
  "../lib/custom-launch/wallet-handoff-v2";
import {
  assertCustomLaunchFundingAuthorizationV3,
  assertCustomLaunchFundingIdempotencyKeyV3,
  createCustomLaunchFundingSubmissionV3,
  CUSTOM_LAUNCH_MAINNET_USDC_V3,
  prepareCustomLaunchFundingAuthorizationV3,
  prepareCustomLaunchRouterReviewV3,
  serializeCustomLaunchFundingTypedDataV3,
  verifyCustomLaunchFundingSignatureV3,
} from "../lib/custom-launch/wallet-handoff-v3";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
const OTHER_PRIVATE_KEY = `0x${"22".repeat(32)}` as Hex;
const account = privateKeyToAccount(PRIVATE_KEY);
const other = privateKeyToAccount(OTHER_PRIVATE_KEY);
const LAUNCH_ID = "60000000-0000-4000-8000-000000000006";
const FUNDING_INTENT = `0x${"33".repeat(32)}` as Hex;
const NONCE = `0x${"44".repeat(32)}` as Hex;
const INITIALIZER = "0x5555555555555555555555555555555555555555";
const NOW = 2_000_000_000n;
const ZERO_ADDRESS = getAddress("0x0000000000000000000000000000000000000000");
const NON_USDC_QUOTE = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const CUSTOM_GRAPH_FACTORY = getAddress(
  "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
);
const ROUTE_NAMESPACE = `0x${"11".repeat(32)}` as Hex;
const ROUTE_NONCE = `0x${"22".repeat(32)}` as Hex;
const TOPOLOGY_HASH = `0x${"33".repeat(32)}` as Hex;
const PERMIT_NONCE = `0x${"55".repeat(32)}` as Hex;
const STAMP_LAUNCH_ID = `0x${"66".repeat(32)}` as Hex;
const VALID_HOOK_APPLICANT_SALT =
  "0x0000000000000000000000000000000000000000000000000000000000000c94" as Hex;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const FUNDING_BOUNDARY = Object.freeze({
  approvalTransactionRequired: false,
  permit2Used: false,
  fundingSignatureProducedByService: false,
  walletTransactionBroadcastByService: false,
});
const PLATFORM_ADMISSION = Object.freeze({
  schemaVersion: "programmable.platform-admission-status.v1",
  disposition: "no_blocking_static_finding",
  reportSha256: `sha256:${"77".repeat(32)}`,
  warningFindingCodes: ["RUNTIME_CREATE2", "SOURCE_MUTABLE_ADMIN_SURFACE"],
  routerSimulationRequiredBeforeAuthorization: true,
  safetyClaim: false,
  feeBehaviorClaim: false,
});

const LAUNCH_AND_STAMP_PARAMETERS = parseAbiParameters(
  "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes",
);
const CUSTOM_GRAPH_ROUTE_PARAMETER = parseAbiParameters(
  "(bytes32,bytes32,bytes32,bytes32,(bytes32,bytes32,uint256,uint256,bytes,bytes)[],(uint8,bytes32,address,bytes32)[],bytes32)",
);
const GRAPH_TARGET_COMMITMENT_TYPEHASH = typehash(
  "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)",
);
const GRAPH_COMMITMENT_TYPEHASH = typehash(
  "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)",
);
const GRAPH_TARGET_SALT_TYPEHASH = typehash(
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)",
);
const GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = typehash(
  "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)",
);
const EXPECTED_GRAPH_OUTPUT_TYPEHASH = typehash(
  "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)",
);
const EXPECTED_GRAPH_RESULT_TYPEHASH = typehash(
  "ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)",
);
const COMPONENT_TYPEHASH = typehash(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
);
const POOL_KEY_TYPEHASH = typehash(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
);
const STAMP_REQUEST_TYPEHASH = typehash(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
);

function fundingOutput(overrides: Readonly<Record<string, unknown>> = {}) {
  const message = {
    from: account.address,
    to: INITIALIZER,
    value: "25000000",
    validAfter: String(NOW - 60n),
    validBefore: String(NOW + 600n),
    nonce: NONCE,
  };
  const typedData = {
    domain: {
      name: "USD Coin" as const,
      version: "2" as const,
      chainId: 1 as const,
      verifyingContract: CUSTOM_LAUNCH_MAINNET_USDC_V3,
    },
    primaryType: "ReceiveWithAuthorization" as const,
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    message,
  };
  return {
    schemaVersion: "programmable.custom-launch-authorization-result.v3",
    integrationState: "ready",
    stage: "funding-signature-required",
    fundingBoundary: FUNDING_BOUNDARY,
    actionRequired: {
      schemaVersion: "programmable.custom-launch-funding-challenge.v1",
      kind: "wallet-signature",
      method: "eip-3009-receive-with-authorization",
      fundingIntentHash: FUNDING_INTENT,
      fundingAuthorization: {
        schemaVersion: "programmable.funding-authorization-descriptor.v1",
        method: "eip-3009-receive-with-authorization",
        token: CUSTOM_LAUNCH_MAINNET_USDC_V3,
        ...message,
      },
      typedData,
      typedDataDigest: hashTypedData({
        ...typedData,
        message: {
          ...message,
          value: BigInt(message.value),
          validAfter: BigInt(message.validAfter),
          validBefore: BigInt(message.validBefore),
        },
      }),
      submission: {
        method: "POST",
        path: `/v3/wallet-admin/custom-launches/${LAUNCH_ID}/funding-authorization`,
        schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
      },
      ...overrides,
    },
  };
}

type RouterTargetFixture = Readonly<{
  index: number;
  targetIdHash: Hex;
  applicantSalt: Hex;
  initCode: Hex;
  initCodeHash: Hex;
  initializerCalldata: Hex;
  initializerCalldataHash: Hex;
  effectiveSalt: Hex;
  account: Address;
  runtimeCodeHash: Hex;
}>;

function typehash(value: string) {
  return keccak256(stringToHex(value));
}

function abiHash(types: string, values: readonly unknown[]) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(types),
    values as never,
  ));
}

function packedHash(values: readonly Hex[]) {
  return keccak256(values.length === 0 ? "0x" : concatHex(values));
}

function routerFixture({
  quote,
  chainId = "1",
  targetCount = 3,
  hookApplicantSalt = VALID_HOOK_APPLICANT_SALT,
  stampHook,
  fee = 3_000,
  tickSpacing = 60,
}: Readonly<{
  quote: Address;
  chainId?: "1" | "8453";
  targetCount?: 2 | 3;
  hookApplicantSalt?: Hex;
  stampHook?: Address;
  fee?: number;
  tickSpacing?: number;
}>) {
  const router = chainId === "8453" ? BASE_CUSTOM_ROOTS_V1.router : CUSTOM_LAUNCH_MAINNET_ROUTER_V1;
  const graphFactory = chainId === "8453" ? BASE_CUSTOM_ROOTS_V1.graphFactory : CUSTOM_GRAPH_FACTORY;
  const targets: RouterTargetFixture[] = Array.from(
    { length: targetCount },
    (_, index) => {
      const byte = (index + 1).toString(16).padStart(2, "0");
      const targetIdHash = `0x${byte.repeat(32)}` as Hex;
      const applicantSalt = index === 1
        ? hookApplicantSalt
        : ZERO_BYTES32;
      const initCode = `0x600${index}6000526001601ff3` as Hex;
      const initCodeHash = keccak256(initCode);
      const initializerCalldata = index === 2 ? "0x1234" : "0x";
      const initializerCalldataHash = keccak256(initializerCalldata);
      const effectiveSalt = abiHash(
        "bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address",
        [
          GRAPH_TARGET_SALT_TYPEHASH,
          BigInt(chainId),
          graphFactory,
          ROUTE_NAMESPACE,
          ROUTE_NONCE,
          targetIdHash,
          applicantSalt,
          router,
        ],
      );
      return Object.freeze({
        index,
        targetIdHash,
        applicantSalt,
        initCode,
        initCodeHash,
        initializerCalldata,
        initializerCalldataHash,
        effectiveSalt,
        account: getCreate2Address({
          from: graphFactory,
          salt: effectiveSalt,
          bytecodeHash: initCodeHash,
        }),
        runtimeCodeHash: keccak256(stringToHex(`runtime-${index}`)),
      });
    },
  );
  const targetTuples = targets.map((target) => [
    target.targetIdHash,
    target.applicantSalt,
    0n,
    0n,
    target.initCode,
    target.initializerCalldata,
  ] as const);
  const expectedOutputs = targets.map((target) => [
    target.index,
    target.targetIdHash,
    target.account,
    target.runtimeCodeHash,
  ] as const);
  const targetCommitments = targets.map((target) => abiHash(
    "bytes32,uint256,bytes32,bytes32,uint256,uint256,bytes32,bytes32",
    [
      GRAPH_TARGET_COMMITMENT_TYPEHASH,
      BigInt(target.index),
      target.targetIdHash,
      target.applicantSalt,
      0n,
      0n,
      target.initCodeHash,
      target.initializerCalldataHash,
    ],
  ));
  const targetCommitmentsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32[]"),
    [targetCommitments],
  ));
  const graphCommitment = abiHash(
    "bytes32,uint256,address,bytes32,bytes32,bytes32,address,uint256,bytes32",
    [
      GRAPH_COMMITMENT_TYPEHASH,
      BigInt(chainId),
      graphFactory,
      ROUTE_NAMESPACE,
      ROUTE_NONCE,
      TOPOLOGY_HASH,
      router,
      0n,
      targetCommitmentsHash,
    ],
  );
  let graphDeploymentHash = graphCommitment;
  for (const target of targets) {
    graphDeploymentHash = abiHash(
      "bytes32,bytes32,uint256,bytes32,address,bytes32,bytes32,bytes32,bytes32,uint256,uint256",
      [
        GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH,
        graphDeploymentHash,
        BigInt(target.index),
        target.targetIdHash,
        target.account,
        target.effectiveSalt,
        target.initCodeHash,
        target.initializerCalldataHash,
        target.runtimeCodeHash,
        0n,
        0n,
      ],
    );
  }
  const outputHashes = targets.map((target) => abiHash(
    "bytes32,uint8,bytes32,address,bytes32",
    [
      EXPECTED_GRAPH_OUTPUT_TYPEHASH,
      target.index,
      target.targetIdHash,
      target.account,
      target.runtimeCodeHash,
    ],
  ));
  const expectedResultHash = abiHash(
    "bytes32,bytes32,bytes32",
    [
      EXPECTED_GRAPH_RESULT_TYPEHASH,
      packedHash(outputHashes),
      graphDeploymentHash,
    ],
  );
  const routePayload = encodeAbiParameters(
    CUSTOM_GRAPH_ROUTE_PARAMETER,
    [[
      ROUTE_NAMESPACE,
      ROUTE_NONCE,
      TOPOLOGY_HASH,
      graphCommitment,
      targetTuples,
      expectedOutputs,
      graphDeploymentHash,
    ]] as never,
  );

  const token = targets[0]!.account;
  const hook = targets[1]!.account;
  const poolHook = stampHook ?? hook;
  const [currency0, currency1] = [quote, token]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1) as [
      Address,
      Address,
    ];
  const components = targets.map((target) => [
    target.index,
    target.account,
    target.runtimeCodeHash,
    target.index === 0 ? 1 : target.index === 1 ? 2 : 0,
    1,
  ] as const).sort((left, right) => (
    BigInt(left[1]) < BigInt(right[1]) ? -1 : 1
  ));
  const componentHashes = components.map((component) => abiHash(
    "bytes32,uint8,address,bytes32,uint8,uint8",
    [COMPONENT_TYPEHASH, ...component],
  ));
  const poolKey = [currency0, currency1, fee, tickSpacing, poolHook] as const;
  const poolKeyHash = abiHash(
    "bytes32,address,address,uint24,int24,address",
    [POOL_KEY_TYPEHASH, ...poolKey],
  );
  const stampRequestHash = abiHash(
    "bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32",
    [
      STAMP_REQUEST_TYPEHASH,
      STAMP_LAUNCH_ID,
      token,
      targets[0]!.runtimeCodeHash,
      poolKeyHash,
      targets[1]!.runtimeCodeHash,
      packedHash(componentHashes),
    ],
  );
  const stampRequest = [
    STAMP_LAUNCH_ID,
    token,
    targets[0]!.runtimeCodeHash,
    poolKey,
    targets[1]!.runtimeCodeHash,
    components,
  ] as const;
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const permit = [
    BigInt(chainId),
    router,
    account.address,
    1,
    keccak256(routePayload),
    expectedResultHash,
    stampRequestHash,
    PERMIT_NONCE,
    now - 60n,
    now + 600n,
    0n,
  ] as const;
  const permitSignature = `0x${"77".repeat(64)}1b` as Hex;
  const permitDigest = hashTypedData({
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: router,
    },
    primaryType: "ProgrammableLaunchPermitV1",
    types: {
      ProgrammableLaunchPermitV1: [
        { name: "chainId", type: "uint256" },
        { name: "router", type: "address" },
        { name: "launchWallet", type: "address" },
        { name: "kind", type: "uint8" },
        { name: "routePayloadHash", type: "bytes32" },
        { name: "expectedResultHash", type: "bytes32" },
        { name: "stampRequestHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "validAfter", type: "uint64" },
        { name: "deadline", type: "uint64" },
        { name: "value", type: "uint256" },
      ],
    },
    message: {
      chainId: permit[0],
      router: permit[1],
      launchWallet: permit[2],
      kind: permit[3],
      routePayloadHash: permit[4],
      expectedResultHash: permit[5],
      stampRequestHash: permit[6],
      nonce: permit[7],
      validAfter: permit[8],
      deadline: permit[9],
      value: permit[10],
    },
  });
  const calldata = `${CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1}${
    encodeAbiParameters(
      LAUNCH_AND_STAMP_PARAMETERS,
      [permit, stampRequest, routePayload, permitSignature] as never,
    ).slice(2)
  }` as Hex;
  const walletAction = Object.freeze({
    chainId,
    from: account.address,
    to: router,
    data: calldata,
    value: toHex(0n),
    valueWei: "0",
  });
  const transaction = Object.freeze({
    schemaVersion: "programmable.exact-wallet-transaction.v3",
    chainId,
    from: account.address,
    to: router,
    valueWei: "0",
    calldata,
  });
  const transactionPreimageHash =
    customLaunchWalletTransactionPreimageHashV2(walletAction);
  const artifactHash = `sha256:${sha256(stringToHex("fixture-artifact")).slice(2)}`;
  const artifact = Object.freeze({
    schemaVersion: "programmable.prepared-custom-graph-launch.v1",
    artifactHash,
    permitDigest,
    route: Object.freeze({
      graphCommitment,
      targets: targets.map((target) => Object.freeze({
        targetId: `target-${target.index}`,
        initializerCalldataHash: target.initializerCalldataHash,
      })),
    }),
    unsignedRouterTransaction: Object.freeze({
      chainId,
      from: account.address,
      to: router,
      valueWei: "0",
      functionName: "launchAndStampV1",
      selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
      calldataWithEmptySignature: calldata,
      signatureState: "permit-authority-signature-required",
      preimageHash: transactionPreimageHash,
    }),
  });
  const signedPermit = Object.freeze({
    schemaVersion: "programmable.signed-prepared-launch-permit.v1",
    ...(chainId === "8453" ? { releaseId: baseFeed.launches[0].routingFeePolicy.enforcementBoundary.releaseId } : {}),
    artifactHash,
    chainId,
    router: router,
    authoritySafe: chainId === "8453" ? BASE_CUSTOM_ROOTS_V1.permitAuthority : account.address,
    signerAddress: chainId === "8453" ? BASE_CUSTOM_ROOTS_V1.permitSigner : account.address,
    permitDigest,
    safeMessageDigest: `0x${"88".repeat(32)}`,
    signature: permitSignature,
    validAfter: String(permit[8]),
    deadline: String(permit[9]),
  });
  const observationWindow = Object.freeze({
    schemaVersion: "programmable.custom-launch-observation-window.v1",
    chainId,
    router: router,
    fromBlock: "25832300",
    toBlock: "25832393",
  });
  const simulation = Object.freeze({
    outcome: "passed",
    transactionPreimageHash,
    profileHash: `sha256:${"99".repeat(32)}`,
    blockNumber: "25832393",
    blockHash: `0x${"aa".repeat(32)}`,
    blockTimestamp: "2000000001",
    responseDigest: `sha256:${"bb".repeat(32)}`,
    gasEstimate: "500000",
  });
  return Object.freeze({
    hook,
    token,
    graphCommitment,
    output: Object.freeze({
      schemaVersion: "programmable.custom-launch-authorization-result.v3",
      integrationState: "ready",
      stage: "router-transaction-required",
      fundingBoundary: FUNDING_BOUNDARY,
      actionRequired: Object.freeze({
        kind: "send-router-transaction",
        transaction,
        graphCommitment,
        artifactHash,
        transactionPreimageHash,
        permitDigest,
        initializerCalldataHash: targets.at(-1)!.initializerCalldataHash,
      }),
      artifact,
      signedPermit,
      observationWindow,
      onchain: null,
      walletTransaction: transaction,
      simulation,
    }),
  });
}

describe("custom launch V3 wallet handoff", () => {
  it("requires the Base signed permit release identity", () => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS, chainId: "8453" });
    expect(prepareCustomLaunchRouterReviewV3(fixture.output, account.address).walletAction.chainId).toBe("8453");
    for (const releaseId of [undefined, "invalid", `sha256:${"ff".repeat(31)}`]) {
      expect(() => prepareCustomLaunchRouterReviewV3({
        ...fixture.output,
        signedPermit: { ...fixture.output.signedPermit, releaseId },
      }, account.address)).toThrow();
    }
  });

  it("accepts the Base checkpoint contract while retaining its chain and quorum checks", () => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS, chainId: "8453" });
    const finality = baseFeed.launches[0].finality;
    const onchain = {
      schemaVersion: "programmable.custom-launch-onchain-evidence.v1",
      finalityState: "finalized",
      chainId: "8453",
      router: BASE_CUSTOM_ROOTS_V1.router,
      onchainLaunchId: STAMP_LAUNCH_ID,
      transactionHash: finality.transactionHash,
      blockNumber: finality.blockNumber,
      blockHash: finality.blockHash,
      logIndex: finality.logIndex,
      token: fixture.token,
      hook: fixture.hook,
      poolManager: BASE_CUSTOM_ROOTS_V1.poolManager,
      poolId: baseFeed.launches[0].poolId,
      stampHash: baseFeed.launches[0].routingFeePolicy.stampBinding.stampHash,
      confirmationDepth: finality.confirmationDepth,
      requiredConfirmationDepth: finality.requiredConfirmationDepth,
      observedAtBlockNumber: "52908841",
      finalizedCheckpoint: structuredClone(finality.finalizedCheckpoint),
    };
    const review = () => prepareCustomLaunchRouterReviewV3({ ...fixture.output, onchain }, account.address);
    expect(review().walletAction.chainId).toBe("8453");
    for (const schema of ["programmable.ethereum-finalized-checkpoint-quorum.v1", "programmable.base-finalized-checkpoint-quorum.v1"]) {
      onchain.finalizedCheckpoint.schemaVersion = schema;
      expect(review).toThrow();
    }
    onchain.finalizedCheckpoint.schemaVersion = finality.finalizedCheckpoint.schemaVersion;
    onchain.finalizedCheckpoint.observations[1].commonBlockHash = ZERO_BYTES32;
    expect(review).toThrow();
  });

  it("binds, signs, locally recovers, and submits one exact EIP-3009 challenge", async () => {
    const prepared = prepareCustomLaunchFundingAuthorizationV3(
      fundingOutput(),
      account.address,
      LAUNCH_ID,
      FUNDING_INTENT,
      NOW,
    );
    const signature = await account.signTypedData({
      ...prepared.typedData,
      message: {
        ...prepared.typedData.message,
        value: BigInt(prepared.value),
        validAfter: BigInt(prepared.validAfter),
        validBefore: BigInt(prepared.validBefore),
      },
    });
    const verified = await verifyCustomLaunchFundingSignatureV3(
      prepared,
      signature,
    );

    const serialized = JSON.parse(
      serializeCustomLaunchFundingTypedDataV3(prepared),
    );
    expect(serialized).toMatchObject({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 1,
        verifyingContract: CUSTOM_LAUNCH_MAINNET_USDC_V3.toLowerCase(),
      },
      primaryType: "ReceiveWithAuthorization",
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ReceiveWithAuthorization: prepared.typedData.types.ReceiveWithAuthorization,
      },
      message: {
        ...prepared.typedData.message,
        from: prepared.typedData.message.from.toLowerCase(),
        to: prepared.typedData.message.to.toLowerCase(),
      },
    });
    expect(verified).toBe(signature);
    expect(createCustomLaunchFundingSubmissionV3(prepared, verified)).toEqual({
      schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
      fundingIntentHash: FUNDING_INTENT,
      typedDataDigest: prepared.typedDataDigest,
      signature,
    });
    expect(assertCustomLaunchFundingIdempotencyKeyV3(LAUNCH_ID)).toBe(LAUNCH_ID);
  });

  it("rejects signer, chain, value, digest, deadline, and endpoint substitution", async () => {
    const prepared = prepareCustomLaunchFundingAuthorizationV3(
      fundingOutput(),
      account.address,
      LAUNCH_ID,
      FUNDING_INTENT,
      NOW,
    );
    const wrongSignature = await other.signTypedData({
      ...prepared.typedData,
      message: {
        ...prepared.typedData.message,
        value: BigInt(prepared.value),
        validAfter: BigInt(prepared.validAfter),
        validBefore: BigInt(prepared.validBefore),
      },
    });
    await expect(verifyCustomLaunchFundingSignatureV3(
      prepared,
      wrongSignature,
    )).rejects.toThrow();

    for (const output of [
      fundingOutput({
        typedData: {
          ...(fundingOutput().actionRequired.typedData as object),
          domain: {
            ...(fundingOutput().actionRequired.typedData.domain as object),
            chainId: 10,
          },
        },
      }),
      fundingOutput({
        fundingAuthorization: {
          ...(fundingOutput().actionRequired.fundingAuthorization as object),
          value: "25000001",
        },
      }),
      fundingOutput({ typedDataDigest: `0x${"99".repeat(32)}` }),
      fundingOutput({
        fundingAuthorization: {
          ...(fundingOutput().actionRequired.fundingAuthorization as object),
          validBefore: String(NOW),
        },
      }),
      fundingOutput({
        submission: {
          ...(fundingOutput().actionRequired.submission as object),
          path: "/v3/wallet-admin/custom-launches/other/funding-authorization",
        },
      }),
      {
        ...fundingOutput(),
        fundingBoundary: {
          ...FUNDING_BOUNDARY,
          approvalTransactionRequired: true,
        },
      },
    ]) {
      expect(() => prepareCustomLaunchFundingAuthorizationV3(
        output,
        account.address,
        LAUNCH_ID,
        FUNDING_INTENT,
        NOW,
      )).toThrow();
    }
  });

  it("never exposes a Router action before an exact authorized resource exists", () => {
    expect(() => prepareCustomLaunchRouterReviewV3(
      fundingOutput(),
      account.address,
    )).toThrow();
    expect(() => assertCustomLaunchFundingIdempotencyKeyV3("short"))
      .toThrow();
  });

  it("accepts only the exact server-authored revision 3 admission status", () => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS });
    const admittedOutput = {
      ...fixture.output,
      platformAdmission: PLATFORM_ADMISSION,
    };
    expect(prepareCustomLaunchRouterReviewV3(
      admittedOutput,
      account.address,
    ).graphCommitment).toBe(fixture.graphCommitment);
    expect(prepareCustomLaunchRouterReviewV3({
      ...fixture.output,
      platformAdmission: {
        ...PLATFORM_ADMISSION,
        warningFindingCodes: ["V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING"],
      },
    }, account.address).graphCommitment).toBe(fixture.graphCommitment);

    for (const platformAdmission of [
      { ...PLATFORM_ADMISSION, warningFindingCodes: ["unknown-finding"] },
      {
        ...PLATFORM_ADMISSION,
        warningFindingCodes: ["RUNTIME_CREATE2", "RUNTIME_CREATE2"],
      },
      { ...PLATFORM_ADMISSION, disposition: "action_required" },
      { ...PLATFORM_ADMISSION, safetyClaim: true },
      { ...PLATFORM_ADMISSION, feeBehaviorClaim: true },
      { ...PLATFORM_ADMISSION, reportSha256: `0x${"77".repeat(32)}` },
    ]) {
      expect(() => prepareCustomLaunchRouterReviewV3({
        ...fixture.output,
        platformAdmission,
      }, account.address)).toThrow();
    }
  });

  it.each(["1.1.0", "1.2.0", "1.3.0"])("accepts server evidence %s without weakening Router bindings", (vectorSetVersion) => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS });
    const vectorIds = Array.from({ length: 16 }, (_, index) => `swap.vector-${index}`);
    const behaviorEvidence = Object.freeze({
      schemaVersion: "programmable.custom-launch-behavior-summary.v1",
      subjectSha256: `sha256:${"12".repeat(32)}`,
      requirements: Object.freeze({
        schemaVersion: "programmable.custom-launch-behavior-requirements.v1",
        vectorSetVersion,
        riskClass: "standard-swaps",
        hookPermissionMask: 0,
        liquidityModel: "external-concentrated-liquidity",
        vectors: vectorIds.map((vectorId) => ({ vectorId })),
        requirementsSha256: `sha256:${"13".repeat(32)}`,
      }),
      status: "not_executed",
      execution: null,
      vectors: vectorIds.map((vectorId) => ({ vectorId })),
      outstandingVectorIds: vectorIds,
      claimAxes: Object.freeze({}),
    });
    const behaviorAssurance = Object.freeze({
      schemaVersion: "programmable.custom-launch-behavior-assurance.v1",
      authorizationScope: "exact-launch-provenance-only",
      evidenceAuthority: "none",
      behaviorExecution: "not_executed",
      mutableAuthorityConditional: false,
      routability: Object.freeze({
        status: "not_verified",
        basis: "behavior-evidence-required",
      }),
      platformFeeConformance: Object.freeze({
        status: "not_verified",
        basis: vectorSetVersion === "1.3.0" ? "exact-hundred-bps-evidence-required" : vectorSetVersion === "1.2.0" ? "exact-thirty-bps-evidence-required" : "exact-ten-bps-evidence-required",
      }),
      liquidityConformance: Object.freeze({
        status: "not_verified",
        basis: "liquidity-lifecycle-evidence-required",
      }),
      safety: Object.freeze({
        status: "not_verified",
        basis: "no-universal-safety-claim",
      }),
    });
    const currentAdmission = Object.freeze({
      ...PLATFORM_ADMISSION,
      needsEvidenceFindingCodes: PLATFORM_ADMISSION.warningFindingCodes,
      riskClassification: Object.freeze({
        schemaVersion: "programmable.platform-admission-risk-classification.v3",
        classifierVersion: "1.1.0",
        evidenceAuthority: "deterministic-static-classification",
        disposition: "needs_evidence",
        evidenceTierStatus: "required",
        approvalAuthority: false,
        safetyClaim: false,
        feeBehaviorClaim: false,
        launchEligibility: Object.freeze({
          deployable: true,
          routable: false,
          featured: false,
          basis: "static-admission-only",
        }),
      }),
      behaviorEvidence,
      productTruthAxes: Object.freeze({
        deployment: Object.freeze({ status: "eligible" }),
        trading: Object.freeze({ status: "not_verified" }),
        platform_fee_evidence: Object.freeze({ status: "not_verified" }),
      }),
    });
    const output = {
      ...fixture.output,
      actionRequired: {
        ...fixture.output.actionRequired,
        walletHandoffUrl:
          `https://programmable.market/developers/api-keys?launchId=${LAUNCH_ID}`,
        expiresAt: "2033-05-18T03:33:21.000Z",
      },
      simulation: { ...fixture.output.simulation, behaviorEvidence },
      behaviorEvidence,
      behaviorAssurance,
      platformAdmission: currentAdmission,
    };
    expect(prepareCustomLaunchRouterReviewV3(
      output,
      account.address,
    ).graphCommitment).toBe(fixture.graphCommitment);

    for (const version of ["1.0.0", "1.4.0", "2.0.0"]) {
      const unsupported = { ...behaviorEvidence, requirements: { ...behaviorEvidence.requirements, vectorSetVersion: version } };
      expect(() => prepareCustomLaunchRouterReviewV3({ ...output,
        behaviorEvidence: unsupported,
        simulation: { ...output.simulation, behaviorEvidence: unsupported },
        platformAdmission: { ...currentAdmission, behaviorEvidence: unsupported },
      }, account.address)).toThrow();
    }
    expect(() => prepareCustomLaunchRouterReviewV3({ ...output,
      behaviorEvidence: { ...behaviorEvidence, status: "failed" },
    }, account.address)).toThrow();
  });

  it("accepts only canonical submitted and finalized onchain evidence", () => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS });
    for (const [finalityState, confirmationDepth] of [
      ["submitted", "1"],
      ["finalized", "64"],
    ] as const) {
      const onchain = {
        schemaVersion: "programmable.custom-launch-onchain-evidence.v1",
        finalityState,
        chainId: "1",
        router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
        onchainLaunchId: `0x${"11".repeat(32)}`,
        transactionHash: `0x${"22".repeat(32)}`,
        blockNumber: "25832393",
        blockHash: `0x${"33".repeat(32)}`,
        logIndex: 2,
        token: fixture.token,
        hook: fixture.hook,
        poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        poolId: `0x${"44".repeat(32)}`,
        stampHash: `0x${"55".repeat(32)}`,
        confirmationDepth,
        requiredConfirmationDepth: "64",
        observedAtBlockNumber: finalityState === "finalized"
          ? "25832456"
          : "25832393",
        ...(finalityState === "submitted" ? {
          finalizedCheckpoint: {
            schemaVersion: "programmable.ethereum-finalized-checkpoint-quorum.v1",
            blockNumber: "25832392",
            blockHash: `0x${"66".repeat(32)}`,
            quorumSize: 2,
            observations: [
              {
                provider: "primary",
                finalizedBlockNumber: "25832392",
                finalizedBlockHash: `0x${"66".repeat(32)}`,
                commonBlockHash: `0x${"66".repeat(32)}`,
              },
              {
                provider: "secondary",
                finalizedBlockNumber: "25832393",
                finalizedBlockHash: `0x${"88".repeat(32)}`,
                commonBlockHash: `0x${"66".repeat(32)}`,
              },
            ],
          },
        } : {}),
      };
      expect(prepareCustomLaunchRouterReviewV3({
        ...fixture.output,
        onchain,
      }, account.address).graphCommitment).toBe(fixture.graphCommitment);
    }

    for (const onchain of [
      {
        ...(fixture.output.onchain ?? {}),
        schemaVersion: "programmable.custom-launch-onchain-evidence.v1",
      },
      {
        schemaVersion: "programmable.custom-launch-onchain-evidence.v1",
        finalityState: "finalized",
        chainId: "1",
        router: OTHER_PRIVATE_KEY.slice(0, 42),
        onchainLaunchId: `0x${"11".repeat(32)}`,
        transactionHash: `0x${"22".repeat(32)}`,
        blockNumber: "25832393",
        blockHash: `0x${"33".repeat(32)}`,
        logIndex: 2,
        token: fixture.token,
        hook: fixture.hook,
        poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        poolId: `0x${"44".repeat(32)}`,
        stampHash: `0x${"55".repeat(32)}`,
        confirmationDepth: "63",
        requiredConfirmationDepth: "64",
        observedAtBlockNumber: "25832456",
      },
    ]) {
      expect(() => prepareCustomLaunchRouterReviewV3({
        ...fixture.output,
        onchain,
      }, account.address)).toThrow();
    }
  });

  it("requires more than 30 seconds before the funding authorization expires", () => {
    const output = fundingOutput();
    const reviewed = prepareCustomLaunchFundingAuthorizationV3(
      output,
      account.address,
      LAUNCH_ID,
      FUNDING_INTENT,
      NOW,
    );
    expect(prepareCustomLaunchFundingAuthorizationV3(
      output,
      account.address,
      LAUNCH_ID,
      FUNDING_INTENT,
      NOW + 569n,
    )).toEqual(reviewed);
    expect(() => prepareCustomLaunchFundingAuthorizationV3(
      output,
      account.address,
      LAUNCH_ID,
      FUNDING_INTENT,
      NOW + 570n,
    )).toThrow();
    expect(assertCustomLaunchFundingAuthorizationV3(
      reviewed,
      account.address,
      NOW + 569n,
    )).toBe(reviewed);
    expect(() => assertCustomLaunchFundingAuthorizationV3(
      reviewed,
      account.address,
      NOW + 570n,
    )).toThrow();
  });

  it("rebinds every serialized typed-data field to the reviewed funding summary", () => {
    const prepared = prepareCustomLaunchFundingAuthorizationV3(
      fundingOutput(),
      account.address,
      LAUNCH_ID,
      FUNDING_INTENT,
      NOW,
    );
    for (const malicious of [
      { ...prepared, value: "25000001" },
      { ...prepared, to: other.address },
      { ...prepared, nonce: `0x${"88".repeat(32)}` },
    ]) {
      expect(() => assertCustomLaunchFundingAuthorizationV3(
        malicious as typeof prepared,
        account.address,
        NOW,
      )).toThrow();
    }

    const changedDomain = {
      ...prepared.typedData,
      domain: {
        ...prepared.typedData.domain,
        version: "3",
      },
    };
    const changedDomainDigest = hashTypedData({
      ...changedDomain,
      message: {
        ...changedDomain.message,
        value: BigInt(changedDomain.message.value),
        validAfter: BigInt(changedDomain.message.validAfter),
        validBefore: BigInt(changedDomain.message.validBefore),
      },
    } as never);
    expect(() => assertCustomLaunchFundingAuthorizationV3({
      ...prepared,
      typedData: changedDomain,
      typedDataDigest: changedDomainDigest,
    } as typeof prepared, account.address, NOW)).toThrow();
  });

  it.each([
    ["native", ZERO_ADDRESS],
    ["a non-USDC ERC-20", NON_USDC_QUOTE],
  ])("accepts an exact direct-native graph with %s quote currency", (
    _label,
    quote,
  ) => {
    const fixture = routerFixture({ quote });
    const review = prepareCustomLaunchRouterReviewV3(
      fixture.output,
      account.address,
    );

    expect(review.graphCommitment).toBe(fixture.graphCommitment);
    expect(review.walletAction.from).toBe(account.address);
    expect(review.permitDigest).toBe(
      fixture.output.actionRequired.permitDigest,
    );
    expect(review.initializerCalldataHash).toBe(
      fixture.output.actionRequired.initializerCalldataHash,
    );
    expect(BigInt(fixture.hook) & 0x3fffn).toBe(0x20ccn);
    expect(fixture.token).not.toBe(quote);
  });

  it.each([0, 999_999, 0x800000])(
    "accepts the exact V3 pool fee mode %i",
    (fee) => {
      const fixture = routerFixture({ quote: ZERO_ADDRESS, fee });
      expect(prepareCustomLaunchRouterReviewV3(
        fixture.output,
        account.address,
      ).graphCommitment).toBe(fixture.graphCommitment);
    },
  );

  it.each([
    ["fee at the excluded profile boundary", { fee: 1_000_000 }],
    ["fee above the static bound", { fee: 1_000_001 }],
    ["unknown dynamic-fee flag", { fee: 0x800001 }],
    ["maximum uint24 value", { fee: 0xffffff }],
    ["zero tick spacing", { tickSpacing: 0 }],
    ["negative tick spacing", { tickSpacing: -1 }],
    ["tick spacing above the bound", { tickSpacing: 32_768 }],
  ])("rejects an exact graph with %s", (_label, overrides) => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS, ...overrides });
    expect(() => prepareCustomLaunchRouterReviewV3(
      fixture.output,
      account.address,
    )).toThrow();
  });

  it("accepts exact graph-bound hooks with multiple V3 permission masks", () => {
    const fixedProfileFixture = routerFixture({
      quote: ZERO_ADDRESS,
      hookApplicantSalt: VALID_HOOK_APPLICANT_SALT,
    });
    const alternateMaskFixture = routerFixture({
      quote: ZERO_ADDRESS,
      hookApplicantSalt: ZERO_BYTES32,
    });

    expect(BigInt(fixedProfileFixture.hook) & 0x3fffn).toBe(0x20ccn);
    expect(BigInt(alternateMaskFixture.hook) & 0x3fffn).not.toBe(0x20ccn);
    expect(prepareCustomLaunchRouterReviewV3(
      fixedProfileFixture.output,
      account.address,
    ).graphCommitment).toBe(fixedProfileFixture.graphCommitment);
    expect(prepareCustomLaunchRouterReviewV3(
      alternateMaskFixture.output,
      account.address,
    ).graphCommitment).toBe(alternateMaskFixture.graphCommitment);
  });

  it("rejects a pool hook that does not match the exact graph hook", () => {
    const fixture = routerFixture({
      quote: ZERO_ADDRESS,
      stampHook: other.address,
    });
    expect(() => prepareCustomLaunchRouterReviewV3(
      fixture.output,
      account.address,
    )).toThrow();
  });

  it("rejects a two-target graph for the three-target V3 profile", () => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS, targetCount: 2 });
    expect(() => prepareCustomLaunchRouterReviewV3(
      fixture.output,
      account.address,
    )).toThrow();
  });

  it("rejects changed permit, initializer calldata, or funding-boundary evidence", () => {
    const fixture = routerFixture({ quote: ZERO_ADDRESS });
    for (const output of [
      {
        ...fixture.output,
        actionRequired: {
          ...fixture.output.actionRequired,
          permitDigest: `0x${"99".repeat(32)}`,
        },
      },
      {
        ...fixture.output,
        actionRequired: {
          ...fixture.output.actionRequired,
          initializerCalldataHash: `0x${"99".repeat(32)}`,
        },
      },
      {
        ...fixture.output,
        fundingBoundary: {
          ...FUNDING_BOUNDARY,
          walletTransactionBroadcastByService: true,
        },
      },
    ]) {
      expect(() => prepareCustomLaunchRouterReviewV3(
        output,
        account.address,
      )).toThrow();
    }
  });
});
