"use client";

import { Globe2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_EXPLORE_FILTERS, LAUNCH_MODE_OPTIONS,
  type ExploreChainFilter,
  type RobinhoodExploreFilters,
} from "@/lib/robinhood-explore-filters";
import { ChainMark } from "@/components/chain-mark";
import styles from "./explore-filters.module.css";

export function ExploreFilters({ value = DEFAULT_EXPLORE_FILTERS, onApply, disabled = false,
  defaultValue = DEFAULT_EXPLORE_FILTERS, modeOptions = LAUNCH_MODE_OPTIONS,
  sortOptions = [{ value: "highest", label: "Market cap" }, { value: "activity", label: "24h volume" }, { value: "newest", label: "Newest" }],
  chainOptions = [] }: {
  value?: RobinhoodExploreFilters;
  onApply?: (filters: RobinhoodExploreFilters) => void;
  disabled?: boolean;
  defaultValue?: RobinhoodExploreFilters;
  modeOptions?: readonly { value: NonNullable<RobinhoodExploreFilters["mode"]>; label: string }[];
  sortOptions?: readonly { value: RobinhoodExploreFilters["sort"]; label: string }[];
  chainOptions?: readonly { value: ExploreChainFilter; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [panelOffset, setPanelOffset] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keyboardOpenRef = useRef(false);
  const panelId = useId();
  const count = Number((value.mode ?? "all") !== (defaultValue.mode ?? "all"))
    + Number(value.sort !== defaultValue.sort)
    + Number((value.chain ?? "all") !== (defaultValue.chain ?? "all"));

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    if (keyboardOpenRef.current) rootRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    const resized = () => setOpen(false);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  return <div className={styles.root} ref={rootRef} style={{ "--filter-offset": `${panelOffset}px` } as CSSProperties}
    onKeyDown={(event) => {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    }}
    onBlurCapture={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
    }}
  >
    <button className={styles.trigger} ref={triggerRef} type="button" disabled={disabled}
      aria-label={count ? `Filters, ${count} active` : "Filters"}
      aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
      title={disabled ? "Filters are currently unavailable" : undefined}
      data-active={count > 0}
      onClick={(event) => {
        if (open) close();
        else {
          keyboardOpenRef.current = event.detail === 0;
          const right = triggerRef.current?.getBoundingClientRect().right ?? window.innerWidth - 16;
          setPanelOffset(Math.min(0, right - Math.min(288, window.innerWidth - 32) - 16));
          setOpen(true);
        }
      }}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span className={styles.label}>Filters</span>
      {count > 0 ? <span className={styles.count} aria-hidden="true">{count}</span> : null}
    </button>
    {open ? <div className={styles.panel} id={panelId} role="dialog" aria-label="Launch filters">
      <div className={styles.heading}>
        <div className={styles.headingLabel}>
          <h2>Filters</h2>
          <button className={styles.reset} type="button" onClick={() => onApply?.({ ...defaultValue })}>Reset</button>
        </div>
        <button className={styles.close} type="button" aria-label="Close filters" onClick={() => close(true)}><X size={18} aria-hidden="true" /></button>
      </div>
      {chainOptions.length ? <fieldset className={styles.field}>
        <legend>Chain</legend>
        <div className={`${styles.choices} ${styles.chainChoices}`}>
          {chainOptions.map(chain => <button type="button" key={String(chain.value)}
            className={styles.chainChoice}
            aria-pressed={(value.chain ?? "all") === chain.value}
            aria-label={chain.label}
            title={chain.label}
            onClick={() => onApply?.({ ...value, ...(chain.value === "all" ? { chain: undefined } : { chain: chain.value }) })}>
            <span aria-hidden="true">
              {chain.value === "all" ? <Globe2 size={18} strokeWidth={1.8} /> : <ChainMark chainId={chain.value} className={styles.chainChoiceMark} />}
            </span>
            <span className="sr-only">{chain.label}</span>
          </button>)}
        </div>
      </fieldset> : null}
      <fieldset className={styles.field}>
        <legend>Sort by</legend>
        <div className={`${styles.choices} ${styles.sortChoices}`}>
          {sortOptions.map(sort => <button type="button" key={sort.value}
            aria-pressed={value.sort === sort.value}
            onClick={() => onApply?.({ ...value, sort: sort.value })}>{sort.label}</button>)}
        </div>
      </fieldset>
      <fieldset className={styles.field}>
        <legend>Launch type</legend>
        <div className={`${styles.choices} ${styles.modeChoices}`}>
          {modeOptions.map(mode => <button type="button" key={mode.value}
            aria-pressed={(value.mode ?? "all") === mode.value}
            onClick={() => onApply?.({ ...value, mode: mode.value })}>{mode.label}</button>)}
        </div>
      </fieldset>

    </div> : null}
  </div>;
}
