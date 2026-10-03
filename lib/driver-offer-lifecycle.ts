// A Driver needs enough time to read pickup, drop-off and payment details.
// The server remains responsible for the six-minute Rider search expiry.
export const DRIVER_OFFER_REVIEW_SECONDS = 60;
export const DRIVER_OFFER_POLL_INTERVAL_MS = 2_000;
// A Firestore read reconciles a slow or interrupted mutation response after
// the server has already atomically assigned the ride.
export const DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS = [800, 2_000] as const;

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

/** The accepted Firestore record is authoritative if a network response stalls. */
export function driverOfferAcceptedByServer(ride: Record<string, unknown> | null | undefined, driverId: string): boolean {
  if (!ride || !driverId) return false;
  const assignedDriverId = String(
    ride.driver_id
      ?? ride.driverId
      ?? (ride.driver && typeof ride.driver === 'object' ? (ride.driver as Record<string, unknown>).id : '')
      ?? '',
  );
  const status = String(ride.status || '').toLowerCase();
  return assignedDriverId === driverId && ['driver_arriving', 'driver_arrived', 'in_progress', 'driver_queued'].includes(status);
}
