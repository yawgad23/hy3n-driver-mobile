import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INCOMING_TRIP_ALERT_PLAYBACK,
  INCOMING_TRIP_NOTIFICATION,
  isDriverRideOfferNotification,
  shouldPlayIncomingTripAlert,
} from '../lib/incoming-trip-alert';

test('an eligible incoming request plays the existing alert one time', () => {
  assert.equal(INCOMING_TRIP_ALERT_PLAYBACK.loop, false);
  assert.equal(INCOMING_TRIP_NOTIFICATION.sound, false);
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

test('only a Driver ride-offer remote notification suppresses foreground channel audio', () => {
  assert.equal(isDriverRideOfferNotification({ type: 'ride_offer', rideId: 'ride-1' }), true);
  assert.equal(isDriverRideOfferNotification({ type: 'ride_status', rideId: 'ride-1' }), false);
  assert.equal(isDriverRideOfferNotification(null), false);
});
