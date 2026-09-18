import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleFoundationBuilderProps } from "@/components/module-foundation-builder";
import type { FoundationLaunchDraft } from "@/lib/module-foundation/ui-types";

const fixture = vi.hoisted(() => ({ session: {} as Record<string, unknown>, builder: null as ModuleFoundationBuilderProps | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/module-foundation-session", () => ({ useFoundationSession: () => fixture.session, FoundationSessionStatus: () => null }));
vi.mock("@/components/module-foundation-builder", () => ({ ModuleFoundationBuilder: (props: ModuleFoundationBuilderProps) => { fixture.builder = props; return null; } }));
vi.mock("@/components/module-mode-wallet-state", () => ({ uploadModuleModeImage: vi.fn() }));
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import { ModuleFoundationLaunchHost } from "@/components/module-foundation-launch-host";
import { uploadModuleModeImage } from "@/components/module-mode-wallet-state";

const account = "0x1000000000000000000000000000000000000000";
const hash = `0x${"11".repeat(32)}` as const;
const image = { url: "https://assets.example.com/coin.webp", sha256: hash };
const draft = { name: "Next coin", symbol: "NEXT", image } as FoundationLaunchDraft;
const previousId = "11111111-1111-4111-8111-111111111111";
const acknowledgeResult = vi.fn(), assertCurrent = vi.fn(), resolveAuthority = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  acknowledgeResult.mockResolvedValue(undefined);
  resolveAuthority.mockRejectedValue(new Error("Fixture stops before network preparation"));
  fixture.session = { account, contextKey: "wallet:release", client: {}, walletContext: {}, envelope: null,
    resultGeneration: 0, availability: { status: "ready", chainId: 4663, chainName: "Robinhood Chain" },
    resolution: { operationId: previousId }, acknowledgeResult, assertCurrent, resolveAuthority,
    preparationBlocked: undefined, submissionBlocked: "Review the saved transaction result before starting another operation." };
  vi.mocked(uploadModuleModeImage).mockResolvedValue({ uri: image.url, sourceSha256: hash } as Awaited<ReturnType<typeof uploadModuleModeImage>>);
  renderToStaticMarkup(<ModuleFoundationLaunchHost />);
});

async function prepareNewDraft() {
  await fixture.builder!.onUploadImage({ image: { kind: "local", sha256: hash, mimeType: "image/webp", bytes: 1 }, blob: new Blob(["fixture"]) });
  return fixture.builder!.onPrepareLaunch(draft);
}

describe("starting a new coin after a saved result", () => {
  it("allows a new draft and does not acknowledge or submit anything on render", () => {
    expect(fixture.builder!.submissionBlocked).toBeUndefined();
    expect(acknowledgeResult).not.toHaveBeenCalled();
    expect(resolveAuthority).not.toHaveBeenCalled();
  });

  it("acknowledges the exact displayed result only when reviewing and preserves the current draft", async () => {
    await expect(prepareNewDraft()).rejects.toThrow("Fixture stops before network preparation");
    expect(acknowledgeResult).toHaveBeenCalledExactlyOnceWith(previousId, false);
    expect(assertCurrent).toHaveBeenCalledWith(account, "wallet:release");
    expect(resolveAuthority).toHaveBeenCalledOnce();
    expect(acknowledgeResult.mock.invocationCallOrder[0]).toBeLessThan(resolveAuthority.mock.invocationCallOrder[0]);
  });

  it("accepts empty optional metadata with only the exact first-party default artwork", async () => {
    await expect(fixture.builder!.onPrepareLaunch({ ...draft, description: "", image: FOUNDATION_DEFAULT_IMAGE })).rejects.toThrow("Fixture stops before network preparation");
    expect(uploadModuleModeImage).not.toHaveBeenCalled();
    expect(resolveAuthority).toHaveBeenCalledOnce();
  });

  it("does not treat a modified default artwork identity as an uploaded user image", async () => {
    await expect(fixture.builder!.onPrepareLaunch({ ...draft, image: { ...FOUNDATION_DEFAULT_IMAGE, sha256: hash } })).rejects.toThrow("exact coin image");
    expect(resolveAuthority).not.toHaveBeenCalled();
  });

  it("stops preparation when another tab changed or locked the saved result", async () => {
    acknowledgeResult.mockRejectedValueOnce(new Error("The saved transaction result changed"));
    await expect(prepareNewDraft()).rejects.toThrow("result changed");
    expect(resolveAuthority).not.toHaveBeenCalled();
  });

  it("continues to block unresolved operations before acknowledgement or preparation", async () => {
    fixture.session.preparationBlocked = "A previous wallet operation needs confirmation before you continue.";
    renderToStaticMarkup(<ModuleFoundationLaunchHost />);
    expect(fixture.builder!.submissionBlocked).toBe(fixture.session.preparationBlocked);
    await expect(prepareNewDraft()).rejects.toThrow("needs confirmation");
    expect(acknowledgeResult).not.toHaveBeenCalled();
    expect(resolveAuthority).not.toHaveBeenCalled();
  });
});
