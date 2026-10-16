import test from 'node:test';
import assert from 'node:assert/strict';
import { protectedOpeningPriceV1, protectedSqrtPriceAtTickV1, protectedLaunchExemptionsV1,
  prepareProtectedNativeContractsV1, protectedRobinhoodPlanV1, PROTECTED_LAUNCH_CHAIN_PINS_V1 } from '../src/launch-protection-v1.mjs';
const owner = '0x1111111111111111111111111111111111111111';

test('tick and minimum opening price match canonical integer arithmetic', () => {
  for (const [tick, expected] of [[-887272, '4295128739'], [0, '79228162514264337593543950336'], [887272, '1461446703485210103287273052203988822378723970342']]) assert.equal(protectedSqrtPriceAtTickV1(tick).toString(), expected);
  for (const supply of ['50', '1000000000000000000000000000', '170141183460469231731687303715884105727']) {
    const result = protectedOpeningPriceV1({ supply, answer: 245000000000n });
    assert.ok(result.openingFdvUsd >= 30000n);
    assert.ok(result.initialTick % 60 === 0);
  }
  assert.throws(() => protectedOpeningPriceV1({ supply: '1000', answer: 245000000000n, targetFdvUsd: '29999' }));
});
test('exemptions are unique and exclude developer, zero and a fourth wallet', () => {
  assert.deepEqual(protectedLaunchExemptionsV1(owner), Array(3).fill('0x0000000000000000000000000000000000000000'));
  for (const extra of [[owner], ['0x0000000000000000000000000000000000000000'], [owner, owner], Array(4).fill(owner)]) {
    assert.throws(() => protectedLaunchExemptionsV1(owner, extra));
  }
});
