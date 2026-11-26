import assert from 'node:assert/strict';
import test from 'node:test';
import { driverNavigationCamera, driverNavigationMapPadding } from '../lib/driver-navigation-camera';
import { distanceBetweenPositionsMetres, driverMapMotionFrames } from '../lib/driver-map-motion';

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

test('accepted ten-meter low-speed interval advances camera heading despite tiny animation steps', () => {
  const incoming = { ...position, longitude: position.longitude + 0.00009, heading: 0 };
  const acceptedMovementMeters = distanceBetweenPositionsMetres(position, incoming);
  assert.ok(acceptedMovementMeters > 9 && acceptedMovementMeters < 11);
  const frames = driverMapMotionFrames(position, incoming, 1_940, { alignHeadingToMovement: true });
  let aligned = driverNavigationCamera(position, null, 1_000)!;
  let legacy = aligned;
  let acceptedCount = 0;
  frames.forEach((frame, index) => {
    assert.ok(distanceBetweenPositionsMetres(index === 0 ? position : frames[index - 1], frame) < 0.6);
    const nowMs = 1_000 + (index + 1) * 50;
    const next = driverNavigationCamera(frame, aligned, nowMs, false, { acceptedMovementMeters });
    if (next) {
      aligned = next;
      acceptedCount += 1;
      assert.ok(Math.abs(aligned.camera.bearing - 90) < 0.01);
    }
    legacy = driverNavigationCamera(frame, legacy, nowMs) ?? legacy;
  });
  assert.ok(acceptedCount > 0);
  assert.ok(Math.abs(aligned.camera.bearing - 90) < 0.01);
  assert.equal(legacy.camera.bearing, 0, 'omitted interval retains default/Android parked classification');
});

test('accepted GPS interval changes only bearing classification, not frame-position jitter or rate throttle', () => {
  const first = driverNavigationCamera(position, null, 1_000)!;
  const tinyEastStep = { ...position, longitude: position.longitude + 0.000001, heading: 90 };
  const options = { acceptedMovementMeters: 10 };
  assert.equal(driverNavigationCamera(tinyEastStep, first, 1_099, false, options), null, '100 ms throttle is unchanged');
  const turned = driverNavigationCamera(tinyEastStep, first, 1_100, false, options)!;
  assert.equal(turned.camera.bearing, 90, 'meaningful accepted movement allows a turn despite a tiny frame');
  assert.equal(driverNavigationCamera({ ...tinyEastStep, longitude: tinyEastStep.longitude + 0.000001 }, turned, 2_000, false, options), null,
    'same-bearing sub-0.6 m frame jitter is still suppressed');
});

test('accepted zero movement and forced recenter retain parked heading with the prior camera sample', () => {
  const first = driverNavigationCamera({ ...position, heading: 90 }, null, 1_000)!;
  const stationary = { ...position, heading: 0 };
  assert.equal(driverNavigationCamera(stationary, first, 2_000, false, { acceptedMovementMeters: 0 }), null);
  const recentered = driverNavigationCamera(stationary, first, 1_001, true, {
    acceptedMovementMeters: 0, closeDrivingView: true, usableViewportHeight: 160,
  })!;
  assert.equal(recentered.camera.bearing, 90);
  assert.equal(recentered.position.heading, 90);
  assert.equal(recentered.camera.zoom, 18, 'forced recenter still applies the requested framing');
  const changedPosition = driverNavigationCamera({ ...stationary, latitude: position.latitude + 0.00003 }, first, 2_000, false, { acceptedMovementMeters: 0 })!;
  assert.equal(changedPosition.camera.bearing, 90, 'zero accepted movement controls parked bearing even if the rendered camera target is over 1.5 m away');
});

test('accepted sub-1.5 m interval stabilizes bearing while real movement updates heading', () => {
  const first = driverNavigationCamera({ ...position, heading: 90 }, null, 1_000)!;
  const point = { ...position, latitude: position.latitude + 0.001, heading: 270 };
  assert.equal(driverNavigationCamera(point, first, 2_000, false, { acceptedMovementMeters: 1 })!.camera.bearing, 90);
  assert.equal(driverNavigationCamera(point, first, 2_000, false, { acceptedMovementMeters: 1.5 })!.camera.bearing, 270);
});

