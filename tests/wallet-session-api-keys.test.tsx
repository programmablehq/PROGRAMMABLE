import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeveloperApiKeys } from "../components/developer-api-keys";
import { useWallet } from "../components/wallet-provider";

vi.mock("../components/wallet-provider", () => ({ useWallet: vi.fn() }));

describe("API keys session restoration", () => {
  it.each([
    { identityReady: true, authenticated: true, walletLinked: true, disconnecting: false, allowed: true },
    { identityReady: false, authenticated: true, walletLinked: true, disconnecting: false, allowed: false },
    { identityReady: true, authenticated: false, walletLinked: true, disconnecting: false, allowed: false },
    { identityReady: true, authenticated: true, walletLinked: false, disconnecting: false, allowed: false },
    { identityReady: true, authenticated: true, walletLinked: true, disconnecting: true, allowed: false },
  ])("requires current authenticated ownership before provider discovery finishes: %j", (state) => {
    vi.mocked(useWallet).mockReturnValue({
      authReady: state.identityReady,
      sessionReady: false,
      authenticated: state.authenticated,
      walletLinked: state.walletLinked,
      disconnecting: state.disconnecting,
      connecting: false,
      wallet: { account: "0x1111111111111111111111111111111111111111" },
      getAccessToken: vi.fn(async () => null),
      getIdentityToken: vi.fn(async () => null),
      openWallet: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>);

    const html = renderToStaticMarkup(<DeveloperApiKeys />);
    expect(html.includes("Loading wallet session")).toBe(!state.allowed);
    expect(html).not.toContain('id="connect-title"');
  });

  it.each([false, true])(
    "waits for the wallet list when authentication is already ready (sessionReady=%s)",
    (sessionReady) => {
      const getAccessToken = vi.fn(async () => null);
      vi.mocked(useWallet).mockReturnValue({
        authReady: true,
        sessionReady,
        connecting: !sessionReady,
        openingWallet: false,
        wallet: null,
        getAccessToken,
        getIdentityToken: vi.fn(async () => null),
        openWallet: vi.fn(),
      } as unknown as ReturnType<typeof useWallet>);

      const html = renderToStaticMarkup(<DeveloperApiKeys />);
      if (sessionReady) {
        expect(html).toContain('id="connect-title"');
        expect(html).not.toContain("Loading wallet session");
      } else {
        expect(html).toContain("Loading wallet session");
        expect(html).not.toContain('id="connect-title"');
        expect(html).not.toContain("Opening wallet");
      }
      expect(getAccessToken).not.toHaveBeenCalled();
    },
  );

  it("shows only Custom Hook issuance while the wallet key list loads", () => {
    const getAccessToken = vi.fn(async () => null);
    const getIdentityToken = vi.fn(async () => null);
    vi.mocked(useWallet).mockReturnValue({
      authReady: true,
      sessionReady: true,
      connecting: false,
      openingWallet: false,
      wallet: { account: "0x1111111111111111111111111111111111111111" },
      getAccessToken,
      getIdentityToken,
      openWallet: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>);

    const html = renderToStaticMarkup(<DeveloperApiKeys />);
    expect(html).toContain("Custom hooks");
    expect(html).toContain("Robinhood");
    expect(html).not.toContain("Modules ·");
    expect(html).not.toContain("Launches + modules");
    expect(html).not.toContain('value="module-contributions"');
    expect(html).not.toContain('value="all"');
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });
});
