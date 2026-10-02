export type NativeMapPoint = [latitude: number, longitude: number];

export type NativeMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const MIN_LATITUDE_DELTA = 0.0065;
const MAX_LATITUDE_DELTA = 0.06;
const MIN_LONGITUDE_DELTA = 0.0065;
const MAX_LONGITUDE_DELTA = 0.08;

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
  return point ? { latitude: point[0], longitude: point[1], latitudeDelta: 0.012, longitudeDelta: 0.012 } : null;
}
