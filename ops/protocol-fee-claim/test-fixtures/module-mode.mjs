import { mountModuleMode } from "../module-mode-app.mjs";
import { buildClaimTransaction } from "../module-mode-core.mjs";
const account = "0x0000000000000000000000000000000000000001";
const ledger = "0x0000000000000000000000000000000000000002";
const quote = "0x0000000000000000000000000000000000000003";
const hash = "0x" + "ab".repeat(32);
const state = new URLSearchParams(location.search).get("state");
let connected = false, paid = false;
const memory = new Map();
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
const provider = {
  request: async ({ method }) => {
    if (method === "eth_requestAccounts") { connected = true; return [account]; }
    if (method === "eth_accounts") return connected ? [account] : [];
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_sendTransaction") {
      if (state === "reject") throw Object.assign(new Error("Rejected"), { code: 4001 });
      if (state === "unknown") throw new Error("Connection interrupted");
      paid = true; return hash;
    }
    throw new Error("Unexpected wallet method: " + method);
  },
};
const snapshot = () => ({ claims: paid || state === "empty" ? [] : [{ ledger, quote, amount: 187423000000000000000n },
  { ledger: quote, quote: ledger, amount: 3107294174684n }],
  assets: paid || state === "empty" ? [] : [
    { address: quote, symbol: "WORM", decimals: 18, amount: 187423000000000000000n },
    { address: ledger, symbol: "WETH", decimals: 18, amount: 3107294174684n },
  ], launchCount: 9, scannedAt: Date.now(), block: { number: 68060540n, hash, timestamp: 0n } });
mountModuleMode({
  storage, clients: [{ waitForTransactionReceipt: async () => ({ status: "success" }) }], findProvider: () => provider,
  api: {
    releases: async () => [],
    scan: async () => { if (state === "error") throw new Error("Die Netzwerkdaten sind nicht aktuell. Bitte erneut versuchen."); return snapshot(); },
    prepare: async ({ snapshot: current }) => ({ snapshot: current, transaction: { ...buildClaimTransaction(account, current.claims), chainId: "0x1237" } }),
    confirm: async () => ({ status: "success", transactionHash: hash }),
  },
});
