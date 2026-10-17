import { describe, expect, it } from "vitest";
import { foundationLaunchFeedback } from "@/lib/launch-feedback";

describe("foundation launch feedback", () => {
  it("recognizes a nested wallet rejection and preserves the draft", () => {
    expect(foundationLaunchFeedback({ message: "Provider error", cause: { code: 4001 } }, "wallet"))
      .toContain("Wallet request cancelled. Your coin details are saved.");
  });

  it("directs pending wallet requests back to the existing prompt", () => {
    expect(foundationLaunchFeedback({ code: -32002 }, "wallet")).toContain("already open in your wallet");
  });

  it("offers an actionable balance error before a wallet request", () => {
    expect(foundationLaunchFeedback({ message: "Insufficient balance", walletRequestAttempted: false }, "wallet"))
      .toContain("Reduce your first buy or add ETH");
  });

  it.each(["wallet", "result"] as const)("does not invite resending after an uncertain %s outcome", stage => {
    const message = foundationLaunchFeedback(new Error("RPC timeout"), stage);
    expect(message).toContain("may already have been sent");
    expect(message).not.toContain("Choose Launch coin");
  });

  it("does not treat a cancelled status read as a cancelled transaction", () => {
    expect(foundationLaunchFeedback({ code: 4001, message: "Cancelled" }, "result"))
      .toContain("may already have been sent");
  });

  it("removes provider URLs and gives a retry action for a failed preflight", () => {
    const message = foundationLaunchFeedback(new Error("HTTP request failed: https://rpc.example/private-key"), "simulation");
    expect(message).toContain("Choose Launch coin to try again");
    expect(message).not.toContain("private-key");
    expect(foundationLaunchFeedback(new Error("Service failed at https://example.com/secret"))).not.toContain("secret");
  });

  it("retains useful short validation messages", () => {
    expect(foundationLaunchFeedback(new Error("Enter a valid address for Reference pool.")))
      .toBe("Enter a valid address for Reference pool.");
  });
});
