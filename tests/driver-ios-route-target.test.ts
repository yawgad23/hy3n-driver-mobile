import assert from 'node:assert/strict';
import test from 'node:test';
import { driverIosRouteMatchesTarget } from '../lib/driver-ios-route-target';

const target = { lat: 5.704, lng: -0.096 };
const roadEnd = { lat: 5.704, lng: -0.098 };
const road = [{ lat: 5.7, lng: -0.1 }, { lat: 5.704, lng: -0.1 }, roadEnd];
const segment = { destinationWaypoint: { position: target }, destinationLatLng: roadEnd, segmentLatLngList: road };

test('iOS accepts matching off-road waypoint identity and its genuine snapped endpoint without modifying geometry', () => {
  const snapshot = JSON.stringify({ segment, road, target });
  assert.equal(driverIosRouteMatchesTarget([segment], road, target), true);
  assert.deepEqual(road.at(-1), roadEnd, 'a waypoint connector must never be appended');
  assert.equal(JSON.stringify({ segment, road, target }), snapshot, 'validation does not mutate the SDK snapshot or server target');
  assert.equal(driverIosRouteMatchesTarget([{ ...segment,
    destinationWaypoint: { position: { latitude: target.lat, longitude: target.lng } } }], road, target), true);
});

test('iOS binds waypoint identity within 25 m even when conflicting geometry ends within the legacy 150 m server radius', () => {
  const nearbyWrongWaypoint = { lat: target.lat + 0.0005, lng: target.lng };
  assert.equal(driverIosRouteMatchesTarget([{ destinationWaypoint: { position: nearbyWrongWaypoint },
    destinationLatLng: target }], [road[0], target], target), false);
  assert.equal(driverIosRouteMatchesTarget([{ ...segment,
    destinationWaypoint: { position: { lat: target.lat + 0.0002, lng: target.lng } } }], road, target), true);
  assert.equal(driverIosRouteMatchesTarget([{ ...segment,
    destinationWaypoint: { position: { lat: target.lat + 0.0003, lng: target.lng } } }], road, target), false);
});

test('iOS requires the actual path to end within 25 m of its declared routable endpoint, not merely a matching waypoint', () => {
  assert.equal(driverIosRouteMatchesTarget([segment], road.slice(0, 2), target), false);
  const nearTargetPrefix = [road[0], { lat: target.lat + 0.0005, lng: target.lng }];
  assert.equal(driverIosRouteMatchesTarget([{ ...segment, destinationLatLng: target }], nearTargetPrefix, target), false,
    'a current prefix inside the old 150 m target radius still has not reached the declared endpoint');
  assert.equal(driverIosRouteMatchesTarget([segment], [...road.slice(0, 2), { lat: roadEnd.lat + 0.0002, lng: roadEnd.lng }], target), true);
  assert.equal(driverIosRouteMatchesTarget([segment], [...road.slice(0, 2), { lat: roadEnd.lat + 0.0003, lng: roadEnd.lng }], target), false);
  assert.equal(driverIosRouteMatchesTarget([segment], [], target), false);
  assert.equal(driverIosRouteMatchesTarget([segment], [roadEnd], target), false);
});

test('iOS fails closed for malformed or conflicting waypoint metadata instead of taking the nearby endpoint fallback', () => {
  for (const waypoint of [null, false, '', [], {}, { position: null }, { position: {} },
    { position: { lat: '5.704', lng: target.lng } }, { position: { lat: target.lat, lng: null } },
    { position: { lat: NaN, lng: target.lng } }, { position: { lat: Infinity, lng: target.lng } },
    { position: { lat: 91, lng: target.lng } }, { position: { lat: target.lat, lng: 181 } },
    { position: { lat: 0, lng: 0 } },
    { position: { ...target, latitude: target.lat + 0.001 } },
    { position: { ...target, longitude: 'invalid' } },
    { position: { lat: null, lng: target.lng, latitude: target.lat } },
  ]) {
    assert.equal(driverIosRouteMatchesTarget([{ destinationWaypoint: waypoint, destinationLatLng: target }],
      [road[0], target], target), false, `malformed waypoint ${JSON.stringify(waypoint)}`);
  }
});

test('iOS metadata-bearing routes require a valid declared endpoint and cannot hide conflicting coordinate aliases', () => {
  for (const endpoint of [undefined, null, {}, [], { lat: null, lng: roadEnd.lng },
    { lat: roadEnd.lat, lng: 'invalid' }, { lat: NaN, lng: roadEnd.lng },
    { lat: 91, lng: roadEnd.lng }, { lat: roadEnd.lat, lng: 181 }, { lat: 0, lng: 0 },
    { ...roadEnd, latitude: roadEnd.lat + 0.001 }, { ...roadEnd, longitude: null },
  ]) {
    assert.equal(driverIosRouteMatchesTarget([{ ...segment, destinationLatLng: endpoint }], road, target), false);
  }
  assert.equal(driverIosRouteMatchesTarget([{ ...segment,
    destinationLatLng: { latitude: roadEnd.lat, longitude: roadEnd.lng } }], road, target), true);
});

test('iOS validates the final leg of each candidate independently so a partial current snapshot cannot contaminate the complete route', () => {
  const partial = { ...segment, segmentLatLngList: road.slice(0, 2) };
  assert.equal(driverIosRouteMatchesTarget([partial], partial.segmentLatLngList, target), false);
  assert.equal(driverIosRouteMatchesTarget([segment], road, target), true);
  const intermediate = { destinationWaypoint: { position: road[1] }, destinationLatLng: road[1] };
  assert.equal(driverIosRouteMatchesTarget([intermediate, segment], road, target), true);
});

test('iOS legacy snapshots without waypoint metadata retain the existing 150 m endpoint fallback without extra tolerance', () => {
  const legacy = { segmentLatLngList: road };
  assert.equal(driverIosRouteMatchesTarget([legacy], road, target), false, 'a snapped endpoint beyond 150 m needs waypoint identity');
  assert.equal(driverIosRouteMatchesTarget([legacy], [road[0], target], target), true);
  assert.equal(driverIosRouteMatchesTarget([legacy], [road[0], { lat: target.lat + 0.0013, lng: target.lng }], target), true);
  assert.equal(driverIosRouteMatchesTarget([legacy], [road[0], { lat: target.lat + 0.0014, lng: target.lng }], target), false);
  assert.equal(driverIosRouteMatchesTarget([{ ...legacy, destinationLatLng: roadEnd }], [road[0], target], target), true,
    'endpoint metadata alone does not silently tighten the legacy no-waypoint behavior');
  assert.equal(driverIosRouteMatchesTarget([], road, target), false);
  assert.equal(driverIosRouteMatchesTarget(null, road, target), false);
  assert.equal(driverIosRouteMatchesTarget([null], road, target), false);
});
