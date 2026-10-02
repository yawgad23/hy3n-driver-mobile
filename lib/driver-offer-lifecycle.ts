// A Driver needs enough time to read pickup, drop-off and payment details.
// The server remains responsible for the six-minute Rider search expiry.
export const DRIVER_OFFER_REVIEW_SECONDS = 60;
export const DRIVER_OFFER_POLL_INTERVAL_MS = 2_000;

export function nextDriverOfferCountdown(seconds: number): number {
  return Math.max(0, Math.floor(Number(seconds) || 0) - 1);
}

/**
 * The client must never silently decline an offer merely because its visual
 * countdown ended. Only an explicit Driver decline can remove it locally.
 */
export function shouldAutoDeclineDriverOffer(): false {
  return false;
}
