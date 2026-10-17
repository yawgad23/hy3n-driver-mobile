import { DRIVER_OFFER_REVIEW_SECONDS } from './driver-offer-lifecycle';

const FALLBACK_OFFER_WINDOW_MS = DRIVER_OFFER_REVIEW_SECONDS * 1_000;

/**
 * Use the server's targeted-offer lease whenever present. Older records without
 * a lease get one bounded local display window starting when this Driver sees
 * the offer; this is not a server assignment or a client-side extension.
 */
export function driverOfferExpiryMs(serverExpiresAt: unknown, receivedAtMs: number): number {
  const parsed = Date.parse(String(serverExpiresAt || ''));
  if (Number.isFinite(parsed)) return parsed;
  return receivedAtMs + FALLBACK_OFFER_WINDOW_MS;
}

/** The offer and its request song remain active until, but not after, the lease deadline. */
export function isDriverOfferWithinWindow(expiresAtMs: number, nowMs: number): boolean {
  return Number.isFinite(expiresAtMs) && nowMs < expiresAtMs;
}
