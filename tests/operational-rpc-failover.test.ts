import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  isOperationalRpcFailoverEligible,
  createOperationalRpcFailover,
  OperationalRpcReadError,
  OperationalRpcUnavailableError,
  safeOperationalRpcError,
} from "../lib/onchain/operational-rpc-failover.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example/rpc-key",
  rpcUrlSecondary: "https://secondary.example/rpc-key",
  rpcProviderIds: { primary: "drpc", secondary: "quicknode" },
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

function httpFailure(status: number | undefined, url = deployment.rpcUrl) {
  return new HttpRequestError({
    status,
    url,
    body: { method: "eth_blockNumber" },
  });
}

function rpcFailure(
  message: string,
  code = -32_000,
  url = deployment.rpcUrl,
) {
  return new RpcRequestError({
    body: { method: "eth_blockNumber" },
    error: { code, message },
    url,
  });
}

describe("operational RPC failover", () => {
  let now = 0;
  let withOperationalRpcFailover = createOperationalRpcFailover(() => now);
  beforeEach(() => {
    now = 0;
    withOperationalRpcFailover = createOperationalRpcFailover(() => now);
  });

  it("keeps a healthy primary read byte-for-byte and never calls secondary", async () => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => ({
      blockNumber: "25725412",
      blockHash: `0x${"ab".repeat(32)}`,
      endpoint: candidate.rpcUrl,
      secondary: candidate.rpcUrlSecondary,
    }));

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).resolves.toEqual({
      blockNumber: "25725412",
      blockHash: `0x${"ab".repeat(32)}`,
      endpoint: deployment.rpcUrl,
      secondary: null,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("uses the fixed secondary once after primary HTTP 429", async () => {
    const calls: string[] = [];
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      calls.push(candidate.rpcUrl);
      if (candidate.rpcUrl === deployment.rpcUrl) throw httpFailure(429);
      return "secondary-ready";
    });

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).resolves.toBe("secondary-ready");
    expect(calls).toEqual([
      deployment.rpcUrl,
      deployment.rpcUrlSecondary,
    ]);
  });

  it("recognizes explicit monthly capacity and transport timeouts", () => {
    expect(
      isOperationalRpcFailoverEligible(
        rpcFailure("monthly_capacity_exceeded"),
      ),
    ).toBe(true);
    expect(
      isOperationalRpcFailoverEligible(
        new TimeoutError({
          body: { method: "eth_getLogs" },
          url: deployment.rpcUrl,
        }),
      ),
    ).toBe(true);
  });

  it("uses the fixed secondary after the bound dRPC free-plan timeout", async () => {
    const calls: string[] = [];
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      calls.push(candidate.rpcUrl);
      if (candidate.rpcUrl === deployment.rpcUrl) {
        throw rpcFailure(
          "Request timeout on the free plan, please upgrade to paid plan",
        );
      }
      return "secondary-ready";
    });

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).resolves.toBe("secondary-ready");
    expect(calls).toEqual([
      deployment.rpcUrl,
      deployment.rpcUrlSecondary,
    ]);
  });

  it("uses the fixed secondary after dRPC returns its code 10 timeout", async () => {
    const calls: string[] = [];
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      calls.push(candidate.rpcUrl);
      if (candidate.rpcUrl === deployment.rpcUrl) {
        throw rpcFailure("provider timeout", 10);
      }
      return "secondary-ready";
    });

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).resolves.toBe("secondary-ready");
    expect(calls).toEqual([
      deployment.rpcUrl,
      deployment.rpcUrlSecondary,
    ]);
    expect(
      isOperationalRpcFailoverEligible(rpcFailure("provider timeout", 10)),
    ).toBe(false);
  });

  it("uses the fixed secondary after an exact archive-read limitation", async () => {
    const calls: string[] = [];
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      calls.push(candidate.rpcUrl);
      if (candidate.rpcUrl === deployment.rpcUrl) {
        throw rpcFailure(
          "Archive requests require a personal token. Get one at: https://provider.example",
          -32602,
        );
      }
      return "secondary-archive-ready";
    });

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).resolves.toBe("secondary-archive-ready");
    expect(calls).toEqual([
      deployment.rpcUrl,
      deployment.rpcUrlSecondary,
    ]);
  });

  it("uses the fixed secondary after dRPC reports code 12 routing unavailability", async () => {
    const calls: string[] = [];
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      calls.push(candidate.rpcUrl);
      if (candidate.rpcUrl === deployment.rpcUrl) {
        throw rpcFailure(
          "Can't route your request to suitable provider, if you specified certain providers revise the list",
          12,
        );
      }
      return "secondary-ready";
    });

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).resolves.toBe("secondary-ready");
    expect(calls).toEqual([
      deployment.rpcUrl,
      deployment.rpcUrlSecondary,
    ]);
  });

  it.each([
    [httpFailure(400), "http-400"],
    [rpcFailure("execution reverted"), "rpc--32000"],
    [rpcFailure("Invalid parameters were provided", -32602), "rpc--32602"],
  ])("redacts a non-failover RPC error without rotating providers", async (
    error,
    reason,
  ) => {
    const read = vi.fn(async () => {
      throw error;
    });

    const received = await withOperationalRpcFailover(deployment, read).catch(
      (candidate) => candidate,
    );
    expect(received).toBeInstanceOf(OperationalRpcReadError);
    expect(safeOperationalRpcError(received)).toEqual({
      name: "OperationalRpcReadError",
      category: "read-failed",
      role: "primary",
      reason,
    });
    expect(JSON.stringify(received)).not.toContain("primary.example");
    expect(JSON.stringify(received)).not.toContain("eth_blockNumber");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("preserves a provider-independent integrity error without rotating", async () => {
    const error = new Error("Pool identity mismatch");
    const read = vi.fn(async () => {
      throw error;
    });

    await expect(
      withOperationalRpcFailover(deployment, read),
    ).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("emits only a provider-neutral role and RPC code after secondary failure", async () => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      if (candidate.rpcUrl === deployment.rpcUrl) {
        throw rpcFailure(
          "Request timeout on the free plan, please upgrade to paid plan",
        );
      }
      throw rpcFailure("provider-specific failure", -32_001, candidate.rpcUrl);
    });

    const error = await withOperationalRpcFailover(deployment, read).catch(
      (candidate) => candidate,
    );
    expect(safeOperationalRpcError(error)).toEqual({
      name: "OperationalRpcReadError",
      category: "read-failed",
      role: "secondary",
      reason: "rpc--32001",
    });
    expect(JSON.stringify(error)).not.toContain("primary.example");
    expect(JSON.stringify(error)).not.toContain("secondary.example");
    expect(JSON.stringify(error)).not.toContain("provider-specific");
  });

  it("returns one safe unavailable error when both configured RPCs fail", async () => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      throw httpFailure(
        candidate.rpcUrl === deployment.rpcUrl ? 429 : 503,
        candidate.rpcUrl,
      );
    });

    const promise = withOperationalRpcFailover(deployment, read);
    await expect(promise).rejects.toBeInstanceOf(
      OperationalRpcUnavailableError,
    );
    await expect(promise).rejects.toThrow(
      "Operational RPC reads are temporarily unavailable",
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("redacts a code 12 routing failure from the fixed secondary", async () => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      throw rpcFailure(
        "Can't route your request to suitable provider, if you specified certain providers revise the list",
        12,
        candidate.rpcUrl,
      );
    });

    const error = await withOperationalRpcFailover(deployment, read).catch(
      (candidate) => candidate,
    );
    expect(error).toBeInstanceOf(OperationalRpcUnavailableError);
    expect(JSON.stringify(error)).not.toContain("primary.example");
    expect(JSON.stringify(error)).not.toContain("secondary.example");
    expect(JSON.stringify(error)).not.toContain("eth_blockNumber");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not retain provider URLs or request bodies in the public error chain", async () => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      throw httpFailure(429, candidate.rpcUrl);
    });

    const error = await withOperationalRpcFailover(deployment, read).catch(
      (candidate) => candidate,
    );
    expect(error).toBeInstanceOf(OperationalRpcUnavailableError);
    expect(JSON.stringify(error)).not.toContain("primary.example");
    expect(JSON.stringify(error)).not.toContain("secondary.example");
    expect(JSON.stringify(error)).not.toContain("eth_blockNumber");
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(safeOperationalRpcError(error)).toEqual({
      name: "OperationalRpcUnavailableError",
      category: "rpc-unavailable",
    });
  });

  it("keeps endpoint URLs and request bodies out of telemetry", () => {
    const summary = JSON.stringify(
      safeOperationalRpcError(httpFailure(429)),
    );

    expect(summary).toBe(
      '{"name":"HttpRequestError","category":"rpc-unavailable"}',
    );
    expect(summary).not.toContain("primary.example");
    expect(summary).not.toContain("eth_blockNumber");
  });

  it("skips a rate-limited primary while serving fresh secondary reads", async () => {
    const calls: string[] = [];
    let observation = 0;
    const read = async (candidate: ReadyOnchainDeployment) => {
      calls.push(candidate.rpcUrl);
      if (candidate.rpcUrl === deployment.rpcUrl) throw httpFailure(429);
      return ++observation;
    };
    await expect(withOperationalRpcFailover(deployment, read)).resolves.toBe(1);
    now = 29_999;
    await expect(withOperationalRpcFailover(deployment, read)).resolves.toBe(2);
    expect(calls).toEqual([deployment.rpcUrl, deployment.rpcUrlSecondary, deployment.rpcUrlSecondary]);
  });

  it("permits one recovery probe and increases the delay after another rejection", async () => {
    const firstRead = async (candidate: ReadyOnchainDeployment) => {
      if (candidate.rpcUrl === deployment.rpcUrl) throw httpFailure(429);
      return "secondary";
    };
    await withOperationalRpcFailover(deployment, firstRead);
    now = 30_000;
    let rejectProbe!: (error: Error) => void;
    const probe = new Promise<string>((_resolve, reject) => { rejectProbe = reject; });
    const read = vi.fn((candidate: ReadyOnchainDeployment) =>
      candidate.rpcUrl === deployment.rpcUrl ? probe : Promise.resolve("secondary"));
    const recovering = withOperationalRpcFailover(deployment, read);
    await expect(withOperationalRpcFailover(deployment, read)).resolves.toBe("secondary");
    expect(read.mock.calls.filter(([candidate]) => candidate.rpcUrl === deployment.rpcUrl)).toHaveLength(1);
    rejectProbe(httpFailure(429));
    await expect(recovering).resolves.toBe("secondary");
    now = 89_999;
    await withOperationalRpcFailover(deployment, read);
    expect(read.mock.calls.filter(([candidate]) => candidate.rpcUrl === deployment.rpcUrl)).toHaveLength(1);
    now = 90_000;
    const healthy = vi.fn(async () => "recovered");
    await expect(withOperationalRpcFailover(deployment, healthy)).resolves.toBe("recovered");
    await withOperationalRpcFailover(deployment, healthy);
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it("caps repeated capacity failures at five minutes without polling in between", async () => {
    const read = vi.fn(async () => { throw rpcFailure("monthly_capacity_exceeded"); });
    const primaryOnly = { ...deployment, rpcUrlSecondary: null };
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const before = read.mock.calls.length;
      await expect(withOperationalRpcFailover(primaryOnly, read)).rejects.toBeInstanceOf(OperationalRpcReadError);
      expect(read).toHaveBeenCalledTimes(before + 1);
      now += delay - 1;
      await expect(withOperationalRpcFailover(primaryOnly, read)).rejects.toBeInstanceOf(OperationalRpcUnavailableError);
      expect(read).toHaveBeenCalledTimes(before + 1);
      now++;
    }
  });

  it("pauses both rejected endpoints and leaves unrelated credentials usable", async () => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => { throw httpFailure(429, candidate.rpcUrl); });
    await expect(withOperationalRpcFailover(deployment, read)).rejects.toBeInstanceOf(OperationalRpcUnavailableError);
    await expect(withOperationalRpcFailover(deployment, read)).rejects.toBeInstanceOf(OperationalRpcUnavailableError);
    expect(read).toHaveBeenCalledTimes(2);
    const other = { ...deployment, rpcUrl: "https://primary.example/another-key" };
    const healthy = vi.fn(async () => "fresh");
    await expect(withOperationalRpcFailover(other, healthy)).resolves.toBe("fresh");
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it.each([503, 400])("does not pause an endpoint for HTTP %i", async (status) => {
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      if (candidate.rpcUrl === deployment.rpcUrl) throw httpFailure(status);
      return "secondary";
    });
    for (let i = 0; i < 2; i++) await withOperationalRpcFailover(deployment, read).catch(() => undefined);
    expect(read.mock.calls.filter(([candidate]) => candidate.rpcUrl === deployment.rpcUrl)).toHaveLength(2);
  });

  it("does not let an older successful request clear a newer capacity rejection", async () => {
    let finish!: (value: string) => void;
    const startedBeforeRejection = withOperationalRpcFailover(deployment, () =>
      new Promise<string>(resolve => { finish = resolve; }));
    const read = vi.fn(async (candidate: ReadyOnchainDeployment) => {
      if (candidate.rpcUrl === deployment.rpcUrl) throw httpFailure(429);
      return "secondary";
    });
    await withOperationalRpcFailover(deployment, read);
    finish("previous request");
    await startedBeforeRejection;
    await withOperationalRpcFailover(deployment, read);
    expect(read.mock.calls.filter(([candidate]) => candidate.rpcUrl === deployment.rpcUrl)).toHaveLength(1);
  });

  it("treats simultaneous first rejections as a single 30-second cooldown", async () => {
    const read = async (candidate: ReadyOnchainDeployment) => {
      if (candidate.rpcUrl === deployment.rpcUrl) throw httpFailure(429);
      return "secondary";
    };
    await Promise.all([withOperationalRpcFailover(deployment, read), withOperationalRpcFailover(deployment, read)]);
    now = 30_000;
    const recovered = vi.fn(async () => "primary");
    await expect(withOperationalRpcFailover(deployment, recovered)).resolves.toBe("primary");
    expect(recovered).toHaveBeenCalledTimes(1);
  });
});
