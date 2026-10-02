import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_BACKGROUND_LOCATION_POLICY,
  DRIVER_FOREGROUND_LOCATION_POLICY,
  shouldTrackDriverLocation,
} from '../lib/driver-location-policy';

test('Driver foreground and background policies publish responsive movement updates', () => {
  assert.equal(DRIVER_FOREGROUND_LOCATION_POLICY.timeIntervalMs, 3_000);
  assert.equal(DRIVER_FOREGROUND_LOCATION_POLICY.distanceIntervalMeters, 5);
  assert.equal(DRIVER_BACKGROUND_LOCATION_POLICY.timeIntervalMs, 5_000);
  assert.equal(DRIVER_BACKGROUND_LOCATION_POLICY.distanceIntervalMeters, 5);
});

test('accepted trips retain live location tracking even if availability is toggled off', () => {
  assert.equal(shouldTrackDriverLocation(true, false), true);
  assert.equal(shouldTrackDriverLocation(false, true), true);
  assert.equal(shouldTrackDriverLocation(false, false), false);
});
