export type TurnByTurnDestination = {
  latitude: number;
  longitude: number;
};

function isValidCoordinate(value: number, maximum: number) {
  return Number.isFinite(value) && Math.abs(value) <= maximum;
}

export function isTurnByTurnDestination(value: unknown): value is TurnByTurnDestination {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TurnByTurnDestination>;
  return isValidCoordinate(Number(candidate.latitude), 90)
    && isValidCoordinate(Number(candidate.longitude), 180);
}

/**
 * Android's Google Maps navigation intent opens the real Google Maps driving
 * experience: a moving map, spoken turn prompts, live rerouting, and arrival
 * guidance. It deliberately uses coordinates from the server-owned ride, not
 * a free-text address supplied by the Driver.
 */
export function googleMapsTurnByTurnUri(destination: TurnByTurnDestination) {
  if (!isTurnByTurnDestination(destination)) return null;
  return `google.navigation:q=${destination.latitude},${destination.longitude}&mode=d`;
}

/**
 * Cross-platform fallback for Android without the Maps app and for iOS. When
 * Google Maps is available, dir_action=navigate requests its turn-by-turn UI.
 */
export function googleMapsNavigationFallbackUrl(destination: TurnByTurnDestination) {
  if (!isTurnByTurnDestination(destination)) return null;
  const coordinates = `${destination.latitude},${destination.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates)}&travelmode=driving&dir_action=navigate`;
}

type NavigationTargetKind = 'pickup' | 'destination' | 'stop';
export type TripNavigationTarget = TurnByTurnDestination & { kind: NavigationTargetKind; label: string };

function pointFrom(value: any, fallbackLatitude?: unknown, fallbackLongitude?: unknown): TurnByTurnDestination | null {
  const latitude = Number(value?.lat ?? value?.latitude ?? fallbackLatitude);
  const longitude = Number(value?.lng ?? value?.longitude ?? fallbackLongitude);
  const point = { latitude, longitude };
  return isTurnByTurnDestination(point) ? point : null;
}

/**
 * A stop can override a drop-off only when route_target references the exact
 * server-owned pending in_trip_stops entry. This rejects legacy loose route
 * targets, which otherwise can leave iPhone guidance pointing at an old pin.
 */
function verifiedPendingStopTarget(ride: any): TripNavigationTarget | null {
  const target = ride?.route_target;
  if (!target || typeof target !== 'object' || target.kind !== 'stop') return null;
  const stopId = String(target.stop_id || '').trim();
  if (!stopId || !Array.isArray(ride?.in_trip_stops)) return null;
  const stop = ride.in_trip_stops.find((candidate: any) => candidate
    && typeof candidate === 'object'
    && String(candidate.id || '').trim() === stopId
    && String(candidate.status || '').trim().toLowerCase() === 'pending');
  const fromStop = pointFrom(stop);
  const fromTarget = pointFrom(target.location);
  if (!fromStop || !fromTarget
    || fromStop.latitude !== fromTarget.latitude
    || fromStop.longitude !== fromTarget.longitude) return null;
  return {
    ...fromStop,
    kind: 'stop',
    label: String(stop.address || stop.name || target.location?.address || target.location?.name || 'Next stop'),
  };
}

/** One safe target selector for embedded guidance and external map handoff. */
export function activeTripNavigationTarget(ride: any, phase: 'pickup' | 'dropoff'): TripNavigationTarget | null {
  if (phase === 'pickup') {
    const pickup = pointFrom(ride?.pickup, ride?.pickup_lat, ride?.pickup_lng);
    return pickup ? { ...pickup, kind: 'pickup', label: String(ride?.pickup_address || 'Pickup') } : null;
  }

  const stop = verifiedPendingStopTarget(ride);
  if (stop) return stop;
  const destination = pointFrom(ride?.destination, ride?.destination_lat, ride?.destination_lng);
  return destination ? { ...destination, kind: 'destination', label: String(ride?.destination_address || 'Drop-off') } : null;
}

export function tripNavigationDestination(ride: any, phase: 'pickup' | 'dropoff'): TurnByTurnDestination | null {
  const target = activeTripNavigationTarget(ride, phase);
  return target ? { latitude: target.latitude, longitude: target.longitude } : null;
}
