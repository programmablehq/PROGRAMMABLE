import "server-only";

import {
  HttpRequestError,
  RpcRequestError,
  SocketClosedError,
  TimeoutError,
} from "viem";

import type { MainnetRpcProviderId, OnchainDeployment } from "./types";

const CAPACITY_MESSAGE =
  /(?:monthly[_\s-]*capacity[_\s-]*(?:exceeded|reached)|capacity[_\s-]*(?:exceeded|reached)|rate[_\s-]*limit(?:ed)?|too many requests|request timeout on the free plan,? please upgrade to (?:a )?paid plan)/iu;
const ARCHIVE_LIMITATION_MESSAGE =
  /archive requests require a personal token/iu;
const PROVIDER_ROUTING_UNAVAILABLE_MESSAGE =
  /can't route your request to suitable provider/iu;

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

function containsRpcEndpointError(error: unknown) {
  return errorChain(error).some(
    (candidate) =>
      candidate instanceof HttpRequestError ||
      candidate instanceof RpcRequestError ||
      candidate instanceof SocketClosedError ||
      candidate instanceof TimeoutError,
  );
}

function rpcCapacityMessage(error: RpcRequestError) {
  const details = [
    error.message,
    error.details,
    typeof error.data === "string" ? error.data : undefined,
    error.cause instanceof Error ? error.cause.message : undefined,
  ].filter((value): value is string => Boolean(value));
  return details.some((value) => CAPACITY_MESSAGE.test(value));
}

function isCapacityRejection(error: unknown) {
  return errorChain(error).some((candidate) =>
    candidate instanceof HttpRequestError && candidate.status === 429 ||
    candidate instanceof RpcRequestError && (
      candidate.code === 429 || candidate.code === -32_005 ||
      rpcCapacityMessage(candidate)
    ),
  );
}

function rpcArchiveLimitationMessage(error: RpcRequestError) {
  const details = [
    error.details,
    typeof error.data === "string" ? error.data : undefined,
    error.cause instanceof Error ? error.cause.message : undefined,
  ].filter((value): value is string => Boolean(value));
  return details.some((value) => ARCHIVE_LIMITATION_MESSAGE.test(value));
}

function rpcProviderRoutingUnavailable(error: RpcRequestError) {
  const details = [
    error.details,
    typeof error.data === "string" ? error.data : undefined,
    error.cause instanceof Error ? error.cause.message : undefined,
  ].filter((value): value is string => Boolean(value));
  return error.code === 12 && details.some(
    (value) => PROVIDER_ROUTING_UNAVAILABLE_MESSAGE.test(value),
  );
}

/**
 * Provider failover is intentionally narrower than a generic retry. A
 * secondary RPC is eligible only when the primary transport is unavailable or
 * explicitly rejects capacity. Other failures stay on the primary path;
 * provider-independent integrity errors remain intact while endpoint-bearing
 * viem errors are redacted before they reach framework logging.
 */
export function isOperationalRpcFailoverEligible(
  error: unknown,
  provider?: MainnetRpcProviderId,
) {
  return errorChain(error).some((candidate) => {
    if (candidate instanceof OperationalRpcUnavailableError) return true;
    if (
      candidate instanceof TimeoutError ||
      candidate instanceof SocketClosedError
    ) {
      return true;
    }
    if (candidate instanceof HttpRequestError) {
      return (
        candidate.status === undefined ||
        candidate.status === 408 ||
        candidate.status === 429 ||
        candidate.status >= 500
      );
    }
    if (candidate instanceof RpcRequestError) {
      return (
        (provider === "drpc" && candidate.code === 10) ||
        candidate.code === 429 ||
        candidate.code === -32_005 ||
        rpcCapacityMessage(candidate) ||
        rpcArchiveLimitationMessage(candidate) ||
        rpcProviderRoutingUnavailable(candidate)
      );
    }
    return false;
  });
}

function singleRpcDeployment<Deployment extends OnchainDeployment>(
  deployment: Deployment,
  rpcUrl: string,
): Deployment {
  return {
    ...deployment,
    rpcUrl,
    rpcUrlSecondary: null,
  } as Deployment;
}

export class OperationalRpcUnavailableError extends Error {
  override name = "OperationalRpcUnavailableError";

  constructor() {
    super("Operational RPC reads are temporarily unavailable");
  }
}

export class OperationalRpcReadError extends Error {
  override name = "OperationalRpcReadError";
  readonly role: "primary" | "secondary";
  readonly reason: string;

  constructor(
    role: "primary" | "secondary",
    reason: string,
  ) {
    super("Operational RPC read failed");
    this.role = role;
    this.reason = reason;
  }
}

