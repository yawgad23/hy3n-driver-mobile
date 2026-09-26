export interface DriverHistoryTrip {
  id: string;
  pickup: string;
  pickup_address: string;
  pickup_location: string;
  destination: string;
  destination_address: string;
  dropoff_location: string;
  fare: number;
  final_fare: number;
  fare_estimate: number;
  tip_amount: number;
  status: string;
  created_date: string;
  trip_date: string;
  rider_name: string;
  passenger_name: string;
  distance: number | null;
  distance_km: number | null;
  duration: number | null;
  duration_min: number | null;
  duration_minutes: number | null;
  category: string;
  driver_feedback: string;
  passenger_feedback: string;
  payment_method: string;
  rider_rating: number | null;
  passenger_rating: number | null;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

export function historyText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export function historyLocation(...values: unknown[]): string {
  for (const value of values) {
    const direct = historyText(value);
    if (direct) return direct;
    const source = record(value);
    if (!source) continue;
    for (const key of ['address', 'name', 'label', 'formatted_address', 'description']) {
      const candidate = historyText(source[key]);
      if (candidate) return candidate;
    }
  }
  return '—';
}

export function historyNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function historyDate(value: unknown): Date | null {
  const text = historyText(value);
  const parsed = text ? new Date(text) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function numberOr(value: unknown, fallback = 0): number {
  return historyNumber(value) ?? fallback;
}

function firstDate(source: UnknownRecord): string {
  for (const key of ['trip_date', 'completed_at', 'created_date', 'created_at']) {
    const candidate = historyText(source[key]);
    if (historyDate(candidate)) return candidate;
  }
  return '';
}

export function normalizeDriverHistory(rawTrips: unknown): DriverHistoryTrip[] {
  if (!Array.isArray(rawTrips)) return [];

  return rawTrips.flatMap((raw) => {
    const source = record(raw);
    const id = source ? historyText(source.id) : '';
    if (!source || !id) return [];

    const tripDate = firstDate(source);
    const pickup = historyLocation(source.pickup_address, source.pickup_location, source.pickup);
    const destination = historyLocation(source.destination_address, source.dropoff_location, source.destination);
    const status = historyText(source.status, 'unknown').toLowerCase();
    const fare = numberOr(source.fare);
    const finalFare = numberOr(source.final_fare, fare);
    const fareEstimate = numberOr(source.fare_estimate, finalFare);

    return [{
      id,
      pickup,
      pickup_address: pickup,
      pickup_location: pickup,
      destination,
      destination_address: destination,
      dropoff_location: destination,
      fare,
      final_fare: finalFare,
      fare_estimate: fareEstimate,
      tip_amount: numberOr(source.tip_amount),
      status,
      created_date: tripDate,
      trip_date: tripDate,
      rider_name: historyText(source.rider_name),
      passenger_name: historyText(source.passenger_name),
      distance: historyNumber(source.distance),
      distance_km: historyNumber(source.distance_km),
      duration: historyNumber(source.duration),
      duration_min: historyNumber(source.duration_min),
      duration_minutes: historyNumber(source.duration_minutes),
      category: historyText(source.category),
      driver_feedback: historyText(source.driver_feedback),
      passenger_feedback: historyText(source.passenger_feedback),
      payment_method: historyText(source.payment_method ?? source.payment),
      rider_rating: historyNumber(source.rider_rating),
      passenger_rating: historyNumber(source.passenger_rating),
    }];
  });
}
