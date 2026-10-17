"use client";
import { TOKEN_IMAGE_ACCEPT } from "@/lib/token-image";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ImagePlus, Plus, Waves, X } from "lucide-react";
import { foundationConfigurationError, type FoundationModuleDescriptor, type FoundationModuleSelection } from "@/lib/module-foundation/ui-types";
import { foundationStudioModules, foundationStudioSelection, type FoundationStudioCategory, type FoundationStudioDraft } from "@/lib/module-foundation/studio";
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import { MAX_OTHER_LINKS, type ModuleSocialKind } from "@/lib/module-mode/token-metadata";
import { normalizeFoundationSocialInput } from "@/lib/module-foundation/social-input";
import { ModuleFoundationConfigField } from "../module-foundation-config-field";
import { StudioCanvas } from "./studio-canvas";
import styles from "./studio.module.css";

export interface FoundationStudioProps {
  platformFeeBps?: 30 | 100;
  previousLaunchAction?: ReactNode;
  recoveryAction?: ReactNode;
  networkControl?: ReactNode;
  draft: FoundationStudioDraft;
  catalog: readonly FoundationModuleDescriptor[];
  imageSource?: string;
  imagePreparing?: boolean;
  quoteSymbol: string;
  quoteStatus?: string;
  initialBuy: string;
  actionLabel: string;
  disabled?: boolean;
  busy?: boolean;
  actionDisabled?: boolean;
  status?: string;
  error?: string;
  errors: Record<string, string>;
  customQuote: boolean;
  canResolveQuote: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  imageInput?: RefObject<HTMLInputElement | null>;
  preview?: boolean;
  modulesLoading?: boolean;
  emptyModulesMessage?: string;
  onUpdate: <K extends keyof FoundationStudioDraft>(key: K, value: FoundationStudioDraft[K]) => void;
  onSocialChange?: (kind: ModuleSocialKind, value: string) => void;
  onImageError?: () => void;
  onChooseImage: (file: File | undefined) => void;
  onRemoveImage: () => void;
  onQuoteChange: (address: string) => void;
  onDefaultQuote: () => void;
  onEnableQuote: () => void;
  onRetryAvailability?: () => void;
  onSubmit: (event: FormEvent) => void;
  onBack?: () => void;
}

type Panel = "coin" | "quote" | "fees" | string;

const moduleDescriptions: Readonly<Record<string, string>> = {
  "0x58c95276beac0d40a73b54505047ecdefaa684fed4b4b8157dcfe7a027eb7251": "For the time you choose, each wallet can buy only the percentage of the total supply you set below. All its buys count together, including the creator's first buy. Selling does not reset the limit. During this time, buys must use the official Uniswap router. Once the time ends, the limit stops.",
};

