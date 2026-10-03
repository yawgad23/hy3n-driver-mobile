import assert from 'node:assert/strict';
import test from 'node:test';
import { emitDriverRideOffer, subscribeDriverRideOffer } from '../lib/ride-offer-signal';

test('Driver offer signal notifies foreground offer queries and cleans up', () => {
  let received = 0;
  const unsubscribe = subscribeDriverRideOffer(() => { received += 1; });
  emitDriverRideOffer();
  unsubscribe();
  emitDriverRideOffer();
  assert.equal(received, 1);
});
