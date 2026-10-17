import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverOfferLeaseKey,
  isUnavailableDriverOfferError,
  shouldPresentDriverOffer,
} from '../lib/driver-offer-lease';

const offer = {
  id: 'ride-1',
  driver_offer_attempt: 2,
  driver_offer_issued_at: '2026-10-17T18:00:00.000Z',
  driver_offer_expires_at: '2026-10-17T18:01:00.000Z',
};

test('does not re-present a locally retired cached offer lease', () => {
  const retired = driverOfferLeaseKey(offer);
  assert.equal(shouldPresentDriverOffer(offer, retired), false);
});

test('allows a genuinely newer server offer lease for the same ride', () => {
  const retired = driverOfferLeaseKey(offer);
  const newer = { ...offer, driver_offer_attempt: 3, driver_offer_issued_at: '2026-10-17T18:01:00.000Z', driver_offer_expires_at: '2026-10-17T18:02:00.000Z' };
  assert.equal(shouldPresentDriverOffer(newer, retired), true);
});

test('treats an expired or reassigned offer response as a normal terminal outcome', () => {
  assert.equal(isUnavailableDriverOfferError(new Error('This ride offer is no longer available to you.')), true);
  assert.equal(isUnavailableDriverOfferError(new Error('This ride request has expired.')), true);
  assert.equal(isUnavailableDriverOfferError(new Error('network unavailable')), false);
});
