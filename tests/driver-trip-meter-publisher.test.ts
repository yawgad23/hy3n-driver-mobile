import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_TRIP_METER_MIN_INTERVAL_MS,
  shouldPublishDriverTripMeter,
} from '../lib/driver-trip-meter-publisher';

test('Driver trip meter sends the first valid sample and then bounded updates', () => {
  const first = 1_700_000_000_000;
  assert.equal(shouldPublishDriverTripMeter(0, first), true);
  assert.equal(shouldPublishDriverTripMeter(first, first + DRIVER_TRIP_METER_MIN_INTERVAL_MS - 1), false);
  assert.equal(shouldPublishDriverTripMeter(first, first + DRIVER_TRIP_METER_MIN_INTERVAL_MS), true);
});
