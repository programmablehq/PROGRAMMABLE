import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundationLaunchBalance, foundationLaunchBalanceError } from "@/lib/module-foundation/launch-balance";

afterEach(() => vi.useRealTimers());

describe("early launch funding feedback", () => {
  it("detects an empty wallet even without a first buy, leaving unknown and invalid inputs to the normal checks", () => {
    expect(foundationLaunchBalanceError(0n, "", "Ethereum")).toContain("Not enough ETH on Ethereum");
    expect(foundationLaunchBalanceError(0n, "0", "Robinhood Chain")).toContain("Robinhood Chain");
    expect(foundationLaunchBalanceError(undefined, "1", "Ethereum")).toBeUndefined();
    expect(foundationLaunchBalanceError(1n, "invalid", "Ethereum")).toBeUndefined();
    expect(foundationLaunchBalanceError(1n, "0", "Ethereum")).toBeUndefined();
    expect(foundationLaunchBalanceError(1_000_000_000_000_000_000n, "1", "Ethereum")).toContain("network fees");
    expect(foundationLaunchBalanceError(1_000_000_000_000_000_001n, "1", "Ethereum")).toBeUndefined();
  });

  it("coalesces display and launch reads, and refreshes a funded wallet after a deposit", async () => {
    const read = vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(10n);
    const balance = new FoundationLaunchBalance(read);
    const changed = vi.fn();
    const unsubscribe = balance.subscribe(changed);
    expect(await Promise.all([balance.read(), balance.read()])).toEqual([0n, 0n]);
    expect(await balance.read()).toBe(0n);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await balance.read(true)).toBe(10n);
    expect(balance.getSnapshot()).toBe(10n);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("never carries a wallet or chain balance into another reader and expires cached balances", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(10n).mockResolvedValueOnce(0n);
    const first = new FoundationLaunchBalance(read);
    expect(await first.read()).toBe(10n);
    expect(await new FoundationLaunchBalance(async () => 99n).read()).toBe(99n);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await first.read()).toBe(0n);
  });

  it("does not confuse an unavailable provider with an empty wallet or wait for its long timeout", async () => {
    vi.useFakeTimers();
    let finish: (value: bigint) => void = () => {};
    const read = vi.fn().mockImplementationOnce(() => new Promise<bigint>(resolve => { finish = resolve; })).mockResolvedValueOnce(20n);
    const balance = new FoundationLaunchBalance(read);
    const pending = balance.read();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBeUndefined();
    expect(await balance.read()).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    // An explicit launch retry can recover immediately; focus events cannot
    // start a second slow provider request after the display timeout.
    expect(await balance.read(true)).toBe(20n);
    finish(0n);
    await Promise.resolve();
    expect(await balance.read()).toBe(20n);
    expect(await new FoundationLaunchBalance(async () => { throw new Error("offline"); }).read()).toBeUndefined();
  });

  it("retries a failed background read after the cooldown", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(30n);
    const balance = new FoundationLaunchBalance(read);
    expect(await balance.read()).toBeUndefined();
    expect(await balance.read()).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await balance.read()).toBe(30n);
  });
});
