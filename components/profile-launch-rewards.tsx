"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Hex } from "viem";
import type { Launch } from "./robinhood-launches-view";
import { isRobinhoodFoundationLaunch, isRobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import type { FoundationProfileLaunch } from "@/lib/profile/module-launches";
import type { LaunchClaimWalletInputV1, LaunchClaimWalletReviewV1 } from "@/lib/custom-launch/claim-handoff-v1";
import styles from "./profile-launch-rewards.module.css";

const FoundationClaim = dynamic(() => import("./foundation-profile-claim").then(module => module.FoundationProfileClaim), { ssr: false });
const LegacyClaim = dynamic(() => import("./legacy-module-profile-claim").then(module => module.LegacyModuleProfileClaim), { ssr: false });
const CustomClaims = dynamic(() => import("./generic-launch-claims").then(module => module.GenericLaunchClaims), { ssr: false });

function foundationSource(launch: Launch): FoundationProfileLaunch | null {
  const candidate = launch.foundationClaim ?? launch;
  if (typeof candidate.tokenAddress !== "string" || candidate.tokenAddress.toLowerCase() !== launch.tokenAddress.toLowerCase()
    || typeof candidate.creator !== "string" || candidate.creator.toLowerCase() !== launch.creator.toLowerCase()
    || ![candidate.hookAddress, "quoteAsset" in candidate ? candidate.quoteAsset : null].every(value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value))
    || !["poolId" in candidate ? candidate.poolId : null, "sourceReleaseDigest" in candidate ? candidate.sourceReleaseDigest : null].every(value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value))) return null;
  return candidate as FoundationProfileLaunch;
}

/** The compact card opens existing, independently verified claim paths on demand. */
export function ProfileLaunchRewards({ launch, account, chainId, sendWallet, onEthereumClaim }: {
  launch: Launch; account: string; chainId: 1 | 4663;
  sendWallet?: (input: LaunchClaimWalletInputV1) => Promise<LaunchClaimWalletReviewV1 | Hex>;
  onEthereumClaim?: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const foundation = foundationSource(launch);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  if (account.toLowerCase() !== launch.creator.toLowerCase()) return null;
  // Arbitrary Ethereum hooks do not have a universal claim entry point.
  // Offer the action only for a bound module ledger or a supported legacy model.
  if (chainId === 1 && !foundation && launch.mode !== "classic") return null;
  return <>
    <button className={styles.claimButton} type="button" onClick={() => {
      if (chainId === 1 && !foundation) onEthereumClaim?.(launch.tokenAddress);
      else setOpen(true);
    }}>Claim rewards</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <header><h2 id={title}>{launch.name || "Claim rewards"}</h2><button type="button" aria-label="Close rewards" onClick={() => setOpen(false)}><X size={20} aria-hidden="true" /></button></header>
      {open ? foundation ? <FoundationClaim launch={foundation} account={account} chainId={chainId} />
        : chainId === 4663 && isRobinhoodModuleLaunch(launch) && !isRobinhoodFoundationLaunch(launch) ? <LegacyClaim launch={launch} account={account} />
          : <CustomClaims account={account} launchId={launch.launchId} compact sendWallet={sendWallet} /> : null}
    </dialog>
  </>;
}