test('omitted or malformed accepted movement retains legacy camera behavior', () => {
  const first = driverNavigationCamera({ ...position, heading: 90 }, null, 1_000)!;
  const moving = { ...position, latitude: position.latitude + 0.001, heading: 270 };
  const jitter = { ...position, latitude: position.latitude + 0.000009, heading: 270 };
  for (const acceptedMovementMeters of [undefined, -1, Number.NaN, Infinity]) {
    assert.deepEqual(driverNavigationCamera(moving, first, 2_000, false, { acceptedMovementMeters }), driverNavigationCamera(moving, first, 2_000));
    assert.deepEqual(driverNavigationCamera(jitter, first, 2_000, false, { acceptedMovementMeters }), driverNavigationCamera(jitter, first, 2_000));
  }
});

test('reference route-forward view is flat, heading-up, and shows most of the usable map ahead of the car', () => {
  const height = 400;
  for (const heading of [0, 90, 180, 270, 359]) {
    const point = { ...position, heading };
    const sample = driverNavigationCamera(point, null, 1_000, false, { routeForwardView: true, usableViewportHeight: height })!;
    assert.equal(sample.camera.zoom, 17.6);
    assert.equal(sample.camera.tilt, 0);
    assert.equal(sample.camera.bearing, heading, 'actual travel direction stays up the screen');
    const metres = distanceBetweenPositionsMetres(point, { latitude: sample.camera.target.lat, longitude: sample.camera.target.lng, heading });
    const metresPerPoint = 156543.03392 * Math.cos(point.latitude * Math.PI / 180) / 2 ** sample.camera.zoom;
    const offsetPoints = metres / metresPerPoint;
    assert.ok(offsetPoints > 120 && offsetPoints < 135, 'lower anchor reserves substantially more space ahead than behind');
    assert.ok(height / 2 + offsetPoints < height - 44 + 1, 'realistic car stays above the dock with clearance');
    const moved = driverNavigationCamera({ ...point, latitude: point.latitude + 0.001 }, sample, 2_000, false,
      { routeForwardView: true, usableViewportHeight: height })!;
    assert.equal(moved.camera.zoom, 17.6, 'GPS speed/movement never pumps the reference zoom');
  }
});

test('reference route-forward anchor adapts to short padded viewports without putting the car below controls', () => {
  for (const height of [0, 40, 88, 100, 160, 400, 620]) {
    const sample = driverNavigationCamera(position, null, 1_000, false, { routeForwardView: true, usableViewportHeight: height })!;
    const metres = distanceBetweenPositionsMetres(position, { latitude: sample.camera.target.lat, longitude: sample.camera.target.lng, heading: 0 });
    const metresPerPoint = 156543.03392 * Math.cos(position.latitude * Math.PI / 180) / 2 ** sample.camera.zoom;
    const expectedPoints = Math.min(height * 0.32, Math.max(0, height / 2 - 44));
    assert.ok(Math.abs(metres / metresPerPoint - expectedPoints) < 1);
    if (height >= 88) assert.ok(height / 2 + metres / metresPerPoint <= height - 44 + 1);
    assert.equal(sample.camera.tilt, 0);
  }
  for (const height of [undefined, -1, Number.NaN, Infinity]) {
    assert.ok(driverNavigationCamera(position, null, 1_000, false, { routeForwardView: true, usableViewportHeight: height }));
  }
});

test('reference framing keeps parked bearing and forced recenter while leaving Android/default policies unchanged', () => {
  const point = { ...position, heading: 90 };
  const first = driverNavigationCamera(point, null, 1_000, false, { routeForwardView: true, usableViewportHeight: 400 })!;
  const resized = driverNavigationCamera({ ...point, heading: 0 }, first, 2_000, true,
    { routeForwardView: true, acceptedMovementMeters: 0, usableViewportHeight: 160 })!;
  assert.equal(resized.camera.bearing, 90);
  assert.equal(resized.camera.zoom, 17.6);
  assert.equal(resized.camera.tilt, 0);
  assert.ok(resized.camera.target.lng < first.camera.target.lng, 'shorter map safely reduces look-ahead');
  assert.deepEqual(driverNavigationCamera(position, null, 1_000, false, { routeForwardView: false }),
    driverNavigationCamera(position, null, 1_000));
  const oldClose = driverNavigationCamera(position, null, 1_000, false, { closeDrivingView: true })!;
  assert.equal(oldClose.camera.zoom, 18);
  assert.equal(oldClose.camera.tilt, 45);
});

