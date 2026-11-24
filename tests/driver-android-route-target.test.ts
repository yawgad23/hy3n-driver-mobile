import assert from 'node:assert/strict';
import test from 'node:test';
import { driverAndroidRouteMatchesTarget } from '../lib/driver-android-route-target';

const target = { lat: 5.704, lng: -0.096 };
const roadEnd = { lat: 5.704, lng: -0.098 };
const road = [{ lat: 5.7, lng: -0.1 }, { lat: 5.704, lng: -0.1 }, roadEnd];
const segment = { destinationWaypoint: { position: target }, destinationLatLng: roadEnd, segmentLatLngList: road };

test('Android accepts the real route to the native road endpoint for its matching off-road waypoint', () => {
  assert.equal(driverAndroidRouteMatchesTarget([segment], road, target), true);
  assert.deepEqual(road.at(-1), roadEnd, 'no fake target connector is appended');
});

test('Android matching destination waypoint alone cannot turn a partial current prefix into a complete driving route', () => {
  assert.equal(driverAndroidRouteMatchesTarget([segment], road.slice(0, 2), target), false);
  assert.equal(driverAndroidRouteMatchesTarget([segment], road, target), true);
});

test('Android rejects conflicting and malformed waypoint identities even when a route endpoint is near the server target', () => {
  for (const position of [null, {}, { lat: '5.704', lng: -0.096 }, { lat: 5.704, lng: null }, { lat: NaN, lng: -0.096 }, { lat: 5.73, lng: -0.11 }]) {
    assert.equal(driverAndroidRouteMatchesTarget([{ destinationWaypoint: { position } }], [road[0], target], target), false);
  }
});

test('Android rejects malformed declared road endpoints and retains endpoint-only support when old snapshots lack waypoint metadata', () => {
  assert.equal(driverAndroidRouteMatchesTarget([{ ...segment, destinationLatLng: { lat: null, lng: -0.098 } }], road, target), false);
  assert.equal(driverAndroidRouteMatchesTarget([{ segmentLatLngList: road }], road, target), false);
  assert.equal(driverAndroidRouteMatchesTarget([{ segmentLatLngList: [road[0], target] }], [road[0], target], target), true);
});