/** Presentation only. Wallet preparation, simulation, locking and receipt handling remain in the launch host. */
export function FoundationStudio({ formRef, imageInput, ...props }: FoundationStudioProps) {
  const { draft, catalog, disabled, errors } = props;
  const [chosenPanel, setPanel] = useState<Panel>("coin");
  const [handledErrors, setHandledErrors] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"modules" | "canvas" | "settings">("settings");
  const [savedConfigurations, setSavedConfigurations] = useState<Record<string, FoundationModuleSelection["configuration"]>>({});
  const [savedQuote, setSavedQuote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useRef<HTMLDialogElement>(null);
  const addOtherLink = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pickerOpen && picker.current && !picker.current.open) picker.current.showModal(); }, [pickerOpen]);
  const errorSignature = Object.entries(errors).filter(([, value]) => value).map(([key, value]) => `${key}:${value}`).sort().join("|");
  const invalidModule = draft.modules.find(item => {
    const descriptor = catalog.find(module => module.id === item.id);
    return !descriptor?.available || descriptor.fields.some(field => foundationConfigurationError(field, item.configuration[field.key]));
  });
  const errorPanel = Object.keys(errors).some(key => ["name", "symbol", "description", "image", "initialBuy", "creatorFeeBps"].includes(key) || key.startsWith("social-")) ? "coin"
    : errors.quoteAsset || errors.quoteValuation ? "quote" : errors.modules ? invalidModule?.id ?? draft.modules[0]?.id ?? "modules" : undefined;
  const panel = errorPanel && errorSignature !== handledErrors ? errorPanel : chosenPanel;
  const activeMobilePanel = errorPanel && errorSignature !== handledErrors ? "settings" : mobilePanel;
  // Keep the revealed panel when typing clears validation. Otherwise mobile
  // returns to the canvas and a desktop inspector returns to the old module.
  if (errorPanel && errorSignature !== handledErrors) {
    setHandledErrors(errorSignature);
    setPanel(errorPanel);
    setMobilePanel("settings");
  }
  const selected = catalog.find(item => item.id === panel);
  const selection = draft.modules.find(item => item.id === panel);
  const inspectedSelection = selected ? selection ?? foundationStudioSelection(selected, savedConfigurations[selected.id]) : undefined;
  const modules = foundationStudioModules(catalog, "all");
  const focusPanel = (id: Panel) => { setHandledErrors(errorSignature); setPanel(id); setMobilePanel("settings"); };
  const closePicker = () => { picker.current?.close(); setPickerOpen(false); };
  const nextPanel = (removed: string) => draft.modules.find(item => item.id !== removed)?.id ?? "coin";
  const disableQuote = () => { setSavedQuote(draft.quoteAsset); props.onDefaultQuote(); if (panel === "quote") focusPanel(nextPanel("quote")); };
  const enableQuote = () => { if (savedQuote) props.onQuoteChange(savedQuote); else props.onEnableQuote(); focusPanel("quote"); };
  const blockedReason = (descriptor: FoundationModuleDescriptor) => {
    if (!descriptor.available) return descriptor.unavailableReason || "Module unavailable";
    if (draft.modules.some(item => item.id === descriptor.id)) return undefined;
    if (draft.modules.length >= 8) return "Select up to eight modules.";
    const conflict = descriptor.conflictsWith?.find(id => draft.modules.some(item => item.id === id));
    return conflict ? `Cannot combine with ${catalog.find(item => item.id === conflict)?.name ?? "a selected module"}.` : undefined;
  };
  const toggle = (descriptor: FoundationModuleDescriptor) => {
    if (disabled) return;
    const existing = draft.modules.find(item => item.id === descriptor.id);
    if (existing) { setSavedConfigurations(current => ({ ...current, [descriptor.id]: existing.configuration })); props.onUpdate("modules", draft.modules.filter(item => item.id !== descriptor.id)); if (panel === descriptor.id) focusPanel(nextPanel(descriptor.id)); }
    else if (!blockedReason(descriptor)) { props.onUpdate("modules", [...draft.modules, foundationStudioSelection(descriptor, savedConfigurations[descriptor.id])]); focusPanel(descriptor.id); }
  };
  const moduleNodes = draft.modules.map(item => ({ id: item.id, name: catalog.find(module => module.id === item.id)?.name ?? "Module", value: undefined, icon: <ModuleLogo category={catalog.find(module => module.id === item.id)?.studio?.category ?? "other"} /> }));
  const nodes = [
    ...(props.customQuote ? [{ id: "quote", name: "Any Quote Pool", value: `$${draft.symbol || "COIN"} / ${props.quoteSymbol}`, icon: <ModuleLogo quote /> }] : []),
    ...(draft.creatorFeeBps ? [{ id: "fees", name: "Creator fees", value: `${draft.creatorFeeBps / 100}%`, icon: <ModuleLogo category="fees" /> }] : []),
    ...moduleNodes,
  ];
  const updateSocial = (key: ModuleSocialKind, value: string) => props.onSocialChange
    ? props.onSocialChange(key, value) : props.onUpdate("socialLinks", { ...draft.socialLinks, [key]: value });
  // Legacy project links remain editable when opening an older saved draft.
  const otherLinks = [...(["discord", "github", "gitbook"] as const).flatMap(key => draft.socialLinks[key] ? [draft.socialLinks[key]!] : []), ...(draft.socialLinks.other ?? [])];
  const updateOtherLinks = (other: string[]) => { const links = { ...draft.socialLinks, other }; delete links.discord; delete links.github; delete links.gitbook; props.onUpdate("socialLinks", links); };
  const focusOtherLink = (index: number) => requestAnimationFrame(() => {
    const input = addOtherLink.current?.closest("form")?.querySelector<HTMLInputElement>(`#foundation-other-${index}`);
    (input ?? addOtherLink.current)?.focus();
  });
  const field = (key: "name" | "symbol" | "description", label: string, placeholder: string, maxLength: number) => <StudioField id={`foundation-${key}`} label={label} error={errors[key]}>
    {key === "description" ? <textarea id={`foundation-${key}`} name={key} rows={2} maxLength={maxLength} value={draft[key]} placeholder={placeholder} aria-invalid={Boolean(errors[key]) || undefined} aria-describedby={errors[key] ? `foundation-${key}-error` : undefined} onChange={event => props.onUpdate(key, event.target.value)} />
      : <div className={key === "symbol" ? styles.cashtagInput : undefined}>{key === "symbol" ? <span aria-hidden="true">$</span> : null}<input id={`foundation-${key}`} name={key} autoComplete="off" spellCheck={key === "symbol" ? false : undefined} maxLength={maxLength} value={draft[key]} placeholder={placeholder} aria-invalid={Boolean(errors[key]) || undefined} aria-describedby={errors[key] ? `foundation-${key}-error` : undefined} onChange={event => props.onUpdate(key, key === "symbol" ? event.target.value.replace(/^\$/, "").toUpperCase() : event.target.value)} /></div>}
  </StudioField>;

  return <form className={styles.studio} ref={formRef} onSubmit={event => { setHandledErrors(""); props.onSubmit(event); }} noValidate>
    <header className={styles.heading}>{props.preview ? <a className={styles.homeLogo} href="https://programmable.market" aria-label="Programmable home"><Image src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png" alt="" width={42} height={52} unoptimized /></a> : null}<div className={styles.title}><h1>Module Mode</h1><p>Build your coin with the rules you choose</p>{props.networkControl}</div>{props.preview ? <span className={styles.previewTag}>Preview</span> : null}</header>
    <nav className={styles.mobileNavigation} aria-label="Studio panels">{(["modules", "canvas", "settings"] as const).map(value => <button type="button" key={value} aria-pressed={activeMobilePanel === value} onClick={() => { setPanel(panel); setHandledErrors(errorSignature); setMobilePanel(value); }}>{value === "canvas" ? "Your coin" : value[0].toUpperCase() + value.slice(1)}</button>)}</nav>
    <fieldset className={styles.workspace} disabled={disabled} data-mobile-panel={activeMobilePanel}>
      <aside id="studio-module-library" tabIndex={-1} className={styles.library} aria-label="Module library">
        <div className={styles.panelHeading}><h2>Modules</h2></div>
        <div className={styles.moduleList} aria-busy={props.modulesLoading || undefined}>
          {props.canResolveQuote && !props.modulesLoading ? <button type="button" className={styles.moduleCard} data-active={props.customQuote} role="switch" aria-label="Any Quote Pool" aria-checked={props.customQuote} onClick={() => props.customQuote ? disableQuote() : enableQuote()}>
            <span className={styles.moduleName}><ModuleLogo quote /><span>Any Quote Pool</span></span>
            <span className={styles.toggle} data-checked={props.customQuote} aria-hidden="true"><span /></span>
          </button> : null}
          {props.modulesLoading ? <ModuleListLoading /> : <>
          {modules.map(module => { const enabled = draft.modules.some(item => item.id === module.id); const reason = !enabled ? blockedReason(module) : undefined; return <button type="button" className={styles.moduleCard} key={`${module.id}:${module.version}`} data-active={enabled} data-unavailable={!module.available} disabled={module.comingSoon && !enabled} role="switch" aria-label={module.name} aria-checked={enabled} aria-disabled={Boolean(reason) || undefined} title={reason} onClick={() => reason ? focusPanel(module.id) : toggle(module)}>
            <span className={styles.moduleName}><ModuleLogo category={module.studio?.category ?? "other"} /><span>{module.name}{module.comingSoon ? <small className={styles.comingSoon}>Coming soon</small> : null}</span></span>
            {!module.comingSoon || enabled ? <span className={styles.toggle} data-checked={enabled} aria-hidden="true"><span /></span> : null}
          </button>; })}
          {!catalog.length ? <div className={styles.emptyCard}>{props.emptyModulesMessage || "No modules available"}</div> : null}
          </>}
        </div>
        {props.previousLaunchAction ? <div className={styles.libraryFooter}>{props.previousLaunchAction}</div> : null}
      </aside>

      <section className={styles.market} aria-label="Coin composition">
        <StudioCanvas nodes={nodes} activeId={panel} disabled={disabled} onSelect={focusPanel} onAdd={() => setPickerOpen(true)} coin={<>
            <div className={styles.coinArtwork}><Image src={props.imageSource ?? FOUNDATION_DEFAULT_IMAGE.url} alt={`${draft.name || "Your coin"} artwork`} width={168} height={168} unoptimized draggable={false} onError={props.onImageError} /></div><strong>{draft.name || "Your coin"}</strong><span>${draft.symbol || "COIN"}</span><div className={styles.coinPair}>${draft.symbol || "COIN"} / {props.quoteSymbol}</div>
        </>} />
      </section>

      <aside className={styles.inspector} aria-label="Coin and module settings">
        {panel !== "coin" ? <button type="button" className={styles.inspectorBack} onClick={() => focusPanel("coin")}><ArrowLeft size={16} /> Back to coin details</button> : null}
        <div className={styles.panelHeading}><h2>{panel === "coin" ? "Coin details" : panel === "quote" ? "Any Quote Pool" : panel === "fees" ? "Creator fees" : panel === "modules" ? "Selected modules" : selected?.name ?? "Settings"}</h2></div>
        <div className={styles.inspectorContent} key={panel}>
          {panel === "coin" ? <>
            <div className={styles.imageControl}><button type="button" disabled={disabled || props.imagePreparing} data-invalid={Boolean(errors.image) || undefined} aria-describedby={errors.image ? "foundation-image-error" : undefined} onClick={() => imageInput?.current?.click()}><ImagePlus size={20} />{props.imagePreparing ? "Preparing image…" : props.imageSource ? "Change image" : "Add image"}</button>{props.imageSource ? <button type="button" aria-label="Remove coin image" disabled={disabled} onClick={props.onRemoveImage}><X size={18} /></button> : null}<input className={styles.hiddenInput} ref={imageInput} type="file" disabled={disabled || props.imagePreparing} accept={TOKEN_IMAGE_ACCEPT} aria-label="Coin image file" onChange={event => { props.onChooseImage(event.target.files?.[0]); event.target.value = ""; }} /></div>
            {props.imagePreparing ? <span role="status">Preparing image…</span> : null}
            {errors.image ? <div id="foundation-image-error" className={styles.error} role="alert">{errors.image}</div> : null}
            {field("name", "Name", "Coin name", 48)}{field("symbol", "Ticker", "COIN", 12)}
            <section className={styles.baseSection} aria-label="Launch settings"><h3>Launch settings</h3>
              <div className={styles.launchFields}>
              <StudioField id="foundation-initial-buy" label="First buy · ETH" error={errors.initialBuy}><input id="foundation-initial-buy" name="initialBuy" inputMode="decimal" autoComplete="off" required value={props.initialBuy} aria-invalid={Boolean(errors.initialBuy) || undefined} aria-describedby={errors.initialBuy ? "foundation-initial-buy-error" : "foundation-first-buy-help"} placeholder="ETH amount" onChange={event => props.onUpdate("initialBuy", event.target.value)} /></StudioField>
              <StudioField id="foundation-creator-fee-inline" label="Creator fees · %" error={errors.creatorFeeBps}><input id="foundation-creator-fee-inline" name="creatorFeeBps" type="number" min={0} max={10} step={1} value={draft.creatorFeeBps / 100} aria-invalid={Boolean(errors.creatorFeeBps) || undefined} aria-describedby={errors.creatorFeeBps ? "foundation-creator-fee-inline-error" : undefined} onChange={event => props.onUpdate("creatorFeeBps", Number(event.target.value) * 100)} /></StudioField>
              </div>
              <p id="foundation-first-buy-help" className={styles.settingStatus}>Minimum about $2, plus gas. Included in your launch.</p>
            </section>
            <StudioDetails title="Description & links · optional" forceOpen={Boolean(errors.description) || Object.keys(errors).some(key => key.startsWith("social-"))}>
              {field("description", "Description", "About your coin", 280)}
              {(["website", "twitter", "telegram"] as const).map(key => <StudioField key={key} id={`foundation-social-${key}`} label={key === "twitter" ? "X" : key === "website" ? "Website" : "Telegram"} error={errors[`social-${key}`]}><input id={`foundation-social-${key}`} name={key} inputMode={key === "website" ? "url" : "text"} autoComplete="off" autoCapitalize="none" spellCheck={false} value={draft.socialLinks[key] ?? ""} aria-invalid={Boolean(errors[`social-${key}`]) || undefined} aria-describedby={errors[`social-${key}`] ? `foundation-social-${key}-error` : undefined} placeholder={key === "website" ? "example.com" : "@username or link"} onChange={event => updateSocial(key, event.target.value)} onBlur={event => { const value = normalizeFoundationSocialInput(key, event.target.value); if (value !== event.target.value) updateSocial(key, value); }} /></StudioField>)}
              <div className={styles.otherHeading}><h3>Other links</h3><button ref={addOtherLink} type="button" aria-label="Add other link" disabled={otherLinks.length >= MAX_OTHER_LINKS} onClick={() => { updateOtherLinks([...otherLinks, ""]); focusOtherLink(otherLinks.length); }}><Plus size={17} /></button></div>
              {otherLinks.map((link, index) => <div key={index} className={styles.otherLink}><div className={styles.field}><label className="sr-only" htmlFor={`foundation-other-${index}`}>Other link {index + 1}</label><input id={`foundation-other-${index}`} name={`other-${index}`} inputMode="url" value={link} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://" aria-invalid={Boolean(errors["social-other"]) || undefined} aria-describedby={errors["social-other"] ? "foundation-other-error" : undefined} onChange={event => updateOtherLinks(otherLinks.map((value, i) => i === index ? event.target.value : value))} onBlur={event => updateOtherLinks(otherLinks.map((value, i) => i === index ? normalizeFoundationSocialInput("website", event.target.value) : value))} /></div><button type="button" aria-label={`Remove other link ${index + 1}`} onClick={() => { updateOtherLinks(otherLinks.filter((_, i) => i !== index)); focusOtherLink(Math.min(index, otherLinks.length - 2)); }}><X size={16} /></button></div>)}
              {errors["social-socialLinks"] ? <span className={styles.error}>{errors["social-socialLinks"]}</span> : null}
              {errors["social-other"] ? <span id="foundation-other-error" className={styles.error}>{errors["social-other"]}</span> : null}
            </StudioDetails>
          </> : panel === "quote" ? <>
            <p className={styles.moduleDescription}>Trade your coin against another token instead of ETH.</p>
            <button type="button" className={styles.quoteChoice} aria-pressed={!props.customQuote} onClick={disableQuote}><Waves size={22} /><strong>ETH</strong>{!props.customQuote ? <Check size={18} /> : null}</button>
            <StudioField id="foundation-quote" label="Quote token address"><input id="foundation-quote" name="quoteAsset" value={props.customQuote ? draft.quoteAsset : ""} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(errors.quoteAsset) || undefined} aria-describedby={props.quoteStatus || errors.quoteAsset ? "foundation-quote-status" : undefined} placeholder="Token address · 0x…" onChange={event => props.onQuoteChange(event.target.value)} /></StudioField>
            {props.quoteStatus || errors.quoteAsset ? <div id="foundation-quote-status" className={errors.quoteAsset ? styles.error : styles.settingStatus} role="status">{errors.quoteAsset || props.quoteStatus}</div> : null}
            {props.customQuote ? <section className={styles.baseSection} aria-label="Starting value"><h3>Starting value</h3>
              <div className={`${styles.presets} ${styles.valueCurrency}`} role="group" aria-label="Starting value currency">
                <button type="button" aria-pressed={draft.quoteValuation === undefined} onClick={() => props.onUpdate("quoteValuation", undefined)}>Automatic USD</button>
                <button type="button" aria-pressed={draft.quoteValuation !== undefined} onClick={() => props.onUpdate("quoteValuation", draft.quoteValuation ?? "")}>Set in {props.quoteSymbol}</button>
              </div>
              {draft.quoteValuation !== undefined ? <>
                <StudioField id="foundation-quote-valuation" label={`Starting market cap · ${props.quoteSymbol}`} error={errors.quoteValuation}>
                  <input id="foundation-quote-valuation" name="quoteValuation" value={draft.quoteValuation} inputMode="decimal" autoComplete="off" placeholder="Enter a value" aria-invalid={Boolean(errors.quoteValuation) || undefined} aria-describedby={errors.quoteValuation ? "foundation-quote-value-help foundation-quote-valuation-error" : "foundation-quote-value-help"} onChange={event => props.onUpdate("quoteValuation", event.target.value)} />
                </StudioField>
                <p id="foundation-quote-value-help" className={styles.settingStatus}>Total supply value in {props.quoteSymbol}. The ETH first buy is included in your launch.</p>
              </> : <p className={styles.settingStatus}>Starts near $5,000. Requires a market price for the paired token.</p>}
            </section> : null}
          </> : panel === "fees" ? <>
            <p className={styles.moduleDescription}>Set the percentage of each buy and sell that goes to the creator. The platform fee is charged separately.</p>
            <label className={styles.largeNumber}><span>Buy & sell</span><div><input id="foundation-creator-fee" type="number" min={0} max={10} step={1} value={draft.creatorFeeBps / 100} onChange={event => props.onUpdate("creatorFeeBps", Number(event.target.value) * 100)} /><span>%</span></div></label>
            <input aria-label="Creator fees" className={styles.range} type="range" min={0} max={10} step={1} value={draft.creatorFeeBps / 100} onChange={event => props.onUpdate("creatorFeeBps", Number(event.target.value) * 100)} />
            <div className={styles.presets}>{[0, 1, 3, 5].map(value => <button type="button" key={value} aria-pressed={draft.creatorFeeBps === value * 100} onClick={() => props.onUpdate("creatorFeeBps", value * 100)}>{value}%</button>)}</div>
            <div className={styles.settingStatus}>Platform fee <strong>{(props.platformFeeBps ?? 30) / 100}%</strong></div>{errors.creatorFeeBps ? <div className={styles.error}>{errors.creatorFeeBps}</div> : null}
          </> : panel === "modules" ? draft.modules.map(item => <button type="button" className={styles.summaryButton} key={item.id} onClick={() => focusPanel(item.id)}><ModuleLogo category={catalog.find(module => module.id === item.id)?.studio?.category ?? "other"} />{catalog.find(module => module.id === item.id)?.name ?? "Module"}</button>) : selected ? <>
            <p className={styles.moduleDescription}>{moduleDescriptions[selected.id] ?? selected.description}</p>
            {selected.fields.map(configField => <div className={styles.settingCard} data-kind={configField.kind} key={configField.key}><ModuleFoundationConfigField compact field={configField} id={`foundation-module-${encodeURIComponent(selected.id)}-${encodeURIComponent(configField.key)}`} value={inspectedSelection!.configuration[configField.key]} showErrors={Boolean(errors.modules)} onChange={value => {
              const next = { ...inspectedSelection!, configuration: { ...inspectedSelection!.configuration, [configField.key]: value } };
              setSavedConfigurations(current => ({ ...current, [selected.id]: next.configuration }));
              if (selection && selected.available) props.onUpdate("modules", draft.modules.map(item => item.id === selected.id ? next : item));
            }} /></div>)}
            <StudioDetails title="Details">{selected.fields.map(configField => configField.description ? <p key={configField.key}><strong>{configField.label}</strong><br />{configField.description}</p> : null)}</StudioDetails>
            {blockedReason(selected) ? <div className={styles.error}>{blockedReason(selected)}</div> : null}{errors.modules ? <div className={styles.error}>{errors.modules}</div> : null}
          </> : selection ? <p className={styles.error}>This module is no longer available. Remove it and choose a current module.</p> : null}
          {selection ? <button type="button" className={styles.inspectorBack} onClick={() => {
            setSavedConfigurations(current => ({ ...current, [selection.id]: selection.configuration }));
            props.onUpdate("modules", draft.modules.filter(item => item.id !== selection.id));
            focusPanel(nextPanel(selection.id));
          }}><X size={16} /> Remove {selected?.name ?? "module"}</button> : null}
        </div>
        <div className={styles.inspectorAction}>
          {props.recoveryAction}
          <button type="submit" className={styles.launch} disabled={props.actionDisabled || disabled} aria-busy={props.busy}>{props.actionLabel}<ArrowRight size={19} /></button>
          {props.error || props.status || props.onRetryAvailability ? <div className={styles.actionStatus} role={props.error ? "alert" : "status"}>{props.error ? <span className={styles.error}>{props.error}</span> : props.status ? <span>{props.status}</span> : null}{props.onRetryAvailability ? <button type="button" onClick={props.onRetryAvailability} disabled={props.busy}>Retry</button> : null}</div> : null}
        </div>
      </aside>
    </fieldset>
    {pickerOpen ? <dialog ref={picker} className={styles.picker} aria-labelledby="studio-picker-title" onClose={() => setPickerOpen(false)} onCancel={event => { event.preventDefault(); closePicker(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePicker();
    }}>
      <div className={styles.pickerHeading}><h2 id="studio-picker-title">Add module</h2><button type="button" aria-label="Close module list" onClick={closePicker} autoFocus><X size={20} /></button></div>
      <div className={styles.pickerList}>
        {props.canResolveQuote ? <button type="button" disabled={disabled} className={styles.pickerModule} onClick={() => { closePicker(); if (props.customQuote) focusPanel("quote"); else enableQuote(); }}><ModuleLogo quote /><span className={styles.pickerModuleLabel}>Any Quote Pool</span>{props.customQuote ? <Check size={18} /> : <Plus size={18} />}</button> : null}
        {props.modulesLoading ? <ModuleListLoading /> : <>
        {modules.map(module => { const enabled = draft.modules.some(item => item.id === module.id); return <button type="button" key={module.id} className={styles.pickerModule} data-unavailable={!module.available} disabled={disabled || (!enabled && Boolean(blockedReason(module)))} title={blockedReason(module)} onClick={() => { closePicker(); if (enabled) focusPanel(module.id); else toggle(module); }}><ModuleLogo category={module.studio?.category ?? "other"} /><span className={styles.pickerModuleLabel}>{module.name}{module.comingSoon ? <small className={styles.comingSoon}>Coming soon</small> : null}</span>{enabled ? <Check size={18} /> : !module.comingSoon ? <Plus size={18} /> : null}</button>; })}
        {!catalog.length && !props.canResolveQuote ? <div className={styles.emptyCard}>{props.emptyModulesMessage || "No modules available"}</div> : null}
        </>}
      </div>
    </dialog> : null}
  </form>;
}

function StudioField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}
    {error ? <span id={`${id}-error`} className={styles.error}>{error}</span> : null}</div>;
}

function StudioDetails({ title, children, forceOpen = false }: { title: string; children: ReactNode; forceOpen?: boolean }) {
  const [expanded, setOpen] = useState(false);
  if (forceOpen && !expanded) setOpen(true);
  const open = forceOpen || expanded;
  const id = useId();
  return <section className={styles.details} data-open={open}><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)}>{title}<ChevronDown size={16} /></button>
    <div id={id} className={styles.fold} inert={!open} aria-hidden={!open}><div><div className={styles.foldContent}>{children}</div></div></div>
  </section>;
}

function ModuleLogo({ category = "other", quote = false }: { category?: FoundationStudioCategory; quote?: boolean }) {
  return <span className={styles.moduleArt} data-flower={quote ? "quote" : category} aria-hidden="true" />;
}

function ModuleListLoading() {
  return <div className={styles.moduleLoading} role="status"><span className="sr-only">Loading modules…</span><div aria-hidden="true" /></div>;
}
