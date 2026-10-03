export type NativeMapPoint = [latitude: number, longitude: number];

export type NativeMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const MIN_LATITUDE_DELTA = 0.0065;
const MAX_LATITUDE_DELTA = 0.024;
const MIN_LONGITUDE_DELTA = 0.0065;
const MAX_LONGITUDE_DELTA = 0.028;
const DRIVER_FOLLOW_DELTA = 0.008;
const MAX_TARGET_DISTANCE_KM_FOR_DRIVER_FRAME = 2.4;

function isPoint(value: unknown): value is NativeMapPoint {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Math.abs(Number(value[0])) <= 90
    && Math.abs(Number(value[1])) <= 180;
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function approximateDistanceKm(from: NativeMapPoint, to: NativeMapPoint) {
  const latitudeKm = (to[0] - from[0]) * 111.32;
  const longitudeKm = (to[1] - from[1]) * 111.32 * Math.cos(((from[0] + to[0]) / 2) * Math.PI / 180);
  return Math.hypot(latitudeKm, longitudeKm);
}

/** Keeps the Driver and the next stop visible at useful road-level zoom. */
export function nativeTrackingRegion(
  driverPoint: NativeMapPoint | null | undefined,
  targetPoint: NativeMapPoint | null | undefined,
  fallbackPoint: NativeMapPoint | null | undefined,
): NativeMapRegion | null {
  const driver = isPoint(driverPoint) ? driverPoint : null;
  const target = isPoint(targetPoint) ? targetPoint : null;
  const fallback = isPoint(fallbackPoint) ? fallbackPoint : null;
  if (driver && target) {
    // A long offer/trip should not zoom the Driver out to a whole-city map.
    // Keep a road-level follow view around the vehicle until the next stop is
    // genuinely close enough to show usefully in the same frame.
    if (approximateDistanceKm(driver, target) > MAX_TARGET_DISTANCE_KM_FOR_DRIVER_FRAME) {
      return {
        latitude: driver[0] - DRIVER_FOLLOW_DELTA * 0.16,
        longitude: driver[1],
        latitudeDelta: DRIVER_FOLLOW_DELTA,
        longitudeDelta: DRIVER_FOLLOW_DELTA,
      };
    }
    const latitudeSpan = bounded(Math.abs(driver[0] - target[0]) * 2.25, MIN_LATITUDE_DELTA, MAX_LATITUDE_DELTA);
    const longitudeSpan = bounded(Math.abs(driver[1] - target[1]) * 2.1, MIN_LONGITUDE_DELTA, MAX_LONGITUDE_DELTA);
    return {
      latitude: (driver[0] + target[0]) / 2 - latitudeSpan * 0.16,
      longitude: (driver[1] + target[1]) / 2,
      latitudeDelta: latitudeSpan,
      longitudeDelta: longitudeSpan,
    };
  }
  const point = driver || target || fallback;
  return point ? {
    latitude: point[0] - DRIVER_FOLLOW_DELTA * 0.16,
    longitude: point[1],
    latitudeDelta: DRIVER_FOLLOW_DELTA,
    longitudeDelta: DRIVER_FOLLOW_DELTA,
  } : null;
}
