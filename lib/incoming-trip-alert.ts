export const INCOMING_TRIP_ALERT_PLAYBACK = Object.freeze({
  loop: false,
  volume: 0.92,
});

// The app plays the branded HY3N alert itself. The accompanying local
// notification remains visual-only so iOS never layers its default chime over
// that same offer.
export const INCOMING_TRIP_NOTIFICATION = Object.freeze({
  sound: false,
});

/**
 * A foreground Driver receives the branded one-shot alert from the app after
 * the authenticated offer query confirms eligibility. The remote wake-up must
 * remain visible, but its Android channel sound would otherwise play on top of
 * that branded alert (and can sound like the request is repeating).
 */
export function isDriverRideOfferNotification(data: unknown): boolean {
  return Boolean(
    data
    && typeof data === 'object'
    && String((data as Record<string, unknown>).type || '').trim().toLowerCase() === 'ride_offer',
  );
}

type IncomingTripAlertInput = {
  isOnline: boolean;
  incomingRideId?: string | null;
  activeTripId?: string | null;
  soundAlerts: boolean;
};

/** A request gets one local HY3N alert; it must never ring continuously. */
export function shouldPlayIncomingTripAlert({
  isOnline,
  incomingRideId,
  activeTripId,
  soundAlerts,
}: IncomingTripAlertInput): boolean {
  return Boolean(isOnline && incomingRideId && !activeTripId && soundAlerts);
}
