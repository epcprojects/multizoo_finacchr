/**
 * Browser-side twin of @multizoo/utils' money helpers. Amounts arrive from
 * the API as strings ("12345.50") and are only ever combined as BigInt
 * paisa here — the before → after previews in the entry form must agree
 * with the server to the paisa, so no parseFloat anywhere.
 */

const AMOUNT = /^-?\d{1,16}(\.\d{1,2})?$/;

export function isAmount(value: string): boolean {
  return AMOUNT.test(value.trim());
}

export function toPaisa(value: string | null | undefined): bigint {
  const text = (value ?? '0').trim() || '0';
  if (!AMOUNT.test(text)) return 0n;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const p = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -p : p;
}

export function fromPaisa(paisa: bigint): string {
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** "12160777.5" → "Rs 12,160,777.50"; `decimals: false` drops the paisa. */
export function formatMoney(
  amount: string | bigint | null | undefined,
  { decimals = true, prefix = true }: { decimals?: boolean; prefix?: boolean } = {},
): string {
  const text = typeof amount === 'bigint' ? fromPaisa(amount) : fromPaisa(toPaisa(amount));
  const negative = text.startsWith('-');
  const [whole, fraction] = text.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decimals ? `${grouped}.${fraction}` : grouped;
  return `${negative ? '−' : ''}${prefix ? 'Rs ' : ''}${body}`;
}

/** Today in Pakistan time, YYYY-MM-DD — the same "business date" the API uses. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function firstOfMonthIso(): string {
  return `${todayIso().slice(0, 8)}01`;
}

/** "2026-09-23" → "23 Sep 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
    ?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message || fallback;
}
