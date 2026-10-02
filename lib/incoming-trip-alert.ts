export const INCOMING_TRIP_ALERT_PLAYBACK = Object.freeze({
  loop: false,
  volume: 0.92,
});

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
