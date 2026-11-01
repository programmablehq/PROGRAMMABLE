import { PROTECTED_LAUNCH_POLICY_V1 } from './launch-protection-pins-v1.mjs';

function positive(value, max = (1n << 127n) - 1n) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > max) throw new TypeError('A positive bounded decimal amount is required');
  return BigInt(value);
}

// Uniswap TickMath constants, preserving the same upward sqrt rounding as Core.
const RATIOS = ['fffcb933bd6fad37aa2d162d1a594001','fff97272373d413259a46990580e213a','fff2e50f5f656932ef12357cf3c7fdcc',
 'ffe5caca7e10e4e61c3624eaa0941cd0','ffcb9843d60f6159c9db58835c926644','ff973b41fa98c081472e6896dfb254c0',
 'ff2ea16466c96a3843ec78b326b52861','fe5dee046a99a2a811c461f1969c3053','fcbe86c7900a88aedcffc83b479aa3a4',
 'f987a7253ac413176f2b074cf7815e54','f3392b0822b70005940c7a398e4b70f3','e7159475a2c29b7443b29c7fa6e889d9',
 'd097f3bdfd2022b8845ad8f792aa5825','a9f746462d870fdf8a65dc1f90e061e5','70d869a156d2a1b890bb3df62baf32f7',
 '31be135f97d08fd981231505542fcfa6','9aa508b5b7a84e1c677de54f3e99bc9','5d6af8dedb81196699c329225ee604','2216e584f5fa1ea926041bedfe98','48a170391f7dc42444e8fa2'];
export function protectedSqrtPriceAtTickV1(tick) {
  if (!Number.isInteger(tick) || Math.abs(tick) > 887272) throw new TypeError('Invalid tick');
  const t = Math.abs(tick); let ratio = 1n << 128n;
  for (let i = 0; i < RATIOS.length; i++) if (t & (1 << i)) ratio = ratio * BigInt('0x' + RATIOS[i]) >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}
export function protectedOpeningPriceV1({ supply, answer, feedDecimals = 8, targetFdvUsd = '15000' }) {
  const amount = positive(supply), target = positive(targetFdvUsd);
  if (target < BigInt(PROTECTED_LAUNCH_POLICY_V1.minimumFdvUsd) || answer <= 0n || !Number.isInteger(feedDecimals) || feedDecimals < 0 || feedDecimals > 18) throw new TypeError('Invalid USD floor or feed');
  const value = tick => { const sqrt = protectedSqrtPriceAtTickV1(tick); return (((1n << 192n) * amount / (sqrt * sqrt)) * answer) / (10n ** BigInt(18 + feedDecimals)); };
  let lo = -14786, hi = 14786;
  if (value(lo * 60) < target) throw new TypeError('Valuation outside tick range');
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (value(mid * 60) >= target) lo = mid; else hi = mid - 1; }
  const initialTick = lo * 60;
  return { initialTick, sqrtPriceX96: protectedSqrtPriceAtTickV1(initialTick), openingFdvUsd: value(initialTick) };
}
