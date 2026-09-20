import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { runWithBrowserWalletRequestLock, WalletRequestNotSubmittedError } from "@/lib/wallet-request-lock";

const account = `0x${"a".repeat(40)}`;
const hash = `0x${"b".repeat(64)}`;
const source = readFileSync("components/wallet-provider.tsx", "utf8");
const file = ts.createSourceFile("wallet-provider.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Execute the real provider callback with wallet I/O replaced, without mounting Privy's UI. */
function callbackSource(name: string): string {
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!callback) throw new Error(`Missing wallet callback ${name}`);
  return ts.transpileModule(`module.exports = ${callback.getText(file)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function harness(kind: "legacy" | "launch-plan", failure: "preflight" | "gas" | "ambiguous-send" | "rejection" | "success") {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const review = { binding: "exact-trade", maxGasCostWei: "1000", transaction: { from: account, to: account, data: "0x1234" } };
  let preparations = 0;
  const prepare = vi.fn(async () => {
    preparations++;
    if (kind === "launch-plan" && preparations === 1) return review;
    if (failure === "preflight") throw new Error("Quote is no longer available");
    return failure === "gas" ? { ...review, maxGasCostWei: "1001" } : review;
  });
  const send = vi.fn(async () => {
    if (failure === "rejection") throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    if (failure === "ambiguous-send") throw new Error("Wallet connection interrupted");
    return hash;
  });
  const connectedWallet = { getEthereumProvider: async () => ({ request: send }), switchChain: vi.fn() };
  const runtime = { localStorage: storage, sessionStorage: storage, now: () => 1_800_000_000_000, notify: vi.fn(),
    crypto: { subtle: webcrypto.subtle, getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array as Uint8Array<ArrayBuffer>) },
    locks: { request: async <Result>(name: string, _options: unknown, work: (lock: { name: string }) => Promise<Result>) => work({ name }) } };
  const callbackModule = { exports: undefined as unknown };
  runInNewContext(callbackSource(kind === "legacy" ? "sendCustomV4SwapWalletAction" : "sendLaunchPlanTradeWalletAction"), {
    module: callbackModule, connectedWallet, wallet: { account, chainId: "0x1237" }, user: { id: "fixture-session" },
    walletSessionGenerationRef: { current: 1 },
    walletRequestSessionRef: { current: { authenticated: true, privyUserId: "fixture-session", account, walletCapability: connectedWallet } },
    robinhoodChainHex: "0x1237", robinhoodChain: { id: 4663, name: "Robinhood Chain" },
    getWalletProviderOnChain: async () => ({ request: send }), assertExternalWalletAuthorityCurrent: async () => undefined,
    runWithBrowserWalletRequestLock: (input: Parameters<typeof runWithBrowserWalletRequestLock>[0]) => runWithBrowserWalletRequestLock({ ...input, runtime }),
    WalletRequestNotSubmittedError,
    getWalletTransactionErrorMessage: (error: { message: string }) => error.message,
    errorIsExplicitWalletRejection: (error: { code?: number }) => error.code === 4001,
    parseSubmittedTransactionHash: (value: string) => value,
    require: (name: string) => {
      if (name === "@/lib/swap/custom-v4") return { prepareCustomV4SwapWallet: prepare };
      if (name === "@/lib/custom-launch/routed-trade-wallet-v1") return { prepareLaunchPlanTradeWalletV1: prepare };
      throw new Error(`Unexpected callback import ${name}`);
    },
  });
  const invoke = () => (callbackModule.exports as (input: unknown) => Promise<string>)({ action: "submit", reviewed: review });
  const lease = () => storage.getItem(`programmable:wallet-request:v1:4663:${account}`);
  return { invoke, lease, send };
}

describe.each(["legacy", "launch-plan"] as const)("%s swap preflight wallet locking", kind => {
  it.each(["preflight", "gas"] as const)("releases a %s failure before any wallet request", async failure => {
    const test = harness(kind, failure);
    await expect(test.invoke()).rejects.toMatchObject({ walletRequestAttempted: false, walletRequestRejected: false });
    expect(test.send).not.toHaveBeenCalled();
    expect(test.lease()).toBeNull();
    await expect(test.invoke()).rejects.not.toThrow("already pending");
  });

  it("keeps an uncertain submitted request locked and prevents a second send", async () => {
    const test = harness(kind, "ambiguous-send");
    await expect(test.invoke()).rejects.toMatchObject({ walletRequestAttempted: true, walletRequestRejected: false });
    expect(test.lease()).not.toBeNull();
    await expect(test.invoke()).rejects.toThrow("already pending");
    expect(test.send).toHaveBeenCalledOnce();
  });

  it("releases an explicit wallet rejection", async () => {
    const test = harness(kind, "rejection");
    await expect(test.invoke()).rejects.toMatchObject({ walletRequestAttempted: true, walletRequestRejected: true });
    expect(test.send).toHaveBeenCalledOnce();
    expect(test.lease()).toBeNull();
  });

  it("releases the request lease after receiving its transaction hash", async () => {
    const test = harness(kind, "success");
    await expect(test.invoke()).resolves.toBe(hash);
    expect(test.send).toHaveBeenCalledOnce();
    expect(test.lease()).toBeNull();
  });
});
