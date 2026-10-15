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

export function tripNavigationDestination(ride: any, phase: 'pickup' | 'dropoff'): TurnByTurnDestination | null {
  const target = phase === 'dropoff' ? ride?.destination : ride?.pickup;
  const latitude = Number(target?.lat ?? target?.latitude ?? (phase === 'dropoff' ? ride?.destination_lat : ride?.pickup_lat));
  const longitude = Number(target?.lng ?? target?.longitude ?? (phase === 'dropoff' ? ride?.destination_lng : ride?.pickup_lng));
  const destination = { latitude, longitude };
  return isTurnByTurnDestination(destination) ? destination : null;
}
