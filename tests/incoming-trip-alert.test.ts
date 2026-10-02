import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INCOMING_TRIP_ALERT_PLAYBACK,
  shouldPlayIncomingTripAlert,
} from '../lib/incoming-trip-alert';

test('an eligible incoming request plays the existing alert one time', () => {
  assert.equal(INCOMING_TRIP_ALERT_PLAYBACK.loop, false);
  assert.equal(shouldPlayIncomingTripAlert({
    isOnline: true,
    incomingRideId: 'ride-1',
    activeTripId: null,
    soundAlerts: true,
  }), true);
});

test('request audio never plays while offline, on trip, or muted', () => {
  assert.equal(shouldPlayIncomingTripAlert({ isOnline: false, incomingRideId: 'ride-1', activeTripId: null, soundAlerts: true }), false);
  assert.equal(shouldPlayIncomingTripAlert({ isOnline: true, incomingRideId: 'ride-1', activeTripId: 'active-1', soundAlerts: true }), false);
  assert.equal(shouldPlayIncomingTripAlert({ isOnline: true, incomingRideId: 'ride-1', activeTripId: null, soundAlerts: false }), false);
});
