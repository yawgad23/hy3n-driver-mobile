export type DriverMapPosition = {
  latitude: number;
  longitude: number;
  heading: number;
};

type NativeRoutePoint = { lat: number; lng: number };

export type DriverMapMotionOptions = {
  alignHeadingToMovement?: boolean;
  /** Caller-verified current geometry; pass [] while deviating or rerouting. */
  routePoints?: readonly NativeRoutePoint[];
};

type RouteSegmentLike = {
  segmentLatLngList?: unknown;
};

const EARTH_RADIUS_METRES = 6_371_000;
const MAX_SMOOTH_MOVE_METRES = 1_200;
const DEFAULT_DRIVER_MOTION_DURATION_MS = 1_320;
export const DRIVER_INITIAL_MOTION_DURATION_MS = 1_800;
export const DRIVER_MAX_MOTION_DURATION_MS = 9_000;
export const DRIVER_MOTION_COMPLETION_RATIO = 0.97;
const MOTION_FRAME_INTERVAL_MS = 50;
const MAX_MOTION_FRAMES = Math.ceil(DRIVER_MAX_MOTION_DURATION_MS / MOTION_FRAME_INTERVAL_MS);

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

/** Native/Expo course is a number: null and negative sentinels are not north. */
export function validatedDriverCourse(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return normalisedHeading(value);
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

const MAX_ROUTE_PROJECTION_METRES = 20;
// Sparse or disconnected geometry cannot establish a safe connected road span.
const MAX_CONNECTED_ROUTE_SEGMENT_METRES = 250;
const MAX_ROUTE_DETOUR_RATIO = 1.8;
const MIN_MOVEMENT_METRES = 2;
const MAX_ROUTE_DETOUR_ALLOWANCE_METRES = 5;

type RouteProjection = { segmentIndex: number; point: DriverMapPosition; distance: number; along: number };

function projectOntoRoute(position: DriverMapPosition, points: DriverMapPosition[], lengths: number[]) {
  let best: RouteProjection | null = null;
  let along = 0;
  const longitudeScale = Math.cos(radians(position.latitude));
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = radians(end.longitude - start.longitude) * longitudeScale;
    const dy = radians(end.latitude - start.latitude);
    const px = radians(position.longitude - start.longitude) * longitudeScale;
    const py = radians(position.latitude - start.latitude);
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength > 0) {
      const progress = Math.max(0, Math.min(1, (px * dx + py * dy) / squaredLength));
      const point = {
        latitude: start.latitude + (end.latitude - start.latitude) * progress,
        longitude: start.longitude + (end.longitude - start.longitude) * progress,
        heading: 0,
      };
      const distance = distanceBetweenPositionsMetres(position, point);
      if (!best || distance < best.distance) {
        best = { segmentIndex: index, point, distance, along: along + lengths[index] * progress };
      }
    }
    along += lengths[index];
  }
  return best && best.distance <= MAX_ROUTE_PROJECTION_METRES ? best : null;
}

function distinctPath(points: DriverMapPosition[]) {
  return points.filter((point, index) => index === 0
    || point.latitude !== points[index - 1].latitude || point.longitude !== points[index - 1].longitude);
}

function pathHasLoop(points: DriverMapPosition[]) {
  const side = (a: DriverMapPosition, b: DriverMapPosition, c: DriverMapPosition) =>
    (b.longitude - a.longitude) * (c.latitude - a.latitude) - (b.latitude - a.latitude) * (c.longitude - a.longitude);
  const onSegment = (a: DriverMapPosition, b: DriverMapPosition, point: DriverMapPosition) =>
    Math.abs(side(a, b, point)) < 1e-14
    && point.latitude >= Math.min(a.latitude, b.latitude) - 1e-10
    && point.latitude <= Math.max(a.latitude, b.latitude) + 1e-10
    && point.longitude >= Math.min(a.longitude, b.longitude) - 1e-10
    && point.longitude <= Math.max(a.longitude, b.longitude) + 1e-10;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 2; right < points.length; right += 1) {
      if (distanceBetweenPositionsMetres(points[left], points[right]) < 0.5) return true;
      if (left + 1 < points.length && right + 1 < points.length) {
        const a = points[left];
        const b = points[left + 1];
        const c = points[right];
        const d = points[right + 1];
        if ((side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0)
          || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
      }
    }
  }
  return false;
}

function verifiedRoadPath(previous: DriverMapPosition, next: DriverMapPosition, route: readonly NativeRoutePoint[], directMetres: number) {
  // Never filter invalid vertices and accidentally bridge two disconnected pieces.
  if (route.length < 2 || route.some((point) => !point || !finiteCoordinate(point.lat, point.lng))) return null;
  const points = route.map((point) => ({ latitude: point.lat, longitude: point.lng, heading: 0 }));
  const lengths = points.slice(1).map((point, index) => distanceBetweenPositionsMetres(points[index], point));
  const from = projectOntoRoute(previous, points, lengths);
  const to = projectOntoRoute(next, points, lengths);
  if (!from || !to || to.along <= from.along + 0.01) return null;
  if (lengths.slice(from.segmentIndex, to.segmentIndex + 1).some((length) => !Number.isFinite(length) || length > MAX_CONNECTED_ROUTE_SEGMENT_METRES)) return null;
  const road = distinctPath([
    from.point,
    ...points.slice(from.segmentIndex + 1, to.segmentIndex + 1),
    to.point,
  ]);
  if (road.length - 1 > MAX_MOTION_FRAMES || pathHasLoop(road)) return null;
  // Small endpoint connectors keep the exact accepted GPS coordinates. They are
  // included in the span budget, not silently snapped onto an old road.
  const path = distinctPath([previous, ...road, next]);
  const span = path.slice(1).reduce((total, point, index) => total + distanceBetweenPositionsMetres(path[index], point), 0);
  if (!Number.isFinite(span) || span > MAX_SMOOTH_MOVE_METRES
    || span > directMetres * MAX_ROUTE_DETOUR_RATIO + MAX_ROUTE_DETOUR_ALLOWANCE_METRES
    || path.length - 1 > MAX_MOTION_FRAMES) return null;
  return path;
}

