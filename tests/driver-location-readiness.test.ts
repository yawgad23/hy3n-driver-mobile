import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverAvailabilityLabel,
  hasRecentUsableDriverLocation,
  hasUsableDriverLocation,
} from '../lib/driver-location-readiness';

test('Driver availability only advertises online after a real device coordinate exists', () => {
  assert.equal(hasUsableDriverLocation(null), false);
  assert.equal(hasUsableDriverLocation({ coords: { latitude: 0, longitude: 0 } }), false);
  assert.equal(hasUsableDriverLocation({ coords: { latitude: 5.6037, longitude: -0.187 } }), true);
  assert.equal(driverAvailabilityLabel(true, false), 'Locating');
  assert.equal(driverAvailabilityLabel(true, true), 'Online');
  assert.equal(driverAvailabilityLabel(false, true), 'Offline');
});

test('Driver can reuse a fresh valid GPS point when returning online', () => {
  const now = 1_700_000_000_000;
  const location = { coords: { latitude: 5.6037, longitude: -0.187 }, timestamp: now - 15_000 };
  assert.equal(hasRecentUsableDriverLocation(location, now), true);
  assert.equal(hasRecentUsableDriverLocation({ ...location, timestamp: now - 61_000 }, now), false);
  assert.equal(hasRecentUsableDriverLocation({ coords: { latitude: 0, longitude: 0 }, timestamp: now }, now), false);
});
