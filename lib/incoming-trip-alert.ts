export const INCOMING_TRIP_ALERT_PLAYBACK = Object.freeze({
  // The foreground request card owns the life of this player. It stops when
  // the Driver accepts, declines, goes offline, or the server offer expires.
  loop: true,
  volume: 0.92,
});

// The trusted server push owns the audible alert. Keeping this as a platform
// sound avoids the previous foreground-only Expo Audio player and works while
// HY3N is backgrounded as well.
export const INCOMING_TRIP_NOTIFICATION = Object.freeze({
  sound: 'default',
});

/**
 * A Driver ride-offer push is the single alert source. Its payload contains no
 * fare; the authenticated offer query owns all trip details.
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

/** An eligible, active request owns the looping foreground HY3N alert. */
export function shouldPlayIncomingTripAlert({
  isOnline,
  incomingRideId,
  activeTripId,
  soundAlerts,
}: IncomingTripAlertInput): boolean {
  return Boolean(isOnline && incomingRideId && !activeTripId && soundAlerts);
}
