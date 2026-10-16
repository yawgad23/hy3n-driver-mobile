import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRefreshDriverRideOffersOnAppResume } from '../lib/ride-offer-signal';

test('refreshes the authenticated Driver offer feed when HY3N returns to foreground', () => {
  assert.equal(shouldRefreshDriverRideOffersOnAppResume({
    previousAppState: 'background',
    nextAppState: 'active',
    authenticated: true,
    online: true,
    hasCurrentLocation: true,
  }), true);

  assert.equal(shouldRefreshDriverRideOffersOnAppResume({
    previousAppState: 'inactive',
    nextAppState: 'active',
    authenticated: true,
    online: true,
    hasCurrentLocation: true,
  }), true);
});

test('does not query offers for offline, unauthenticated, or locationless states', () => {
  const base = {
    previousAppState: 'background',
    nextAppState: 'active',
    authenticated: true,
    online: true,
    hasCurrentLocation: true,
  };

  assert.equal(shouldRefreshDriverRideOffersOnAppResume({ ...base, online: false }), false);
  assert.equal(shouldRefreshDriverRideOffersOnAppResume({ ...base, authenticated: false }), false);
  assert.equal(shouldRefreshDriverRideOffersOnAppResume({ ...base, hasCurrentLocation: false }), false);
  assert.equal(shouldRefreshDriverRideOffersOnAppResume({ ...base, nextAppState: 'background' }), false);
});
