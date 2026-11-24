import assert from 'node:assert/strict';
import test from 'node:test';
import { driverNavigationCamera, driverNavigationMapPadding } from '../lib/driver-navigation-camera';
import { distanceBetweenPositionsMetres } from '../lib/driver-map-motion';

const position = { latitude: 5.7, longitude: -0.1, heading: 0 };

// These are pure policy tests, not evidence of native camera/GPS behavior on a phone.
test('following camera looks ahead along the road at a stable navigation zoom', () => {
  const north = driverNavigationCamera(position, null, 1_000)!;
  assert.ok(north.camera.target.lat > position.latitude);
  assert.ok(Math.abs(north.camera.target.lng - position.longitude) < 1e-9);
  const ahead = distanceBetweenPositionsMetres(position, {
    latitude: north.camera.target.lat, longitude: north.camera.target.lng, heading: 0,
  });
  assert.ok(ahead > 50 && ahead < 60, 'look-ahead places the car below the usable viewport center');
  assert.equal(north.camera.zoom, 17.2);
  assert.equal(north.camera.tilt, 45);
  const east = driverNavigationCamera({ ...position, heading: 90 }, null, 1_000)!;
  assert.ok(east.camera.target.lng > position.longitude);
  assert.ok(Math.abs(east.camera.target.lat - position.latitude) < 1e-9);
  assert.equal(east.camera.zoom, north.camera.zoom, 'heading may not pump the zoom');
});

test('opt-in driving camera zooms closer while keeping the car behind its forward road target', () => {
  const options = { closeDrivingView: true, usableViewportHeight: 400 };
  for (const heading of [0, 90, 180, 270, 359]) {
    const point = { ...position, heading };
    const sample = driverNavigationCamera(point, null, 1_000, false, options)!;
    assert.equal(sample.camera.zoom, 18);
    assert.equal(sample.camera.tilt, 45);
    assert.equal(sample.camera.bearing, heading);
    const ahead = distanceBetweenPositionsMetres(point, { latitude: sample.camera.target.lat, longitude: sample.camera.target.lng, heading });
    assert.ok(ahead > 0 && ahead <= 36, 'nearby road detail, not a whole-trip bounding box');
    const repeat = driverNavigationCamera({ ...point, latitude: point.latitude + 0.001 }, sample, 2_000, false, options)!;
    assert.equal(repeat.camera.zoom, 18, 'movement/heading never pump the close driving zoom');
  }
  const original = driverNavigationCamera(position, null, 1_000)!;
  assert.equal(original.camera.zoom, 17.2, 'default/Android and pickup policy is preserved');
  assert.deepEqual(driverNavigationCamera(position, null, 1_000, false, { closeDrivingView: false, usableViewportHeight: 50 }), original);
});

test('close camera bounds look-ahead by the actual usable map height and remains finite worldwide', () => {
  for (const latitude of [0, 5.7, 50, 80, 85, 90, -90]) for (const usableViewportHeight of [0, 40, 100, 160, 400]) {
    const point = { latitude, longitude: 179.99999, heading: 90 };
    const sample = driverNavigationCamera(point, null, 1_000, false, { closeDrivingView: true, usableViewportHeight })!;
    assert.ok(Number.isFinite(sample.camera.target.lat) && Number.isFinite(sample.camera.target.lng));
    assert.ok(Math.abs(sample.camera.target.lat) <= 90);
    assert.ok(sample.camera.target.lng >= -180 && sample.camera.target.lng < 180);
    assert.equal(sample.camera.zoom, 18);
    const ahead = distanceBetweenPositionsMetres(point, { latitude: sample.camera.target.lat, longitude: sample.camera.target.lng, heading: 90 });
    const mercatorLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
    const metersPerPoint = 156543.03392 * Math.cos(mercatorLatitude * Math.PI / 180) / 2 ** 18;
    assert.ok(ahead <= Math.min(35, usableViewportHeight * 0.18 * metersPerPoint) + 0.2, 'car offset fits inside the overlay-free viewport budget');
  }
  for (const height of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const sample = driverNavigationCamera(position, null, 1_000, false, { closeDrivingView: true, usableViewportHeight: height })!;
    assert.ok(Number.isFinite(sample.camera.target.lat) && Number.isFinite(sample.camera.target.lng));
    assert.equal(sample.camera.zoom, 18);
  }
});

test('close camera retains parked-bearing stabilization and jitter throttling; explicit recenter can apply new framing', () => {
  const options = { closeDrivingView: true, usableViewportHeight: 400 };
  const point = { ...position, heading: 90 };
  const first = driverNavigationCamera(point, null, 1_000, false, options)!;
  assert.equal(driverNavigationCamera({ ...point, heading: 270 }, first, 2_000, false, options), null);
  assert.equal(driverNavigationCamera({ ...point, latitude: point.latitude + 0.001 }, first, 1_099, false, options), null);
  const resized = driverNavigationCamera({ ...point, heading: 270 }, first, 2_000, true, { ...options, usableViewportHeight: 160 })!;
  assert.equal(resized.camera.bearing, 90, 'layout changes must not rotate a parked car');
  assert.equal(resized.camera.zoom, 18);
  const distance = (sample: typeof first) => distanceBetweenPositionsMetres(point, { latitude: sample.camera.target.lat, longitude: sample.camera.target.lng, heading: 90 });
  assert.ok(distance(resized) < distance(first), 'shorter visible map uses a shorter forward offset');
});

