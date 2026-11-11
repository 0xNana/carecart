import { expect, it } from 'vitest';
import { forecastQuantity } from './forecast';

it('keeps safe-integer quantities exact when intermediate demand addition exceeds Number precision', () => {
  expect(forecastQuantity(2, Number.MAX_SAFE_INTEGER, 2, 30)).toEqual({
    leadTimeDemand: 2, recommendedQuantity: Number.MAX_SAFE_INTEGER,
  });
});

it('rejects quantities beyond safe integer representation rather than rounding', () => {
  expect(() => forecastQuantity(0, Number.MAX_SAFE_INTEGER, 2, 30)).toThrow(/safe integer/);
});
