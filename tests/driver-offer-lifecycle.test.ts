import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS,
  DRIVER_OFFER_POLL_INTERVAL_MS,
  DRIVER_OFFER_REVIEW_SECONDS,
  driverOfferAcceptedByServer,
  nextDriverOfferCountdown,
  shouldAutoDeclineDriverOffer,
} from '../lib/driver-offer-lifecycle';

test('Driver ride offers are polled quickly and never silently declined by the client timer', () => {
  assert.equal(DRIVER_OFFER_POLL_INTERVAL_MS, 2_000);
  assert.equal(DRIVER_OFFER_REVIEW_SECONDS, 60);
  assert.equal(nextDriverOfferCountdown(1), 0);
  assert.equal(nextDriverOfferCountdown(0), 0);
  assert.equal(shouldAutoDeclineDriverOffer(), false);
});

test('Driver reconciles a server-confirmed acceptance if the mutation response stalls', () => {
  assert.deepEqual(DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS, [800, 2_000]);
  assert.equal(driverOfferAcceptedByServer({ driver_id: 'driver-1', status: 'driver_arriving' }, 'driver-1'), true);
  assert.equal(driverOfferAcceptedByServer({ driver: { id: 'driver-1' }, status: 'in_progress' }, 'driver-1'), true);
  assert.equal(driverOfferAcceptedByServer({ driver_id: 'other-driver', status: 'driver_arriving' }, 'driver-1'), false);
  assert.equal(driverOfferAcceptedByServer({ driver_id: 'driver-1', status: 'searching' }, 'driver-1'), false);
});
