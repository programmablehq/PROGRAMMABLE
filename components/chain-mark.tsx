import Image from "next/image";
import type { ViewChainId } from "@/lib/view-chain";

export function ChainMark({ chainId, className }: { chainId: ViewChainId; className?: string }) {
  if (chainId === 999) return <Image className={className} src="/brand/networks/hyperevm.png" style={{ filter: "brightness(0) invert(1)" }} width={18} height={18} alt="HyperEVM" title="HyperEVM" />;
  if (chainId === 8453) return <svg className={className} width={18} height={18} viewBox="0 0 24 24" role="img" aria-label="Base" focusable="false"><title>Base</title><circle cx="12" cy="12" r="10" fill="#0052FF" /><path d="M2 12h15" stroke="white" strokeWidth="2" /></svg>;
  if (chainId === 4663) return <Image className={className} src="/brand/networks/robinhood-feather-white.svg"
    width={14} height={18} alt="Robinhood Chain" title="Robinhood Chain" />;
  return <svg className={className} width={16} height={18} viewBox="0 0 24 24" fill="none"
    role="img" aria-label="Ethereum" focusable="false">
    <title>Ethereum</title>
    <path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" fill="currentColor" />
    <path d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z" fill="currentColor" />
    <path d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z" fill="currentColor" />
  </svg>;
}