function safeRpcFailureReason(error: unknown) {
  for (const candidate of errorChain(error)) {
    if (candidate instanceof HttpRequestError) {
      return candidate.status === undefined
        ? "http-network"
        : `http-${candidate.status}`;
    }
    if (candidate instanceof RpcRequestError) {
      return `rpc-${candidate.code}`;
    }
    if (candidate instanceof TimeoutError) return "transport-timeout";
    if (candidate instanceof SocketClosedError) return "socket-closed";
  }
  return "endpoint-error";
}

function redactRpcEndpointError(
  error: unknown,
  role: "primary" | "secondary",
) {
  return containsRpcEndpointError(error)
    ? new OperationalRpcReadError(role, safeRpcFailureReason(error))
    : error;
}

export function createOperationalRpcFailover(now = Date.now) {
  type Cooldown = { failures: number; retryAt: number; probing: boolean };
  // Shared by readers in this runtime. Store no responses, request bodies or
  // errors, and never export endpoint keys in logs or status responses.
  const cooldowns = new Map<string, Cooldown>();

  async function attempt<Deployment extends OnchainDeployment, Output>(
    deployment: Deployment,
    read: (deployment: Deployment) => Promise<Output>,
  ) {
    const endpoint = deployment.rpcUrl;
    const previous = cooldowns.get(endpoint);
    if (previous && (previous.retryAt > now() || previous.probing)) {
      throw new OperationalRpcUnavailableError();
    }
    if (previous) previous.probing = true;
    try {
      const result = await read(deployment);
      // A request started before a capacity rejection cannot clear a newer
      // cooldown. Only its single recovery probe may reopen that endpoint.
      if (previous && cooldowns.get(endpoint) === previous) cooldowns.delete(endpoint);
      return result;
    } catch (error) {
      if (isCapacityRejection(error)) {
        const current = cooldowns.get(endpoint);
        // Concurrent first failures belong to one outage, not multiple failed
        // recovery attempts. They must not extend the backoff independently.
        if (!current || current === previous) {
          const failures = Math.min((previous?.failures ?? 0) + 1, 5);
          cooldowns.delete(endpoint);
          cooldowns.set(endpoint, { failures, probing: false,
            retryAt: now() + Math.min(300_000, 30_000 * 2 ** (failures - 1)) });
          if (cooldowns.size > 64) cooldowns.delete(cooldowns.keys().next().value!);
        }
      } else if (previous && cooldowns.get(endpoint) === previous) {
        // Transport and integrity errors retain their existing behavior. Only
        // an explicit capacity rejection starts or extends this cooldown.
        cooldowns.delete(endpoint);
      }
      throw error;
    }
  }

  return async function withOperationalRpcFailover<
    Deployment extends OnchainDeployment,
    Output,
  >(
    deployment: Deployment,
    read: (deployment: Deployment) => Promise<Output>,
  ) {
    const primary = singleRpcDeployment(deployment, deployment.rpcUrl);
    const primaryProvider = deployment.rpcProviderIds?.primary;
    const secondaryProvider = deployment.rpcProviderIds?.secondary;
    try {
      return await attempt(primary, read);
    } catch (primaryError) {
      const secondaryUrl = deployment.rpcUrlSecondary;
      if (
        !secondaryUrl ||
        secondaryUrl === deployment.rpcUrl ||
        !isOperationalRpcFailoverEligible(primaryError, primaryProvider)
      ) {
        throw redactRpcEndpointError(primaryError, "primary");
      }

      try {
        return await attempt(singleRpcDeployment(deployment, secondaryUrl), read);
      } catch (secondaryError) {
        if (isOperationalRpcFailoverEligible(secondaryError, secondaryProvider)) {
          // Do not retain transport errors: framework cache logging serializes
          // nested causes and can otherwise expose authenticated RPC URLs.
          throw new OperationalRpcUnavailableError();
        }
        throw redactRpcEndpointError(secondaryError, "secondary");
      }
    }
  };
}

/**
 * Runs one complete read per eligible endpoint, retaining the configured
 * secondary and integrity checks. Capacity failures pause the endpoint for
 * 30 seconds to five minutes, then permit one recovery probe in this runtime.
 */
export const withOperationalRpcFailover = createOperationalRpcFailover();

/** Provider-neutral telemetry fields; endpoint URLs and request bodies stay out. */
export function safeOperationalRpcError(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  if (error instanceof OperationalRpcReadError) {
    return {
      name: error.name,
      category: "read-failed" as const,
      role: error.role,
      reason: error.reason,
    };
  }
  return {
    name: error.name,
    category: isOperationalRpcFailoverEligible(error)
      ? "rpc-unavailable"
      : "read-failed",
  } as const;
}
