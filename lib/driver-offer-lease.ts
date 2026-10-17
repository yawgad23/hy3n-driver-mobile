type DriverOfferLike = Record<string, unknown> | null | undefined;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * A server-issued lease identifies one presentation of a targeted request.
 * The attempt/issued/deadline fields prevent a cached old offer from being
 * mistaken for a genuinely newer server offer for the same ride.
 */
export function driverOfferLeaseKey(offer: DriverOfferLike): string | null {
  const rideId = text(offer?.id);
  if (!rideId) return null;
  return [
    rideId,
    text(offer?.driver_offer_attempt),
    text(offer?.driver_offer_issued_at),
    text(offer?.driver_offer_expires_at),
  ].join('|');
}

/** Do not re-open a request card or restart its song from the same retired server lease. */
export function shouldPresentDriverOffer(offer: DriverOfferLike, retiredLeaseKey: string | null): boolean {
  const leaseKey = driverOfferLeaseKey(offer);
  return Boolean(leaseKey && leaseKey !== retiredLeaseKey);
}

/** A late decline is an expected terminal state, not a client error to show to a Driver. */
export function isUnavailableDriverOfferError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message || error || '').toLowerCase();
  return /no longer available|has expired|offer is no longer|ride request has expired/.test(message);
}
