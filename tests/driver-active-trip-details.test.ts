import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTripDetails } from '../lib/driver-active-trip-details';

test('shows the server-locked booking quote and route details to the assigned Driver', () => {
  assert.deepEqual(activeTripDetails({
    quoted_fare: 37.75,
    estimated_distance_km: 8.4,
    estimated_duration_minutes: 21,
  }), {
    bookedFare: 37.75,
    estimatedDistanceKm: 8.4,
    estimatedDurationMinutes: 21,
  });
});

test('never presents a completed final fare as an active trip booking quote', () => {
  assert.deepEqual(activeTripDetails({
    final_fare: 99,
    live_route_metrics: { distance_km: 2.2, duration_minutes: 7 },
  }), {
    bookedFare: null,
    estimatedDistanceKm: 2.2,
    estimatedDurationMinutes: 7,
  });
});

test('uses compatible legacy server quote fields when a current quote field is absent', () => {
  assert.equal(activeTripDetails({ fare_estimate: '25.5' }).bookedFare, 25.5);
  assert.equal(activeTripDetails({ fare: '24' }).bookedFare, 24);
});
