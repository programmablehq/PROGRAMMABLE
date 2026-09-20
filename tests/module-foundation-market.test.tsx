import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { foundationInlineTradeError, ModuleFoundationMarket, type ModuleFoundationMarketProps } from "@/components/module-foundation-market";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT, type FoundationTradeReview } from "@/lib/module-foundation/ui-types";

const address = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"11".repeat(32)}` as const;
const props: ModuleFoundationMarketProps = {
  availability: { status: "ready", chainId: 4663, chainName: "Robinhood Chain" }, contextKey: "wallet:release:coin",
  coin: { address, name: "Coin", symbol: "COIN", description: "", decimals: 18, balance: "123.456789012345678901" },
  quote: { address, chainId: 4663, symbol: "WETH", name: "Wrapped Ether", decimals: 18, supported: true },
  tradeAsset: { address: "0x0000000000000000000000000000000000000000", chainId: 4663, symbol: "ETH", name: "Ether", decimals: 18, supported: true, balance: "1" },
  maximumBuyAmount: "0.9997", creatorFeeBps: 0,
  pool: { poolId: hash, currency0: address, currency1: address, fee: 3000, tickSpacing: 60, hooks: address, poolManager: address },
  onPrepareTrade: vi.fn(), onConfirmTrade: vi.fn(),
};
const review: FoundationTradeReview = {
  id: "trade", contextKey: props.contextKey, account: address, chainId: 4663, side: "buy", expiresAt: Math.floor(Date.now() / 1000) + 120,
  simulationBlock: "1", inputAmount: "0.01", outputAmount: "10", minimumOutput: "9.7", platformFeeAmount: "0.00003", creatorFeeAmount: "0",
  platformFeeBps: 30, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT, universalRouter: address,
  transactions: [{ label: "Buy", to: address, chainId: 4663, value: "0.01", effect: "Buy COIN" }],
};
const draft = { side: "buy" as const, amount: "0.01", slippageBps: 300 };

describe("inline Foundation trading", () => {
  it("starts with Buy, gas-aware Max and three percent slippage without a review page", () => {
    const html = renderToStaticMarkup(<ModuleFoundationMarket {...props} />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Buy<\/button>/);
    expect(html).toMatch(/<summary>Slippage <span>3%<\/span><\/summary>/);
    expect(html).toMatch(/<button[^>]*class="[^"]*tradeMax[^>]*>Max<\/button>/);
    expect(html).toMatch(/<button type="submit"[^>]*>Buy<\/button>/);
    for (const removed of ["Review buy", "Continue in wallet", "Simulated at block", "Network gas is separate", "Return to trading"]) expect(html).not.toContain(removed);
    expect(props.onPrepareTrade).not.toHaveBeenCalled();
    expect(props.onConfirmTrade).not.toHaveBeenCalled();
  });

  it("keeps Connect wallet enabled with an empty amount and disables Max without verified funds", () => {
    const html = renderToStaticMarkup(<ModuleFoundationMarket {...props} maximumBuyAmount={undefined} tradeAsset={{ ...props.tradeAsset!, balance: undefined }} walletAction={{ label: "Connect wallet", onClick: vi.fn() }} />);
    const submit = html.match(/<button type="submit"[^>]*>/)?.[0];
    expect(html).toContain("Connect wallet");
    expect(submit).not.toContain("disabled");
    expect(html).toMatch(/<button[^>]*class="[^"]*tradeMax[^>]*disabled=""[^>]*>Max/);
    expect(html).not.toContain("Balance:");
  });

  it("keeps an unresolved wallet operation blocked", () => {
    const html = renderToStaticMarkup(<ModuleFoundationMarket {...props} submissionBlocked="Check the pending transaction." />);
    expect(html).toContain("Check the pending transaction.");
    expect(html.match(/<button type="submit"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("binds the direct wallet handoff to the exact input, side, chain and transaction list", () => {
    const verify = (value: FoundationTradeReview) => foundationInlineTradeError(value, draft, props.contextKey, 4663);
    expect(verify(review)).toBeNull();
    for (const changed of [{ ...review, inputAmount: "0.02" }, { ...review, side: "sell" as const }, { ...review, chainId: 1 },
      { ...review, transactions: [] }, { ...review, transactions: [{ ...review.transactions[0], chainId: 1 }] }]) expect(verify(changed)).toContain("quote changed");
  });

  it("retains release, expiry and fixed fee-recipient checks before the direct handoff", () => {
    const verify = (value: FoundationTradeReview) => foundationInlineTradeError(value, draft, props.contextKey, 4663);
    expect(verify({ ...review, contextKey: "another-wallet:release" })).toContain("changed");
    expect(verify({ ...review, expiresAt: 0 })).toContain("expired");
    expect(verify({ ...review, platformFeeRecipient: address as typeof FOUNDATION_PLATFORM_FEE_RECIPIENT })).toContain("fee");
  });
});
