import { formatUnits, getAddress } from "viem";
import { CHAIN_ID, TREASURY, MULTICALL, CLAIM_DATA, createClients, parseReleases, scanFees, prepareClaim,
  confirmClaim, findMinedClaimHash, jsonStringify } from "./module-mode-core.mjs";
import { decodeFunctionData, multicall3Abi } from "viem";

const JOURNAL_KEY = "programmable.foundation.platform-claim.v1";
const LOCK_KEY = "programmable.foundation.platform-claim";
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const short = address => address.slice(0, 6) + "…" + address.slice(-4);
function displayAmount(full) {
  const [whole, fraction = ""] = full.split(".");
  if (fraction.length <= 8) return full;
  const visible = fraction.slice(0, 8).replace(/0+$/, "");
  return whole === "0" && !visible ? "<0.00000001" : "≈ " + whole + (visible ? "." + visible : "");
}
const $ = selector => document.querySelector(selector);
const json = async path => {
  const response = await fetch(path, { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Die Launch-Historie ist gerade nicht erreichbar. Bitte erneut versuchen.");
  return response.json();
};
const providers = new Map();
window.addEventListener("eip6963:announceProvider", event => {
  if (typeof event.detail?.provider?.request === "function") providers.set(event.detail.info?.uuid, event.detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
function findProvider() {
  const announced = [...providers.values()];
  return announced.find(item => item.info?.rdns === "io.metamask")?.provider ?? announced[0]?.provider ??
    window.ethereum?.providers?.find(item => item.isMetaMask) ?? window.ethereum;
}

export function restoreJournal(storage) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    const transaction = saved.prepared?.transaction;
    const claims = saved.prepared?.snapshot?.claims;
    if (saved.version !== 1 || !Number.isSafeInteger(saved.startedAt) || !transaction ||
      !same(transaction.to, MULTICALL) || transaction.value !== "0x0" || Number(transaction.chainId) !== CHAIN_ID ||
      !/^0x[0-9a-f]+$/i.test(transaction.nonce) || !Number.isSafeInteger(Number(BigInt(transaction.nonce))) ||
      !Array.isArray(claims) || claims.length < 1 || claims.length > 128 ||
      (saved.hash !== null && !/^0x[0-9a-f]{64}$/i.test(saved.hash))) throw new Error();
    getAddress(transaction.from);
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: transaction.data });
    if (decoded.functionName !== "aggregate3" || decoded.args[0].length !== claims.length) throw new Error();
    const seen = new Set();
    claims.forEach((claim, index) => {
      claim.ledger = getAddress(claim.ledger);
      claim.amount = BigInt(claim.amount);
      const call = decoded.args[0][index];
      if (seen.has(claim.ledger) || claim.amount <= 0n || !same(call.target, claim.ledger) ||
        call.allowFailure || !same(call.callData, CLAIM_DATA)) throw new Error();
      seen.add(claim.ledger);
    });
    return saved;
  } catch { throw new Error("Ein gespeicherter Claim ist unvollständig. Bitte zuerst die Transaktion in deiner Wallet prüfen."); }
}

export function mountModuleMode(overrides = {}) {
  const clients = overrides.clients ?? createClients();
  const api = { scan: scanFees, prepare: prepareClaim, confirm: confirmClaim, findMined: findMinedClaimHash,
    // Claims use the complete canonical factory history, independently of launch availability.
    releases: async () => parseReleases(await json("/module-mode/releases")), ...overrides.api };
  const storage = overrides.storage ?? localStorage;
  let account = null, chain = null, provider = null, snapshot = null, busy = false, revision = 0, journal = null;
  let initialError = "";
  try { journal = restoreJournal(storage); } catch (error) { initialError = error.message; }
  const button = $("[data-mm-action]"), label = $("[data-mm-label]"), status = $("[data-mm-status]");
  const errorBox = $("[data-mm-error]"), assets = $("[data-mm-assets]"), count = $("[data-mm-count]");
  const refreshButton = $("[data-mm-refresh]"), wallet = $("[data-mm-wallet]");
  function error(message = "") { errorBox.textContent = message; errorBox.hidden = !message; }
  function render() {
    button.disabled = busy || Boolean(initialError);
    button.setAttribute("aria-busy", String(busy));
    refreshButton.disabled = busy;
    wallet.textContent = account ? "Verbunden: " + short(account) : "Wallet nicht verbunden";
    label.textContent = busy ? "Wird geprüft…" : journal ? "Transaktion prüfen" : !account ? "Wallet verbinden" :
      chain !== CHAIN_ID ? "Auf Robinhood wechseln" : !snapshot ? "Gebühren laden" :
        snapshot.claims.length ? "Alle Fees claimen" : "Gebühren aktualisieren";
    if (snapshot) {
      count.textContent = snapshot.claims.length === 1 ? "1 offenes Gebührenkonto" :
        snapshot.claims.length ? snapshot.claims.length + " offene Gebührenkonten" : "Keine offenen Gebühren";
      assets.replaceChildren(...snapshot.assets.map(asset => {
        const row = document.createElement("li"), name = document.createElement("a"), value = document.createElement("strong");
        name.href = "https://robinhoodchain.blockscout.com/token/" + asset.address;
        name.target = "_blank"; name.rel = "noopener noreferrer";
        name.textContent = asset.symbol; name.title = asset.address;
        const exact = formatUnits(asset.amount, asset.decimals);
        value.textContent = displayAmount(exact); value.title = exact + " " + asset.symbol;
        value.setAttribute("aria-label", exact + " " + asset.symbol);
        row.append(name, value); return row;
      }));
      $("[data-mm-launches]").textContent = snapshot.launchCount + " Launches geprüft";
    }
  }
  async function scan(minimumBlock = 0n) {
    const releases = await api.releases();
    snapshot = await api.scan({ clients, releases, minimumBlock, progress: message => { status.textContent = message; } });
    status.textContent = snapshot.claims.length ? "Bereit zum Claim." : "Neue Gebühren erscheinen hier nach weiteren Trades.";
    render();
    return snapshot;
  }
  async function syncWallet() {
    const expectedRevision = ++revision;
    const [accounts, chainId] = await Promise.all([provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" })]);
    if (expectedRevision !== revision) return;
    account = accounts[0] ? getAddress(accounts[0]) : null;
    chain = Number(chainId); render();
  }
  function bind(next) {
    if (provider === next) return;
    if (provider) {
      provider.removeListener?.("accountsChanged", walletChanged);
      provider.removeListener?.("chainChanged", walletChanged);
    }
    provider = next;
    provider.on?.("accountsChanged", walletChanged);
    provider.on?.("chainChanged", walletChanged);
  }
  function walletChanged() { revision++; syncWallet().catch(cause => error(cause.message)); }
  function persist(saved) {
    // Persist before entering the wallet; an unknown send is never automatically repeated.
    storage.setItem(JOURNAL_KEY, jsonStringify(saved));
    journal = saved;
  }
  function clearJournal(expected) {
    const current = restoreJournal(storage);
    if (jsonStringify(current) !== jsonStringify(expected)) {
      journal = current;
      throw new Error("Der Claim wurde in einem anderen Tab aktualisiert. Bitte die Transaktion prüfen.");
    }
    storage.removeItem(JOURNAL_KEY); journal = null;
  }
  async function claimLock(action) {
    if (!navigator.locks) throw new Error("Bitte einen aktuellen Browser verwenden.");
    return navigator.locks.request(LOCK_KEY, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Der Claim ist bereits in einem anderen Tab geöffnet.");
      journal = restoreJournal(storage);
      return action();
    });
  }
  async function recover() {
    if (!journal) return scan();
    const minedHash = await api.findMined(clients, journal.prepared);
    if (minedHash && !same(minedHash, journal.hash)) persist({ ...journal, hash: minedHash });
    if (!journal?.hash) {
      status.textContent = "Bitte die offene Anfrage in deiner Wallet prüfen.";
      $("[data-mm-resolve]").hidden = false;
      return;
    }
    const pending = journal;
    const receipt = await api.confirm(clients, pending.hash, pending.prepared, { allowReplacement: true });
    const link = $("[data-mm-transaction]");
    link.href = "https://robinhoodchain.blockscout.com/tx/" + receipt.transactionHash; link.hidden = false;
    await scan(receipt.blockNumber ?? 0n);
    clearJournal(pending);
    $("[data-mm-resolve]").hidden = true;
    status.textContent = receipt.outcome === "replaced" ? "Die Wallet hat den Claim ersetzt oder abgebrochen. Die Gebühren sind neu geladen." :
      receipt.status === "reverted" ? "Der Claim wurde zurückgesetzt. Die aktuellen Gebühren sind wieder geladen." :
      "Alle ausgewählten Fees wurden an die Treasury ausgezahlt.";
  }
  async function send() {
    await syncWallet();
    if (!account || chain !== CHAIN_ID) throw new Error("Bitte die Wallet mit Robinhood Chain verbinden.");
    const expectedAccount = account, expectedRevision = revision;
    const current = await scan();
    if (!current.claims.length) return;
    const prepared = await api.prepare({ clients, snapshot: current, account: expectedAccount });
    const [accounts, chainId] = await Promise.all([provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" })]);
    if (revision !== expectedRevision || !same(accounts[0], expectedAccount) || Number(chainId) !== CHAIN_ID)
      throw new Error("Die Wallet hat sich geändert. Bitte erneut claimen.");
    const saved = { version: 1, startedAt: Date.now(), hash: null, prepared };
    persist(saved);
    status.textContent = "Claim in deiner Wallet bestätigen.";
    let hash;
    try { hash = await provider.request({ method: "eth_sendTransaction", params: [prepared.transaction] }); }
    catch (cause) {
      if ([4001, 4100, -32602].includes(cause?.code)) {
        clearJournal(saved);
        throw new Error(cause.code === 4001 ? "Claim abgebrochen. Deine Gebühren bleiben verfügbar." : "Die Wallet hat den Claim nicht angenommen. Bitte erneut verbinden.");
      }
      throw new Error("Die Wallet hat noch keine eindeutige Antwort geliefert. Bitte die offene Anfrage prüfen.");
    }
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("Die Wallet-Antwort konnte nicht zugeordnet werden. Bitte deine Wallet prüfen.");
    persist({ ...saved, hash });
    status.textContent = "Auszahlung wird bestätigt…";
    const receipt = await clients[0].waitForTransactionReceipt({ hash, confirmations: 2, timeout: 60000 });
    if (receipt.transactionHash && !same(receipt.transactionHash, hash)) {
      await api.confirm(clients, receipt.transactionHash, prepared, { allowReplacement: true });
      persist({ ...saved, hash: receipt.transactionHash });
    }
    await recover();
  }
  async function withBusy(action) {
    if (busy) return;
    busy = true; error(); render();
    try { await action(); } catch (cause) {
      status.textContent = "";
      error(cause.name === "TimeoutError" ? "Das Laden dauert gerade zu lange. Bitte erneut versuchen." :
        cause.shortMessage ?? cause.message ?? "Bitte erneut versuchen.");
      if (!snapshot && !journal) { count.textContent = "Gebühren noch nicht verfügbar"; status.textContent = "Bitte aktualisieren."; }
    }
    finally {
      try { journal = restoreJournal(storage); } catch (cause) { initialError = cause.message; error(initialError); }
      busy = false; render();
    }
  }
  button.addEventListener("click", () => withBusy(async () => {
    if (journal) return claimLock(recover);
    if (!provider) {
      const next = (overrides.findProvider ?? findProvider)();
      if (!next?.request) throw new Error("Bitte diese Seite in einem Browser mit deiner Wallet öffnen.");
      bind(next);
    }
    if (!account) {
      await provider.request({ method: "eth_requestAccounts" });
      await syncWallet(); return;
    }
    if (chain !== CHAIN_ID) {
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] }); }
      catch (cause) {
        if (cause?.code !== 4902) throw cause;
        await provider.request({ method: "wallet_addEthereumChain", params: [{
          chainId: "0x1237", chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        }] });
      }
      await syncWallet(); return;
    }
    if (!snapshot?.claims.length) return scan();
    return claimLock(async () => {
      if (journal) return recover();
      await send();
    });
  }));
  refreshButton.addEventListener("click", () => withBusy(scan));
  $("[data-mm-cancelled]").addEventListener("click", () => {
    if (busy || journal?.hash) return;
    const pending = journal;
    // Explicit owner acknowledgement, never a timed automatic unlock of an uncertain send.
    withBusy(() => claimLock(async () => {
      clearJournal(pending);
      $("[data-mm-resolve]").hidden = true; error(); status.textContent = "Gebühren bleiben verfügbar.";
    }));
  });
  window.addEventListener("storage", event => {
    if (event.key !== JOURNAL_KEY || busy) return;
    try { journal = restoreJournal(storage); } catch (cause) { initialError = cause.message; error(initialError); }
    render();
  });
  $("[data-mm-recipient]").textContent = short(TREASURY);
  $("[data-mm-recipient]").href = "https://robinhoodchain.blockscout.com/address/" + TREASURY;
  render();
  if (initialError) error(initialError);
  const existing = (overrides.findProvider ?? findProvider)();
  if (existing?.request) { bind(existing); syncWallet().catch(() => {}); }
  return { ready: withBusy(async () => { if (journal) await claimLock(recover); else await scan(); }) };
}
