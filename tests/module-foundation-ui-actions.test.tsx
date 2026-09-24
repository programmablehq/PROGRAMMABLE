import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FoundationTransactionSteps } from "@/components/module-foundation-review";
import { ModuleFoundationActions, ModuleFoundationActionReview, foundationActionFieldErrors, foundationActionReviewError, foundationActionUnavailableReason, type FoundationActionDescriptor, type FoundationActionReview } from "@/components/module-foundation-actions";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT } from "@/lib/module-foundation/ui-types";

const account = "0x1111111111111111111111111111111111111111" as const;
const ledger = "0x2222222222222222222222222222222222222222" as const;
const quote = { address: "0x3333333333333333333333333333333333333333" as const, symbol: "Q", decimals: 6 };
const availability = { status: "ready" as const, chainId: 4663, chainName: "Robinhood Chain" };
const payout: FoundationActionDescriptor = {
  id: "ledger:platform-payout", label: "Platform fee payout", description: "Pay the available ledger balance to its fixed recipient.",
  fields: [], available: true, role: "public",
  payout: { asset: quote, recipient: FOUNDATION_PLATFORM_FEE_RECIPIENT, claimableAmount: "12.000001", creditedAmount: "15.000001", paidAmount: "3", asOfBlock: "111" },
};
const action: FoundationActionDescriptor = {
  id: "technical.fixture:record", actionId: "record", label: "Record observation", description: "Technical action fixture.", available: true, role: "creator",
  fields: [{ key: "/step", label: "Step", kind: "integer", required: true }, { key: "/enabled", label: "Enabled", kind: "boolean", required: true }],
};
const review: FoundationActionReview = {
  id: "review-fixture", actionId: payout.id, contextKey: "wallet:source:pool", account, chainId: 4663, simulationBlock: "112", expiresAt: 200,
  configuration: {}, transfers: [{ asset: quote, recipient: FOUNDATION_PLATFORM_FEE_RECIPIENT, amount: "12.000001" }],
  transactions: [{ label: "Pay platform fees", to: ledger, chainId: 4663, value: "0", effect: `Transfer 12.000001 Q to ${FOUNDATION_PLATFORM_FEE_RECIPIENT}.` }],
};
const verify = (value: FoundationActionReview, descriptor: FoundationActionDescriptor = payout) => foundationActionReviewError(value, descriptor, value.configuration, review.contextKey, 4663, 100_000);

