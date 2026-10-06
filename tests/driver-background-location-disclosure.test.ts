import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_BACKGROUND_LOCATION_DISCLOSURE,
  shouldShowDriverBackgroundLocationDisclosure,
} from '../lib/driver-background-location-disclosure';

test('Android shows the prominent HY3N disclosure once before background location', () => {
  assert.match(DRIVER_BACKGROUND_LOCATION_DISCLOSURE.message, /background or not in use/i);
  assert.match(DRIVER_BACKGROUND_LOCATION_DISCLOSURE.message, /online or completing an active trip/i);
  assert.match(DRIVER_BACKGROUND_LOCATION_DISCLOSURE.message, /stops when you go offline/i);

  assert.equal(shouldShowDriverBackgroundLocationDisclosure({
    platform: 'android',
    shouldTrack: true,
    decision: 'unseen',
  }), true);
  assert.equal(shouldShowDriverBackgroundLocationDisclosure({
    platform: 'android',
    shouldTrack: true,
    decision: 'accepted',
  }), false);
  assert.equal(shouldShowDriverBackgroundLocationDisclosure({
    platform: 'android',
    shouldTrack: true,
    decision: 'declined',
  }), false);
});

test('the disclosure does not interrupt iOS or inactive Driver tracking', () => {
  assert.equal(shouldShowDriverBackgroundLocationDisclosure({
    platform: 'ios',
    shouldTrack: true,
    decision: 'unseen',
  }), false);
  assert.equal(shouldShowDriverBackgroundLocationDisclosure({
    platform: 'android',
    shouldTrack: false,
    decision: 'unseen',
  }), false);
});
