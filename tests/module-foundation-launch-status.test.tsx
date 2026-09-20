import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FoundationSessionStatus, type useFoundationSession } from "@/components/module-foundation-session";
import type { FoundationResolution } from "@/lib/module-foundation/result-store";

vi.mock("@/components/wallet-provider", () => ({ useWallet: vi.fn() }));

type Session = ReturnType<typeof useFoundationSession>;
const hash = `0x${"11".repeat(32)}` as const;
const resolution: FoundationResolution = { schemaVersion: "programmable.foundation.resolution.v1",
  account: "0x1000000000000000000000000000000000000000", operationId: "11111111-1111-4111-8111-111111111111",
  releaseDigest: hash, calldataHash: hash, to: "0x2000000000000000000000000000000000000000", value: "0x0",
  nonce: 1, startBlock: "68060539", createdAt: 1, resolvedAt: 2, status: "success", blockNumber: "68060540", blockHash: hash,
  transactionHash: hash, metadata: { operationKind: "launch", stepKind: "launch", token: "0x2CCE608219d32eA1Eb6c7EA4d04a0eACd1F08da9" } };
const session = { pending: "null", resolution, resolutionState: JSON.stringify(resolution), progress: "" } as Session;

function render(overrides: Partial<Session> = {}) {
  return renderToStaticMarkup(<FoundationSessionStatus session={{ ...session, ...overrides }} hideSuccessfulLaunch hideSuccessfulTrade />);
}

describe("compact completed-launch status", () => {
  it("omits the completed launch block without acknowledging or clearing its record", () => {
    const acknowledgeResult = vi.fn();
    expect(render({ acknowledgeResult })).toBe("");
    expect(acknowledgeResult).not.toHaveBeenCalled();
    expect(session.resolution).toBe(resolution);
  });

  it("omits completed trades when their inline market result is already shown", () => {
    for (const stepKind of ["buy", "sell"] as const) {
      expect(render({ resolution: { ...resolution, metadata: { operationKind: "trade", stepKind } } })).toBe("");
    }
  });

  it("keeps unresolved recovery visible even beside a successful saved launch", () => {
    const html = render({ pending: "unreadable" });
    expect(html).toContain("Check your previous transaction");
    expect(html).toContain("Check exact transaction");
    expect(html).toContain("Your transaction is confirmed");
  });

  it("keeps reverted, intermediate and unreadable operations visible", () => {
    expect(render({ resolution: { ...resolution, status: "reverted" } })).toContain("Your transaction reverted");
    for (const stepKind of ["approve", "wrap"] as const) {
      expect(render({ resolution: { ...resolution, metadata: { operationKind: "launch", stepKind } } })).toContain("Your transaction is confirmed");
    }
    expect(render({ resolution: null, resolutionState: "unreadable" })).toContain("saved transaction result could not be read");
  });

  it("preserves active wallet progress", () => {
    expect(render({ progress: "Waiting for confirmation…" })).toContain("Waiting for confirmation…");
  });
});
