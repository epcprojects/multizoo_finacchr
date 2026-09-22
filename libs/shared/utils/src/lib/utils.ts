import { randomBytes } from 'crypto';

/** Used for invite tokens and password-reset tokens — 32 bytes, hex-encoded. */
export function generateRandomToken(): string {
  return randomBytes(32).toString('hex');
}

/** Consistent normalisation for case-insensitive unique lookups (email, names). */
export function normalise(value: string): string {
  return value.trim().toUpperCase();
}
