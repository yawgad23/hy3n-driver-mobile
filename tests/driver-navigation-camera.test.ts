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
