import assert from 'node:assert/strict';
import test from 'node:test';
import { remainingDriverRoute, projectDriverOnRoute, assessDriverWrongWay, EMPTY_DRIVER_WRONG_WAY_MONITOR, driverRouteReachesTarget } from '../lib/driver-route-progress';

const road = [{ lat: 5.7, lng: -0.1 }, { lat: 5.704, lng: -0.1 }, { lat: 5.704, lng: -0.096 }];
test('remaining geometry begins at the Driver on the road and retains the destination', () => {
  const points = remainingDriverRoute({ latitude: 5.702, longitude: -0.1 }, road);
  assert.deepEqual(points[0], { lat: 5.702, lng: -0.1 });
  assert.deepEqual(points.at(-1), road.at(-1));
  assert.equal(points.length, 3);
});
test('small GPS drift projects onto Google geometry without adding a straight connector', () => {
  const points = remainingDriverRoute({ latitude: 5.702, longitude: -0.1001, accuracyMeters: 5 }, road);
  assert.equal(points[0].lng, -0.1);
  assert.equal(points[0].lat, 5.702);
});
test('a disconnected or invalid route is hidden rather than fabricated', () => {
  assert.deepEqual(remainingDriverRoute({ latitude: 5.702, longitude: -0.102 }, road), []);
  assert.deepEqual(remainingDriverRoute(null, road), []);
  assert.equal(projectDriverOnRoute({ latitude: NaN, longitude: -0.1 }, road), null);
  assert.equal(projectDriverOnRoute({ latitude: 5.702, longitude: -0.1 }, [{ lat: NaN, lng: 0 }, road[1]]), null);
});
test('two significant backwards observations trigger once and duplicate GPS cannot trigger twice', () => {
  let state = EMPTY_DRIVER_WRONG_WAY_MONITOR;
  for (const [index, lat] of [5.703, 5.7026, 5.7022].entries()) {
    const result = assessDriverWrongWay(state, { latitude: lat, longitude: -0.1 }, road, `${index}`, 100_000 + index);
    assert.equal(result.shouldReroute, index === 2);
    state = result.next;
  }
  assert.equal(assessDriverWrongWay(state, { latitude: 5.7022, longitude: -0.1 }, road, '2', 120_000).shouldReroute, false);
});
test('normal forward movement and stationary GPS drift do not cause wrong-way reroutes', () => {
  let state = EMPTY_DRIVER_WRONG_WAY_MONITOR;
  for (const [index, lat] of [5.701, 5.70101, 5.701, 5.702, 5.703].entries()) {
    const result = assessDriverWrongWay(state, { latitude: lat, longitude: -0.1 }, road, `${index}`, 100_000 + index);
    assert.equal(result.shouldReroute, false);
    state = result.next;
  }
});
test('replacement geometry must terminate near the unchanged Driver target', () => {
  assert.equal(driverRouteReachesTarget(road, road[2]), true);
  assert.equal(driverRouteReachesTarget(road, { lat: 5.73, lng: -0.11 }), false);
});
