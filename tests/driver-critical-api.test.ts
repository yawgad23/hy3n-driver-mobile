import assert from 'node:assert/strict';
import test from 'node:test';
import { isCriticalDriverProcedure } from '../lib/driver-critical-api';

test('live Driver lifecycle procedures bypass the background batch queue', () => {
  for (const path of [
    'driverTrips.availableOffers',
    'driverTrips.respondToOffer',
    'driverTrips.setAvailability',
    'driverTrips.arrive',
    'driverTrips.verifyAndStart',
    'driverTrips.start',
    'driverTrips.complete',
    'driverTrips.recordTripLocation',
  ]) {
    assert.equal(isCriticalDriverProcedure(path), true);
  }
  assert.equal(isCriticalDriverProcedure('driverTrips.history'), false);
  assert.equal(isCriticalDriverProcedure('driverFinance.getOverview'), false);
});
