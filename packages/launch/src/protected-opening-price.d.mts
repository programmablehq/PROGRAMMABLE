export function protectedSqrtPriceAtTickV1(tick: number): bigint;
export function protectedOpeningPriceV1(input: {
  supply: string;
  answer: bigint;
  feedDecimals?: number;
  targetFdvUsd?: string;
}): { initialTick: number; sqrtPriceX96: bigint; openingFdvUsd: bigint };
