"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi, formatUnits, getAddress, type Hex } from "viem";
import { useFoundationSession } from "@/components/module-foundation-session";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { foundationLedgerAbi } from "@/lib/module-foundation/abi";
import { prepareFoundationClaim } from "@/lib/module-foundation/client";
import { readFoundationResolution } from "@/lib/module-foundation/result-store";
import type { FoundationPool } from "@/lib/module-foundation/route";
import type { RobinhoodFoundationLaunch } from "@/lib/robinhood-launches";
import styles from "./robinhood-profile-launches.module.css";

type FeeBalance = { context: string; amount: bigint; decimals: number | null; symbol: string };

/** Indexed launch identity supplies the row; the wallet path independently verifies the live pool and recipient. */
export function FoundationProfileClaim({ launch, account }: { launch: RobinhoodFoundationLaunch; account: string }) {
  const token = getAddress(launch.tokenAddress);
  const session = useFoundationSession(token);
  const [balanceState, setBalanceState] = useState<FeeBalance | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const claiming = useRef(false);
  const [message, setMessage] = useState("");
  const [transactionHash, setTransactionHash] = useState<Hex | null>(null);
  const owner = session.account?.toLowerCase() === account.toLowerCase()
    && launch.creator.toLowerCase() === account.toLowerCase();
  const balance = balanceState?.context === session.contextKey ? balanceState : null;
  const releaseDigest = session.envelope?.binding?.releaseDigest;

  useEffect(() => {
    if (!owner || session.availability.status !== "ready" || !releaseDigest) return;
    let active = true;
    const client = session.client;
    const ledger = getAddress(launch.feeLedgerAddress);
    void (async () => {
      if (releaseDigest.toLowerCase() !== launch.sourceReleaseDigest.toLowerCase()) throw new Error("The coin's fee release changed.");
      const blockNumber = await client.getBlockNumber();
      const [creator, quote, credited, claimed] = await Promise.all([
        client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creator", blockNumber }),
        client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "quote", blockNumber }),
        client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creatorCredited", blockNumber }),
        client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creatorClaimed", blockNumber }),
      ]);
      if (getAddress(creator) !== getAddress(launch.creator) || getAddress(quote) !== getAddress(launch.quoteAsset)
        || claimed > credited) throw new Error("The coin's fee ledger does not match its launch.");
      const amount = credited - claimed;
      const metadata = amount > 0n ? await Promise.allSettled([
        client.readContract({ address: getAddress(launch.quoteAsset), abi: erc20Abi, functionName: "decimals", blockNumber }),
        client.readContract({ address: getAddress(launch.quoteAsset), abi: erc20Abi, functionName: "symbol", blockNumber }),
      ]) : null;
      const decimals = metadata?.[0].status === "fulfilled" && metadata[0].value <= 36 ? metadata[0].value : null;
      const symbol = metadata?.[1].status === "fulfilled" && /^[A-Za-z0-9._-]{1,16}$/.test(metadata[1].value)
        ? metadata[1].value : "quote units";
      if (active) { setBalanceError(""); setBalanceState({ context: session.contextKey, amount: credited - claimed, decimals,
        symbol }); }
    })().catch(() => { if (active) setBalanceError("Fees could not be checked."); });
    return () => { active = false; };
  }, [account, launch.creator, launch.feeLedgerAddress, launch.quoteAsset, launch.sourceReleaseDigest, owner,
    releaseDigest, refresh, session.availability.status, session.client, session.contextKey]);

  async function claim() {
    if (!session.account || !owner || claiming.current || !balance || balance.amount <= 0n) return;
    claiming.current = true;
    const wallet = session.account;
    const context = session.contextKey;
    setBusy(true);
    setMessage("Checking the current payout…");
    setTransactionHash(null);
    try {
      if (session.submissionBlocked) throw new Error(session.submissionBlocked);
      const pool: FoundationPool = { token, quote: getAddress(launch.quoteAsset), hook: getAddress(launch.hookAddress), poolId: launch.poolId as Hex };
      const sequence = await prepareFoundationClaim({ client: session.client, binding: await session.resolveAuthority(),
        account: wallet, pool, beneficiary: "creator" });
      if (sequence.recipient !== getAddress(launch.creator)) throw new Error("The payout recipient changed.");
      session.assertCurrent(wallet, context);
      setMessage("Confirm the fee payout in your wallet…");
      const outcome = await session.execute(sequence);
      setTransactionHash(outcome.result.transactionHash);
      if (outcome.result.status === "confirmed" && outcome.result.operationComplete) {
        setMessage("Fee payout confirmed onchain.");
        setBalanceState(null);
        setRefresh(value => value + 1);
        try {
          const saved = readFoundationResolution(wallet);
          if (saved?.transactionHash.toLowerCase() === outcome.result.transactionHash.toLowerCase()) await session.acknowledgeResult(saved.operationId);
        } catch { /* The confirmed payout remains visible even if saved-operation cleanup fails. */ }
      } else {
        setMessage(outcome.result.message ?? "The transaction was sent. Check its confirmation before claiming again.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The fee payout could not be prepared.");
    } finally {
      claiming.current = false;
      setBusy(false);
    }
  }

  if (!owner) return null;
  const ready = session.availability.status === "ready" && !balanceError && balance !== null;
  return <div className={styles.claimArea}>
    {session.walletAction ? <button type="button" disabled={session.walletAction.busy} onClick={session.walletAction.onClick}>
      {session.walletAction.label}</button> : session.availability.status === "unavailable" || balanceError
      ? <button type="button" onClick={() => { setBalanceError(""); session.retryAvailability(); setRefresh(value => value + 1); }}>Retry fee check</button>
      : <button type="button" disabled={!ready || balance!.amount === 0n || busy || Boolean(session.submissionBlocked)} onClick={() => void claim()}>
        {busy ? "Preparing claim…" : "Claim fees"}</button>}
    <span className={styles.claimStatus}>{balanceError || session.availability.status === "unavailable" ? balanceError || "Fee claims are temporarily unavailable"
      : !ready ? "Checking fees…" : balance.amount === 0n ? "No creator fees available"
      : balance.decimals === null ? "Creator fees available" : `${formatUnits(balance.amount, balance.decimals)} ${balance.symbol} available`}</span>
    {session.submissionBlocked ? <span className={styles.claimStatus}>{session.submissionBlocked} <a href={`/modules/${token}`}>Review wallet activity</a></span> : null}
    {message ? <p className={styles.claimMessage} role="status">{message}{transactionHash ? <> <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${transactionHash}`}
      target="_blank" rel="noreferrer">View transaction</a></> : null}</p> : null}
  </div>;
}
