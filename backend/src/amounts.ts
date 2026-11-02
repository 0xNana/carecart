import { parseAtomicAmount, type AtomicAmount } from './domain';

const USDC_SCALE = 1_000_000n;

/** Human decimal strings only. Never round excess precision or accept JS numbers. */
export function parseUsdc(decimal: string): AtomicAmount {
  if (typeof decimal !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(decimal)) {
    throw new TypeError('USDC amount must be a decimal string with at most six fractional digits');
  }
  const [whole, fraction = ''] = decimal.split('.');
  return parseAtomicAmount(BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, '0')));
}

export function formatUsdc(atomic: bigint): string {
  const amount = parseAtomicAmount(atomic);
  return `${amount / USDC_SCALE}.${(amount % USDC_SCALE).toString().padStart(6, '0')}`;
}
