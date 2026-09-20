"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import type { Address } from "viem";
import type { FoundationQuoteAsset } from "@/lib/module-foundation/ui-types";
import { ModulePickerDialog } from "./module-picker-dialog";
import styles from "./module-foundation-ui.module.css";

type Lookup = { address: string; asset?: FoundationQuoteAsset; error?: string };

export function ModuleFoundationPairDialog({ chainId, initialAddress = "", initialAsset, quoteAssets, onResolveQuote, onApply, onClose }: {
  chainId: number;
  initialAddress?: string;
  initialAsset?: FoundationQuoteAsset;
  quoteAssets: readonly FoundationQuoteAsset[];
  onResolveQuote: (address: Address) => Promise<FoundationQuoteAsset>;
  onApply: (asset: FoundationQuoteAsset) => void;
  onClose: () => void;
}) {
  const [configuring, setConfiguring] = useState(Boolean(initialAddress));
  const [address, setAddress] = useState(initialAddress);
  const [lookup, setLookup] = useState<Lookup | null>(initialAsset ? { address: initialAddress, asset: initialAsset } : null);
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const resolver = useRef(onResolveQuote);
  useLayoutEffect(() => { resolver.current = onResolveQuote; }, [onResolveQuote]);
  const trimmed = address.trim();
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
  const known = quoteAssets.find(asset => asset.chainId === chainId && asset.address.toLowerCase() === trimmed.toLowerCase());
  const current = lookup?.address.toLowerCase() === trimmed.toLowerCase() ? lookup : null;
  const asset = known ?? current?.asset;
  const error = current?.error ?? (asset && !asset.supported ? asset.reason ?? "This token is not supported." : undefined);
  const supported = Boolean(asset?.supported && asset.chainId === chainId && !asset.supportsNativeEth);

  useEffect(() => {
    if (!configuring || !validAddress || known) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void resolver.current(trimmed as Address).then(resolved => {
        if (cancelled) return;
        if (resolved.address.toLowerCase() !== trimmed.toLowerCase() || resolved.chainId !== chainId || !Number.isInteger(resolved.decimals) || resolved.decimals < 0 || resolved.decimals > 36) {
          throw new Error("This token could not be verified. Check its address and try again.");
        }
        setLookup({ address: trimmed, asset: resolved });
      }).catch(caught => {
        if (!cancelled) setLookup({ address: trimmed, error: caught instanceof Error && caught.message.length <= 320 ? caught.message : "This token could not be checked. Try again." });
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [chainId, configuring, known, trimmed, validAddress, retry]);

  return <ModulePickerDialog variant="compact" animateOpen title={configuring ? "Pair another token" : "Add a module"}
    description={configuring ? "Pair with a meme coin or tokenized stock instead of ETH." : undefined}
    onClose={onClose} showDone={configuring} doneLabel={initialAddress ? "Save module" : "Add module"}
    doneDisabled={!supported} onDone={() => { if (asset && supported) onApply(asset); }}
    footer={configuring && !initialAddress ? <button type="button" className={styles.textButton} onClick={() => setConfiguring(false)}><ArrowLeftIcon size={16} aria-hidden="true" /> Modules</button> : undefined}>
    {configuring ? <div className={styles.pairConfiguration}>
      <div className={styles.field}>
        <label htmlFor="foundation-pair-address">Token address</label>
        <input ref={input} id="foundation-pair-address" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="0x…" value={address}
          aria-invalid={Boolean(error) || undefined} aria-describedby="foundation-pair-status"
          onChange={event => { setAddress(event.target.value); setLookup(null); }} />
        <p id="foundation-pair-status" className={error ? styles.error : supported ? styles.saved : styles.help} role="status">
          {error ?? (supported ? <><CheckIcon size={16} aria-hidden="true" /> {asset?.name} · {asset?.symbol}</> : asset?.supportsNativeEth ? "ETH is already included in Classic." : validAddress ? "Checking token…" : trimmed ? "Enter a complete token address." : "Paste a contract address on Robinhood Chain.")}
        </p>
        {current?.error ? <button type="button" className={styles.textButton} onClick={() => { setLookup(null); setRetry(value => value + 1); }}>Try again</button> : null}
      </div>
    </div> : <button type="button" className={styles.moduleOption} onClick={() => { setConfiguring(true); requestAnimationFrame(() => input.current?.focus()); }}>
      <PlugsConnectedIcon size={24} aria-hidden="true" />
      <span><strong>Pair another token</strong><small>Meme coins or tokenized stocks instead of ETH.</small></span>
      <ArrowRightIcon size={20} aria-hidden="true" />
    </button>}
  </ModulePickerDialog>;
}
