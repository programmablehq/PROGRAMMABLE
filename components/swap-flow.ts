import type { SwapReceipt, SwapReview } from "@/lib/swap/types";

/** Continue the user's fixed trade after its required allowance transactions. */
export async function runSwapFlow(input: {
  review: SwapReview;
  assertCurrent: () => void;
  prepare: () => Promise<SwapReview>;
  submit: (review: SwapReview) => Promise<{ wait: () => Promise<SwapReceipt> }>;
}) {
  const intent = input.review;
  let review = intent;
  let approvals = 0;
  while (true) {
    input.assertCurrent();
    if (review.chainId !== intent.chainId || review.owner.toLowerCase() !== intent.owner.toLowerCase()
      || review.token.toLowerCase() !== intent.token.toLowerCase() || review.side !== intent.side || review.amountIn !== intent.amountIn) {
      throw new Error("The trade changed. Try again.");
    }
    if (review.kind === "swap" && intent.minimumOutput !== null
      && (review.minimumOutput === null || review.minimumOutput < intent.minimumOutput)) {
      throw new Error("The price changed. Check the new quote and try again.");
    }
    if (review.kind === "approval" && approvals >= 3) throw new Error("The token allowance could not be confirmed. Try again.");
    const result = await input.submit(review);
    const receipt = await result.wait();
    if (receipt.status !== "success" || review.kind === "swap") return { receipt, kind: review.kind };
    approvals += 1;
    input.assertCurrent();
    review = await input.prepare();
  }
}
