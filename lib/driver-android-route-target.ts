import { driverRouteReachesTarget } from './driver-route-progress';
import type { DriverRoutePoint } from './driver-off-route-reroute';

/**
 * Android RouteSegment geometry ends on the routable road, not necessarily at
 * its destination waypoint (a pickup can be inside a building or compound).
 * Match the native waypoint when present; never append a GPS/waypoint connector.
 * A conflicting/invalid native waypoint fails closed instead of falling back
 * to an endpoint close to a different target. Older snapshots with no waypoint
 * retain the established endpoint check. iOS does not call this helper.
 */
export function driverAndroidRouteMatchesTarget(
  segments: unknown,
  points: readonly DriverRoutePoint[],
  target: DriverRoutePoint,
) {
  if (!Array.isArray(segments) || points.length < 2) return false;
  const finalSegment = segments.at(-1);
  const waypoint = finalSegment?.destinationWaypoint;
  if (waypoint === undefined || waypoint === null) return driverRouteReachesTarget(points, target);
  // A matching waypoint can also accompany a transient partial prefix. Require
  // the path to reach the SDK's declared road endpoint when it is available.
  const endpoint = finalSegment?.destinationLatLng;
  if (endpoint !== undefined && endpoint !== null) {
    if (typeof endpoint.lat !== 'number' || typeof endpoint.lng !== 'number'
      || !driverRouteReachesTarget(points, endpoint, 25)) return false;
  }
  const position = waypoint.position;
  const lat = position?.lat ?? position?.latitude;
  const lng = position?.lng ?? position?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return driverRouteReachesTarget([{ lat, lng }], target, 25);
}
