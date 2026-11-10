import {
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
  CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
  assertCustomLaunchWalletActionV1,
  customLaunchChainForRouterV1,
  prepareCustomLaunchWalletActionForAuthorizationSchema,
  prepareCustomLaunchWalletActionV1,
} from "../lib/custom-launch/wallet-handoff-v1";
import {
  customLaunchWalletTransactionPreimageHashV2,
  prepareCustomLaunchWalletActionV2,
} from "../lib/custom-launch/wallet-handoff-v2";
import { CANONICAL_LAUNCH_STAMP_V1 } from "../lib/tokens";
import { BASE_CUSTOM_ROOTS_V1 } from "../lib/custom-launch/base-release-v1";
import { ELYSIUM_CUSTOM_ROOTS_V1 } from "../lib/custom-launch/elysium-release-v1";

const CONTROLLER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const HOOK = "0x4444444444444444444444444444444444444444" as const;
const CURRENCY_0 = "0x0000000000000000000000000000000000000000" as const;
const CURRENCY_1 = "0x5555555555555555555555555555555555555555" as const;
const BYTES_32 = `0x${"11".repeat(32)}` as const;
const VALUE_WEI = "17";
const VALID_AFTER = "1";
const DEADLINE = "4102444800";
const parameters = parseAbiParameters(
  "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes",
);

function calldata(input: Readonly<{
  chainId?: bigint;
  controller?: `0x${string}`;
  router?: `0x${string}`;
  signature?: `0x${string}`;
  value?: bigint;
  validAfter?: bigint;
  deadline?: bigint;
}> = {}) {
  const encoded = encodeAbiParameters(parameters, [
    [
      input.chainId ?? 1n,
      input.router ?? CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      input.controller ?? CONTROLLER,
      1,
      BYTES_32,
      BYTES_32,
      BYTES_32,
      BYTES_32,
      input.validAfter ?? BigInt(VALID_AFTER),
      input.deadline ?? BigInt(DEADLINE),
      input.value ?? BigInt(VALUE_WEI),
    ],
    [
      BYTES_32,
      TOKEN,
      BYTES_32,
      [CURRENCY_0, CURRENCY_1, 3_000, 60, HOOK],
      BYTES_32,
      [[0, TOKEN, BYTES_32, 0, 1]],
    ],
    "0x1234",
    input.signature ?? "0xabcd",
  ]);
  return `${CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1}${encoded.slice(2)}`;
}

it("binds shared Base and Elysium router addresses to the explicit encoded chain", () => {
  const router = BASE_CUSTOM_ROOTS_V1.router;
  expect(router).toBe(ELYSIUM_CUSTOM_ROOTS_V1.router);
  expect(customLaunchChainForRouterV1(router)).toBeUndefined();
  for (const chainId of ["8453", "99901"] as const) {
    const action = { chainId, from: CONTROLLER, to: router, valueWei: VALUE_WEI,
      value: "0x11", data: calldata({ chainId: BigInt(chainId), router }) };
    expect(assertCustomLaunchWalletActionV1(action, CONTROLLER).chainId).toBe(chainId);
    expect(() => assertCustomLaunchWalletActionV1({ ...action,
      chainId: chainId === "8453" ? "99901" : "8453" }, CONTROLLER)).toThrow();
  }
});

