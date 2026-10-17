import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDriverNavigationArrival } from '../lib/driver-navigation-arrival';

const nowMs = 1_760_693_400_000;
const target = { key: 'dropoff:5.704000:-0.096000', latitude: 5.704, longitude: -0.096 };
const arrivalAtTarget = { waypoint: { position: { lat: target.latitude, lng: target.longitude } } };
const freshFixAtTarget = { latitude: target.latitude, longitude: target.longitude, accuracyMeters: 8, time: nowMs - 1_000 };

test('does not accept an iPhone callback for a different waypoint', () => {
  const result = validateDriverNavigationArrival({
    target,
    arrival: { waypoint: { position: { lat: 5.699, lng: -0.11 } } },
    deviceFix: freshFixAtTarget,
    nowMs,
  });
  assert.deepEqual(result.reason, 'waypoint_mismatch');
  assert.equal(result.accepted, false);
});

test('does not accept a target waypoint when the fresh Driver phone location is elsewhere', () => {
  const result = validateDriverNavigationArrival({
    target,
    arrival: arrivalAtTarget,
    deviceFix: { latitude: 5.703, longitude: -0.1, accuracyMeters: 5, time: nowMs - 1_000 },
    nowMs,
  });
  assert.deepEqual(result.reason, 'location_not_at_target');
  assert.equal(result.accepted, false);
});

test('does not accept stale or imprecise phone fixes for a navigation arrival', () => {
  assert.equal(validateDriverNavigationArrival({
    target, arrival: arrivalAtTarget,
    deviceFix: { ...freshFixAtTarget, time: nowMs - 16_000 }, nowMs,
  }).reason, 'location_stale_or_imprecise');
  assert.equal(validateDriverNavigationArrival({
    target, arrival: arrivalAtTarget,
    deviceFix: { ...freshFixAtTarget, accuracyMeters: 51 }, nowMs,
  }).reason, 'location_stale_or_imprecise');
});

test('accepts a current iPhone waypoint only when a fresh precise phone fix is at the active HY3N target', () => {
  const result = validateDriverNavigationArrival({ target, arrival: arrivalAtTarget, deviceFix: freshFixAtTarget, nowMs });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'confirmed');
  assert.ok((result.waypointDistanceMeters ?? Infinity) < 1);
  assert.ok((result.locationDistanceMeters ?? Infinity) < 1);
});
