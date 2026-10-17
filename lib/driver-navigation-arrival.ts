import { distanceBetweenPositionsMetres } from './driver-map-motion';

export type DriverNavigationTarget = {
  key: string;
  latitude: number;
  longitude: number;
};

export type DriverNavigationFix = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  time?: number | null;
};

export type DriverNavigationArrival = {
  waypoint?: {
    position?: {
      lat?: unknown;
      lng?: unknown;
      latitude?: unknown;
      longitude?: unknown;
    } | null;
  } | null;
} | null | undefined;

export type DriverArrivalDecision = {
  accepted: boolean;
  reason: 'target_missing' | 'waypoint_invalid' | 'waypoint_mismatch' | 'location_stale_or_imprecise' | 'location_not_at_target' | 'confirmed';
  waypointDistanceMeters: number | null;
  locationDistanceMeters: number | null;
};

const MAX_WAYPOINT_TARGET_DISTANCE_METERS = 25;
const MIN_ARRIVAL_DISTANCE_METERS = 45;
const MAX_ARRIVAL_DISTANCE_METERS = 75;

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0);
}

function pointFromWaypoint(arrival: DriverNavigationArrival) {
  const position = arrival?.waypoint?.position;
  const latitude = Number(position?.lat ?? position?.latitude);
  const longitude = Number(position?.lng ?? position?.longitude);
  return validCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

function hasFreshPreciseFix(fix: DriverNavigationFix | null | undefined, nowMs: number) {
  const accuracy = Number(fix?.accuracyMeters);
  const time = Number(fix?.time);
  return Boolean(
    fix
    && validCoordinate(Number(fix.latitude), Number(fix.longitude))
    && Number.isFinite(accuracy)
    && accuracy >= 0
    && accuracy <= 50
    && Number.isFinite(time)
    && nowMs - time <= 15_000
    && time - nowMs <= 5_000,
  );
}

/**
 * Google Navigation reporting arrival is guidance information only. HY3N may
 * show a local arrival prompt only when that callback names the current target
 * and the Driver's own fresh device fix independently agrees. It never changes
 * a trip, advances a stop, or writes data.
 */
export function validateDriverNavigationArrival(input: {
  target: DriverNavigationTarget | null | undefined;
  arrival: DriverNavigationArrival;
  deviceFix: DriverNavigationFix | null | undefined;
  nowMs?: number;
}): DriverArrivalDecision {
  const nowMs = input.nowMs ?? Date.now();
  const target = input.target;
  if (!target || !validCoordinate(target.latitude, target.longitude)) {
    return { accepted: false, reason: 'target_missing', waypointDistanceMeters: null, locationDistanceMeters: null };
  }

  const waypoint = pointFromWaypoint(input.arrival);
  if (!waypoint) {
    return { accepted: false, reason: 'waypoint_invalid', waypointDistanceMeters: null, locationDistanceMeters: null };
  }

  const waypointDistanceMeters = distanceBetweenPositionsMetres(
    { ...waypoint, heading: 0 },
    { latitude: target.latitude, longitude: target.longitude, heading: 0 },
  );
  if (waypointDistanceMeters > MAX_WAYPOINT_TARGET_DISTANCE_METERS) {
    return { accepted: false, reason: 'waypoint_mismatch', waypointDistanceMeters, locationDistanceMeters: null };
  }

  if (!hasFreshPreciseFix(input.deviceFix, nowMs)) {
    return { accepted: false, reason: 'location_stale_or_imprecise', waypointDistanceMeters, locationDistanceMeters: null };
  }

  const deviceFix = input.deviceFix!;
  const locationDistanceMeters = distanceBetweenPositionsMetres(
    { latitude: deviceFix.latitude, longitude: deviceFix.longitude, heading: 0 },
    { latitude: target.latitude, longitude: target.longitude, heading: 0 },
  );
  const permittedDistanceMeters = Math.min(
    MAX_ARRIVAL_DISTANCE_METERS,
    Math.max(MIN_ARRIVAL_DISTANCE_METERS, Number(deviceFix.accuracyMeters) + 25),
  );
  if (locationDistanceMeters > permittedDistanceMeters) {
    return { accepted: false, reason: 'location_not_at_target', waypointDistanceMeters, locationDistanceMeters };
  }

  return { accepted: true, reason: 'confirmed', waypointDistanceMeters, locationDistanceMeters };
}
