export const DRIVER_FOREGROUND_LOCATION_POLICY = Object.freeze({
  timeIntervalMs: 3_000,
  distanceIntervalMeters: 5,
});

export const DRIVER_BACKGROUND_LOCATION_POLICY = Object.freeze({
  timeIntervalMs: 5_000,
  distanceIntervalMeters: 5,
});

/** Keep rider-visible tracking alive throughout an accepted trip, even if a Driver toggles availability off. */
export function shouldTrackDriverLocation(isOnline: boolean, hasActiveTrip: boolean): boolean {
  return Boolean(isOnline || hasActiveTrip);
}
