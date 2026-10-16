import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const tradeSource = readFileSync(
  join(root, "components/custom-market-trade.tsx"),
  "utf8",
);
const tradeStyles = readFileSync(
  join(root, "components/token-experience.module.css"),
  "utf8",
);

describe("Custom market selector UI", () => {
  it("renders one bound market as a branded static value", () => {
    expect(tradeSource).toContain("if (markets.length === 1)");
    expect(tradeSource).toContain("styles.customMarketValue");
    expect(tradeSource).toContain("customMarketLabel(selected)");
    expect(tradeSource).toContain(
      "`${assetLabel(market.baseAsset)} / ${assetLabel(market.quoteAsset)}`",
    );
    expect(tradeSource).not.toContain("`${market.marketId} · ${market.kind}`");
  });

  it("uses branded native radio semantics when more markets exist", () => {
    expect(tradeSource).toContain("<fieldset");
    expect(tradeSource).toContain("<legend>Supported market</legend>");
    expect(tradeSource).toContain('type="radio"');
    expect(tradeSource).toContain("checked={selectedOption}");
    expect(tradeSource).toContain("onChange={() => onChange(market.marketId)}");
    expect(tradeSource).not.toContain("<select");
    expect(tradeStyles).not.toContain(".customMarketSelect select");
  });

  it("locks market and trade controls while preparation is pending", () => {
    expect(tradeSource).toContain("disabled: boolean;");
    expect(tradeSource).toContain("disabled={disabled}");
    expect(tradeSource).toContain(
      "aria-pressed={side === candidate}\n              key={candidate}\n              disabled={pending}",
    );
    expect(tradeSource).toContain(
      "value={amount} disabled={pending} onChange=",
    );
    expect(tradeSource).toContain(
      "value={slippage} disabled={pending} onChange=",
    );
    expect(tradeSource).toContain("if (pending) return;");
    expect(tradeStyles).toContain(
      ".customMarketOption:has(.customMarketOptionInput:disabled)",
    );
  });

  it("opens the canonical two-sided market on Buy and lists Buy first", () => {
    expect(tradeSource).toContain(
      'supported.includes("quote-to-base")',
    );
    expect(tradeSource).toContain(
      "preferredCustomTradeSide(capability)",
    );
    expect(tradeSource).toContain("{sideOptions.map((candidate) => {");
    expect(tradeSource).not.toContain(
      "capability.supportedSides.map((candidate) => {",
    );
  });

  it("keeps the wallet review bound to the canonical pair and exact route", () => {
    expect(tradeSource).toContain(
      "<dt>Base / quote</dt><dd>{customMarketLabel(activeMarket)}</dd>",
    );
    expect(tradeSource).toContain(
      "<dt>Market ID</dt><dd>{review.request.marketId}</dd>",
    );
    expect(tradeSource).toContain(
      "<dt>Trade direction</dt><dd>{inputSymbol} → {outputSymbol}</dd>",
    );
    expect(tradeSource).toContain(
      "Route binding: {review.request.tradeCapabilityBindingHash}",
    );
    expect(tradeSource).not.toContain(
      "<dt>Pair</dt><dd>{inputSymbol} / {outputSymbol}</dd>",
    );
    expect(tradeSource).not.toContain(
      "tradeCapabilityBindingHash.slice(",
    );
    expect(tradeStyles).toMatch(
      /\.customTradeBindingHash\s*\{[^}]*font-size:\s*10px;/s,
    );
    expect(tradeStyles).toMatch(
      /\.customTradeBindingNote\s*\{[^}]*font-size:\s*13px;/s,
    );
  });

  it("keeps the branded options touch-sized with visible keyboard focus", () => {
    expect(tradeStyles).toMatch(
      /\.customMarketOption\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(tradeStyles).toContain(
      ".customMarketOption:has(.customMarketOptionInput:focus-visible)",
    );
    expect(tradeStyles).toContain('.customMarketOption[data-selected="true"]');
  });
});
