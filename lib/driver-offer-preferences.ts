export type DriverOfferPreferences = {
  notifications: boolean;
  soundAlerts: boolean;
  autoAccept: boolean;
  longTripsOnly: boolean;
  preferHighRated: boolean;
  destinationFilter: string | null;
};

export const DEFAULT_DRIVER_OFFER_PREFERENCES: DriverOfferPreferences = {
  notifications: true,
  soundAlerts: true,
  autoAccept: false,
  longTripsOnly: false,
  preferHighRated: true,
  destinationFilter: null,
};

export const DRIVER_LONG_TRIP_MINIMUM_KM = 10;
export const DRIVER_HIGH_RATED_RIDER_MINIMUM = 4.5;

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeDriverOfferPreferences(value: Partial<DriverOfferPreferences> | null | undefined): DriverOfferPreferences {
  return {
    ...DEFAULT_DRIVER_OFFER_PREFERENCES,
    ...(value || {}),
    notifications: value?.notifications !== false,
    soundAlerts: value?.soundAlerts !== false,
    autoAccept: value?.autoAccept === true,
    longTripsOnly: value?.longTripsOnly === true,
    preferHighRated: value?.preferHighRated !== false,
    destinationFilter: typeof value?.destinationFilter === 'string' && value.destinationFilter.trim()
      ? value.destinationFilter.trim()
      : null,
  };
}

/** Server profile preferences take priority over an older device cache. */
export function mergeDriverOfferPreferences(
  local: Partial<DriverOfferPreferences> | null | undefined,
  remote: Partial<DriverOfferPreferences> | null | undefined,
): DriverOfferPreferences {
  return normalizeDriverOfferPreferences({ ...(local || {}), ...(remote || {}) });
}

export function driverOfferDistanceKm(ride: Record<string, unknown>): number | null {
  return finiteNumber(ride.distance_km ?? ride.estimated_distance_km ?? ride.route_distance_km ?? ride.distance);
}

export function driverOfferRiderRating(ride: Record<string, unknown>): number | null {
  const rating = finiteNumber(ride.rider_rating);
  const count = finiteNumber(ride.rider_rating_count);
  return rating !== null && rating >= 1 && rating <= 5 && (count === null || count > 0) ? rating : null;
}

/**
 * The phone must never hide a server-targeted fallback offer. Long Trips Only
 * is a strict exclude; Prefer High-Rated Riders is server-side ranking, so a
 * lower-rated Rider may still be offered only after preferred candidates.
 */
export function offerMatchesDriverPreferences(
  ride: Record<string, unknown>,
  preferences: Partial<DriverOfferPreferences> | null | undefined,
): boolean {
  const prefs = normalizeDriverOfferPreferences(preferences);
  const distanceKm = driverOfferDistanceKm(ride);
  if (prefs.longTripsOnly && !(distanceKm !== null && distanceKm > DRIVER_LONG_TRIP_MINIMUM_KM)) return false;
  return true;
}
