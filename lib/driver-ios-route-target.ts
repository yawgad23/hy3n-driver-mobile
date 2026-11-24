import { driverRouteReachesTarget } from './driver-route-progress';
import type { DriverRoutePoint } from './driver-off-route-reroute';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coordinate(value: unknown): DriverRoutePoint | null {
  if (!record(value)) return null;
  const lat = value.lat === undefined ? value.latitude : value.lat;
  const lng = value.lng === undefined ? value.longitude : value.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number'
    || !Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  // Do not let alternate coordinate keys conceal malformed/conflicting metadata.
  if ((value.latitude !== undefined && value.latitude !== lat)
    || (value.longitude !== undefined && value.longitude !== lng)) return null;
  return { lat, lng };
}

/**
 * iOS GMSRouteLeg supplies the requested waypoint separately from the routable
 * road endpoint. Both must match: waypoint identity binds the server target,
 * while the path endpoint rejects transient current-leg prefixes. Never append
 * a connector to an off-road target or relax the legacy 150 m endpoint fallback.
 * An explicitly malformed waypoint (including null) cannot use that fallback.
 * This is geometry validation only, not native turn/ETA generation provenance.
 */
export function driverIosRouteMatchesTarget(
  segments: unknown,
  points: readonly DriverRoutePoint[],
  target: DriverRoutePoint,
) {
  if (!Array.isArray(segments) || points.length < 2) return false;
  const finalSegment = segments.at(-1);
  if (!record(finalSegment)) return false;
  const waypoint = finalSegment.destinationWaypoint;
  if (waypoint === undefined) return driverRouteReachesTarget(points, target);
  if (!record(waypoint)) return false;
  const position = coordinate(waypoint.position);
  const endpoint = coordinate(finalSegment.destinationLatLng);
  return Boolean(position && endpoint && points.every(point => coordinate(point) !== null)
    && driverRouteReachesTarget([position], target, 25)
    && driverRouteReachesTarget(points, endpoint, 25));
}
