export type DriverRoutePoint = {
  lat: number;
  lng: number;
};

export type DriverLocationPoint = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
};

export type DriverOffRouteMonitor = {
  consecutiveOffRouteSamples: number;
  lastSampleKey: string | null;
  lastRerouteAtMs: number;
};

export type DriverOffRouteAssessment = {
  distanceMeters: number | null;
  thresholdMeters: number;
  offRoute: boolean;
  shouldReroute: boolean;
  next: DriverOffRouteMonitor;
};

// A confirmed deviation avoids treating ordinary GPS drift, parallel lanes, or
// an occasional inaccurate device sample as a new route. A Driver who has
// genuinely missed a turn will exceed this on two fresh navigation-grade GPS
// samples, then get a clean route from the same server-owned target.
export const DRIVER_OFF_ROUTE_MINIMUM_METRES = 45;
export const DRIVER_OFF_ROUTE_MAXIMUM_METRES = 90;
export const DRIVER_OFF_ROUTE_CONFIRMATION_SAMPLES = 2;
export const DRIVER_OFF_ROUTE_REROUTE_COOLDOWN_MS = 12_000;

const EARTH_RADIUS_METRES = 6_371_000;

export const EMPTY_DRIVER_OFF_ROUTE_MONITOR: DriverOffRouteMonitor = Object.freeze({
  consecutiveOffRouteSamples: 0,
  lastSampleKey: null,
  lastRerouteAtMs: 0,
});

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0);
}

function metresPerLongitudeDegree(latitude: number) {
  return (Math.PI * EARTH_RADIUS_METRES * Math.cos(radians(latitude))) / 180;
}

function pointDistanceMetres(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const referenceLatitude = (from.latitude + to.latitude) / 2;
  const northSouth = (to.latitude - from.latitude) * ((Math.PI * EARTH_RADIUS_METRES) / 180);
  const eastWest = (to.longitude - from.longitude) * metresPerLongitudeDegree(referenceLatitude);
  return Math.hypot(northSouth, eastWest);
}

function pointToSegmentDistanceMetres(
  point: DriverLocationPoint,
  start: DriverRoutePoint,
  end: DriverRoutePoint,
) {
  const referenceLatitude = (point.latitude + start.lat + end.lat) / 3;
  const metresPerLatitude = (Math.PI * EARTH_RADIUS_METRES) / 180;
  const metresPerLongitude = metresPerLongitudeDegree(referenceLatitude);
  const startX = start.lng * metresPerLongitude;
  const startY = start.lat * metresPerLatitude;
  const endX = end.lng * metresPerLongitude;
  const endY = end.lat * metresPerLatitude;
  const pointX = point.longitude * metresPerLongitude;
  const pointY = point.latitude * metresPerLatitude;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const projection = Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
  return Math.hypot(pointX - (startX + deltaX * projection), pointY - (startY + deltaY * projection));
}

/** Returns the nearest distance from a real Driver point to the currently drawn route. */
export function distanceFromDriverToRouteMetres(
  location: DriverLocationPoint,
  routePoints: readonly DriverRoutePoint[],
): number | null {
  if (!validCoordinate(location.latitude, location.longitude)) return null;
  const validRoute = routePoints.filter((point) => validCoordinate(Number(point?.lat), Number(point?.lng)));
  if (validRoute.length === 0) return null;
  if (validRoute.length === 1) {
    return pointDistanceMetres(location, { latitude: validRoute[0].lat, longitude: validRoute[0].lng });
  }

  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < validRoute.length; index += 1) {
    nearest = Math.min(nearest, pointToSegmentDistanceMetres(location, validRoute[index - 1], validRoute[index]));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

export function driverOffRouteThresholdMetres(accuracyMeters?: number | null) {
  const accuracy = Number(accuracyMeters);
  const accuracyAllowance = Number.isFinite(accuracy) && accuracy > 0 ? accuracy * 2 : 0;
  return Math.min(
    DRIVER_OFF_ROUTE_MAXIMUM_METRES,
    Math.max(DRIVER_OFF_ROUTE_MINIMUM_METRES, accuracyAllowance),
  );
}

/**
 * Requires two distinct real GPS observations away from the current route before
 * requesting a replacement. This is presentation/navigation recovery only: it
 * neither changes the ride destination nor updates any fare or trip state.
 */
export function assessDriverOffRoute(
  monitor: DriverOffRouteMonitor,
  location: DriverLocationPoint,
  routePoints: readonly DriverRoutePoint[],
  sampleKey: string,
  nowMs: number,
): DriverOffRouteAssessment {
  const thresholdMeters = driverOffRouteThresholdMetres(location.accuracyMeters);
  const distanceMeters = distanceFromDriverToRouteMetres(location, routePoints);
  const previous = monitor || EMPTY_DRIVER_OFF_ROUTE_MONITOR;

  if (!sampleKey || sampleKey === previous.lastSampleKey) {
    return {
      distanceMeters,
      thresholdMeters,
      offRoute: distanceMeters !== null && distanceMeters > thresholdMeters,
      shouldReroute: false,
      next: previous,
    };
  }

  const offRoute = distanceMeters !== null && distanceMeters > thresholdMeters;
  const consecutiveOffRouteSamples = offRoute ? previous.consecutiveOffRouteSamples + 1 : 0;
  const cooldownElapsed = nowMs - previous.lastRerouteAtMs >= DRIVER_OFF_ROUTE_REROUTE_COOLDOWN_MS;
  const shouldReroute = offRoute
    && consecutiveOffRouteSamples >= DRIVER_OFF_ROUTE_CONFIRMATION_SAMPLES
    && cooldownElapsed;

  return {
    distanceMeters,
    thresholdMeters,
    offRoute,
    shouldReroute,
    next: {
      consecutiveOffRouteSamples: shouldReroute ? 0 : consecutiveOffRouteSamples,
      lastSampleKey: sampleKey,
      lastRerouteAtMs: shouldReroute ? nowMs : previous.lastRerouteAtMs,
    },
  };
}
