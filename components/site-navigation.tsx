"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import {
  DiscordBrandIcon,
  DuneBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import {
  NavigationCloseIcon,
  NavigationMenuIcon,
} from "@/components/navigation-icons";
import { useWallet } from "@/components/wallet-provider";
import { AdminDashboardLink } from "@/components/admin-dashboard-link";
import styles from "@/components/site-navigation.module.css";

const desktopNavItems = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Launch a coin", activePath: "/launch" },
];

const menuNavItems = [
  { href: "/launch", label: "Launch options" },
  { href: "/developers/api-keys", label: "API keys" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
  { href: "/privacy", label: "Privacy & settings" },
];

const mobileNavItems = [desktopNavItems[0], ...menuNavItems];

function warmNavigationRoute(
  router: ReturnType<typeof useRouter>,
  href: string,
) {
  // The router deduplicates fresh entries and renews expired route data.
  router.prefetch(href);
}

function HeaderSocialLinks({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={
        mobile ? styles.mobileSocials : `header-socials ${styles.headerSocials}`
      }
      role="group"
      aria-label="Programmable social links"
    >
      <a
        className="header-social-link"
        href="https://x.com/ProgrammableHQ"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on X"
      >
        <XBrandIcon />
      </a>
      <a
        className="header-social-link"
        href="https://dexscreener.com/robinhood/0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on DEX Screener"
      >
        <Image
          className="header-social-logo"
          src="/brand/platforms/dexscreener-mark-warm-ivory-v1.png"
          alt=""
          width={256}
          height={256}
          sizes="22px"
        />
      </a>
      <a
        className="header-social-link"
        href="https://dune.com/programmablehq/analytics"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable analytics on Dune"
      >
        <DuneBrandIcon />
      </a>
      <a
        className="header-social-link"
        href="https://discord.com/invite/programmable"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on Discord"
      >
        <DiscordBrandIcon />
      </a>
    </div>
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function HeaderWalletButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const { wallet, hasSession, connecting, openingWallet, disconnecting, openWallet, preloadWallet } = useWallet();
  const label = disconnecting
    ? "Disconnecting"
    : connecting
      ? openingWallet ? "Opening wallet" : "Loading wallet"
      : hasSession ? "Reconnect wallet" : "Connect wallet";

  if (wallet) {
    return <span className={styles.headerWalletSummary} aria-label={`Connected wallet ${shortenAddress(wallet.account)}`}>
      {shortenAddress(wallet.account)}
    </span>;
  }

  return <button
    className={styles.headerWalletButton}
    type="button"
    disabled={connecting || disconnecting}
    aria-busy={connecting || disconnecting || undefined}
    aria-haspopup="dialog"
    aria-label={label}
    onFocus={preloadWallet}
    onPointerEnter={preloadWallet}
    onClick={() => { onOpen(); openWallet(); }}
  >
    <WalletIcon className={styles.headerWalletIcon} size={22} aria-hidden="true" />
    <span className={styles.headerWalletLabel}>{label}</span>
  </button>;
}

function HeaderWalletActions({ open, triggerRef, onClose }: Readonly<{
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}>) {
  const { wallet, authenticated, disconnecting, disconnect } = useWallet();
  const copyAddressRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const menuOpen = open && wallet !== null;
  const account = wallet?.account ?? null;
  const [feedback, setFeedback] = useState<{
    account: string | null;
    menuOpen: boolean;
    operation: object | null;
    message: string;
    copyFailed: boolean;
  }>({ account, menuOpen, operation: null, message: "", copyFailed: false });

  // An asynchronous result belongs only to the account and menu that started it.
  if (feedback.account !== account || feedback.menuOpen !== menuOpen) {
    setFeedback({ account, menuOpen, operation: null, message: "", copyFailed: false });
  }
  const feedbackCurrent = feedback.account === account && feedback.menuOpen === menuOpen;
  const message = feedbackCurrent ? feedback.message : "";
  const showCopyAddress = menuOpen && feedbackCurrent && feedback.copyFailed;

  useEffect(() => {
    if (!showCopyAddress) return;
    copyAddressRef.current?.focus();
    copyAddressRef.current?.select();
  }, [showCopyAddress]);

  function startFeedback() {
    const operation = {};
    setFeedback({ account, menuOpen, operation, message: "", copyFailed: false });
    return operation;
  }
  function completeFeedback(operation: object, text: string, copyFailed = false) {
    setFeedback((current) => current.operation === operation &&
      current.account === account && current.menuOpen
      ? { ...current, message: text, copyFailed }
      : current);
  }

  if (!wallet) return null;
  return <div className={styles.walletActions} role="group" aria-label="Wallet actions">
    <p className={styles.walletIdentity}>
      <span>Connected wallet</span>
      <span>{shortenAddress(wallet.account)}</span>
    </p>
    <AdminDashboardLink account={wallet.account} authenticated={authenticated}
      menuOpen={menuOpen} onNavigate={onClose} />
    <button type="button" onClick={async () => {
      const operation = startFeedback();
      try {
        await navigator.clipboard.writeText(wallet.account);
        completeFeedback(operation, "Address copied");
      } catch {
        completeFeedback(operation, "Select and copy the address below.", true);
      }
    }}>Copy address</button>
    <button type="button" aria-disabled={disconnecting || undefined} aria-busy={disconnecting || undefined} onClick={async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      const operation = startFeedback();
      try {
        if (await disconnect({ showDialogOnFailure: false })) {
          onClose();
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        } else {
          completeFeedback(operation, "Unable to disconnect. Try again.");
        }
      } catch {
        completeFeedback(operation, "Unable to disconnect. Try again.");
      } finally {
        busyRef.current = false;
      }
    }}>{disconnecting ? "Disconnecting…" : "Disconnect"}</button>
    <p className={message ? styles.walletFeedback : "sr-only"} role="status" aria-live="polite">{message}</p>
    {showCopyAddress ? <input ref={copyAddressRef} className={styles.walletAddress}
      aria-label="Wallet address" readOnly value={wallet.account}
      onFocus={(event) => event.currentTarget.select()} /> : null}
  </div>;
}

function isCurrent(pathname: string, item: (typeof desktopNavItems)[number]) {
  const activePath = "activePath" in item ? item.activePath : item.href;

  if (activePath === "/explore") {
    return pathname === "/explore" || pathname.startsWith("/explore/");
  }
  if (activePath === "/docs") {
    return pathname === "/docs" || pathname.startsWith("/docs/");
  }
  return pathname === activePath || pathname.startsWith(`${activePath}/`);
}

function DesktopNavigation() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  return (
    <nav className="desktop-nav" aria-label="Primary navigation">
      {desktopNavItems.map((item) => {
        const current = isCurrent(pathname, item);
        return (
          <Link
            key={item.href}
            className={current ? "active" : undefined}
            href={item.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            onFocus={() => warmNavigationRoute(router, item.href)}
            onPointerEnter={() => warmNavigationRoute(router, item.href)}
            onPointerDown={() => warmNavigationRoute(router, item.href)}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [navigationInput, setNavigationInput] = useState<"pointer" | "keyboard">("pointer");
  const menuOpen = menuPath === pathname;

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!headerRef.current?.contains(event.target)) {
        setMenuPath(null);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavigationInput("keyboard");
      if (menuOpen) {
        setMenuPath(null);
        menuButtonRef.current?.focus();
      }
    };

    const closeOnHistoryNavigation = () => {
      setMenuPath(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("popstate", closeOnHistoryNavigation);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("popstate", closeOnHistoryNavigation);
    };
  }, [menuOpen]);

  function closeOnFocusLeave(event: FocusEvent<HTMLElement>) {
    if (!menuOpen) return;
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    const header = event.currentTarget;
    window.requestAnimationFrame(() => {
      if (!header.contains(document.activeElement)) setMenuPath(null);
    });
  }

  return (
    <header
      ref={headerRef}
      className={`site-header ${styles.siteHeader}`}
      data-navigation-input={navigationInput}
      onBlur={closeOnFocusLeave}
      onPointerDownCapture={() => setNavigationInput("pointer")}
      onKeyDownCapture={() => setNavigationInput("keyboard")}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a[href]")) {
          setMenuPath(null);
        }
      }}
    >
      <div className={`header-inner ${styles.headerInner}`}>
        <div className="header-brand">
          <Link
            className="wordmark"
            href="/"
            prefetch={false}
            aria-label="Programmable home"
          >
            <Image
              className="wordmark-logo"
              src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png"
              alt=""
              width={1168}
              height={1536}
              sizes="32px"
              priority
            />
          </Link>
        </div>

        <DesktopNavigation />

        <Link
          className={styles.mobileLaunch}
          href="/launch"
          prefetch={false}
          aria-current={pathname.startsWith("/launch") ? "page" : undefined}
        >
          Launch a coin
        </Link>

        <div className={`header-actions ${styles.headerActions}`}>
          <HeaderWalletButton onOpen={() => setMenuPath(null)} />
          <button
            ref={menuButtonRef}
            className={styles.menuButton}
            type="button"
            aria-controls={menuId}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => {
              setMenuPath(menuOpen ? null : pathname);
            }}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              <NavigationMenuIcon
                className={menuOpen ? styles.iconHidden : styles.iconVisible}
              />
              <NavigationCloseIcon
                className={menuOpen ? styles.iconVisible : styles.iconHidden}
              />
            </span>
          </button>
        </div>

        <div
          className={`${styles.mobileSheet} ${
            menuOpen ? styles.mobileSheetOpen : ""
          }`}
          aria-hidden={!menuOpen}
          inert={menuOpen ? undefined : true}
        >
          <div className={styles.mobileSheetSurface} id={menuId}>
            <MobileNavigation
              id={menuId}
              open={menuOpen}
              onNavigate={() => setMenuPath(null)}
            />
            <HeaderWalletActions open={menuOpen} triggerRef={menuButtonRef} onClose={() => setMenuPath(null)} />
            <HeaderSocialLinks mobile />
          </div>
        </div>
      </div>
    </header>
  );
}

type MobileNavigationProps = {
  id?: string;
  open?: boolean;
  onNavigate?: () => void;
};

export function MobileNavigation({
  id,
  open = false,
  onNavigate,
}: MobileNavigationProps = {}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  // AppShell retains this export for compatibility. The responsive navigation
  // is rendered inside SiteHeader so its visual and keyboard order stay at the
  // top of the page.
  if (!id) return null;

  return (
    <nav className="mobile-nav" aria-label="Menu navigation">
      {mobileNavItems.map((item) => {
        const current = isCurrent(pathname, item) &&
          !(item.href === "/launch" && pathname.startsWith("/launch/modules"));
        return (
          <Link
            key={item.href}
            className={[
              current ? "active" : "",
              desktopNavItems.includes(item) ? styles.mobilePrimaryLink : "",
            ].filter(Boolean).join(" ") || undefined}
            href={item.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            tabIndex={open ? undefined : -1}
            onFocus={() => warmNavigationRoute(router, item.href)}
            onPointerEnter={() => warmNavigationRoute(router, item.href)}
            onPointerDown={() => warmNavigationRoute(router, item.href)}
            onClick={onNavigate}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
