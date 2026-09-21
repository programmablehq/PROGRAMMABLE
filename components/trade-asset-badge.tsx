import styles from "./swap-panel.module.css";

export function TradeAssetBadge({ symbol, native }: { symbol: string; native: boolean }) {
  return <span className={styles.asset} title={symbol}><span className={`${styles.assetIcon} ${native ? styles.eth : ""}`} aria-hidden="true">
    {native ? <svg width="14" height="20" viewBox="0 0 16 24" fill="currentColor"><path d="M8 0 0 12l8 5 8-5L8 0ZM0 14l8 10 8-10-8 5-8-5Z" /></svg> : symbol.slice(0, 1)}
  </span><span>{symbol}</span></span>;
}
