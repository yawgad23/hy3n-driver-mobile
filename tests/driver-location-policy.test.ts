import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_ACTIVE_TRIP_FOREGROUND_LOCATION_POLICY,
  DRIVER_BACKGROUND_LOCATION_POLICY,
  DRIVER_FOREGROUND_LOCATION_POLICY,
  DRIVER_FOREGROUND_PRESENCE_HEARTBEAT_MS,
  driverForegroundLocationPolicy,
  shouldTrackDriverLocation,
} from '../lib/driver-location-policy';

test('Driver foreground and background policies publish responsive movement updates', () => {
  assert.equal(DRIVER_FOREGROUND_LOCATION_POLICY.timeIntervalMs, 3_000);
  assert.equal(DRIVER_FOREGROUND_LOCATION_POLICY.distanceIntervalMeters, 5);
  assert.equal(DRIVER_BACKGROUND_LOCATION_POLICY.timeIntervalMs, 5_000);
  assert.equal(DRIVER_BACKGROUND_LOCATION_POLICY.distanceIntervalMeters, 5);
  assert.equal(DRIVER_FOREGROUND_PRESENCE_HEARTBEAT_MS, 60_000);
});

test('an active trip publishes denser real GPS points for Rider live tracking', () => {
  assert.equal(driverForegroundLocationPolicy(false), DRIVER_FOREGROUND_LOCATION_POLICY);
  assert.equal(driverForegroundLocationPolicy(true), DRIVER_ACTIVE_TRIP_FOREGROUND_LOCATION_POLICY);
  assert.equal(DRIVER_ACTIVE_TRIP_FOREGROUND_LOCATION_POLICY.timeIntervalMs, 2_000);
  assert.equal(DRIVER_ACTIVE_TRIP_FOREGROUND_LOCATION_POLICY.distanceIntervalMeters, 3);
});

test('accepted trips retain live location tracking even if availability is toggled off', () => {
  assert.equal(shouldTrackDriverLocation(true, false), true);
  assert.equal(shouldTrackDriverLocation(false, true), true);
  assert.equal(shouldTrackDriverLocation(false, false), false);
});
