/**
 * Account-code numbering, driven entirely by configuration:
 *  - a PATTERN from chart settings, e.g. "{UNIT}-{NUM}" or "{NUM}"
 *  - a numeric RANGE from the account's class, e.g. 1500–1999
 *  - a STEP from chart settings, e.g. 10
 *
 * Pure functions only, so the rules are unit-tested without a database.
 * Codes are labels: journal lines reference an account's id, so a code can
 * be changed later without touching history.
 */

export const NUM_TOKEN = '{NUM}';
export const UNIT_TOKEN = '{UNIT}';

const LITERAL_CHARS = /^[A-Z0-9\-_./]*$/;

/** Returns an error message, or null when the pattern is usable. */
export function validatePattern(pattern: string, opts: { requireUnit: boolean }): string | null {
  const trimmed = pattern.trim();
  const numCount = trimmed.split(NUM_TOKEN).length - 1;
  const unitCount = trimmed.split(UNIT_TOKEN).length - 1;
  if (numCount !== 1) return `The pattern must contain ${NUM_TOKEN} exactly once.`;
  if (unitCount > 1) return `${UNIT_TOKEN} may appear at most once.`;
  if (opts.requireUnit && unitCount === 0) {
    return `Unit-owned account codes must include ${UNIT_TOKEN}, otherwise two units would need the same code.`;
  }
  const literals = trimmed.replace(NUM_TOKEN, '').replace(UNIT_TOKEN, '');
  if (!LITERAL_CHARS.test(literals)) {
    return 'Besides the tokens, only A–Z, 0–9 and - _ . / are allowed.';
  }
  if (trimmed.length > 24) return 'Keep the pattern under 24 characters.';
  return null;
}

export function buildCode(pattern: string, num: number, unitCode?: string | null): string {
  return pattern.trim().replace(NUM_TOKEN, String(num)).replace(UNIT_TOKEN, unitCode ?? '');
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** The {NUM} part of a code written in this pattern, or null if it doesn't match. */
export function parseNumber(pattern: string, code: string, unitCode?: string | null): number | null {
  const [before, after] = pattern.trim().split(NUM_TOKEN);
  const piece = (p: string) =>
    p
      .split(UNIT_TOKEN)
      .map(escapeRegex)
      .join(escapeRegex(unitCode ?? ''));
  const match = new RegExp(`^${piece(before)}(\\d+)${piece(after ?? '')}$`).exec(code);
  return match ? Number(match[1]) : null;
}

/**
 * Swaps a unit's short code inside an account code when the unit is
 * renamed: JOYLAND-1100 → JL-1100, 1100.JOYLAND → 1100.JL. Matches the old
 * code only as a whole segment, so CAFE never rewrites "CAFETERIA-1100".
 * Pattern-independent on purpose — older codes may predate a pattern change.
 */
export function relabelUnitCode(code: string, oldUnit: string, newUnit: string): string {
  const escaped = oldUnit.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  return code.replace(new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`), `$1${newUnit}`);
}

/**
 * Next free number in [start, end]. Empty range → start. Otherwise the
 * highest used number + step when that still fits (leaving gaps for
 * accounts inserted later), else + 1. Never returns a taken number.
 */
export function nextNumber(taken: Iterable<number>, start: number, end: number, step: number): number | null {
  const used = new Set(taken);
  const inRange = [...used].filter((n) => n >= start && n <= end);
  let next = inRange.length ? Math.max(...inRange) : start - step;
  next = next + step <= end ? next + step : next + 1;
  if (next < start) next = start;
  while (used.has(next)) next += 1;
  return next > end ? null : next;
}
