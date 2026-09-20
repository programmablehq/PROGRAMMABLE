/** V1/V2 saved inputs retain their scalar. V3 always has two explicit rates. */
export type FoundationCreatorFees =
  | { creatorFeeBps: number; creatorBuyFeeBps?: never; creatorSellFeeBps?: never }
  | { creatorFeeBps?: never; creatorBuyFeeBps: number; creatorSellFeeBps: number };

export interface FoundationCreatorFeeRates { creatorBuyFeeBps: number; creatorSellFeeBps: number }

export function isFoundationCreatorFee(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1_000 && value % 100 === 0;
}

export function foundationCreatorFeeBps(value: number): number {
  if (!isFoundationCreatorFee(value)) throw new Error("Creator fees must be 0% or a whole percentage from 1% through 10%.");
  return value;
}

/** Reject partial or mixed representations instead of guessing a missing direction. */
export function foundationCreatorFeeRates(value: FoundationCreatorFees): FoundationCreatorFeeRates {
  if (value.creatorFeeBps !== undefined) {
    if (value.creatorBuyFeeBps !== undefined || value.creatorSellFeeBps !== undefined) throw new Error("Creator fees use either one legacy rate or two directional rates.");
    const fee = foundationCreatorFeeBps(value.creatorFeeBps);
    return { creatorBuyFeeBps: fee, creatorSellFeeBps: fee };
  }
  return { creatorBuyFeeBps: foundationCreatorFeeBps(value.creatorBuyFeeBps), creatorSellFeeBps: foundationCreatorFeeBps(value.creatorSellFeeBps) };
}

/** Preserve legacy DTO shape; never manufacture a scalar for a directional launch. */
export function foundationCreatorFeeFields(value: FoundationCreatorFees): FoundationCreatorFees {
  const rates = foundationCreatorFeeRates(value);
  return value.creatorFeeBps === undefined ? rates : { creatorFeeBps: value.creatorFeeBps };
}

export function foundationCreatorFeesEqual(left: FoundationCreatorFees, right: FoundationCreatorFees): boolean {
  const a = foundationCreatorFeeRates(left), b = foundationCreatorFeeRates(right);
  return a.creatorBuyFeeBps === b.creatorBuyFeeBps && a.creatorSellFeeBps === b.creatorSellFeeBps;
}
