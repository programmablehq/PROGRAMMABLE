import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Hex } from "viem";
vi.mock("server-only", () => ({}));
vi.mock("../lib/custom-ai/step-recovery.server", () => ({ recoverStepHash: vi.fn() }));
import { recoverStepHash } from "../lib/custom-ai/step-recovery.server";
import { reconcileWalletStep } from "../lib/custom-ai/reconcile-step.server";
import { makeStep } from "../lib/custom-ai/transaction.server";
import type { CustomAIChain } from "../lib/custom-ai/chain.server";
import type { LaunchStep, WalletSession } from "../lib/custom-ai/launch-session";

const account = "0x1000000000000000000000000000000000000001";
const oldHash = `0x${"ab".repeat(32)}` as Hex, newHash = `0x${"cd".repeat(32)}` as Hex;
function step(overrides: Partial<LaunchStep> = {}): LaunchStep {
  return { id: "first", kind: "launch", state: "submitted", hash: oldHash, dispatchedAt: 100,
    expiresAt: 120, preparedBlock: "100", transaction: { from: account, to: account, data: "0x12", value: "0x0", gas: "0x10000", chainId: 1, nonce: "0x4" }, ...overrides };
}
function setup(steps = [step()], data: Hex = "0x12") {
  const session: WalletSession = { id: "request", account, chainId: 1, state: "waiting", steps };
  const chain = { block: { number: "500" }, agreed: vi.fn(async (_m: string, _a: unknown[], parse: (v: unknown) => unknown) =>
    parse({ hash: newHash, from: account, to: account, input: data, value: "0x0", chainId: "0x1", nonce: "0x4" })) } as unknown as CustomAIChain;
  return { session, chain };
}
beforeEach(() => vi.mocked(recoverStepHash).mockReset());
describe("wallet nonce reconciliation", () => {
  it("adopts a speed-up hash only for the same saved transaction", async () => {
    vi.mocked(recoverStepHash).mockResolvedValue(newHash);
    const { session, chain } = setup();
    expect(await reconcileWalletStep(chain, session)).toBe(true);
    expect(session.steps[0]).toMatchObject({ hash: newHash, replacedHashes: [oldHash], state: "submitted" });
    expect(session.state).toBe("waiting");
  });
  it("resolves cancellation or unrelated replacement as failure, never success", async () => {
    vi.mocked(recoverStepHash).mockResolvedValue(newHash);
    const { session, chain } = setup(undefined, "0x");
    await reconcileWalletStep(chain, session);
    expect(session).toMatchObject({ state: "failed", steps: [{ state: "failed", failureReason: "replaced", hash: newHash }] });
  });
  it("recovers the earlier request if it won the replacement race", async () => {
    vi.mocked(recoverStepHash).mockResolvedValue(newHash);
    const original = step({ state: "rejected" });
    const replacement = step({ id: "replacement", state: "prepared", hash: undefined, dispatchedAt: undefined,
      preparedBlock: "400", transaction: { ...original.transaction, data: "0x34" } });
    const { session, chain } = setup([original, replacement]);
    await reconcileWalletStep(chain, session);
    expect(recoverStepHash).toHaveBeenCalledWith(chain, expect.objectContaining({ preparedBlock: "100" }));
    expect(session.steps[1].state).toBe("rejected");
    expect(session.steps[2]).toMatchObject({ hash: newHash, state: "submitted", transaction: original.transaction });
    expect(session.steps[2].id).not.toBe(original.id);
  });
  it("retains a lost dispatch without inventing a send or completion", async () => {
    vi.mocked(recoverStepHash).mockResolvedValue(undefined);
    const { session, chain } = setup([step({ state: "dispatching", hash: undefined })]);
    const before = structuredClone(session);
    expect(await reconcileWalletStep(chain, session)).toBe(false);
    expect(session).toEqual(before);
    expect(chain.agreed).not.toHaveBeenCalled();
  });
  it("does not repeatedly change a reconciled hash", async () => {
    vi.mocked(recoverStepHash).mockResolvedValue(newHash);
    const { session, chain } = setup([step({ hash: newHash })]);
    expect(await reconcileWalletStep(chain, session)).toBe(false);
  });
  it("will not issue a fresh nonce while any earlier same-nonce dispatch remains unresolved", async () => {
    const first = step({ state: "rejected" });
    const { session } = setup([first, step({ id: "replacement", state: "prepared", hash: undefined, dispatchedAt: undefined })]);
    const estimate = vi.fn();
    const chain = { chainId: 1, agreed: vi.fn(async () => "5"), rpcs: [estimate] } as unknown as CustomAIChain;
    await expect(makeStep(chain, session, "launch", account, "0x12")).rejects.toThrow("confirming");
    expect(estimate).not.toHaveBeenCalled();
  });
});