test('following camera suppresses GPS jitter and throttles rapid updates', () => {
  const first = driverNavigationCamera(position, null, 1_000)!;
  assert.equal(driverNavigationCamera({ ...position, latitude: position.latitude + 0.000001 }, first, 2_000), null);
  assert.equal(driverNavigationCamera({ ...position, latitude: position.latitude + 0.001 }, first, 1_099), null);
  assert.ok(driverNavigationCamera({ ...position, latitude: position.latitude + 0.001 }, first, 1_100));
  assert.ok(driverNavigationCamera(position, first, 1_001, true), 'explicit recenter bypasses jitter/rate suppression');
});

test('stationary compass changes never rotate the following camera', () => {
  const first = driverNavigationCamera({ ...position, heading: 90 }, null, 1_000)!;
  assert.equal(driverNavigationCamera({ ...position, heading: 270 }, first, 2_000), null);
  const forced = driverNavigationCamera({ ...position, heading: 270 }, first, 2_000, true)!;
  assert.equal(forced.camera.bearing, 90);
  assert.equal(forced.position.heading, 90);
  const smallMovement = driverNavigationCamera({ ...position, latitude: position.latitude + 0.000009, heading: 270 }, first, 2_000)!;
  assert.equal(smallMovement.camera.bearing, 90, 'sub-1.5 m drift preserves the previous road heading');
  const moving = driverNavigationCamera({ ...position, latitude: position.latitude + 0.001, heading: 270 }, first, 2_000)!;
  assert.equal(moving.camera.bearing, 270, 'real movement can update the heading');
});

test('headings wrap cleanly and unavailable or negative headings preserve the last bearing', () => {
  const first = driverNavigationCamera({ ...position, heading: 725 }, null, 1_000)!;
  assert.equal(first.camera.bearing, 5);
  for (const heading of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const next = driverNavigationCamera({ ...position, latitude: position.latitude + 0.001, heading }, first, 2_000)!;
    assert.equal(next.camera.bearing, 5);
  }
  assert.equal(driverNavigationCamera({ ...position, heading: Number.NaN }, null, 1_000)!.camera.bearing, 0);
  const nearNorth = driverNavigationCamera({ ...position, heading: 359 }, null, 1_000)!;
  assert.equal(driverNavigationCamera({ ...position, latitude: position.latitude + 0.001, heading: 1 }, nearNorth, 2_000)!.camera.bearing, 1);
});

test('invalid GPS or time never produces a camera command', () => {
  for (const invalid of [
    { latitude: Number.NaN }, { longitude: Number.POSITIVE_INFINITY },
    { latitude: 90.01 }, { latitude: -90.01 }, { longitude: 180.01 }, { longitude: -180.01 },
  ]) assert.equal(driverNavigationCamera({ ...position, ...invalid }, null, 1_000), null);
  assert.equal(driverNavigationCamera(position, null, Number.NaN), null);
  assert.equal(driverNavigationCamera(position, null, Number.POSITIVE_INFINITY), null);
});

test('look-ahead remains bounded at poles and wraps the international date line', () => {
  for (const point of [
    { latitude: 90, longitude: 180, heading: 0 },
    { latitude: -90, longitude: -180, heading: 180 },
    { latitude: 5.7, longitude: 179.99999, heading: 90 },
    { latitude: 5.7, longitude: -179.99999, heading: 270 },
  ]) {
    const sample = driverNavigationCamera(point, null, 1_000)!;
    assert.ok(Number.isFinite(sample.camera.target.lat));
    assert.ok(Number.isFinite(sample.camera.target.lng));
    assert.ok(Math.abs(sample.camera.target.lat) <= 90);
    assert.ok(sample.camera.target.lng >= -180 && sample.camera.target.lng < 180);
  }
  assert.ok(driverNavigationCamera({ latitude: 5.7, longitude: 179.99999, heading: 90 }, null, 1_000)!.camera.target.lng < 0);
});

test('map padding respects overlay insets and Android pixel density without consuming the usable map', () => {
  assert.deepEqual(driverNavigationMapPadding(20, 30, 800), { top: 20, bottom: 30, left: 12, right: 12 });
  assert.deepEqual(driverNavigationMapPadding(20, 30, 800, 3), { top: 20 * 3, bottom: 30 * 3, left: 12 * 3, right: 12 * 3 });
  const compressed = driverNavigationMapPadding(600, 300, 800, 3);
  assert.ok(compressed.top + compressed.bottom <= (800 - 160) * 3 + 1);
  assert.ok(Math.abs(compressed.top - compressed.bottom * 2) <= 1, 'oversized cards are reduced proportionally');
  assert.deepEqual(driverNavigationMapPadding(200, 200, 100), { top: 0, bottom: 0, left: 12, right: 12 });
});

test('padding sanitizes unavailable layout values and invalid density', () => {
  assert.deepEqual(driverNavigationMapPadding(-20, Number.NaN, Number.NaN, 0), { top: 0, bottom: 0, left: 12, right: 12 });
  for (const scale of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(driverNavigationMapPadding(20, 30, 0, scale), driverNavigationMapPadding(20, 30, 800));
  }
  assert.deepEqual(driverNavigationMapPadding(Number.POSITIVE_INFINITY, 30, -1), { top: 0, bottom: 30, left: 12, right: 12 });
});
