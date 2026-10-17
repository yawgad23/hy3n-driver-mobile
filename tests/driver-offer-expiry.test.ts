import assert from 'node:assert/strict';
import test from 'node:test';
import { DRIVER_OFFER_REVIEW_SECONDS } from '../lib/driver-offer-lifecycle';
import { driverOfferExpiryMs, isDriverOfferWithinWindow } from '../lib/driver-offer-expiry';

test('uses the server targeted-offer deadline without extending it locally', () => {
  const receivedAt = Date.UTC(2026, 9, 17, 18, 0, 0);
  const serverExpiry = new Date(receivedAt + 18_000).toISOString();
  const expiry = driverOfferExpiryMs(serverExpiry, receivedAt);
  assert.equal(expiry, receivedAt + 18_000);
  assert.equal(isDriverOfferWithinWindow(expiry, receivedAt + 17_999), true);
  assert.equal(isDriverOfferWithinWindow(expiry, receivedAt + 18_000), false);
});

test('keeps a legacy offer and its request song for only the bounded fallback window', () => {
  const receivedAt = Date.UTC(2026, 9, 17, 18, 0, 0);
  const expiry = driverOfferExpiryMs(undefined, receivedAt);
  assert.equal(expiry, receivedAt + DRIVER_OFFER_REVIEW_SECONDS * 1_000);
  assert.equal(isDriverOfferWithinWindow(expiry, expiry - 1), true);
  assert.equal(isDriverOfferWithinWindow(expiry, expiry), false);
});
