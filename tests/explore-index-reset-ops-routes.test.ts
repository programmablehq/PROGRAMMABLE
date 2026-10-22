import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as acknowledgeAlchemyWebhook } from
  "../app/api/alchemy/webhook/route";
import { GET as retireAlchemyLaunchRefresh } from
  "../app/api/ops/alchemy-launch-refresh/route";
import { GET as retireIndexV2 } from "../app/api/ops/index-v2/route";
import { GET as retireMarketProjector } from
  "../app/api/ops/market-projector/route";
import { GET as retireProjector } from "../app/api/ops/projector/route";
import { POST as acknowledgeProjectorWake } from
  "../app/api/ops/projector-wake/route";
import { POST as retirePerformanceCapture } from
  "../app/api/ops/read-model-performance-capture/route";
import {
  POST as retireRealBlockSlaCapture,
  PUT as retireRealBlockSlaRetryArm,
} from "../app/api/ops/read-model-real-block-sla/route";

const PROVIDER_ENVIRONMENT = Object.freeze({
  ALCHEMY_WEBHOOK_SIGNING_KEY: "a".repeat(64),
  BITQUERY_OAUTH_TOKEN: "b".repeat(64),
  CRON_SECRET: "c".repeat(64),
  GMGN_API_KEY: "g".repeat(64),
  GMGN_MAX_REQUESTS_PER_SECOND: "20",
  PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE: "true",
  PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN: "p".repeat(64),
  PROGRAMMABLE_PROJECTOR_ACTIVE: "true",
  PROGRAMMABLE_QUICKNODE_STREAM_SECRET: "q".repeat(64),
  PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE: "true",
});

function assertResetHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-programmable-indexing-status")).toBe(
    "reset",
  );
}

describe("displayed-coin indexing reset operations", () => {
  const network = vi.fn(() => {
    throw new Error("network access is forbidden during the indexing reset");
  });

  beforeEach(() => {
    network.mockClear();
    vi.stubGlobal("fetch", network);
    for (const [name, value] of Object.entries(PROVIDER_ENVIRONMENT)) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["index-v2", retireIndexV2],
    ["projector", retireProjector],
    ["market-projector", retireMarketProjector],
    ["alchemy-launch-refresh", retireAlchemyLaunchRefresh],
  ] as const)("retires the %s writer with an exact 410", async (
    operation,
    handler,
  ) => {
    const response = handler();

    expect(response.status).toBe(410);
    assertResetHeaders(response);
    await expect(response.json()).resolves.toEqual({
      status: "index_rebuilding",
      code: "indexing_reset",
      operation,
    });
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    [
      "performance capture",
      "read-model-performance-capture",
      retirePerformanceCapture,
    ],
    [
      "real-block SLA capture",
      "read-model-real-block-sla",
      retireRealBlockSlaCapture,
    ],
    [
      "real-block SLA retry arm",
      "read-model-real-block-sla",
      retireRealBlockSlaRetryArm,
    ],
  ] as const)("retires the manual %s capability with an exact 410", async (
    _label,
    operation,
    handler,
  ) => {
    const response = handler();

    expect(response.status).toBe(410);
    assertResetHeaders(response);
    await expect(response.json()).resolves.toEqual({
      status: "index_rebuilding",
      code: "indexing_reset",
      operation,
    });
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    ["projector-wake", acknowledgeProjectorWake],
    ["alchemy-webhook", acknowledgeAlchemyWebhook],
  ] as const)("acknowledges the paused %s trigger without redelivery", async (
    operation,
    handler,
  ) => {
    const response = handler();

    expect(response.status).toBe(200);
    assertResetHeaders(response);
    await expect(response.json()).resolves.toEqual({
      status: "paused",
      code: "indexing_reset",
      operation,
    });
    expect(network).not.toHaveBeenCalled();
  });

  it("allows the isolated Robinhood and Custom AI indexes alongside the independent production jobs", async () => {
    const config = JSON.parse(await readFile("vercel.json", "utf8")) as {
      crons?: ReadonlyArray<{ path: string; schedule: string }>;
    };

    expect(config.crons).toEqual([
      {
        path: "/api/ops/custom-ai-index",
        schedule: "* * * * *",
      },
      {
        path: "/api/ops/protocol-revenue",
        schedule: "* * * * *",
      },
      {
        path: "/api/ops/custom-launch/generic-v2-projector",
        schedule: "* * * * *",
      },
      {
        path: "/api/ops/robinhood-index",
        schedule: "* * * * *",
      },
    ]);
  });
});
