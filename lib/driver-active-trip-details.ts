export type ActiveTripDetails = {
  bookedFare: number | null;
  estimatedDistanceKm: number | null;
  estimatedDurationMinutes: number | null;
};

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstNonNegative(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNonNegative(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Active Drivers can see the locked amount accepted at booking. This reads the
 * server-saved quote snapshot only; it deliberately never uses a final fare,
 * client-calculated value, or a Driver-entered amount.
 */
export function activeTripDetails(ride: unknown): ActiveTripDetails {
  const source = ride && typeof ride === 'object' ? ride as Record<string, unknown> : {};
  const liveRoute = source.live_route_metrics && typeof source.live_route_metrics === 'object'
    ? source.live_route_metrics as Record<string, unknown>
    : {};
  return {
    bookedFare: firstNonNegative(
      source.quoted_fare,
      source.fare_estimate,
      source.base_fare,
      source.fare,
    ),
    estimatedDistanceKm: firstNonNegative(
      source.estimated_distance_km,
      source.distance_km,
      source.distance,
      liveRoute.distance_km,
    ),
    estimatedDurationMinutes: firstNonNegative(
      source.estimated_duration_minutes,
      source.duration_minutes,
      source.duration,
      liveRoute.duration_minutes,
    ),
  };
}
