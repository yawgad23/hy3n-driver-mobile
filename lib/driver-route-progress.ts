import { driverOffRouteThresholdMetres, type DriverLocationPoint, type DriverRoutePoint } from './driver-off-route-reroute';

const METRES_PER_DEGREE = Math.PI * 6_371_000 / 180;
export type DriverRouteProjection = {
  point: DriverRoutePoint;
  segmentIndex: number;
  distanceMeters: number;
  progressMeters: number;
  bearing: number;
};

function validPoint(point: DriverRoutePoint) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
    && !(point.lat === 0 && point.lng === 0);
}

/** Project only onto supplied Google road geometry, never fabricate a road. */
export function projectDriverOnRoute(location: DriverLocationPoint, points: readonly DriverRoutePoint[]): DriverRouteProjection | null {
  if (!validPoint({ lat: location.latitude, lng: location.longitude }) || points.length < 2) return null;
  if (!points.every(validPoint)) return null;
  const scaleX = METRES_PER_DEGREE * Math.cos(location.latitude * Math.PI / 180);
  let best: DriverRouteProjection | null = null;
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1];
    const ax = (a.lng - location.longitude) * scaleX;
    const ay = (a.lat - location.latitude) * METRES_PER_DEGREE;
    const dx = (b.lng - a.lng) * scaleX;
    const dy = (b.lat - a.lat) * METRES_PER_DEGREE;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (length * length)));
    const distance = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    // At crossings prefer the earlier segment; do not silently skip a future loop.
    if (!best || distance < best.distanceMeters - 0.01) {
      best = {
        point: { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction },
        segmentIndex: index, distanceMeters: distance, progressMeters: travelled + length * fraction,
        bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
      };
    }
    travelled += length;
  }
  return best;
}

/** Hide a disconnected old route instead of drawing a straight GPS-to-road link. */
export function remainingDriverRoute(location: DriverLocationPoint | null, points: readonly DriverRoutePoint[]): DriverRoutePoint[] {
  if (!location) return [];
  const match = projectDriverOnRoute(location, points);
  if (!match || match.distanceMeters > driverOffRouteThresholdMetres(location.accuracyMeters)) return [];
  const remaining = [match.point, ...points.slice(match.segmentIndex + 1)];
  return remaining.filter((point, index) => index === 0
    || Math.abs(point.lat - remaining[index - 1].lat) > 1e-9
    || Math.abs(point.lng - remaining[index - 1].lng) > 1e-9);
}

export type DriverWrongWayMonitor = {
  lastSampleKey: string | null;
  previousLocation: DriverLocationPoint | null;
  consecutiveSamples: number;
  lastRequestAtMs: number;
};
export const EMPTY_DRIVER_WRONG_WAY_MONITOR: DriverWrongWayMonitor = Object.freeze({
  lastSampleKey: null, previousLocation: null, consecutiveSamples: 0, lastRequestAtMs: 0,
});

/** Being on the old road is not enough: reversing along it must reroute too. */
export function assessDriverWrongWay(
  previous: DriverWrongWayMonitor, location: DriverLocationPoint, points: readonly DriverRoutePoint[], sampleKey: string, nowMs: number,
) {
  if (sampleKey === previous.lastSampleKey) return { shouldReroute: false, next: previous };
  const match = projectDriverOnRoute(location, points);
  const before = previous.previousLocation ? projectDriverOnRoute(previous.previousLocation, points) : null;
  const wrongWay = Boolean(match && before
    && match.distanceMeters <= driverOffRouteThresholdMetres(location.accuracyMeters)
    && before.distanceMeters <= driverOffRouteThresholdMetres(previous.previousLocation?.accuracyMeters)
    && before.progressMeters - match.progressMeters >= 10);
  // Keep an anchor through stationary/noisy samples so short GPS updates can
  // accumulate ten real metres. A forward movement resets the confirmation.
  const advanceAnchor = !match || !before || Math.abs(match.progressMeters - before.progressMeters) >= 10;
  const consecutiveSamples = advanceAnchor ? (wrongWay ? previous.consecutiveSamples + 1 : 0) : previous.consecutiveSamples;
  const shouldReroute = wrongWay && consecutiveSamples >= 2 && nowMs - previous.lastRequestAtMs >= 12_000;
  return { shouldReroute, next: {
    lastSampleKey: sampleKey,
    previousLocation: advanceAnchor ? location : previous.previousLocation,
    consecutiveSamples: shouldReroute ? 0 : consecutiveSamples,
    lastRequestAtMs: shouldReroute ? nowMs : previous.lastRequestAtMs,
  } };
}

export function driverRouteReachesTarget(points: readonly DriverRoutePoint[], target: DriverRoutePoint, maxDistanceMeters = 150) {
  const end = points.at(-1);
  if (!end || !validPoint(end) || !validPoint(target)) return false;
  const x = (end.lng - target.lng) * METRES_PER_DEGREE * Math.cos(target.lat * Math.PI / 180);
  const y = (end.lat - target.lat) * METRES_PER_DEGREE;
  return Math.hypot(x, y) <= maxDistanceMeters;
}

/** A shared road is acceptable after confirmation only if its native start is fresh. */
export function driverRouteStartsAtLocation(points: readonly DriverRoutePoint[], location: DriverLocationPoint | null, maxDistanceMeters = 35) {
  const start = points[0];
  if (!start || !location || !validPoint(start) || !validPoint({ lat: location.latitude, lng: location.longitude })) return false;
  const x = (start.lng - location.longitude) * METRES_PER_DEGREE * Math.cos(location.latitude * Math.PI / 180);
  const y = (start.lat - location.latitude) * METRES_PER_DEGREE;
  return Math.hypot(x, y) <= maxDistanceMeters;
}

/** A progress-only prefix/density change is not a newly rerouted road plan. */
export function isSameDriverRoadPlan(candidate: readonly DriverRoutePoint[], previous: readonly DriverRoutePoint[]) {
  if (candidate.length < 2 || previous.length < 2 || !candidate.every(validPoint) || !previous.every(validPoint)) return false;
  let checked = 0;
  for (let index = 0; index < candidate.length - 1; index++) {
    const a = candidate[index], b = candidate[index + 1];
    const x = (b.lng - a.lng) * METRES_PER_DEGREE * Math.cos(a.lat * Math.PI / 180);
    const y = (b.lat - a.lat) * METRES_PER_DEGREE;
    if (Math.hypot(x, y) < 1) continue;
    const bearing = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    const match = projectDriverOnRoute({ latitude: (a.lat + b.lat) / 2, longitude: (a.lng + b.lng) / 2 }, previous);
    if (!match || match.distanceMeters > 8) return false;
    const angle = Math.abs(((bearing - match.bearing + 540) % 360) - 180);
    if (angle > 35) return false; // A real U-turn is replacement geometry, not a prefix refresh.
    checked++;
  }
  return checked > 0;
}
