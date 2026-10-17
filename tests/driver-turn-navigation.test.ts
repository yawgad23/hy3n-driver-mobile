import assert from 'node:assert/strict';
import test from 'node:test';
import {
  googleMapsNavigationFallbackUrl,
  googleMapsTurnByTurnUri,
  tripNavigationDestination,
} from '../lib/driver-turn-navigation';

test('builds the Android Google Maps driving navigation URI for a drop-off', () => {
  assert.equal(
    googleMapsTurnByTurnUri({ latitude: 5.6037, longitude: -0.187 }),
    'google.navigation:q=5.6037,-0.187&mode=d',
  );
});

test('builds a cross-platform driving navigation fallback with turn-by-turn requested', () => {
  assert.equal(
    googleMapsNavigationFallbackUrl({ latitude: 5.6037, longitude: -0.187 }),
    'https://www.google.com/maps/dir/?api=1&destination=5.6037%2C-0.187&travelmode=driving&dir_action=navigate',
  );
});

test('uses the server ride coordinates and rejects malformed destinations', () => {
  assert.deepEqual(
    tripNavigationDestination({ destination: { lat: '5.6037', lng: '-0.187' } }, 'dropoff'),
    { latitude: 5.6037, longitude: -0.187 },
  );
  assert.equal(tripNavigationDestination({ destination_lat: 99, destination_lng: 0 }, 'dropoff'), null);
});

test('uses the Driver-approved active stop before the final destination', () => {
  assert.deepEqual(
    tripNavigationDestination({
      destination: { lat: 5.6037, lng: -0.187 },
      route_target: { kind: 'stop', stop_id: 'stop-1', location: { lat: 5.618, lng: -0.15 } },
      in_trip_stops: [{ id: 'stop-1', status: 'pending', lat: 5.618, lng: -0.15 }],
    }, 'dropoff'),
    { latitude: 5.618, longitude: -0.15 },
  );
});

test('does not navigate to a malformed legacy route target instead of the real destination', () => {
  assert.deepEqual(
    tripNavigationDestination({
      destination: { lat: 5.6037, lng: -0.187 },
      route_target: { location: { lat: 5.618, lng: -0.15 } },
    }, 'dropoff'),
    { latitude: 5.6037, longitude: -0.187 },
  );
});
