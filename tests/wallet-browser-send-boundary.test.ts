import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { walletChainIdsEqual } from "@/lib/wallet-chain-id";
import { getWalletProviderOnChain } from "@/lib/wallet-network";
import { runWithBrowserWalletRequestLock, WalletRequestNotSubmittedError } from "@/lib/wallet-request-lock";
import { executeGeneralGraphWalletSend } from "@/lib/custom-ai/general-wallet-execution";
import { graphWalletActionHash, readGraphWalletAttempts, type GraphWalletChain } from "@/lib/custom-ai/general-wallet-attempt";

const account = `0x${"11".repeat(20)}` as const;
const otherAccount = `0x${"22".repeat(20)}` as const;
const hash = `0x${"33".repeat(32)}` as const;
const file = ts.createSourceFile("wallet-provider.tsx", readFileSync("components/wallet-provider.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the production callback and authority check, as in the swap preflight
// regressions, without mounting the SDK or extracting production UI for tests.
function productionCode() {
  let callback: ts.Expression | undefined;
  let authority: ts.FunctionDeclaration | undefined;
  let addressCheck: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "sendBrowserWalletAction"
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    if (ts.isFunctionDeclaration(node) && node.name?.text === "assertExternalWalletAuthorityCurrent") authority = node;
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isEthereumAddress") addressCheck = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!callback || !authority || !addressCheck) throw Error("Missing production send boundary");
  return ts.transpileModule(`${addressCheck.getText(file)}\n${authority.getText(file).replace(/^export /, "")}\nmodule.exports = ${callback.getText(file)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const code = productionCode();
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function harness(chainId: GraphWalletChain, options: {
  pause?: "lock" | "fees" | "final-accounts";
  embedded?: boolean;
  initialChain?: string;
  sendFailure?: "ambiguous" | "rejected";
} = {}) {
  const chainHex = `0x${Number(chainId).toString(16)}`;
  let providerChain = options.initialChain ?? chainHex;
  let providerAccount: string = account;
  const sessionGeneration = { current: 1 }, identityGeneration = { current: 1 }, networkGeneration = { current: 1 };
  const session = { current: { authenticated: true, privyUserId: "fixture-owner", account: account as string,
    chainId: providerChain } };
  const paused = deferred(), resume = deferred();
  const pause = async () => { paused.resolve(); await resume.promise; };
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let digests = 0, accountReads = 0;
  const runtime = { localStorage: store, sessionStorage: store, now: () => 1_800_000_000_000, notify: vi.fn(),
    crypto: { subtle: { digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      if (++digests === 1 && options.pause === "lock") await pause();
      return webcrypto.subtle.digest(algorithm, data as Parameters<typeof webcrypto.subtle.digest>[1]);
    } }, getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array as Uint8Array<ArrayBuffer>) },
    locks: { request: async <Result>(name: string, _options: unknown, work: (lock: { name: string }) => Promise<Result>) => work({ name }) } };
  const send = vi.fn(async () => {
    if (options.sendFailure === "ambiguous") throw Error("Connection lost after request");
    if (options.sendFailure === "rejected") throw Object.assign(Error("User rejected"), { code: 4001 });
    return hash;
  });
  const provider = { request: vi.fn(async (payload: { method: string; params?: unknown }) => {
    if (payload.method === "eth_chainId") return providerChain;
    if (payload.method === "eth_accounts") {
      if (++accountReads === 2 && options.pause === "final-accounts") await pause();
      return [providerAccount];
    }
    if (payload.method === "eth_sendTransaction") return send();
    throw Error(`Unexpected wallet request ${payload.method}`);
  }) };
  function changeNetwork(next: string, emitEvent = true) {
    providerChain = next;
    if (emitEvent) { session.current.chainId = next; networkGeneration.current++; }
  }
  const connectedWallet = { chainId: providerChain, walletClientType: options.embedded ? "privy" : "external",
    getEthereumProvider: async () => provider,
    switchChain: vi.fn(async (next: number) => { changeNetwork(`0x${next.toString(16)}`); sessionGeneration.current++; }) };
  const fees = { maxFeePerGas: "0x10", maxPriorityFeePerGas: "0x0" };
  const callbackModule = { exports: undefined as unknown };
  runInNewContext(code, { module: callbackModule, connectedWallet, wallet: { account, chainId: providerChain }, user: { id: "fixture-owner" },
    walletRequestSessionRef: session, walletSessionGenerationRef: sessionGeneration, walletIdentityGenerationRef: identityGeneration, walletNetworkGenerationRef: networkGeneration,
    walletChainIdsEqual, appChain: { id: 1, name: "Ethereum" }, base: { id: 8453, name: "Base" }, hyperEvm: { id: 999, name: "HyperEVM" },
    getWalletProviderOnChain, enableHyperEvmLargeTransactionsV1: async () => undefined,
    readHyperEvmWalletFees: async () => { if (options.pause === "fees") await pause(); return fees; },
    runWithBrowserWalletRequestLock: (input: Parameters<typeof runWithBrowserWalletRequestLock>[0]) => runWithBrowserWalletRequestLock({ ...input, runtime }),
    executeGeneralGraphWalletSend: (input: Parameters<typeof executeGeneralGraphWalletSend>[0]) => executeGeneralGraphWalletSend({ ...input, store }),
    WalletRequestNotSubmittedError, parseSubmittedTransactionHash: (value: string) => value,
    sendPrivyTransaction: async () => ({ hash: await send() }),
    getWalletTransactionErrorMessage: (error: { message: string }) => error.message,
  });
  const action = { chainId, from: account, to: otherAccount, value: "0x0" as const, data: "0x12345678" as const };
  const boundary = { context: { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requestHash: `sha256:${"44".repeat(32)}` as const,
    actionHash: graphWalletActionHash(action) }, assertCurrent() {} };
  const invoke = () => (callbackModule.exports as (action: unknown, boundary: unknown) => Promise<string>)(action, boundary);
  return { invoke, send, provider, paused: paused.promise, resume: resume.resolve, changeNetwork, session, identityGeneration, sessionGeneration,
    changeAccount: (emitEvent: boolean) => { providerAccount = otherAccount; if (emitEvent) { session.current.account = otherAccount; sessionGeneration.current++; } },
    lease: () => store.getItem(`programmable:wallet-request:v1:${chainId}:${account}`),
    attempts: () => readGraphWalletAttempts(account, chainId, store), chainHex, action, connectedWallet };
}

describe("browser launch send authority after asynchronous preparation", () => {
  it.each(["1", "8453"] as const)("blocks chain %s network changes while acquiring the lock", async chainId => {
    const f = harness(chainId, { pause: "lock" });
    const pending = f.invoke();
    await f.paused;
    f.changeNetwork(chainId === "1" ? "0x2105" : "0x1");
    f.resume();
    await expect(pending).rejects.toThrow("changed");
    expect(f.send).not.toHaveBeenCalled(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });

  it("invalidates an away-and-back switch even when the final chain matches", async () => {
    const f = harness("1", { pause: "lock" });
    const pending = f.invoke(); await f.paused;
    f.changeNetwork("0x2105"); f.changeNetwork("0x1"); f.resume();
    await expect(pending).rejects.toThrow("changed");
    expect(f.send).not.toHaveBeenCalled(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });

  it.each([false, true])("blocks HyperEVM switches during fee preparation (embedded=%s)", async embedded => {
    const f = harness("999", { pause: "fees", embedded });
    const pending = f.invoke(); await f.paused; f.changeNetwork("0x1"); f.resume();
    await expect(pending).rejects.toThrow("changed");
    expect(f.send).not.toHaveBeenCalled(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });

  it.each(["chain", "account"] as const)("rechecks the provider %s when events did not reach the app", async kind => {
    const f = harness("8453", { pause: "lock" });
    const pending = f.invoke(); await f.paused;
    if (kind === "chain") f.changeNetwork("0x1", false); else f.changeAccount(false);
    f.resume();
    await expect(pending).rejects.toThrow(kind === "chain" ? "not connected" : "account changed");
    expect(f.send).not.toHaveBeenCalled(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });

  it("rechecks generation after the last asynchronous provider read", async () => {
    const f = harness("1", { pause: "final-accounts" });
    const pending = f.invoke(); await f.paused; f.changeNetwork("0x2105"); f.resume();
    await expect(pending).rejects.toThrow("changed");
    expect(f.send).not.toHaveBeenCalled(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });

  it.each(["account", "session", "logout", "generation"] as const)("rejects %s changes during lock acquisition", async kind => {
    const f = harness("1", { pause: "lock" });
    const pending = f.invoke(); await f.paused;
    if (kind === "account") f.changeAccount(true);
    if (kind === "session") f.session.current.privyUserId = "other-user";
    if (kind === "logout") f.session.current.authenticated = false;
    if (kind === "generation") f.identityGeneration.current++;
    f.resume();
    await expect(pending).rejects.toThrow("changed");
    expect(f.send).not.toHaveBeenCalled(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });

  it.each(["1", "8453", "999"] as const)("submits unchanged chain %s once with its explicit chain binding", async chainId => {
    const f = harness(chainId);
    await expect(f.invoke()).resolves.toBe(hash);
    expect(f.send).toHaveBeenCalledOnce(); expect(f.lease()).toBeNull();
    expect(f.attempts()[0].transactionHash).toBe(hash);
    expect(f.provider.request.mock.calls.find(([request]) => request.method === "eth_sendTransaction")?.[0].params)
      .toEqual([{ from: account, to: otherAccount, value: "0x0", data: "0x12345678", chainId: f.chainHex,
        ...(chainId === "999" ? { maxFeePerGas: "0x10", maxPriorityFeePerGas: "0x0" } : {}) }]);
  });

  it("allows its own requested switch before pinning the network generation", async () => {
    const f = harness("1", { initialChain: "0x2105" });
    await expect(f.invoke()).resolves.toBe(hash);
    expect(f.connectedWallet.switchChain).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("allows an SDK wrapper refresh while the same wallet and network stay verified", async () => {
    const f = harness("1", { pause: "lock" });
    const pending = f.invoke(); await f.paused; f.sessionGeneration.current++; f.resume();
    await expect(pending).resolves.toBe(hash); expect(f.send).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous wallet send locked and journaled against retries", async () => {
    const f = harness("1", { sendFailure: "ambiguous" });
    await expect(f.invoke()).rejects.toThrow("Connection lost");
    expect(f.lease()).not.toBeNull(); expect(f.attempts()[0].transactionHash).toBeNull();
    await expect(f.invoke()).rejects.toThrow("already pending");
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("clears an explicitly rejected send without retaining a journal attempt", async () => {
    const f = harness("1", { sendFailure: "rejected" });
    await expect(f.invoke()).rejects.toThrow("User rejected");
    expect(f.send).toHaveBeenCalledOnce(); expect(f.lease()).toBeNull(); expect(f.attempts()).toEqual([]);
  });
});
