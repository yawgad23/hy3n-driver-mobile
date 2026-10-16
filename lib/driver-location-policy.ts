export const DRIVER_FOREGROUND_LOCATION_POLICY = Object.freeze({
  timeIntervalMs: 3_000,
  distanceIntervalMeters: 5,
});

export const DRIVER_ACTIVE_TRIP_FOREGROUND_LOCATION_POLICY = Object.freeze({
  // The Rider map follows a live trip, so publish smaller real GPS movements
  // while the Driver is actively travelling. This changes display freshness
  // only; the protected server meter remains the fare authority.
  timeIntervalMs: 2_000,
  distanceIntervalMeters: 3,
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

/**
 * Active trips receive a denser real-GPS stream than idle availability. No
 * estimated coordinates are ever sent when the device is not moving.
 */
export function driverForegroundLocationPolicy(hasActiveTrip: boolean) {
  return hasActiveTrip
    ? DRIVER_ACTIVE_TRIP_FOREGROUND_LOCATION_POLICY
    : DRIVER_FOREGROUND_LOCATION_POLICY;
}

/** Keep rider-visible tracking alive throughout an accepted trip, even if a Driver toggles availability off. */
export function shouldTrackDriverLocation(isOnline: boolean, hasActiveTrip: boolean): boolean {
  return Boolean(isOnline || hasActiveTrip);
}
