/**
 * Ride category definitions and fare calculation constants
 */

export interface RideCategory {
  id: string;
  name: string;
  description: string;
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  icon: string;
  color: string;
}

export const RIDE_CATEGORIES: Record<string, RideCategory> = {
  standard: {
    id: "standard",
    name: "Standard",
    description: "Affordable and reliable",
    baseFare: 2.5,
    perKmRate: 2.0,
    perMinuteRate: 0.5,
    icon: "directions-car",
    color: "#0a7ea4",
  },
  comfort: {
    id: "comfort",
    name: "Comfort",
    description: "Better comfort and space",
    baseFare: 3.0,
    perKmRate: 3.5,
    perMinuteRate: 0.7,
    icon: "directions-car",
    color: "#FF6B35",
  },
  kantanka: {
    id: "kantanka",
    name: "Kantanka",
    description: "Premium comfort",
    baseFare: 3.0,
    perKmRate: 3.5,
    perMinuteRate: 0.7,
    icon: "directions-car",
    color: "#FF6B35",
  },
  executive: {
    id: "executive",
    name: "Executive",
    description: "Luxury ride experience",
    baseFare: 4.0,
    perKmRate: 4.5,
    perMinuteRate: 0.9,
    icon: "directions-car",
    color: "#22C55E",
  },
};

/**
 * Calculate fare for a ride
 * @param category - Ride category ID
 * @param distanceKm - Distance in kilometers
 * @param durationMinutes - Duration in minutes
 * @returns Calculated fare in GH₵
 */
export function calculateFare(
  category: string,
  distanceKm: number,
  durationMinutes: number
): number {
  const rideCategory = RIDE_CATEGORIES[category];
  if (!rideCategory) {
    throw new Error(`Unknown ride category: ${category}`);
  }

  const distanceFare = distanceKm * rideCategory.perKmRate;
  const timeFare = durationMinutes * rideCategory.perMinuteRate;
  const totalFare = rideCategory.baseFare + distanceFare + timeFare;

  // Round to 2 decimal places
  return Math.round(totalFare * 100) / 100;
}

/**
 * Get fare breakdown for a ride
 */
export function getFareBreakdown(
  category: string,
  distanceKm: number,
  durationMinutes: number
) {
  const rideCategory = RIDE_CATEGORIES[category];
  if (!rideCategory) {
    throw new Error(`Unknown ride category: ${category}`);
  }

  const baseFare = rideCategory.baseFare;
  const distanceFare = distanceKm * rideCategory.perKmRate;
  const timeFare = durationMinutes * rideCategory.perMinuteRate;
  const total = baseFare + distanceFare + timeFare;

  return {
    baseFare: Math.round(baseFare * 100) / 100,
    distanceFare: Math.round(distanceFare * 100) / 100,
    timeFare: Math.round(timeFare * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}