function output(input: Readonly<{
  schemaVersion?:
    | "programmable.custom-launch-authorization-result.v1"
    | "programmable.custom-launch-authorization-result.v2";
  validAfter?: string;
  deadline?: string;
}> = {}) {
  const validAfter = input.validAfter ?? VALID_AFTER;
  const deadline = input.deadline ?? DEADLINE;
  const transaction = {
    schemaVersion: "programmable.custom-launch-wallet-transaction.v1",
    chainId: "1",
    from: CONTROLLER,
    to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
    valueWei: VALUE_WEI,
    functionName: "launchAndStampV1",
    selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
    calldata: calldata({
      validAfter: BigInt(validAfter),
      deadline: BigInt(deadline),
    }),
    signatureState: "permit-authority-signature-attached",
    requiresControllerWalletSignature: true,
    broadcastByService: false,
  };
  return {
    schemaVersion: input.schemaVersion ??
      "programmable.custom-launch-authorization-result.v1",
    artifact: {
      permit: {
        chainId: "1",
        router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
        launchWallet: CONTROLLER,
        kind: 1,
        routePayloadHash: BYTES_32,
        expectedResultHash: BYTES_32,
        stampRequestHash: BYTES_32,
        nonce: BYTES_32,
        validAfter,
        deadline,
        valueWei: VALUE_WEI,
      },
      permitDigest: BYTES_32,
      artifactHash: `sha256:${"22".repeat(32)}`,
      unsignedRouterTransaction: {
        chainId: "1",
        from: CONTROLLER,
        to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
        valueWei: VALUE_WEI,
        functionName: "launchAndStampV1",
        selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
        calldataWithEmptySignature: calldata({
          signature: "0x",
          validAfter: BigInt(validAfter),
          deadline: BigInt(deadline),
        }),
        signatureState: "permit-authority-signature-required",
      },
    },
    signedPermit: {
      schemaVersion: "programmable.signed-prepared-launch-permit.v1",
      chainId: "1",
      router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      artifactHash: `sha256:${"22".repeat(32)}`,
      permitDigest: BYTES_32,
      signature: "0xabcd",
      validAfter,
      deadline,
    },
    observationWindow: {
      schemaVersion: "programmable.custom-launch-observation-window.v1",
      chainId: "1",
      router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
    },
    walletTransaction: transaction,
  };
}

describe("Custom Launch wallet handoff V1", () => {
  it("binds the canonical Router and returns one exact Mainnet wallet action", () => {
    expect(CUSTOM_LAUNCH_MAINNET_ROUTER_V1).toBe(
      CANONICAL_LAUNCH_STAMP_V1.routerAddress,
    );
    expect(prepareCustomLaunchWalletActionV1(output(), CONTROLLER)).toEqual({
      chainId: "1",
      from: CONTROLLER,
      to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      data: calldata(),
      value: "0x11",
      valueWei: VALUE_WEI,
    });
  });

  it("fails closed on controller, Router, value, selector and response drift", () => {
    const cases = [
      () => {
        const value = output();
        value.walletTransaction.chainId = "10";
        return value;
      },
      () => {
        const value = output();
        Object.assign(value.walletTransaction, { from: OTHER });
        return value;
      },
      () => {
        const value = output();
        Object.assign(value.walletTransaction, { to: OTHER });
        return value;
      },
      () => {
        const value = output();
        value.artifact.permit.valueWei = "18";
        return value;
      },
      () => {
        const value = output();
        Object.assign(value.walletTransaction, { selector: "0x00000000" });
        return value;
      },
      () => {
        const value = output();
        value.walletTransaction.calldata = calldata({ chainId: 10n });
        return value;
      },
      () => {
        const value = output();
        value.walletTransaction.broadcastByService = true;
        return value;
      },
      () => ({
        ...output(),
        walletTransaction: {
          ...output().walletTransaction,
          internalSigner: "must-not-be-trusted",
        },
      }),
    ];

    for (const candidate of cases) {
      expect(() => prepareCustomLaunchWalletActionV1(candidate(), CONTROLLER))
        .toThrow("failed the wallet safety checks");
    }
  });

  it("does not open the wallet outside a live permit window", () => {
    expect(() => prepareCustomLaunchWalletActionV1(
      output({ deadline: "2" }),
      CONTROLLER,
    )).toThrow("failed the wallet safety checks");
    expect(() => prepareCustomLaunchWalletActionV1(
      output({ validAfter: "4102444800", deadline: "4102444900" }),
      CONTROLLER,
    )).toThrow("failed the wallet safety checks");
  });
});

