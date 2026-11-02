import { describe, expect, it } from 'vitest';
import { MAX_ATOMIC_AMOUNT } from './domain';
import { formatUsdc, parseUsdc } from './amounts';

describe('six-decimal USDC amounts', () => {
  it.each([
    ['0', 0n], ['0.000001', 1n], ['1', 1_000_000n], ['5', 5_000_000n],
    ['6.20', 6_200_000n], ['10', 10_000_000n], ['10.000001', 10_000_001n],
    ['25', 25_000_000n], ['25.000001', 25_000_001n],
  ])('converts %s exactly without floating point', (decimal, atomic) => {
    expect(parseUsdc(decimal)).toBe(atomic);
    expect(parseUsdc(formatUsdc(atomic))).toBe(atomic);
  });
  it.each(['-1', '+1', '1e6', ' 1', '1 ', '.1', '1.', '01', '1.0000001', 'NaN', ''])
  ('rejects noncanonical or imprecise input %s', (input) => expect(() => parseUsdc(input)).toThrow());
  it('bounds both directions by NEP-141 U128 and rejects JS numbers', () => {
    expect(parseUsdc(formatUsdc(MAX_ATOMIC_AMOUNT))).toBe(MAX_ATOMIC_AMOUNT);
    expect(() => formatUsdc(MAX_ATOMIC_AMOUNT + 1n)).toThrow();
    expect(() => formatUsdc(-1n)).toThrow();
    expect(() => parseUsdc('340282366920938463463374607431768.211456')).toThrow();
    expect(() => parseUsdc(1.2 as never)).toThrow();
    expect(formatUsdc(6_200_000n)).toBe('6.200000');
  });
});