function movementAlignedFrames(previous: DriverMapPosition | null, incoming: DriverMapPosition, durationMs: number, options: DriverMapMotionOptions) {
  const priorHeading = validatedDriverCourse(previous?.heading) ?? 0;
  const next = { ...incoming, heading: validatedDriverCourse(incoming.heading) ?? priorHeading };
  if (!previous || !finiteCoordinate(previous.latitude, previous.longitude)) return [next];
  const metres = distanceBetweenPositionsMetres(previous, next);
  if (!Number.isFinite(metres) || metres < MIN_MOVEMENT_METRES) return [{ ...next, heading: priorHeading }];
  if (metres > MAX_SMOOTH_MOVE_METRES) return [{ ...next, heading: bearingBetweenPositions(previous, next) }];
  const path = verifiedRoadPath(previous, next, options.routePoints ?? [], metres) ?? [previous, next];
  const lengths = path.slice(1).map((point, index) => distanceBetweenPositionsMetres(path[index], point));
  const span = lengths.reduce((sum, length) => sum + length, 0);
  const safeDuration = Number.isFinite(durationMs) ? Math.max(1, Math.min(DRIVER_MAX_MOTION_DURATION_MS, durationMs)) : DEFAULT_DRIVER_MOTION_DURATION_MS;
  const frameCount = Math.max(lengths.length, Math.min(MAX_MOTION_FRAMES, Math.ceil(safeDuration / MOTION_FRAME_INTERVAL_MS)));
  // Retain a frame at every bend: otherwise a single step could cut the corner.
  const flexibleFrames = frameCount - lengths.length;
  const counts = lengths.map((length) => 1 + Math.floor(flexibleFrames * length / span));
  let remainder = frameCount - counts.reduce((sum, count) => sum + count, 0);
  const ranked = lengths.map((length, index) => ({ index, fraction: flexibleFrames * length / span % 1 }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of ranked) {
    if (remainder <= 0) break;
    counts[index] += 1;
    remainder -= 1;
  }
  const frames: DriverMapPosition[] = [];
  let rendered = previous;
  for (let leg = 0; leg < lengths.length; leg += 1) {
    const from = path[leg];
    const to = path[leg + 1];
    for (let index = 1; index <= counts[leg]; index += 1) {
      const progress = index / counts[leg];
      const point = {
        latitude: index === counts[leg] ? to.latitude : from.latitude + (to.latitude - from.latitude) * progress,
        longitude: index === counts[leg] ? to.longitude : from.longitude + (to.longitude - from.longitude) * progress,
        heading: priorHeading,
      };
      point.heading = bearingBetweenPositions(rendered, point);
      frames.push(point);
      rendered = point;
    }
  }
  return frames;
}

/** Align visual movement with the actual interval between trusted GPS samples. */
export function driverMapMotionDurationMs(previousTimestampMs: number | null, currentTimestampMs: number | null) {
  if (previousTimestampMs === null || currentTimestampMs === null) return DRIVER_INITIAL_MOTION_DURATION_MS;
  const intervalMs = currentTimestampMs - previousTimestampMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return DRIVER_INITIAL_MOTION_DURATION_MS;
  return Math.max(1, Math.min(DRIVER_MAX_MOTION_DURATION_MS, Math.round(intervalMs * DRIVER_MOTION_COMPLETION_RATIO)));
}

/**
 * Turns genuine Driver GPS updates into interpolated native marker positions.
 * The caller chooses a duration based on the GPS cadence, so a healthy stream
 * reaches each point before the next update can supersede it. It never fabricates
 * a route and avoids animating a suspiciously large GPS jump across the city.
 */
export function driverMapMotionFrames(
  previous: DriverMapPosition | null,
  incoming: DriverMapPosition,
  durationMs = DEFAULT_DRIVER_MOTION_DURATION_MS,
  options: DriverMapMotionOptions = {},
): DriverMapPosition[] {
  if (!finiteCoordinate(incoming.latitude, incoming.longitude)) return [];
  if (options.alignHeadingToMovement === true) return movementAlignedFrames(previous, incoming, durationMs, options);
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
  const safeDuration = Math.max(1, Math.min(DRIVER_MAX_MOTION_DURATION_MS, durationMs));
  const frameCount = Math.max(1, Math.min(MAX_MOTION_FRAMES, Math.ceil(safeDuration / MOTION_FRAME_INTERVAL_MS)));
  return Array.from({ length: frameCount }, (_, index) => {
    const progress = (index + 1) / frameCount;
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
