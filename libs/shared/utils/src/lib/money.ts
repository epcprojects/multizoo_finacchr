/**
 * Currency arithmetic in integer paisa (1/100 rupee), as BigInt.
 *
 * Amounts travel as strings ("12345.50") because Postgres NUMERIC(18,2)
 * arrives from the pg driver as a string, and a JS number cannot hold a
 * seven-figure balance summed over years without drifting. Nothing in the
 * ledger ever parses money with parseFloat.
 */

const AMOUNT_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;

/** True for a plain decimal string with at most 2 decimal places. */
export function isAmountString(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value.trim());
}

/** "1234.5" → 123450n. Throws on anything that isn't a plain decimal. */
export function toPaisa(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value * 100n;
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (!AMOUNT_PATTERN.test(text)) {
    throw new Error(`Invalid amount: "${value}"`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const paisa = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -paisa : paisa;
}

/** 123450n → "1234.50" — the canonical wire/DB format. */
export function fromPaisa(paisa: bigint): string {
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Sum of decimal strings, returned as a decimal string. */
export function sumAmounts(values: (string | null | undefined)[]): string {
  return fromPaisa(
    values.reduce<bigint>((acc, v) => acc + (v ? toPaisa(v) : 0n), 0n),
  );
}
