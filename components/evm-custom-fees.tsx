"use client";
import { useState, useRef } from "react";
import { formatUnits } from "viem";
import { useWallet } from "./wallet-provider";
import { validateEvmFeeClaimPreparation, type EvmFeeClaimPreparation } from "@/lib/swap/evm-custom";
import styles from "./swap-panel.module.css";
export function EvmCustomFees({ token }: {
  token: `0x${string}`;
}) {
  const wallet = useWallet(), mutex = useRef(false);
  const [claim, setClaim] = useState<EvmFeeClaimPreparation | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [hash, setHash] = useState<string | null>(null);
  async function prepare() {
    if (mutex.current)
      return;
    if (!wallet.wallet) {
      wallet.openWallet();
      return;
    }
    mutex.current = true;
    setBusy(true);
    setError("");
    setHash(null);
    try {
      const request = { chainId: 999, owner: wallet.wallet.account, token, vaultKind: "fees", recipientKind: "creator" };
      const response = await fetch("/api/swap/evm/fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error);
      setClaim(validateEvmFeeClaimPreparation(body, { ...request, chainId: 999 }));
    }
    catch (e) {
      setError(e instanceof Error ? e.message : "Fee claim is unavailable.");
    }
    finally {
      setBusy(false);
      mutex.current = false;
    }
  }
  async function submit() { if (!claim || mutex.current)
    return; mutex.current = true; setBusy(true); setError(""); try {
    setHash(await wallet.sendEvmCustomSwapWalletAction(claim));
    setClaim(null);
  }
  catch (e) {
    setClaim(null);
    setError(e instanceof Error ? e.message : "Fee claim is unavailable.");
  }
  finally {
    setBusy(false);
    mutex.current = false;
  } }
  return <details style={{ marginTop: 24 }}><summary>Creator fees</summary><p>Claim accrued HYPE to the creator’s fixed fee recipient.</p>
{claim ? <><p>{formatUnits(BigInt(claim.amount), 18)} HYPE to {claim.recipient.slice(0, 6)}…{claim.recipient.slice(-4)}</p><button className={styles.primary} disabled={busy} onClick={submit}>{busy ? "Waiting for wallet…" : "Confirm fee claim"}</button></> : <button className={styles.primary} disabled={busy} onClick={prepare}>{busy ? "Checking fees…" : "Check claimable fees"}</button>}
{hash ? <p role="status">Claim submitted. <a href={`https://hyperevmscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction</a></p> : null}{error ? <p role="alert">{error}</p> : null}</details>;
}