test('reference framing uses physical overlay bounds when native padding has been compressed', () => {
  for (const layout of [
    { height: 500, top: 200, bottom: 260 },
    { height: 550, top: 160, bottom: 240 },
  ]) {
    const padding = driverNavigationMapPadding(layout.top, layout.bottom, layout.height);
    const usable = layout.height - padding.top - padding.bottom;
    const sample = driverNavigationCamera(position, null, 1_000, false, {
      routeForwardView: true,
      usableViewportHeight: usable,
      visibleTopOverlapPoints: Math.max(0, layout.top - padding.top),
      visibleBottomOverlapPoints: Math.max(0, layout.bottom - padding.bottom),
    })!;
    const metresPerPoint = 156543.03392 * Math.cos(position.latitude * Math.PI / 180) / 2 ** sample.camera.zoom;
    const signedOffset = (sample.camera.target.lat - position.latitude) * 111_320 / metresPerPoint;
    const carY = padding.top + usable / 2 + signedOffset;
    assert.ok(carY >= layout.top && carY <= layout.height - layout.bottom,
      'car center remains in the actual visible map, not inside the physical dock');
    if (layout.height - layout.top - layout.bottom >= 88) {
      assert.ok(layout.height - layout.bottom - carY >= 44 - 1e-6, 'full clearance is maintained when the actual region has room');
    }
  }
});

const stableFollowOptions = { routeForwardView: true, stabilizeFollowing: true, acceptedMovementMeters: 22, usableViewportHeight: 400 };
const angleDifference = (from: number, to: number) => ((to - from + 540) % 360) - 180;

test('stable iPhone follow consumes the same small 50 ms steps as the vehicle without camera batching', () => {
  const frames = driverMapMotionFrames(position, { ...position, latitude: position.latitude + 0.0002 }, 1_940, { alignHeadingToMovement: true });
  let sample = driverNavigationCamera(position, null, 1_000, false, stableFollowOptions)!;
  const targets = [sample.camera.target];
  for (const [index, frame] of frames.entries()) {
    const next = driverNavigationCamera(frame, sample, 1_000 + (index + 1) * 50, false, stableFollowOptions);
    assert.ok(next, 'each rendered travel frame must advance the camera, not wait for 0.6 metres or 100 ms');
    assert.equal(next.camera.zoom, 17.6);
    assert.equal(next.camera.tilt, 0);
    assert.equal(next.position.latitude, frame.latitude);
    sample = next;
    targets.push(next.camera.target);
  }
  for (let index = 1; index < targets.length; index += 1) {
    const distance = distanceBetweenPositionsMetres(
      { latitude: targets[index - 1].lat, longitude: targets[index - 1].lng, heading: 0 },
      { latitude: targets[index].lat, longitude: targets[index].lng, heading: 0 },
    );
    assert.ok(distance < 0.6, 'camera must not batch smooth marker frames into visible metre-sized jumps');
  }
});

test('stable iPhone camera bounds a genuine turn and converges without resetting zoom or coordinates', () => {
  let sample = driverNavigationCamera(position, null, 1_000, false, stableFollowOptions)!;
  for (let index = 1; index <= 40; index += 1) {
    const nextPosition = { ...position, latitude: position.latitude + index * 0.000004, heading: 90 };
    const next = driverNavigationCamera(nextPosition, sample, 1_000 + index * 50, false, stableFollowOptions)!;
    assert.ok(next);
    assert.ok(angleDifference(sample.camera.bearing, next.camera.bearing) >= 0);
    assert.ok(angleDifference(sample.camera.bearing, next.camera.bearing) <= 6 + 1e-9, '120 degrees/second maximum at the existing vehicle cadence');
    assert.equal(next.position.latitude, nextPosition.latitude, 'bearing filtering may not alter accepted position');
    assert.equal(next.camera.zoom, 17.6);
    sample = next;
  }
  assert.ok(Math.abs(sample.camera.bearing - 90) < 0.1, 'actual road turns are not frozen or flattened');
});

test('stable iPhone camera turns 359 to 1 by the shortest arc and does not jump after a long GPS gap', () => {
  const first = driverNavigationCamera({ ...position, heading: 359 }, null, 1_000, false, stableFollowOptions)!;
  const wrap = driverNavigationCamera({ ...position, latitude: position.latitude + 0.000004, heading: 1 }, first, 1_050, false, stableFollowOptions)!;
  assert.ok(angleDifference(359, wrap.camera.bearing) > 0 && angleDifference(359, wrap.camera.bearing) < 2);
  const gap = driverNavigationCamera({ ...position, latitude: position.latitude + 0.001, heading: 90 }, first, 61_000, false, stableFollowOptions)!;
  assert.ok(Math.abs(angleDifference(first.camera.bearing, gap.camera.bearing)) <= 12 + 1e-9, 'stale elapsed time cannot authorize one giant bearing jump');
});

