export const DRIVER_FOREGROUND_LOCATION_POLICY = Object.freeze({
  timeIntervalMs: 3_000,
  distanceIntervalMeters: 5,
});

export const DRIVER_BACKGROUND_LOCATION_POLICY = Object.freeze({
  timeIntervalMs: 5_000,
  distanceIntervalMeters: 5,
});

// A native watcher may legitimately stay quiet while a parked Driver is still
// online. Refresh the current coordinate in the foreground before the Rider's
// three-minute live-presence window expires, without pretending a force-closed
// or backgrounded app is still available.
export const DRIVER_FOREGROUND_PRESENCE_HEARTBEAT_MS = 60_000;

/** Keep rider-visible tracking alive throughout an accepted trip, even if a Driver toggles availability off. */
export function shouldTrackDriverLocation(isOnline: boolean, hasActiveTrip: boolean): boolean {
  return Boolean(isOnline || hasActiveTrip);
}
