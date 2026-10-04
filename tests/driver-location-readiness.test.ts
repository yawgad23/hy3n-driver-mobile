import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverAvailabilityLabel,
  hasBootstrapDriverLocation,
  hasRecentUsableDriverLocation,
  hasUsableDriverLocation,
  shouldReplaceDriverLocation,
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

test('Driver bootstraps only from a recent real device fix and retains the newest GPS result', () => {
  const now = 1_700_000_000_000;
  const cached = { coords: { latitude: 5.6037, longitude: -0.187 }, timestamp: now - 30_000 };
  const stale = { coords: { latitude: 5.6036, longitude: -0.188 }, timestamp: now - 55_000 };
  const fresh = { coords: { latitude: 5.6038, longitude: -0.186 }, timestamp: now - 2_000 };

  assert.equal(hasBootstrapDriverLocation(cached, now), true);
  assert.equal(hasBootstrapDriverLocation({ ...cached, timestamp: now - 60_001 }, now), false);
  assert.equal(shouldReplaceDriverLocation(cached, stale), false);
  assert.equal(shouldReplaceDriverLocation(cached, fresh), true);
});
