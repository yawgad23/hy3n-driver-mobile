export type DriverLocationLike = {
  coords?: {
    latitude?: unknown;
    longitude?: unknown;
  } | null;
  timestamp?: unknown;
} | null | undefined;

/** A short reuse window avoids an unnecessary high-accuracy GPS wait when a
 * Driver returns online immediately after a deliberate offline toggle. */
export const RECENT_DRIVER_LOCATION_MAX_AGE_MS = 60_000;

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

export function hasRecentUsableDriverLocation(
  location: DriverLocationLike,
  now = Date.now(),
  maximumAgeMs = RECENT_DRIVER_LOCATION_MAX_AGE_MS,
): boolean {
  if (!hasUsableDriverLocation(location)) return false;
  const timestamp = Number(location?.timestamp);
  return Number.isFinite(timestamp)
    && timestamp <= now + 5_000
    && now - timestamp <= maximumAgeMs;
}

export function driverAvailabilityLabel(isOnline: boolean, hasLocation: boolean): 'Online' | 'Locating' | 'Offline' {
  if (!isOnline) return 'Offline';
  return hasLocation ? 'Online' : 'Locating';
}
