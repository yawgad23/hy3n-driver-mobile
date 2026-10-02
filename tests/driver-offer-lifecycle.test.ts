import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_OFFER_POLL_INTERVAL_MS,
  DRIVER_OFFER_REVIEW_SECONDS,
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