test('stable iPhone follow still suppresses parked drift and enforces a bounded bridge cadence', () => {
  const first = driverNavigationCamera({ ...position, heading: 90 }, null, 1_000, false, stableFollowOptions)!;
  const parked = { ...stableFollowOptions, acceptedMovementMeters: 0 };
  assert.equal(driverNavigationCamera({ ...position, heading: 270 }, first, 2_000, false, parked), null);
  assert.equal(driverNavigationCamera({ ...position, latitude: position.latitude + 0.000001, heading: 270 }, first, 2_000, false, parked), null);
  assert.equal(driverNavigationCamera({ ...position, latitude: position.latitude + 0.0001 }, first, 1_039, false, stableFollowOptions), null);
  const forced = driverNavigationCamera({ ...position, heading: 270 }, first, 1_001, true, parked)!;
  assert.equal(forced.camera.bearing, 90);
});

test('stable iPhone camera can finish a bounded heading correction at a fixed accepted endpoint', () => {
  let sample = driverNavigationCamera(position, null, 1_000, false, stableFollowOptions)!;
  const endpoint = { ...position, latitude: position.latitude + 0.0002, heading: 90 };
  for (let index = 1; index <= 40; index += 1) {
    const next = driverNavigationCamera(endpoint, sample, 1_000 + index * 50, false, stableFollowOptions);
    if (next) sample = next;
    assert.equal(sample.position.latitude, endpoint.latitude);
  }
  assert.ok(Math.abs(sample.camera.bearing - endpoint.heading) < 0.1);
});

test('omitting stable follow preserves every legacy camera policy', () => {
  const first = driverNavigationCamera(position, null, 1_000)!;
  for (const stableFlag of [undefined, false]) {
    for (const now of [1_050, 1_100, 2_000]) {
      const point = { ...position, latitude: position.latitude + 0.000001, heading: 90 };
      assert.deepEqual(driverNavigationCamera(point, first, now, false, { stabilizeFollowing: stableFlag }), driverNavigationCamera(point, first, now));
    }
  }
});

test('stable iPhone motion and camera together eliminate repeated short-connector look-ahead swings', () => {
  const routePoints = [{ lat: 5.7, lng: -0.1 }, { lat: 5.702, lng: -0.1 }];
  let endpoint = { latitude: 5.7, longitude: -0.09995, heading: 0 };
  let stable = driverNavigationCamera(endpoint, null, 1_000, false, stableFollowOptions)!;
  let legacy = driverNavigationCamera(endpoint, null, 1_000, false, { ...stableFollowOptions, stabilizeFollowing: false })!;
  let now = 1_000;
  let largestStableJump = 0;
  let largestLegacyJump = 0;
  const targetDistance = (from: typeof stable, to: typeof stable) => distanceBetweenPositionsMetres(
    { latitude: from.camera.target.lat, longitude: from.camera.target.lng, heading: 0 },
    { latitude: to.camera.target.lat, longitude: to.camera.target.lng, heading: 0 },
  );
  for (let interval = 1; interval <= 3; interval += 1) {
    const incoming = { ...endpoint, latitude: 5.7 + interval * 0.0002 };
    const oldFrames = driverMapMotionFrames(endpoint, incoming, 1_940, { alignHeadingToMovement: true, routePoints });
    const frames = driverMapMotionFrames(endpoint, incoming, 1_940, {
      alignHeadingToMovement: true, stabilizeHeadingCorrections: true, routePoints,
    });
    assert.deepEqual(frames.map(({ latitude, longitude }) => ({ latitude, longitude })),
      oldFrames.map(({ latitude, longitude }) => ({ latitude, longitude })), 'car coordinates/cadence remain identical');
    frames.forEach((frame, index) => {
      now += 50;
      const next = driverNavigationCamera(frame, stable, now, false, stableFollowOptions)!;
      assert.ok(next);
      largestStableJump = Math.max(largestStableJump, targetDistance(stable, next));
      assert.ok(Math.abs(angleDifference(0, next.camera.bearing)) < 0.01, 'parallel endpoint offsets are not road turns');
      stable = next;
      const old = driverNavigationCamera(oldFrames[index], legacy, now, false, { ...stableFollowOptions, stabilizeFollowing: false });
      if (old) {
        largestLegacyJump = Math.max(largestLegacyJump, targetDistance(legacy, old));
        legacy = old;
      }
    });
    endpoint = incoming;
  }
  assert.ok(largestStableJump < 2, `stable target increments were ${largestStableJump}m`);
  assert.ok(largestLegacyJump > 50, 'fixture reproduces the previous look-ahead swing rather than merely testing a straight zero-offset path');
});
