export type DriverMapPosition = {
  latitude: number;
  longitude: number;
  heading: number;
};

type NativeRoutePoint = { lat: number; lng: number };

type RouteSegmentLike = {
  segmentLatLngList?: unknown;
};

const EARTH_RADIUS_METRES = 6_371_000;
const MAX_SMOOTH_MOVE_METRES = 1_200;
const FRAME_COUNT = 12;

// The native Navigation SDK reports a route-change event before every platform
// has made the replacement route geometry readable. Re-read it a few times so
// HY3N's custom polyline switches promptly, without asking the SDK to create a
// second competing route.
export const DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS = [0, 250, 850, 1_800] as const;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function finiteCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0);
}

export function normalisedHeading(value: unknown, fallback = 0) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return ((fallback % 360) + 360) % 360;
  return ((heading % 360) + 360) % 360;
}

export function distanceBetweenPositionsMetres(from: DriverMapPosition, to: DriverMapPosition) {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingBetweenPositions(from: DriverMapPosition, to: DriverMapPosition) {
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude);
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude)
    - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta);
  return normalisedHeading((Math.atan2(y, x) * 180) / Math.PI, from.heading);
}

function interpolateHeading(from: number, to: number, progress: number) {
  const delta = ((to - from + 540) % 360) - 180;
  return normalisedHeading(from + delta * progress);
}

/**
 * Turns genuine Driver GPS updates into a short sequence of native marker
 * positions. It never fabricates a route and avoids animating a suspiciously
 * large GPS jump across the city.
 */
export function driverMapMotionFrames(previous: DriverMapPosition | null, incoming: DriverMapPosition): DriverMapPosition[] {
  if (!finiteCoordinate(incoming.latitude, incoming.longitude)) return [];
  const next = {
    latitude: incoming.latitude,
    longitude: incoming.longitude,
    heading: normalisedHeading(incoming.heading, previous?.heading || 0),
  };
  if (!previous || !finiteCoordinate(previous.latitude, previous.longitude)) return [next];

  const metres = distanceBetweenPositionsMetres(previous, next);
  if (!Number.isFinite(metres) || metres > MAX_SMOOTH_MOVE_METRES || metres < 2) return [next];

  const derivedHeading = bearingBetweenPositions(previous, next);
  const nextHeading = Number.isFinite(Number(incoming.heading)) ? next.heading : derivedHeading;
  return Array.from({ length: FRAME_COUNT }, (_, index) => {
    const progress = (index + 1) / FRAME_COUNT;
    return {
      latitude: previous.latitude + (next.latitude - previous.latitude) * progress,
      longitude: previous.longitude + (next.longitude - previous.longitude) * progress,
      heading: interpolateHeading(previous.heading, nextHeading, progress),
    };
  });
}

/** Converts the Navigation SDK route into one safe MapView polyline. */
export function routePointsForMap(segments: unknown): NativeRoutePoint[] {
  if (!Array.isArray(segments)) return [];
  const points: NativeRoutePoint[] = [];
  for (const segment of segments as RouteSegmentLike[]) {
    if (!Array.isArray(segment?.segmentLatLngList)) continue;
    for (const point of segment.segmentLatLngList as any[]) {
      const lat = Number(point?.lat ?? point?.latitude);
      const lng = Number(point?.lng ?? point?.longitude);
      if (!finiteCoordinate(lat, lng)) continue;
      const previous = points.at(-1);
      if (!previous || previous.lat !== lat || previous.lng !== lng) points.push({ lat, lng });
    }
  }
  return points;
}
