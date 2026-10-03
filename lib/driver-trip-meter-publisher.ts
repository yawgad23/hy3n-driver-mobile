export const DRIVER_TRIP_METER_MIN_INTERVAL_MS = 3_000;

/**
 * Presence updates keep the live vehicle moving; meter samples are a separate
 * server-authoritative fare input. Bound their request rate so GPS traffic
 * cannot queue behind the Driver's lifecycle actions on a slow connection.
 */
export function shouldPublishDriverTripMeter(
  previousRecordedAtMs: number,
  nextRecordedAtMs: number,
): boolean {
  if (!Number.isFinite(nextRecordedAtMs) || nextRecordedAtMs <= 0) return false;
  if (!Number.isFinite(previousRecordedAtMs) || previousRecordedAtMs <= 0) return true;
  return nextRecordedAtMs - previousRecordedAtMs >= DRIVER_TRIP_METER_MIN_INTERVAL_MS;
}
