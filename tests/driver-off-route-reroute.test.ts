import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessDriverOffRoute,
  distanceFromDriverToRouteMetres,
  driverOffRouteThresholdMetres,
  EMPTY_DRIVER_OFF_ROUTE_MONITOR,
} from '../lib/driver-off-route-reroute';

const straightRoute = [
  { lat: 5.6000, lng: -0.2000 },
  { lat: 5.6100, lng: -0.2000 },
];

test('measures a Driver position on the current route as near zero deviation', () => {
  const distance = distanceFromDriverToRouteMetres(
    { latitude: 5.605, longitude: -0.2 },
    straightRoute,
  );
  assert.ok(distance !== null && distance < 1);
});

test('requires two fresh off-route GPS samples before requesting a replacement route', () => {
  const first = assessDriverOffRoute(
    EMPTY_DRIVER_OFF_ROUTE_MONITOR,
    { latitude: 5.605, longitude: -0.1993, accuracyMeters: 8 },
    straightRoute,
    'gps-1',
    20_000,
  );
  assert.equal(first.offRoute, true);
  assert.equal(first.shouldReroute, false);
  assert.equal(first.next.consecutiveOffRouteSamples, 1);

  const second = assessDriverOffRoute(
    first.next,
    { latitude: 5.6052, longitude: -0.1993, accuracyMeters: 8 },
    straightRoute,
    'gps-2',
    22_000,
  );
  assert.equal(second.shouldReroute, true);
  assert.equal(second.next.consecutiveOffRouteSamples, 0);
  assert.equal(second.next.lastRerouteAtMs, 22_000);
});

test('does not count a React render of the same GPS observation twice', () => {
  const once = assessDriverOffRoute(
    EMPTY_DRIVER_OFF_ROUTE_MONITOR,
    { latitude: 5.605, longitude: -0.1993 },
    straightRoute,
    'gps-1',
    20_000,
  );
  const repeated = assessDriverOffRoute(
    once.next,
    { latitude: 5.605, longitude: -0.1993 },
    straightRoute,
    'gps-1',
    20_001,
  );
  assert.equal(repeated.shouldReroute, false);
  assert.equal(repeated.next.consecutiveOffRouteSamples, 1);
});

test('resets off-route confirmation when the Driver returns to the route', () => {
  const offRoute = assessDriverOffRoute(
    EMPTY_DRIVER_OFF_ROUTE_MONITOR,
    { latitude: 5.605, longitude: -0.1993 },
    straightRoute,
    'gps-1',
    20_000,
  );
  const recovered = assessDriverOffRoute(
    offRoute.next,
    { latitude: 5.6055, longitude: -0.2 },
    straightRoute,
    'gps-2',
    22_000,
  );
  assert.equal(recovered.offRoute, false);
  assert.equal(recovered.shouldReroute, false);
  assert.equal(recovered.next.consecutiveOffRouteSamples, 0);
});

test('uses GPS accuracy only to make the guard more conservative and applies a reroute cooldown', () => {
  assert.equal(driverOffRouteThresholdMetres(null), 45);
  assert.equal(driverOffRouteThresholdMetres(30), 60);
  assert.equal(driverOffRouteThresholdMetres(100), 90);

  const first = assessDriverOffRoute(
    EMPTY_DRIVER_OFF_ROUTE_MONITOR,
    { latitude: 5.605, longitude: -0.1993 },
    straightRoute,
    'gps-1',
    20_000,
  );
  const rerouted = assessDriverOffRoute(
    first.next,
    { latitude: 5.6052, longitude: -0.1993 },
    straightRoute,
    'gps-2',
    22_000,
  );
  assert.equal(rerouted.shouldReroute, true);

  const cooldownFirst = assessDriverOffRoute(
    rerouted.next,
    { latitude: 5.6054, longitude: -0.1993 },
    straightRoute,
    'gps-3',
    24_000,
  );
  const cooldownSecond = assessDriverOffRoute(
    cooldownFirst.next,
    { latitude: 5.6056, longitude: -0.1993 },
    straightRoute,
    'gps-4',
    26_000,
  );
  assert.equal(cooldownSecond.shouldReroute, false);
});
