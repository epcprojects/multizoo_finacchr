const BUSINESS_TIME_ZONE = 'Asia/Karachi';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today's date where the business actually is, as YYYY-MM-DD. The server's
 * own clock may be UTC — a 1 a.m. PKT entry must still land on today.
 */
export function businessDate(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Strict YYYY-MM-DD that is also a real calendar date (rejects 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
