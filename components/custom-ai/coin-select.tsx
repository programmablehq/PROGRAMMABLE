"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./workspace.module.css";

export function CoinSelect({ label, value, options, disabled, onChange }: {
  label: string; value: string; options: { value: string; label: string }[];
  disabled?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  useEffect(() => {
    if (!open) return;
    items.current[active]?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, active]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div className={styles.select} ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span className={styles.fieldLabel} id={`${id}-label`}>{label}</span>
    <button type="button" ref={trigger} className={styles.selectTrigger} disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? `${id}-options` : undefined}
      onClick={() => { setActive(selected); setOpen(!open); }} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setActive(selected); setOpen(true);
        }
      }}>
      <span id={`${id}-value`}>{options[selected]?.label}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && !disabled && <div className={styles.selectMenu} role="listbox" id={`${id}-options`} aria-labelledby={`${id}-label`}>
      {options.map((option, index) => <button key={option.value} ref={element => { items.current[index] = element; }}
        type="button" role="option" aria-selected={option.value === value} tabIndex={index === active ? 0 : -1}
        onClick={() => { onChange(option.value); close(); }} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          }
        }}>
        {option.label}{option.value === value && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
