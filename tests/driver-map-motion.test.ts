import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS,
  driverMapMotionFrames,
  normalisedHeading,
  routePointsForMap,
} from '../lib/driver-map-motion';

test('interpolates a nearby Driver GPS update into a smooth, heading-aware car movement', () => {
  const frames = driverMapMotionFrames(
    { latitude: 5.6037, longitude: -0.187, heading: 350 },
    { latitude: 5.6041, longitude: -0.1865, heading: 10 },
  );
  assert.equal(frames.length, 12);
  assert.ok(frames[0].latitude > 5.6037);
  assert.ok(frames[0].latitude < 5.6041);
  assert.equal(frames.at(-1)?.latitude, 5.6041);
  assert.equal(frames.at(-1)?.longitude, -0.1865);
  assert.equal(frames.at(-1)?.heading, 10);
  assert.ok(frames[0].heading > 350 || frames[0].heading < 20);
});

test('does not animate a stale cross-city GPS jump', () => {
  const frames = driverMapMotionFrames(
    { latitude: 5.6037, longitude: -0.187, heading: 90 },
    { latitude: 5.7037, longitude: -0.287, heading: 180 },
  );
  assert.deepEqual(frames, [{ latitude: 5.7037, longitude: -0.287, heading: 180 }]);
});

test('derives the car heading from movement when the device reports no compass heading', () => {
  const frames = driverMapMotionFrames(
    { latitude: 5.6037, longitude: -0.187, heading: 0 },
    { latitude: 5.6037, longitude: -0.1866, heading: Number.NaN },
  );
  assert.equal(frames.length, 12);
  assert.ok(Math.abs((frames.at(-1)?.heading || 0) - 90) < 10);
});

test('normalises headings and safely rejects malformed marker coordinates', () => {
  assert.equal(normalisedHeading(-10), 350);
  assert.deepEqual(driverMapMotionFrames(null, { latitude: 99, longitude: 0, heading: 0 }), []);
});

test('keeps a bounded redraw window after native navigation reroutes', () => {
  assert.deepEqual(DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS, [0, 250, 850, 1_800]);
  assert.ok(DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS.at(-1)! < 2_000);
});

test('converts Navigation SDK geometry to one valid HY3N route line', () => {
  assert.deepEqual(routePointsForMap([
    { segmentLatLngList: [{ lat: 5.6, lng: -0.18 }, { lat: 5.61, lng: -0.17 }] },
    { segmentLatLngList: [{ lat: 5.61, lng: -0.17 }, { latitude: 5.62, longitude: -0.16 }] },
    { segmentLatLngList: [{ lat: 99, lng: 1 }] },
  ]), [
    { lat: 5.6, lng: -0.18 },
    { lat: 5.61, lng: -0.17 },
    { lat: 5.62, lng: -0.16 },
  ]);
});
