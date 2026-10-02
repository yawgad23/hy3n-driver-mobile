import assert from 'node:assert/strict';
import test from 'node:test';
import { driverAvailabilityLabel, hasUsableDriverLocation } from '../lib/driver-location-readiness';

test('Driver availability only advertises online after a real device coordinate exists', () => {
  assert.equal(hasUsableDriverLocation(null), false);
  assert.equal(hasUsableDriverLocation({ coords: { latitude: 0, longitude: 0 } }), false);
  assert.equal(hasUsableDriverLocation({ coords: { latitude: 5.6037, longitude: -0.187 } }), true);
  assert.equal(driverAvailabilityLabel(true, false), 'Locating');
  assert.equal(driverAvailabilityLabel(true, true), 'Online');
  assert.equal(driverAvailabilityLabel(false, true), 'Offline');
});
