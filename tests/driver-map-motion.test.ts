import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS,
  driverMapMotionFrames,
  driverMapMotionDurationMs,
  normalisedHeading,
  routePointsForMap,
  bearingBetweenPositions,
  distanceBetweenPositionsMetres,
  validatedDriverCourse,
  type DriverMapPosition,
} from '../lib/driver-map-motion';

test('interpolates a nearby Driver GPS update into a smooth, heading-aware car movement', () => {
  const frames = driverMapMotionFrames(
    { latitude: 5.6037, longitude: -0.187, heading: 350 },
    { latitude: 5.6041, longitude: -0.1865, heading: 10 },
  );
  assert.equal(frames.length, 27);
  assert.ok(frames[0].latitude > 5.6037);
  assert.ok(frames[0].latitude < 5.6041);
  assert.equal(frames.at(-1)?.latitude, 5.6041);
  assert.equal(frames.at(-1)?.longitude, -0.1865);
  assert.equal(frames.at(-1)?.heading, 10);
  assert.ok(frames[0].heading > 350 || frames[0].heading < 20);
});


test('matches marker animation duration to the observed GPS cadence like the Rider map', () => {
  assert.equal(driverMapMotionDurationMs(null, 1_000), 1_800);
  assert.equal(driverMapMotionDurationMs(1_000, 3_000), 1_940);
  assert.equal(driverMapMotionDurationMs(1_000, 1_500), 485);
  assert.equal(driverMapMotionDurationMs(2_000, 2_000), 1_800);
  assert.equal(driverMapMotionDurationMs(1_000, 30_000), 9_000);
});

