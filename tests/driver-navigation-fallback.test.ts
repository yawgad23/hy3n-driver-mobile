import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverMapAppNavigationLabel,
  driverMapAppNavigationUri,
  driverMapAppWebFallbackUri,
} from '../lib/driver-navigation-fallback';

const destination = { latitude: 5.6037, longitude: -0.187 };

test('Driver navigation fallback opens Apple Maps with driving directions on iPhone', () => {
  assert.equal(
    driverMapAppNavigationUri(destination, 'ios'),
    'https://maps.apple.com/?daddr=5.6037%2C-0.187&dirflg=d',
  );
  assert.equal(driverMapAppNavigationLabel('ios'), 'Navigate in Apple Maps');
});

test('Driver navigation fallback opens Google Maps turn-by-turn navigation on Android', () => {
  assert.equal(
    driverMapAppNavigationUri(destination, 'android'),
    'google.navigation:q=5.6037,-0.187&mode=d',
  );
  assert.equal(driverMapAppNavigationLabel('android'), 'Navigate in Google Maps');
  assert.equal(
    driverMapAppWebFallbackUri(destination),
    'https://www.google.com/maps/dir/?api=1&destination=5.6037%2C-0.187&travelmode=driving&dir_action=navigate',
  );
});

test('Driver navigation fallback refuses an invalid destination', () => {
  assert.equal(driverMapAppNavigationUri({ latitude: 91, longitude: 0 }, 'ios'), null);
  assert.equal(driverMapAppWebFallbackUri({ latitude: 0, longitude: 181 }), null);
});
