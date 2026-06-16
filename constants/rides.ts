/**
 * Ride categories - EXACT from web app
 */

export interface RideCategory {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  pricePerKm: number;
  pricePerMin: number;
  minFare: number;
  icon: string;
  color?: string;
}

export const RIDE_CATEGORIES: RideCategory[] = [
  {
    id: "standard",
    name: "Standard",
    description: "Affordable everyday rides",
    basePrice: 11.00,
    pricePerKm: 4.18,
    pricePerMin: 0.44,
    minFare: 16.50,
    icon: "car",
  },
  {
    id: "comfort",
    name: "Comfort",
    description: "Comfortable rides with extra amenities",
    basePrice: 16.50,
    pricePerKm: 5.06,
    pricePerMin: 0.66,
    minFare: 27.50,
    icon: "star",
  },
  {
    id: "kantanka",
    name: "Kantanka",
    description: "Proudly Ghanaian-made mini SUVs",
    basePrice: 13.20,
    pricePerKm: 4.62,
    pricePerMin: 0.55,
    minFare: 22.00,
    icon: "car",
  },
  {
    id: "executive",
    name: "Executive",
    description: "Luxury travel for special occasions",
    basePrice: 27.50,
    pricePerKm: 6.60,
    pricePerMin: 1.10,
    minFare: 44.00,
    icon: "shield-check",
  },
  {
    id: "okada",
    name: "Okada",
    description: "Fast bike rides to beat traffic",
    basePrice: 5.50,
    pricePerKm: 1.65,
    pricePerMin: 0.33,
    minFare: 8.80,
    icon: "bike",
  },
  {
    id: "express_delivery",
    name: "Express Delivery",
    description: "Fast package delivery across the city",
    basePrice: 16.50,
    pricePerKm: 2.20,
    pricePerMin: 0.55,
    minFare: 22.00,
    icon: "package",
  }
];

export const FREE_WAITING_MINUTES = 3;

export const PAYMENT_METHODS = [
  { id: "cash", name: "Cash", icon: "Banknote" },
  { id: "mobile_money", name: "MoMo", icon: "Smartphone" },
  { id: "wallet", name: "Wallet", icon: "Wallet" },
  { id: "card", name: "Card", icon: "CreditCard" },
];

export const POPULAR_DESTINATIONS = [
  { name: "Kotoka International Airport", address: "Airport Rd, Accra", lat: 5.6052, lng: -0.1668 },
  { name: "Accra Mall", address: "Tetteh Quarshie Interchange, Accra", lat: 5.6362, lng: -0.1769 },
  { name: "University of Ghana", address: "Legon, Accra", lat: 5.6502, lng: -0.1869 },
  { name: "Labadi Beach", address: "La, Accra", lat: 5.5558, lng: -0.1469 },
  { name: "Osu Oxford Street", address: "Osu, Accra", lat: 5.5558, lng: -0.1769 },
  { name: "Tema Station", address: "Accra Central", lat: 5.5502, lng: -0.2069 },
  { name: "West Hills Mall", address: "Weija, Accra", lat: 5.5752, lng: -0.3169 },
  { name: "Achimota Mall", address: "Achimota, Accra", lat: 5.6252, lng: -0.2269 },
];

export function calculateFare(
  categoryId: string,
  distanceKm: number,
  durationMinutes: number,
  surgeMultiplier: number = 1.0
): number {
  const category = RIDE_CATEGORIES.find(c => c.id === categoryId);
  if (!category) return 0;

  const distanceFare = category.basePrice + (distanceKm * category.pricePerKm);
  const timeFare = durationMinutes * category.pricePerMin;
  const subtotal = distanceFare + timeFare;
  const withSurge = subtotal * surgeMultiplier;
  const final = Math.max(withSurge, category.minFare);
  
  return parseFloat(final.toFixed(2));
}

export function getFareBreakdown(
  categoryId: string,
  distanceKm: number,
  durationMinutes: number,
  surgeMultiplier: number = 1.0
) {
  const category = RIDE_CATEGORIES.find(c => c.id === categoryId);
  if (!category) return { baseFare: 0, distanceFare: 0, timeFare: 0, total: 0 };

  const baseFare = category.basePrice;
  const distanceFare = distanceKm * category.pricePerKm;
  const timeFare = durationMinutes * category.pricePerMin;
  const subtotal = baseFare + distanceFare + timeFare;
  const withSurge = subtotal * surgeMultiplier;
  const total = Math.max(withSurge, category.minFare);

  return {
    baseFare: parseFloat(baseFare.toFixed(2)),
    distanceFare: parseFloat(distanceFare.toFixed(2)),
    timeFare: parseFloat(timeFare.toFixed(2)),
    total: parseFloat(total.toFixed(2)),
  };
}
