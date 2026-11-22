import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDriverRouteTraffic, DRIVER_ROUTE_BASE_COLOR,
  DRIVER_SLOWER_TRAFFIC_COLOR, DRIVER_TRAFFIC_JAM_COLOR,
} from '../lib/driver-route-traffic';

const road = [{ lat: 5.7, lng: -0.1 }, { lat: 5.701, lng: -0.1 }, { lat: 5.702, lng: -0.1 }];
const secondRoad = [road[2], { lat: 5.703, lng: -0.1 }, { lat: 5.704, lng: -0.1 }];
function segment(stretches: unknown = [], status?: unknown, points: unknown = road) {
  return { segmentLatLngList: points, navigationTrafficData: {
    status: arguments.length >= 2 ? status : 'OK', roadStretchRenderingDataList: stretches,
  } };
}
function stretch(style?: unknown, offsetMeters?: unknown, lengthMeters?: unknown) {
  return {
    style: arguments.length >= 1 ? style : 'SLOWER_TRAFFIC',
    offsetMeters: arguments.length >= 2 ? offsetMeters : 20,
    lengthMeters: arguments.length >= 3 ? lengthMeters : 70,
  };
}
function close(actual: number, expected: number, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not close to ${expected}`);
}
const metersPerLatitudeDegree = Math.PI * 6_371_000 / 180;

test('blue base route and orange/red overlays use only real provider-returned style data', () => {
  assert.equal(DRIVER_ROUTE_BASE_COLOR, '#2563EB');
  const intervals = normalizeDriverRouteTraffic([segment([stretch(), stretch('TRAFFIC_JAM', 100, 30)])]);
  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].color, DRIVER_SLOWER_TRAFFIC_COLOR);
  assert.equal(intervals[1].color, DRIVER_TRAFFIC_JAM_COLOR);
  assert.equal(intervals[0].style, 'slower-traffic');
  assert.equal(intervals[1].style, 'traffic-jam');
  assert.equal(intervals[0].startMeters, 20);
  assert.equal(intervals[0].endMeters, 90);
  close(intervals[0].points[0].lat, 5.7 + 20 / metersPerLatitudeDegree);
  close(intervals[0].points.at(-1)!.lat, 5.7 + 90 / metersPerLatitudeDegree);
  close(intervals[0].points[0].lng, -0.1);
});

test('numeric public TS enums and native string enum names both work without coercion', () => {
  const numeric = normalizeDriverRouteTraffic([segment([stretch(1), stretch(2, 100, 20)], 0)]);
  assert.deepEqual(numeric, normalizeDriverRouteTraffic([segment([stretch('SLOWER_TRAFFIC'), stretch('TRAFFIC_JAM', 100, 20)], 'OK')]));
  for (const status of ['UNAVAILABLE', 1, null, undefined, '0', false, 'ok', 'UNKNOWN']) {
    assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()], status)]), []);
  }
  for (const style of ['UNKNOWN', 0, null, undefined, false, '1', 'SLOW', 'free-flow', 999]) {
    assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch(style)])]), []);
  }
});

test('no data, iOS routes and speed/delay/duration hints never fabricate traffic', () => {
  for (const missing of [null, undefined, {}, [], 'traffic', [null]]) assert.deepEqual(normalizeDriverRouteTraffic(missing), []);
  assert.deepEqual(normalizeDriverRouteTraffic([{ segmentLatLngList: road, speed: 1, seconds: 400, delaySeverity: 1 }]), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment()]), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment(null)]), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment({})]), []);
});

test('traffic stretch crossing multiple road edges retains real vertices and interpolates boundaries', () => {
  const result = normalizeDriverRouteTraffic([segment([stretch('TRAFFIC_JAM', 80, 100)])])[0];
  assert.equal(result.points.length, 3);
  assert.deepEqual(result.points[1], road[1]);
  close(result.points[0].lat, 5.7 + 80 / metersPerLatitudeDegree);
  close(result.points.at(-1)!.lat, 5.7 + 180 / metersPerLatitudeDegree);
});

test('prefix already passed is removed and a partially passed stretch is clipped, not shifted', () => {
  const original = segment([stretch('SLOWER_TRAFFIC', 10, 20), stretch('TRAFFIC_JAM', 80, 100)]);
  const result = normalizeDriverRouteTraffic([original], { progressMeters: 120 });
  assert.equal(result.length, 1);
  assert.equal(result[0].startMeters, 120);
  assert.equal(result[0].endMeters, 180);
  close(result[0].points[0].lat, 5.7 + 120 / metersPerLatitudeDegree);
  assert.deepEqual(normalizeDriverRouteTraffic([original], { progressMeters: 9999 }), []);
});

test('traffic is local to each leg, not overlapping prefixes of flattened complete route', () => {
  const result = normalizeDriverRouteTraffic([
    segment([stretch('SLOWER_TRAFFIC', 20, 40)]),
    segment([stretch('TRAFFIC_JAM', 20, 40)], 'OK', secondRoad),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].segmentIndex, 0);
  assert.equal(result[1].segmentIndex, 1);
  close(result[1].startMeters, metersPerLatitudeDegree * 0.002 + 20);
  close(result[1].points[0].lat, 5.702 + 20 / metersPerLatitudeDegree);
  assert.ok(result[1].points[0].lat > result[0].points.at(-1)!.lat);
});

test('prefix progress crossing legs drops earlier traffic and trims only current leg', () => {
  const legLength = metersPerLatitudeDegree * 0.002;
  const result = normalizeDriverRouteTraffic([
    segment([stretch('SLOWER_TRAFFIC', 0, 200)]),
    segment([stretch('TRAFFIC_JAM', 20, 100)], 'OK', secondRoad),
  ], { progressMeters: legLength + 60 });
  assert.equal(result.length, 1);
  assert.equal(result[0].segmentIndex, 1);
  close(result[0].startMeters, legLength + 60);
  close(result[0].points[0].lat, 5.702 + 60 / metersPerLatitudeDegree);
  close(result[0].points.at(-1)!.lat, 5.702 + 120 / metersPerLatitudeDegree);
});

test('SDK current-route snapshot starts at offset zero; never reapply complete-route prefix', () => {
  const currentRoad = [{ lat: 5.701, lng: -0.1 }, road[2]];
  const result = normalizeDriverRouteTraffic([segment([stretch('TRAFFIC_JAM', 20, 40)], 'OK', currentRoad)]);
  close(result[0].points[0].lat, 5.701 + 20 / metersPerLatitudeDegree);
  assert.equal(result[0].startMeters, 20);
});

test('stretches outside bounds clamp within their own leg, never overflow into later legs', () => {
  const result = normalizeDriverRouteTraffic([
    segment([stretch('TRAFFIC_JAM', 180, 9999), stretch('SLOWER_TRAFFIC', 10000, 80)]),
    segment([], 'OK', secondRoad),
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].points.at(-1), road.at(-1));
  close(result[0].endMeters, metersPerLatitudeDegree * 0.002);
});

test('malformed offsets and lengths do not produce congestion overlays', () => {
  for (const bad of [null, undefined, -1, NaN, Infinity, '80', true, Number.MAX_VALUE]) {
    assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch('TRAFFIC_JAM', bad, 20)])]), []);
    assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch('TRAFFIC_JAM', 20, bad)])]), []);
  }
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch('TRAFFIC_JAM', 20, 0), null, {}, []])]), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()])], { progressMeters: -1 }), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()])], { progressMeters: NaN }), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()])], { progressMeters: undefined }), []);
  // Deliberately exercise malformed runtime inputs outside the declared TS shape.
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()])], { progressMeters: null } as never), []);
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()])], null as never), []);
});

test('invalid or degenerate geometry fails closed, not an invented connector or shifted following leg', () => {
  const invalidPaths = [[], [road[0]], [road[0], road[0]], [road[0], null, road[2]],
    [road[0], { lat: NaN, lng: -0.1 }], [road[0], { lat: '5.7', lng: -0.1 }],
    [road[0], { lat: 91, lng: 0 }], [road[0], { lat: 0, lng: 0 }]];
  for (const points of invalidPaths) {
    assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()], 'OK', points), segment([stretch()], 'OK', secondRoad)]), []);
  }
});

test('valid geometry without traffic still contributes length for later legs', () => {
  const result = normalizeDriverRouteTraffic([
    { segmentLatLngList: road }, segment([stretch()], 'OK', secondRoad),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].segmentIndex, 1);
  close(result[0].startMeters, metersPerLatitudeDegree * 0.002 + 20);
});

test('duplicate vertices do not break slicing and alternate coordinate names are safe', () => {
  const points = [road[0], road[0], ...road.slice(1)].map(p => ({ latitude: p.lat, longitude: p.lng }));
  assert.deepEqual(normalizeDriverRouteTraffic([segment([stretch()], 'OK', points)]), normalizeDriverRouteTraffic([segment([stretch()])]));
});

test('antimeridian traffic remains on short provider edge instead of crossing the globe', () => {
  const result = normalizeDriverRouteTraffic([segment([stretch('TRAFFIC_JAM', 100, 300)], 'OK', [
    { lat: 1, lng: 179.999 }, { lat: 1, lng: -179.995 },
  ])])[0];
  assert.equal(result.points.length, 2);
  for (const p of result.points) assert.ok(Math.abs(p.lng) > 179.99);
});

test('normalization is pure and leaves provider snapshots unmodified', () => {
  const input = [segment([stretch('TRAFFIC_JAM', 80, 100)])];
  const before = JSON.stringify(input);
  normalizeDriverRouteTraffic(input, { progressMeters: 90 });
  assert.equal(JSON.stringify(input), before);
});
