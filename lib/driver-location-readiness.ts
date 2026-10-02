export type DriverLocationLike = {
  coords?: {
    latitude?: unknown;
    longitude?: unknown;
  } | null;
} | null | undefined;

/** A Driver must have a real device coordinate before the UI advertises live availability. */
export function hasUsableDriverLocation(location: DriverLocationLike): boolean {
  const latitude = Number(location?.coords?.latitude);
  const longitude = Number(location?.coords?.longitude);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0);
}

export function driverAvailabilityLabel(isOnline: boolean, hasLocation: boolean): 'Online' | 'Locating' | 'Offline' {
  if (!isOnline) return 'Offline';
  return hasLocation ? 'Online' : 'Locating';
}