test('uses a cadence-matched number of interpolation frames', () => {
  const previous = { latitude: 5.6037, longitude: -0.187, heading: 90 };
  const incoming = { latitude: 5.6041, longitude: -0.1865, heading: 90 };
  assert.equal(driverMapMotionFrames(previous, incoming, 880).length, 18);
  assert.equal(driverMapMotionFrames(previous, incoming, 1_800).length, 36);
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
  assert.equal(frames.length, 27);
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

const movementOptions = { alignHeadingToMovement: true };
const eastStart = { latitude: 5.6037, longitude: -0.187, heading: 90 };
const eastEnd = { latitude: eastStart.latitude, longitude: -0.1866, heading: 0 };

function assertMovementFacing(previous: DriverMapPosition, frames: DriverMapPosition[]) {
  let rendered = previous;
  for (const frame of frames) {
    assert.ok(distanceBetweenPositionsMetres(rendered, frame) > 0);
    const bearing = bearingBetweenPositions(rendered, frame);
    assert.ok(Math.abs(((frame.heading - bearing + 540) % 360) - 180) < 0.001, 'every frame faces its rendered travel segment');
    rendered = frame;
  }
}

test('validates native/Expo course before normalization, including north and absent/negative sentinels', () => {
  assert.equal(validatedDriverCourse(0), 0);
  assert.equal(validatedDriverCourse(725), 5);
  assert.equal(validatedDriverCourse(360), 0);
  for (const value of [null, undefined, -1, -360, Number.NaN, Infinity, -Infinity, '', '90', false, {}]) {
    assert.equal(validatedDriverCourse(value), null);
  }
  assert.equal(normalisedHeading(null), 0, 'legacy normalization is unchanged');
  assert.equal(normalisedHeading(-1), 359, 'only the opt-in course validator rejects sentinels');
});

test('opt-in eastward travel faces east in every frame even with stale valid course 0', () => {
  const start = { ...eastStart, heading: 0 };
  const frames = driverMapMotionFrames(start, eastEnd, 1_940, movementOptions);
  assert.equal(frames.length, 39);
  assertMovementFacing(start, frames);
  for (const frame of frames) assert.ok(Math.abs(frame.heading - 90) < 0.01);
  assert.equal(frames.at(-1)?.latitude, eastEnd.latitude);
  assert.equal(frames.at(-1)?.longitude, eastEnd.longitude);
});

test('opt-in unavailable, negative, and contradictory course all defer to meaningful direct movement', () => {
  for (const course of [null, undefined, -1, Number.NaN, 0, 270]) {
    const incoming = { ...eastEnd, heading: course as unknown as number };
    const frames = driverMapMotionFrames(eastStart, incoming, 1_320, movementOptions);
    assertMovementFacing(eastStart, frames);
    for (const frame of frames) assert.ok(Math.abs(frame.heading - 90) < 0.01);
  }
});

test('opt-in stationary fixes and sub-two-meter jitter preserve the previous rendered heading', () => {
  for (const course of [null, undefined, -1, 0, 270, Number.NaN]) {
    for (const latitude of [eastStart.latitude, eastStart.latitude + 0.000009]) {
      const incoming = { ...eastStart, latitude, heading: course as unknown as number };
      assert.deepEqual(driverMapMotionFrames(eastStart, incoming, 1_940, movementOptions), [{ ...incoming, heading: 90 }]);
    }
  }
});

test('opt-in bootstrap validates unavailable course without treating a negative sentinel as a direction', () => {
  for (const course of [null, undefined, -1]) {
    assert.deepEqual(driverMapMotionFrames(null, { ...eastStart, heading: course as unknown as number }, 1_320, movementOptions), [{ ...eastStart, heading: 0 }]);
  }
  assert.equal(driverMapMotionFrames(null, { ...eastStart, heading: 0 }, 1_320, movementOptions)[0].heading, 0);
});

const roadStart = { latitude: 5.6037, longitude: -0.187, heading: 270 };
const roadBend = { lat: roadStart.latitude, lng: roadStart.longitude + 0.001 };
const roadEnd = { latitude: roadStart.latitude + 0.001, longitude: roadBend.lng, heading: 270 };
const verifiedL = [
  { lat: roadStart.latitude, lng: roadStart.longitude },
  roadBend,
  { lat: roadEnd.latitude, lng: roadEnd.longitude },
] as const;

test('opt-in verified L road retains its bend, stays on road, and faces each traveled segment', () => {
  const frames = driverMapMotionFrames(roadStart, roadEnd, 1_940, { ...movementOptions, routePoints: verifiedL });
  assert.equal(frames.length, 39);
  assertMovementFacing(roadStart, frames);
  assert.ok(frames.some((frame) => frame.latitude === roadBend.lat && frame.longitude === roadBend.lng), 'exact bend is retained');
  for (const frame of frames) {
    assert.ok(frame.latitude === roadStart.latitude || frame.longitude === roadEnd.longitude, 'does not cut the road corner');
    if (frame.latitude === roadStart.latitude) assert.ok(Math.abs(frame.heading - 90) < 0.01);
    else assert.ok(Math.abs(frame.heading) < 0.01);
  }
  assert.equal(frames.at(-1)?.latitude, roadEnd.latitude);
  assert.equal(frames.at(-1)?.longitude, roadEnd.longitude);
});

test('verified bends survive even a one-frame requested duration rather than cutting a corner', () => {
  const frames = driverMapMotionFrames(roadStart, roadEnd, 1, { ...movementOptions, routePoints: verifiedL });
  assert.equal(frames.length, 2);
  assert.equal(frames[0].latitude, roadBend.lat);
  assert.equal(frames[0].longitude, roadBend.lng);
  assertMovementFacing(roadStart, frames);
});

test('opt-in reversed, disconnected, invalid, and long-detour route spans use direct movement', () => {
  const routes = [
    [...verifiedL].reverse(),
    [verifiedL[0], { lat: roadStart.latitude, lng: roadStart.longitude + 0.01 }, verifiedL[2]],
    [verifiedL[0], { lat: Number.NaN, lng: roadBend.lng }, verifiedL[2]],
    // Every leg is connected (<250 m), but this would be an implausible detour.
    [verifiedL[0], { lat: roadStart.latitude - 0.002, lng: roadStart.longitude },
      { lat: roadStart.latitude - 0.002, lng: roadBend.lng },
      { lat: roadStart.latitude, lng: roadBend.lng }, verifiedL[2]],
  ];
  const direct = driverMapMotionFrames(roadStart, roadEnd, 1_940, movementOptions);
  for (const routePoints of routes) {
    assert.deepEqual(driverMapMotionFrames(roadStart, roadEnd, 1_940, { ...movementOptions, routePoints }), direct);
  }
});

test('opt-in route geometry must match both endpoints within twenty meters', () => {
  const offset = 0.0002; // About 22 m north of the accepted start, outside the 20 m gate.
  const direct = driverMapMotionFrames(roadStart, roadEnd, 1_940, movementOptions);
  const routes = [
    [{ lat: roadStart.latitude + offset, lng: roadStart.longitude }, verifiedL[1], verifiedL[2]],
    [verifiedL[0], verifiedL[1], { lat: roadEnd.latitude - offset, lng: roadEnd.longitude }],
  ];
  for (const routePoints of routes) {
    assert.deepEqual(driverMapMotionFrames(roadStart, roadEnd, 1_940, { ...movementOptions, routePoints }), direct);
  }
});

test('opt-in route projection keeps exact accepted endpoints with small connectors and rendered segment bearings', () => {
  for (const offset of [0.00005, 0.00000001]) {
    const start = { ...roadStart, latitude: roadStart.latitude - offset };
    const end = { ...roadEnd, longitude: roadEnd.longitude + offset };
    const frames = driverMapMotionFrames(start, end, 1_940, { ...movementOptions, routePoints: verifiedL });
    assertMovementFacing(start, frames);
    assert.ok(frames.some((frame) => frame.latitude === roadBend.lat && frame.longitude === roadBend.lng));
    assert.equal(frames.at(-1)?.latitude, end.latitude);
    assert.equal(frames.at(-1)?.longitude, end.longitude);
  }
});

test('opt-in rejects looped verified spans even when their total length is within the detour budget', () => {
  const loop = [verifiedL[0],
    { lat: roadStart.latitude, lng: roadStart.longitude + 0.0004 },
    { lat: roadStart.latitude + 0.00002, lng: roadStart.longitude + 0.0004 },
    { lat: roadStart.latitude + 0.00002, lng: roadStart.longitude + 0.00042 },
    { lat: roadStart.latitude, lng: roadStart.longitude + 0.0004 },
    verifiedL[1], verifiedL[2]];
  assert.deepEqual(driverMapMotionFrames(roadStart, roadEnd, 1_940, { ...movementOptions, routePoints: loop }),
    driverMapMotionFrames(roadStart, roadEnd, 1_940, movementOptions));
});

test('opt-in rejects collinear route backtracking without needing an exactly repeated vertex', () => {
  const routePoints = [verifiedL[0],
    { lat: roadStart.latitude, lng: roadStart.longitude + 0.0004 },
    { lat: roadStart.latitude, lng: roadStart.longitude + 0.00038 },
    verifiedL[1], verifiedL[2]];
  assert.deepEqual(driverMapMotionFrames(roadStart, roadEnd, 1_940, { ...movementOptions, routePoints }),
    driverMapMotionFrames(roadStart, roadEnd, 1_940, movementOptions));
});

test('opt-in large jump still avoids interpolation and faces its direct accepted displacement', () => {
  const incoming = { ...eastEnd, longitude: eastStart.longitude + 0.02 };
  const frames = driverMapMotionFrames(eastStart, incoming, 1_940, movementOptions);
  assert.equal(frames.length, 1);
  assertMovementFacing(eastStart, frames);
  assert.equal(frames[0].longitude, incoming.longitude);
});

test('empty verified geometry during reroute/deviation never forces an old road bend', () => {
  assert.deepEqual(driverMapMotionFrames(roadStart, roadEnd, 1_940, { ...movementOptions, routePoints: [] }),
    driverMapMotionFrames(roadStart, roadEnd, 1_940, movementOptions));
});

test('default/Android interpolation ignores supplied geometry and retains legacy finite-course and jitter behavior', () => {
  for (const alignHeadingToMovement of [undefined, false]) {
    assert.deepEqual(driverMapMotionFrames(roadStart, roadEnd, 1_940, { alignHeadingToMovement, routePoints: verifiedL }),
      driverMapMotionFrames(roadStart, roadEnd, 1_940));
  }
  const frames = driverMapMotionFrames({ ...eastStart, heading: 0 }, eastEnd, 1_940);
  assert.ok(frames.every((frame) => frame.heading === 0));
  assert.equal(driverMapMotionFrames(eastStart, { ...eastStart, heading: 270 })[0].heading, 270);
  assert.equal(driverMapMotionFrames(eastStart, { ...eastStart, heading: null as unknown as number })[0].heading, 0);
});

const stabilizedMovementOptions = { ...movementOptions, stabilizeHeadingCorrections: true };
const northRoute = [{ lat: 5.7, lng: -0.1 }, { lat: 5.702, lng: -0.1 }];
const northStart = { latitude: 5.7, longitude: -0.09995, heading: 0 };
const northEnd = { latitude: 5.7002, longitude: -0.09995, heading: 0 };

function assertHeadingNear(actual: number, expected: number) {
  assert.ok(Math.abs(((actual - expected + 540) % 360) - 180) < 0.01,
    `heading ${actual} should face ${expected}`);
}

function positionsOnly(frames: DriverMapPosition[]) {
  return frames.map(({ latitude, longitude }) => ({ latitude, longitude }));
}

test('heading correction opt-in removes straight-road connector 270/0/90 without changing any positions or cadence', () => {
  for (const duration of [1, 50, 1_940, 9_000]) {
    const legacy = driverMapMotionFrames(northStart, northEnd, duration, { ...movementOptions, routePoints: northRoute });
    const corrected = driverMapMotionFrames(northStart, northEnd, duration, { ...stabilizedMovementOptions, routePoints: northRoute });
    assertMovementFacing(northStart, legacy);
    assertHeadingNear(legacy[0].heading, 270);
    assert.ok(legacy.some((frame) => frame.heading === 0));
    assertHeadingNear(legacy.at(-1)!.heading, 90);
    assert.deepEqual(positionsOnly(corrected), positionsOnly(legacy), 'all interpolation positions and frame counts are unchanged');
    for (const frame of corrected) assertHeadingNear(frame.heading, 0);
    assert.equal(corrected.at(-1)?.latitude, northEnd.latitude);
    assert.equal(corrected.at(-1)?.longitude, northEnd.longitude);
  }
  assert.equal(driverMapMotionFrames(northStart, northEnd, 1_940,
    { ...stabilizedMovementOptions, routePoints: northRoute }).length, 39);
});

test('heading correction holds north across repeated straight fixes on either side of a verified road', () => {
  let previous = northStart;
  const fixes = [
    { latitude: 5.7002, longitude: -0.09995, heading: 270 },
    { latitude: 5.7004, longitude: -0.10004, heading: 90 },
    { latitude: 5.7006, longitude: -0.09996, heading: 180 },
    { latitude: 5.7008, longitude: -0.09995, heading: 0 },
  ];
  for (const incoming of fixes) {
    const frames = driverMapMotionFrames(previous, incoming, 1_940, { ...stabilizedMovementOptions, routePoints: northRoute });
    const legacy = driverMapMotionFrames(previous, incoming, 1_940, { ...movementOptions, routePoints: northRoute });
    assert.deepEqual(positionsOnly(frames), positionsOnly(legacy));
    for (const frame of frames) assertHeadingNear(frame.heading, 0);
    assert.equal(frames.at(-1)?.latitude, incoming.latitude);
    assert.equal(frames.at(-1)?.longitude, incoming.longitude);
    previous = frames.at(-1)!;
  }
});

test('heading correction borrows each adjoining L-road bearing instead of flattening genuine turns', () => {
  for (const offset of [0.00005, 0.00000001]) {
    const start = { ...roadStart, latitude: roadStart.latitude - offset };
    const end = { ...roadEnd, longitude: roadEnd.longitude + offset };
    for (const duration of [1, 1_940]) {
      const frames = driverMapMotionFrames(start, end, duration, { ...stabilizedMovementOptions, routePoints: verifiedL });
      const legacy = driverMapMotionFrames(start, end, duration, { ...movementOptions, routePoints: verifiedL });
      assert.deepEqual(positionsOnly(frames), positionsOnly(legacy));
      const bendIndex = frames.findIndex((frame) => frame.latitude === roadBend.lat && frame.longitude === roadBend.lng);
      assert.ok(bendIndex >= 0, 'the exact bend is still rendered');
      frames.forEach((frame, index) => assertHeadingNear(frame.heading, index <= bendIndex ? 90 : 0));
      assert.equal(frames.at(-1)?.latitude, end.latitude);
      assert.equal(frames.at(-1)?.longitude, end.longitude);
    }
  }
});

test('heading correction does not classify a short interior road leg as projection noise', () => {
  const routePoints = [
    { lat: 5.7, lng: -0.1 },
    { lat: 5.7, lng: -0.099 },
    { lat: 5.70005, lng: -0.099 },
    { lat: 5.70005, lng: -0.098 },
  ];
  const start = { latitude: 5.69995, longitude: -0.1, heading: 0 };
  const end = { latitude: 5.7001, longitude: -0.098, heading: 0 };
  const frames = driverMapMotionFrames(start, end, 1_940, { ...stabilizedMovementOptions, routePoints });
  const legacy = driverMapMotionFrames(start, end, 1_940, { ...movementOptions, routePoints });
  assert.deepEqual(positionsOnly(frames), positionsOnly(legacy));
  const interior = frames.filter((frame) => frame.longitude === -0.099 && frame.latitude > 5.7);
  assert.ok(interior.length > 0, 'short northward road leg is retained');
  for (const frame of interior) assertHeadingNear(frame.heading, 0);
  assertHeadingNear(frames[0].heading, 90);
  assertHeadingNear(frames.at(-1)!.heading, 90);
});

test('heading correction never borrows a road bearing for connectors longer than eight metres', () => {
  for (const offset of [0.00008, 0.00017]) {
    const start = { ...roadStart, latitude: roadStart.latitude - offset };
    const end = { ...roadEnd, longitude: roadEnd.longitude + offset };
    assert.ok(distanceBetweenPositionsMetres(start, { ...start, latitude: roadStart.latitude }) > 8);
    assert.ok(distanceBetweenPositionsMetres(end, { ...end, longitude: roadEnd.longitude }) > 8);
    const options = { ...movementOptions, routePoints: verifiedL };
    const legacy = driverMapMotionFrames(start, end, 1_940, options);
    assertMovementFacing(start, legacy);
    assertHeadingNear(legacy[0].heading, 0);
    assertHeadingNear(legacy.at(-1)!.heading, 90);
    assert.deepEqual(driverMapMotionFrames(start, end, 1_940, { ...options, stabilizeHeadingCorrections: true }), legacy);
  }
});

test('heading correction eligibility is independent for the two endpoint connectors', () => {
  for (const [startOffset, endOffset] of [[0.00005, 0.00008], [0.00008, 0.00005]]) {
    const start = { ...roadStart, latitude: roadStart.latitude - startOffset };
    const end = { ...roadEnd, longitude: roadEnd.longitude + endOffset };
    const frames = driverMapMotionFrames(start, end, 1_940, { ...stabilizedMovementOptions, routePoints: verifiedL });
    const legacy = driverMapMotionFrames(start, end, 1_940, { ...movementOptions, routePoints: verifiedL });
    assert.deepEqual(positionsOnly(frames), positionsOnly(legacy));
    assertHeadingNear(frames[0].heading, startOffset < 0.00008 ? 90 : 0);
    assertHeadingNear(frames.at(-1)!.heading, endOffset < 0.00008 ? 0 : 90);
  }
});

test('heading correction is not applied to an absent connector or an on-road genuine bend', () => {
  const cases = [
    [roadStart, roadEnd],
    [roadStart, { ...roadEnd, longitude: roadEnd.longitude + 0.00005 }],
    [{ ...roadStart, latitude: roadStart.latitude - 0.00005 }, roadEnd],
  ] as const;
  for (const [start, end] of cases) {
    const frames = driverMapMotionFrames(start, end, 1_940, { ...stabilizedMovementOptions, routePoints: verifiedL });
    const legacy = driverMapMotionFrames(start, end, 1_940, { ...movementOptions, routePoints: verifiedL });
    assert.deepEqual(positionsOnly(frames), positionsOnly(legacy));
    assertHeadingNear(frames[0].heading, 90);
    assertHeadingNear(frames.at(-1)!.heading, 0);
    if (start === roadStart && end === roadEnd) assert.deepEqual(frames, legacy);
  }
});

test('heading correction still rejects reversed, stale, disconnected, invalid, detouring, and looped road geometry', () => {
  const routes = [
    [],
    [...verifiedL].reverse(),
    verifiedL.map(({ lat, lng }) => ({ lat: lat + 0.01, lng })),
    [verifiedL[0], { lat: roadStart.latitude, lng: roadStart.longitude + 0.01 }, verifiedL[2]],
    [verifiedL[0], { lat: Number.NaN, lng: roadBend.lng }, verifiedL[2]],
    [verifiedL[0], { lat: roadStart.latitude - 0.002, lng: roadStart.longitude },
      { lat: roadStart.latitude - 0.002, lng: roadBend.lng }, roadBend, verifiedL[2]],
    [verifiedL[0], { lat: roadStart.latitude, lng: roadStart.longitude + 0.0004 },
      { lat: roadStart.latitude, lng: roadStart.longitude + 0.00038 }, roadBend, verifiedL[2]],
    [verifiedL[0], { lat: roadStart.latitude, lng: roadStart.longitude + 0.0004 },
      { lat: roadStart.latitude + 0.00002, lng: roadStart.longitude + 0.0004 },
      { lat: roadStart.latitude + 0.00002, lng: roadStart.longitude + 0.00042 },
      { lat: roadStart.latitude, lng: roadStart.longitude + 0.0004 }, roadBend, verifiedL[2]],
  ];
  const start = { ...roadStart, latitude: roadStart.latitude - 0.00005 };
  const end = { ...roadEnd, longitude: roadEnd.longitude + 0.00005 };
  const direct = driverMapMotionFrames(start, end, 1_940, movementOptions);
  for (const routePoints of routes) {
    const frames = driverMapMotionFrames(start, end, 1_940, { ...stabilizedMovementOptions, routePoints });
    assert.deepEqual(frames, direct);
    assertMovementFacing(start, frames);
  }
});

test('heading correction leaves direct movement, real direction changes, large jumps, and stationary fixes unchanged', () => {
  for (const [start, end] of [
    [eastStart, eastEnd],
    [northStart, northEnd],
    [northEnd, northStart],
    [eastStart, { ...eastEnd, longitude: eastStart.longitude + 0.02 }],
    [eastStart, { ...eastStart, latitude: eastStart.latitude + 0.000009, heading: 270 }],
  ]) {
    assert.deepEqual(driverMapMotionFrames(start, end, 1_940, stabilizedMovementOptions),
      driverMapMotionFrames(start, end, 1_940, movementOptions));
  }
  const south = driverMapMotionFrames(northEnd, northStart, 1_940, { ...stabilizedMovementOptions, routePoints: northRoute });
  for (const frame of south) assertHeadingNear(frame.heading, 180);
});

test('heading correction requires both flags and does not change default/Android or explicitly disabled outputs', () => {
  const legacy = driverMapMotionFrames(northStart, northEnd, 1_940, { ...movementOptions, routePoints: northRoute });
  assert.deepEqual(driverMapMotionFrames(northStart, northEnd, 1_940,
    { ...movementOptions, routePoints: northRoute, stabilizeHeadingCorrections: false }), legacy);
  for (const alignHeadingToMovement of [undefined, false]) {
    const options = { alignHeadingToMovement, routePoints: northRoute };
    assert.deepEqual(driverMapMotionFrames(northStart, northEnd, 1_940, { ...options, stabilizeHeadingCorrections: true }),
      driverMapMotionFrames(northStart, northEnd, 1_940, options));
  }
});
