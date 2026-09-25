import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFoundationAvailability, unavailableFoundation } from "@/lib/module-foundation/availability";
import { loadFoundationSessionAvailability } from "@/components/module-foundation-session";
import { foundationV2Fixture } from "./module-foundation-v2-fixture";

vi.mock("@/components/wallet-provider", () => ({ useWallet: vi.fn() }));
vi.mock("@/lib/module-foundation/availability", async original => ({
  ...await original<typeof import("@/lib/module-foundation/availability")>(), fetchFoundationAvailability: vi.fn(),
}));

const token = "0x1111111111111111111111111111111111111111";
const unavailable = { ...unavailableFoundation(), token: token.toLowerCase() as typeof token };
const ready = { ...unavailable, available: true, reason: null, binding: foundationV2Fixture(false, true).binding };

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("initial coin authority propagation", () => {
  it("keeps waiting for a fresh token authority and retries after two seconds", async () => {
    vi.mocked(fetchFoundationAvailability).mockResolvedValueOnce(unavailable).mockResolvedValueOnce(ready);
    const controller = new AbortController(), loaded = vi.fn();
    const result = loadFoundationSessionAvailability(controller.signal, token).then(value => { loaded(value); return value; });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchFoundationAvailability).toHaveBeenCalledExactlyOnceWith(controller.signal, token);
    expect(loaded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(ready);
    expect(fetchFoundationAvailability).toHaveBeenCalledTimes(2);
  });

  it("stops after four unavailable responses without accepting an old authority", async () => {
    vi.mocked(fetchFoundationAvailability).mockResolvedValue(unavailable);
    const result = loadFoundationSessionAvailability(new AbortController().signal, token);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(result).resolves.toBe(unavailable);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFoundationAvailability).toHaveBeenCalledTimes(4);
  });

  it("retries failed reads with the same bound token and stops after the fourth failure", async () => {
    vi.mocked(fetchFoundationAvailability).mockRejectedValue(new Error("Temporary provider failure"));
    const controller = new AbortController();
    const result = expect(loadFoundationSessionAvailability(controller.signal, token)).rejects.toThrow("Temporary provider failure");
    await vi.advanceTimersByTimeAsync(6_000);
    await result;
    expect(fetchFoundationAvailability).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(fetchFoundationAvailability).mock.calls) expect(call).toEqual([controller.signal, token]);
  });

  it("cancels the retry delay when the coin changes or its page unmounts", async () => {
    vi.mocked(fetchFoundationAvailability).mockResolvedValue(unavailable);
    const controller = new AbortController();
    const result = expect(loadFoundationSessionAvailability(controller.signal, token)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFoundationAvailability).toHaveBeenCalledOnce();
  });

  it("ignores a late successful response after its session was cancelled", async () => {
    let finish!: (value: typeof ready) => void;
    vi.mocked(fetchFoundationAvailability).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const result = expect(loadFoundationSessionAvailability(controller.signal, token)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); finish(ready);
    await result;
    expect(fetchFoundationAvailability).toHaveBeenCalledOnce();
  });

  it("keeps launch-form availability as a single read", async () => {
    vi.mocked(fetchFoundationAvailability).mockResolvedValue(unavailable);
    await expect(loadFoundationSessionAvailability(new AbortController().signal)).resolves.toBe(unavailable);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFoundationAvailability).toHaveBeenCalledOnce();
  });

  it("recovers a launch form from a transient provider disagreement without a retry click", async () => {
    vi.mocked(fetchFoundationAvailability).mockResolvedValueOnce({ ...unavailable, providerDisagreement: true }).mockResolvedValueOnce(ready);
    const result = loadFoundationSessionAvailability(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe(ready);
    expect(fetchFoundationAvailability).toHaveBeenCalledTimes(2);
  });
});