describe("Foundation management actions", () => {
  it("keeps payout amount and recipient fixed without losing token precision", () => {
    expect(verify(review)).toBeNull();
    const huge = "9007199254740993.000001";
    const descriptor = { ...payout, payout: { ...payout.payout!, claimableAmount: huge } };
    const prepared = { ...review, transfers: [{ ...review.transfers[0], amount: huge }] };
    expect(verify(prepared, descriptor)).toBeNull();
    expect(verify({ ...prepared, simulationBlock: "111", transfers: [{ ...prepared.transfers[0], amount: "9007199254740993.000002" }] }, descriptor)).toContain("differs");
    expect(verify({ ...review, transfers: [{ ...review.transfers[0], recipient: account }] })).toContain("recipient");
    expect(verify({ ...review, transfers: [{ ...review.transfers[0], asset: { ...quote, address: ledger } }] })).toContain("differs");
    expect(verify({ ...review, transfers: [...review.transfers, review.transfers[0]] })).toContain("differs");
    expect(verify({ ...review, transfers: [{ ...review.transfers[0], amount: "12.0000010" }] })).toContain("amount");
  });

  it("accepts fees accrued after the displayed block but rejects a reduced or older claim", () => {
    expect(verify({ ...review, transfers: [{ ...review.transfers[0], amount: "12.000002" }] })).toBeNull();
    expect(verify({ ...review, transfers: [{ ...review.transfers[0], amount: "12" }] })).toContain("differs");
    expect(verify({ ...review, simulationBlock: "110" })).toContain("differs");
    expect(verify({ ...review, simulationBlock: "111", transfers: [{ ...review.transfers[0], amount: "12.000002" }] })).toContain("differs");
  });

  it("requires a verified nonzero claimable instead of deriving it from cumulative credits", () => {
    for (const amount of [undefined, "0", "0.000000", "1e3", "-1", "0.0000001"]) {
      expect(foundationActionUnavailableReason({ ...payout, payout: { ...payout.payout!, claimableAmount: amount } })).not.toBeNull();
    }
    expect(foundationActionUnavailableReason({ ...payout, payout: { ...payout.payout!, claimableAmount: "0.000001" } })).toBeNull();
    expect(foundationActionUnavailableReason({ ...payout, payout: { ...payout.payout!, asOfBlock: undefined } })).toContain("verified");
    expect(foundationActionUnavailableReason({ ...payout, payout: { ...payout.payout!, asset: { ...quote, decimals: -1 } } })).toContain("verified");
    expect(foundationActionUnavailableReason({ ...payout, fields: [{ key: "recipient", label: "Recipient", kind: "address" }] })).toContain("fixed payout");
  });

  it("binds each review to the current source context, network, action and exact settings", () => {
    const moduleReview = { ...review, actionId: action.id, configuration: { "/step": "1", "/enabled": false }, transfers: [] };
    expect(verify(moduleReview, action)).toBeNull();
    expect(foundationActionReviewError(moduleReview, action, { "/enabled": false, "/step": "1" }, review.contextKey, 4663, 100_000)).toBeNull();
    expect(foundationActionReviewError(moduleReview, action, { "/enabled": false, "/step": "2" }, review.contextKey, 4663, 100_000)).toContain("differs");
    expect(verify({ ...review, contextKey: "another-wallet:source:pool" })).toContain("changed");
    expect(verify({ ...review, chainId: 1 })).toContain("differs");
    expect(verify({ ...review, actionId: "another-action" })).toContain("differs");
    expect(verify({ ...review, expiresAt: 100 })).toContain("expired");
    expect(verify({ ...review, expiresAt: Number.NaN })).toContain("expired");
  });

  it("refuses incomplete transaction evidence and unavailable roles at confirmation", () => {
    expect(verify({ ...review, transactions: [] })).toContain("wallet steps");
    expect(verify({ ...review, transactions: [{ ...review.transactions[0], chainId: 1 }] })).toContain("wallet steps");
    expect(verify({ ...review, transactions: [{ ...review.transactions[0], value: "1e18" }] })).toContain("wallet steps");
    expect(verify({ ...review, simulationBlock: "pending" })).toContain("wallet steps");
    expect(verify(review, { ...payout, available: false, unavailableReason: "The required role is no longer verified." })).toContain("role");
  });

  it("preserves open primitive fields, explicit false and inert JSON text", () => {
    expect(foundationActionFieldErrors(action, { "/step": "9007199254740993", "/enabled": false })).toEqual({});
    expect(foundationActionFieldErrors(action, { "/step": "1e3", "/enabled": "false" })).toEqual({ "/step": "Enter a whole number for Step.", "/enabled": "Choose a setting for Enabled." });
    expect(foundationActionFieldErrors(action, { "/step": "1", "/enabled": false, "/undeclared": "x" })["/undeclared"]).toContain("not editable");
    const fields: FoundationActionDescriptor = { ...action, fields: [{ key: "/data", label: "Bounded data", kind: "text" }, { key: "/asset", label: "Asset", kind: "select", required: true, options: [{ value: "quote", label: "Quote" }] }] };
    expect(foundationActionFieldErrors(fields, { "/data": '[{"amount":"1"}]', "/asset": "quote" })).toEqual({});
    expect(foundationActionFieldErrors(fields, { "/asset": "invented" })["/asset"]).toContain("available option");
  });

  it("honors host visibility and role availability without inferring authority from role names", () => {
    const callbacks = { onPrepare: vi.fn(), onConfirm: vi.fn() };
    const html = renderToStaticMarkup(<ModuleFoundationActions availability={availability} contextKey={review.contextKey} actions={[{ ...action, visible: false }, { ...payout, available: false, unavailableReason: "Connect the authorized wallet." }]} {...callbacks} />);
    expect(html).not.toContain(action.label);
    expect(html).toContain("Connect the authorized wallet.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Review payout<\/button>/);
    const creator = renderToStaticMarkup(<ModuleFoundationActions availability={availability} contextKey={review.contextKey} actions={[action]} {...callbacks} />);
    expect(creator).toContain(action.label);
    expect(creator).toContain('name="/step"');
    expect(creator).toContain("Configure action");
    expect(callbacks.onPrepare).not.toHaveBeenCalled();
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
  });

  it("labels fee credits separately from actual payouts and leaves unknown balances unknown", () => {
    const html = renderToStaticMarkup(<ModuleFoundationActions availability={availability} contextKey={review.contextKey} actions={[{ ...payout, payout: { ...payout.payout!, claimableAmount: undefined } }]} onPrepare={vi.fn()} onConfirm={vi.fn()} />);
    for (const phrase of ["Available to pay", "Fees credited", "Paid onchain", "Not available", "Credit alone does not mean it reached a wallet", "block 111"]) expect(html).toContain(phrase);
    expect(html).toContain(FOUNDATION_PLATFORM_FEE_RECIPIENT);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Review payout<\/button>/);
  });

  it("disables unavailable and ambiguous action lists and displays an honest empty state", () => {
    const props = { contextKey: review.contextKey, onPrepare: vi.fn(), onConfirm: vi.fn() };
    const unavailable = renderToStaticMarkup(<ModuleFoundationActions availability={{ ...availability, status: "unavailable", reason: "No verified deployment binding." }} actions={[payout]} {...props} />);
    expect(unavailable).toContain("No verified deployment binding.");
    expect(unavailable).toMatch(/<button[^>]*disabled[^>]*>Review payout<\/button>/);
    const duplicate = renderToStaticMarkup(<ModuleFoundationActions availability={availability} actions={[payout, payout]} {...props} />);
    expect(duplicate).toContain("action list could not be verified");
    expect(duplicate.match(/<button[^>]*disabled[^>]*>Review payout<\/button>/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<ModuleFoundationActions availability={availability} actions={[]} {...props} />)).toContain("No management actions are available for this wallet.");
  });

  it("shows exact wallet effects and requires an explicit enabled confirmation control", () => {
    const callbacks = { onConfirm: vi.fn(), onEdit: vi.fn() };
    const liveReview = { ...review, expiresAt: Math.floor(Date.now() / 1000) + 120 };
    const html = renderToStaticMarkup(<ModuleFoundationActionReview review={liveReview} action={payout} configuration={{}} contextKey={review.contextKey} chainId={4663} busy={false} {...callbacks} />);
    for (const text of ["Payout review", "12.000001 Q", FOUNDATION_PLATFORM_FEE_RECIPIENT, "Native value", "Transaction details", "Continue in wallet"]) expect(html).toContain(text);
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    const blocked = renderToStaticMarkup(<ModuleFoundationActionReview review={liveReview} action={payout} configuration={{}} contextKey={review.contextKey} chainId={4663} busy={false} blockedReason="A transaction is awaiting confirmation." {...callbacks} />);
    expect(blocked).toMatch(/<button[^>]*disabled[^>]*>Continue in wallet<\/button>/);
    const approvalSteps = renderToStaticMarkup(<FoundationTransactionSteps transactions={[{ label: "Reset allowance", to: quote.address, chainId: 4663, value: "0", spender: ledger, effect: "Set the existing Q allowance to 0." }, { label: "Approve exact amount", to: quote.address, chainId: 4663, value: "0", spender: ledger, effect: "Approve exactly 12.000001 Q." }]} />);
    expect(approvalSteps).toContain("allowance to 0");
    expect(approvalSteps).toContain("exactly 12.000001 Q");
  });
});