describe("Custom Launch wallet handoff V2", () => {
  const profileHash = `sha256:${"66".repeat(32)}`;

  function simulatedOutput() {
    const value = {
      ...output({
        schemaVersion: "programmable.custom-launch-authorization-result.v2",
      }),
      launchProfileHash: profileHash,
      launchIntentHash: `sha256:${"67".repeat(32)}`,
      launchProfileSelection: {
        schemaVersion: "programmable.launch-profile-selection.v2",
      },
      agentAttestation: {
        schemaVersion: "programmable.agent-launch-attestation.v2",
      },
      onchain: null,
    };
    const action = prepareCustomLaunchWalletActionForAuthorizationSchema(
      value,
      CONTROLLER,
      "programmable.custom-launch-authorization-result.v2",
    );
    return {
      ...value,
      simulation: {
        outcome: "passed",
        transactionPreimageHash:
          customLaunchWalletTransactionPreimageHashV2(action),
        profileHash,
        blockNumber: "25720000",
        blockHash: `0x${"77".repeat(32)}`,
        responseDigest: `sha256:${"88".repeat(32)}`,
        gasEstimate: "500000",
      },
    };
  }

  function authorizedResourceV2() {
    return {
      schemaVersion: "programmable.custom-launch.v2",
      launchId: "50000000-0000-4000-8000-000000000005",
      requestId: "50000000-0000-4000-8000-000000000005",
      onchainLaunchId: null,
      routeId: "custom-launch:create:v2",
      ownerWallet: CONTROLLER,
      status: "authorized",
      requestHash: `sha256:${"65".repeat(32)}`,
      launchProfileHash: profileHash,
      launchIntentHash: `sha256:${"67".repeat(32)}`,
      createdAt: "2026-08-25T12:00:00.000Z",
      updatedAt: "2026-08-25T12:00:01.000Z",
      output: simulatedOutput(),
      failure: null,
    } as const;
  }

  it("accepts a real backend-shaped V2 resource with pinned simulation", () => {
    const resource = authorizedResourceV2();
    expect(prepareCustomLaunchWalletActionV2(
      resource.output,
      CONTROLLER,
      resource.launchProfileHash,
    )).toEqual(prepareCustomLaunchWalletActionV1(output(), CONTROLLER));
  });

  it("matches the backend transaction-preimage known vector", () => {
    expect(customLaunchWalletTransactionPreimageHashV2({
      chainId: "1",
      from: CONTROLLER,
      to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      data: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
      value: "0x0",
      valueWei: "0",
    })).toBe(
      "sha256:4854a6e16b1d8137e8eb3663951b2107c0571b894072245751203f03caf60070",
    );
  });

  it("keeps V1 and V2 authorization envelopes route-exact", () => {
    expect(() => prepareCustomLaunchWalletActionV2(
      output(),
      CONTROLLER,
      profileHash,
    )).toThrow("failed the wallet safety checks");
    expect(() => prepareCustomLaunchWalletActionV1(
      simulatedOutput(),
      CONTROLLER,
    )).toThrow("failed the wallet safety checks");
  });

  it("fails closed on transaction-preimage, profile or simulation drift", () => {
    const cases = [
      () => ({
        ...simulatedOutput(),
        simulation: {
          ...simulatedOutput().simulation,
          transactionPreimageHash: `sha256:${"99".repeat(32)}`,
        },
      }),
      () => ({
        ...simulatedOutput(),
        simulation: {
          ...simulatedOutput().simulation,
          profileHash: `sha256:${"aa".repeat(32)}`,
        },
      }),
      () => ({
        ...simulatedOutput(),
        simulation: {
          ...simulatedOutput().simulation,
          blockNumber: "0",
        },
      }),
      () => ({
        ...simulatedOutput(),
        simulation: {
          ...simulatedOutput().simulation,
          gasEstimate: "0",
        },
      }),
    ];

    for (const candidate of cases) {
      expect(() => prepareCustomLaunchWalletActionV2(
        candidate(),
        CONTROLLER,
        profileHash,
      )).toThrow("failed the wallet safety checks");
    }
  });
});
