import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const requireHere = createRequire(__filename);
const start = { lat: 5.7, lng: -0.1 };
const destination = { lat: 5.706, lng: -0.1 };
const target = { latitude: destination.lat, longitude: destination.lng, label: 'Drop-off' };
type CameraWrite = { atMs: number; controllerId: number; camera: { target: { lat: number; lng: number }; bearing: number; tilt: number; zoom: number } };
type MarkerWrite = { atMs: number; controllerId: number; marker: { id: string; position: { lat: number; lng: number }; rotation: number } };

// This is a local esbuild execution of the actual component and its policies,
// with real React effects and a mocked asynchronous native bridge. It is not a
// native build or proof of on-device SDK delivery / perceived camera smoothness.
const bundledComponent = build({
  entryPoints: [path.join(__dirname, '../components/NativeDriverGoogleMap.tsx')],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  plugins: [{ name: 'camera-runtime-native-boundary', setup(builder) {
    builder.onResolve({ filter: /^(react-native|@googlemaps\/react-native-navigation-sdk|expo-keep-awake|@expo\/vector-icons\/MaterialIcons)$/ }, args => ({ path: args.path, external: true }));
  } }],
}).then(result => result.outputFiles[0].text);

async function flushMicrotasks() {
  for (let index = 0; index < 40; index++) await Promise.resolve();
}

async function mountMap(platform: 'ios' | 'android' = 'ios', initialHeading = 0) {
  let props: any = { latitude: start.lat, longitude: start.lng, heading: initialHeading,
    locationTimestamp: Date.now(), locationAccuracy: 5, target, tripStatus: 'dropoff', navigationId: 'camera-ride' };
  const cameras: CameraWrite[] = [];
  const markers: MarkerWrite[] = [];
  const lines = new Map<string, any>();
  const listeners: Record<string, ((value?: any) => void) | null> = {};
  let generation = 0;
  let nativeTarget = destination;
  let held = false;
  const releases: Array<() => void> = [];
  let activeCameraWrites = 0;
  let maxConcurrentCameraWrites = 0;
  let nextControllerId = 0;
  let deferNextController = false;
  const controllerAnnouncements: Array<() => void> = [];
  const stamp = () => ({ hy3nTargetLatitude: nativeTarget.lat, hy3nTargetLongitude: nativeTarget.lng,
    hy3nRouteGeneration: generation, hy3nCapturedAtMs: Date.now() });
  const geometry = () => ({ segmentLatLngList: [start, nativeTarget], ...stamp() });
  const createMapController = (controllerId: number) => ({
    addMarker: async (marker: any) => {
      if (marker.id === 'hy3n-driver-vehicle') markers.push({ atMs: Date.now(), controllerId, marker });
      return marker;
    },
    removeMarker: async () => {},
    moveCamera: async (camera: CameraWrite['camera']) => {
      cameras.push({ atMs: Date.now(), controllerId, camera });
      activeCameraWrites++;
      maxConcurrentCameraWrites = Math.max(maxConcurrentCameraWrites, activeCameraWrites);
      try { if (held) await new Promise<void>(resolve => releases.push(resolve)); }
      finally { activeCameraWrites--; }
    },
    addPolyline: async (line: any) => { lines.set(line.id, line); return line; },
    removePolyline: async (id: string) => { lines.delete(id); },
    getPolylines: async () => [...lines.values()],
  });
  const navigationController = {
    showTermsAndConditionsDialog: async () => true, init: async () => 'ok',
    setAudioGuidanceType: () => {}, startUpdatingLocation: () => {}, stopUpdatingLocation: () => {},
    setBackgroundLocationUpdatesEnabled: () => {}, setTurnByTurnLoggingEnabled: () => {},
    startGuidance: async () => {}, stopGuidance: async () => {}, clearDestinations: async () => {}, cleanup: async () => {},
    getCurrentTimeAndDistance: async () => stamp(),
    getRouteSegments: async () => [geometry()], getCurrentRouteSegment: async () => geometry(),
    setDestination: async (point: any) => { generation++; nativeTarget = point.position; return 'OK'; },
  };
  const sdk = {
    useNavigation: () => React.useMemo(() => ({ navigationController,
      removeAllListeners: () => { Object.keys(listeners).forEach(key => { listeners[key] = null; }); },
      setOnArrival: (callback: any) => { listeners.arrival = callback; },
      setOnRouteChanged: (callback: any) => { listeners.changed = callback; },
      setOnReroutingRequestedByOffRoute: (callback: any) => { listeners.offRoute = callback; },
      setOnLocationChanged: (callback: any) => { listeners.location = callback; },
      setOnTurnByTurn: (callback: any) => { listeners.turn = callback; },
      setOnRemainingTimeOrDistanceChanged: (callback: any) => { listeners.remaining = callback; },
      setOnTrafficUpdated: (callback: any) => { listeners.traffic = callback; },
    }), []),
    MapView: ({ onMapViewControllerCreated, ...viewProps }: any) => {
      const [{ controllerId, controller }] = React.useState(() => {
        const controllerId = ++nextControllerId;
        return { controllerId, controller: createMapController(controllerId) };
      });
      React.useEffect(() => {
        const announce = () => { onMapViewControllerCreated(controller); if (platform === 'android') viewProps.onMapReady?.(); };
        if (deferNextController) { deferNextController = false; controllerAnnouncements.push(announce); }
        else announce();
      }, [onMapViewControllerCreated, controller]);
      return React.createElement('map', { ...viewProps, controllerId });
    },
    NavigationProvider: ({ children }: any) => children,
    AudioGuidance: { VOICE_ALERTS_AND_GUIDANCE: 1, BLUETOOTH_AUDIO: 2 }, MapColorScheme: { FOLLOW_SYSTEM: 0 },
    NavigationSessionStatus: { OK: 'ok' }, RouteStatus: { OK: 'OK' },
    TaskRemovedBehavior: { CONTINUE_SERVICE: 0 }, TravelMode: { DRIVING: 0 },
  };
  const native = { View: 'view', Text: 'text', TouchableOpacity: 'button',
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    Linking: { openSettings: () => {} }, Platform: { OS: platform, select: (values: any) => values[platform] },
    PixelRatio: { get: () => 3 }, StyleSheet: { create: (values: any) => values, absoluteFillObject: {}, absoluteFill: {} } };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', '__DEV__', 'console', await bundledComponent)(
    (name: string) => name === 'react-native' ? native : name === '@googlemaps/react-native-navigation-sdk' ? sdk
      : name === 'expo-keep-awake' ? { useKeepAwake: () => {} }
      : name === '@expo/vector-icons/MaterialIcons' ? (iconProps: any) => React.createElement('icon', iconProps) : requireHere(name),
    module, module.exports, true, { ...console, info: () => {}, warn: () => {} });
  const Component = module.exports.default;
  let tree!: ReactTestRenderer;
  let disposed = false;
  await act(async () => { tree = create(React.createElement(Component, props)); await flushMicrotasks(); });
  await act(async () => { await flushMicrotasks(); });
  return {
    cameras, markers,
    clearWrites: () => { cameras.length = 0; markers.length = 0; },
    update: async (values: any) => { props = { ...props, ...values }; await act(async () => { tree.update(React.createElement(Component, props)); await flushMicrotasks(); }); },
    press: async (label: string) => { await act(async () => { tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); await flushMicrotasks(); }); },
    holdCameraBridge: () => { held = true; },
    releaseOne: async () => { await act(async () => { const release = releases.shift(); assert.ok(release, 'a native camera command must be in flight'); release(); await flushMicrotasks(); }); },
    releaseAll: async () => { held = false; await act(async () => { releases.splice(0).forEach(release => release()); await flushMicrotasks(); }); },
    activeCameraWrites: () => activeCameraWrites,
    maxConcurrentCameraWrites: () => maxConcurrentCameraWrites,
    mapVisible: () => tree.root.findAllByType('map').length === 1,
    visibleControllerId: () => tree.root.findByType('map').props.controllerId as number,
    mapPadding: () => tree.root.findByType('map').props.mapPadding as { top: number; bottom: number },
    deferNextMapController: () => { deferNextController = true; },
    publishMapController: async () => { await act(async () => {
      const announce = controllerAnnouncements.shift();
      assert.ok(announce, 'the replacement MapView has a controller-created callback waiting');
      announce(); await flushMicrotasks();
    }); },
    dispose: async () => { if (disposed) return; disposed = true; await act(async () => { tree.unmount(); await flushMicrotasks(); }); },
  };
}

type RuntimeMap = Awaited<ReturnType<typeof mountMap>>;
async function withMap(run: (map: RuntimeMap, advance: (ms: number) => Promise<void>, clock: any) => Promise<void>, platform: 'ios' | 'android' = 'ios', initialHeading = 0) {
  // Await the finite local bundle before installing fake timers: esbuild's own
  // service lifetime must not be driven by the component's controlled clock.
  await bundledComponent;
  const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000,
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let map: RuntimeMap | undefined;
  try {
    map = await mountMap(platform, initialHeading);
    const advance = async (ms: number) => { await act(async () => { await clock.tickAsync(ms); await flushMicrotasks(); }); };
    await run(map, advance, clock);
  } finally {
    if (map) { await map.dispose(); await map.releaseAll(); }
    clock.uninstall();
  }
}

const signedTurn = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const latestMarker = (map: RuntimeMap) => { const latest = map.markers.at(-1); assert.ok(latest, 'vehicle marker has an accepted frame'); return latest; };

// Independently reconstruct the flat iOS look-ahead from the mock's default
// 800-point viewport and real rendered padding. Raw target coordinates cannot
// be compared with the vehicle: changing bearing also changes this offset.
function cameraVehiclePosition(map: RuntimeMap, write: CameraWrite, vehicleLatitude: number) {
  const padding = map.mapPadding();
  const usableHeight = 800 - padding.top - padding.bottom;
  const topOverlap = Math.max(0, 24 + 170 + 12 - padding.top);
  const bottomOverlap = Math.max(0, 28 - padding.bottom);
  const visibleHeight = Math.max(0, usableHeight - topOverlap - bottomOverlap);
  const forwardPoints = topOverlap + visibleHeight / 2
    + Math.min(visibleHeight * 0.32, Math.max(0, visibleHeight / 2 - 44)) - usableHeight / 2;
  const mercatorLatitude = Math.max(-85.05112878, Math.min(85.05112878, vehicleLatitude));
  const metersPerPoint = 156543.03392 * Math.cos(mercatorLatitude * Math.PI / 180) / 2 ** write.camera.zoom;
  const lookAheadMeters = forwardPoints * metersPerPoint;
  const radians = write.camera.bearing * Math.PI / 180;
  return {
    lat: write.camera.target.lat - Math.cos(radians) * lookAheadMeters / 111_320,
    lng: write.camera.target.lng - Math.sin(radians) * lookAheadMeters
      / (111_320 * Math.max(0.05, Math.cos(vehicleLatitude * Math.PI / 180))),
  };
}

async function beginStraightMotion(map: RuntimeMap, advance: (ms: number) => Promise<void>) {
  await advance(1_000);
  map.clearWrites();
  await map.update({ latitude: start.lat + 0.00036, locationTimestamp: Date.now() });
}

// A short eastward movement starts north-facing and deliberately ends before
// bounded camera rotation can finish. Its residual heading must have a real
// end-of-motion settle timer; testing cancellation without this precondition
// would pass trivially on the old implementation that never settled at all.
async function endShortTurn(map: RuntimeMap, advance: (ms: number) => Promise<void>) {
  await advance(200);
  map.clearWrites();
  await map.update({ longitude: start.lng + 0.00012, locationTimestamp: Date.now() });
  await advance(150); // 194 ms duration / four frames: last frame at 145.5 ms.
  const marker = latestMarker(map);
  assert.equal(marker.marker.position.lng, start.lng + 0.00012, 'motion has reached the exact accepted endpoint');
  const camera = map.cameras.at(-1);
  assert.ok(camera);
  assert.ok(Math.abs(signedTurn(camera.camera.bearing, marker.marker.rotation)) > 2,
    'a bounded-rate camera must still have residual heading to settle after this short turn');
  return { markerCount: map.markers.length, cameraCount: map.cameras.length, bearing: marker.marker.rotation };
}

test('iOS straight moving camera consumes each car frame instead of leaving old ~150 ms gaps', async () => {
  await withMap(async (map, advance) => {
    await beginStraightMotion(map, advance);
    await advance(1_000);
    assert.equal(map.markers.length, 20, 'a 970 ms accepted interval retains all twenty car frames');
    const cameraTimes = new Set(map.cameras.map(write => write.atMs));
    for (const marker of map.markers) assert.ok(cameraTimes.has(marker.atMs), `moving car frame at ${marker.atMs} must be consumed by the camera`);
    const times = [...cameraTimes].sort((a, b) => a - b);
    for (let index = 1; index < times.length; index++) assert.ok(times[index] - times[index - 1] <= 50, 'the following camera cannot skip two car frames');
    assert.equal(latestMarker(map).marker.position.lat, start.lat + 0.00036);
    assert.equal(map.maxConcurrentCameraWrites(), 1);
  });
});

test('Explore stops all future camera writes while marker motion continues; recenter resumes from the live car', async () => {
  await withMap(async (map, advance) => {
    await beginStraightMotion(map, advance);
    await advance(150);
    await map.press('Explore map');
    const cameraCount = map.cameras.length;
    const markerCount = map.markers.length;
    const oldLatitude = latestMarker(map).marker.position.lat;
    await advance(250);
    assert.equal(map.cameras.length, cameraCount, 'Explore must stop camera writes from the already-running animator');
    assert.ok(map.markers.length > markerCount);
    assert.ok(latestMarker(map).marker.position.lat > oldLatitude);
    await map.press('Recenter navigation');
    assert.ok(map.cameras.length > cameraCount, 'explicit recenter issues an immediate live camera update');
    assert.ok(map.cameras.at(-1)!.camera.target.lat > latestMarker(map).marker.position.lat, 'north-facing recenter frames ahead of the current car, not the old GPS start');
    const resumedCount = map.cameras.length;
    await advance(150);
    assert.ok(map.cameras.length > resumedCount, 'following resumes for subsequent car frames');
  });
});

test('iOS camera eases a 350-to-north-east turn across zero by the short arc with bounded angular rate', async () => {
  await withMap(async (map, advance, clock) => {
    const initialCamera = map.cameras.at(-1);
    assert.ok(initialCamera);
    assert.equal(initialCamera.camera.bearing, 350);
    const idleTimerCount = clock.countTimers();
    await advance(1_000);
    map.clearWrites();
    await map.update({ latitude: start.lat + 0.00036, longitude: start.lng + 0.00006, locationTimestamp: Date.now() });
    await advance(250);
    assert.equal(clock.countTimers(), idleTimerCount + 1, 'during car motion only the car-frame timer runs; no parallel heading-settle loop');
    await advance(750);
    let previous = initialCamera;
    for (const write of map.cameras) {
      const turn = signedTurn(previous.camera.bearing, write.camera.bearing);
      assert.ok(turn >= -1e-8, 'heading must approach the north-east bearing clockwise across zero, never spin the long way');
      assert.ok(turn <= 120 * Math.min(100, write.atMs - previous.atMs) / 1_000 + 1e-8,
        'camera heading cannot spend a GPS gap or same-tick force call as an instantaneous rotation');
      previous = write;
    }
    assert.ok(map.cameras.some(write => write.camera.bearing < 20), 'the short turn crosses north into the accepted north-east heading');
    assert.ok(map.cameras.every(write => write.camera.bearing >= 340 || write.camera.bearing <= 20), 'no intermediate heading traverses south');
  }, 'ios', 350);
});

test('slow camera bridge is serial and coalesces obsolete frames to the newest pending command', async () => {
  await withMap(async (map, advance) => {
    map.holdCameraBridge();
    await beginStraightMotion(map, advance);
    await advance(300);
    assert.equal(map.cameras.length, 1, 'bridge backlog must not start parallel or per-frame commands');
    assert.ok(map.markers.length >= 6, 'marker progresses independently of a blocked camera');
    const first = map.cameras[0];
    const marker = latestMarker(map);
    await map.releaseOne();
    assert.equal(map.cameras.length, 2, 'one release must select only the latest pending command');
    const newest = map.cameras[1];
    assert.ok(Math.abs((newest.camera.target.lat - first.camera.target.lat)
      - (marker.marker.position.lat - map.markers[0].marker.position.lat)) < 1e-8,
      'straight-road camera advancement matches the newest car frame, not the oldest queued frame');
    assert.equal(map.maxConcurrentCameraWrites(), 1);
    assert.equal(map.activeCameraWrites(), 1);
    await map.releaseAll();
    assert.equal(map.cameras.length, 2, 'releasing the newest command must not replay dropped frames');
  });
});

for (const cancellation of ['explore', 'target-clear', 'unmount'] as const) {
  test(`slow camera bridge discards pending commands after ${cancellation}`, async () => {
    await withMap(async (map, advance) => {
      map.holdCameraBridge();
      await beginStraightMotion(map, advance);
      await advance(200);
      assert.equal(map.cameras.length, 1);
      if (cancellation === 'explore') await map.press('Explore map');
      else if (cancellation === 'target-clear') await map.update({ target: null });
      else await map.dispose();
      const cameraCount = map.cameras.length;
      await map.releaseAll();
      await advance(1_500);
      assert.equal(map.cameras.length, cameraCount, 'a command already in native flight cannot be recalled, but no stale pending command may be submitted');
    });
  });
}

test('slow bridge replaces old-target backlog with only the new target latest car frame', async () => {
  await withMap(async (map, advance) => {
    map.holdCameraBridge();
    await beginStraightMotion(map, advance);
    await advance(200);
    assert.equal(map.cameras.length, 1);
    const first = map.cameras[0];
    const firstMarker = map.markers[0];
    await map.update({ target: { ...target, latitude: target.latitude + 0.001, label: 'Approved stop', kind: 'stop' },
      latitude: start.lat + 0.00072, locationTimestamp: Date.now() });
    await advance(200);
    const currentMarker = latestMarker(map);
    assert.equal(currentMarker.marker.position.lat, start.lat + 0.00072);
    assert.equal(map.cameras.length, 1, 'target replacement must not bypass the serial bridge writer');
    await map.releaseOne();
    assert.equal(map.cameras.length, 2, 'only the new target newest pending command follows the old in-flight command');
    assert.ok(Math.abs((map.cameras[1].camera.target.lat - first.camera.target.lat)
      - (currentMarker.marker.position.lat - firstMarker.marker.position.lat)) < 1e-8,
      'new-target camera uses the latest car frame, not any old-target backlog position');
    await map.releaseAll();
    assert.equal(map.cameras.length, 2, 'no old-target command is replayed after the new target command');
    assert.equal(map.maxConcurrentCameraWrites(), 1);
  });
});

test('end-of-motion camera heading settles without adding or restarting car frames', async () => {
  await withMap(async (map, advance, clock) => {
    const idleTimerCount = clock.countTimers();
    const ending = await endShortTurn(map, advance);
    assert.ok(clock.countTimers() > idleTimerCount, 'residual heading owns a cancellable one-shot timer');
    await advance(2_000);
    assert.equal(map.markers.length, ending.markerCount, 'settle work rotates the camera, never fabricates marker movement');
    assert.ok(map.cameras.length > ending.cameraCount, 'residual heading must settle after the last vehicle frame');
    assert.ok(Math.abs(signedTurn(map.cameras.at(-1)!.camera.bearing, ending.bearing)) <= 2, 'settle converges to the final accepted movement bearing');
    const settledCount = map.cameras.length;
    await advance(1_000);
    assert.equal(map.cameras.length, settledCount, 'settle timer stops after convergence rather than polling forever');
    assert.equal(clock.countTimers(), idleTimerCount, 'converged settle work releases its timer');
  });
});

for (const cancellation of ['explore', 'navigation-pause', 'target-clear', 'unmount'] as const) {
  test(`residual camera heading settle work is cancelled on ${cancellation}`, async () => {
    await withMap(async (map, advance, clock) => {
      const idleTimerCount = clock.countTimers();
      const ending = await endShortTurn(map, advance);
      assert.ok(clock.countTimers() > idleTimerCount, 'a real settle timer exists before cancellation');
      if (cancellation === 'explore') await map.press('Explore map');
      else if (cancellation === 'navigation-pause') await map.update({ navigationPaused: true });
      else if (cancellation === 'target-clear') await map.update({ target: null });
      else await map.dispose();
      assert.ok(clock.countTimers() <= idleTimerCount, 'cancellation clears the one-shot timer immediately, not just its eventual write');
      const cameraCount = map.cameras.length; // lifecycle reframing, if any, already completed.
      await advance(2_500);
      assert.equal(map.cameras.length, cameraCount, 'old end-of-motion heading work may not write after cancellation');
      assert.equal(map.markers.length, ending.markerCount);
      if (cancellation === 'unmount') assert.equal(clock.countTimers(), 0, 'unmount releases logical timers, not merely their writes');
    });
  });
}

test('target replacement cancels the old residual heading timer without a late old-target camera write', async () => {
  await withMap(async (map, advance, clock) => {
    const idleTimerCount = clock.countTimers();
    const ending = await endShortTurn(map, advance);
    assert.ok(clock.countTimers() > idleTimerCount);
    await map.update({ target: { ...target, latitude: target.latitude + 0.001, label: 'Approved stop', kind: 'stop' } });
    const cameraCount = map.cameras.length;
    assert.ok(cameraCount > ending.cameraCount, 'new target may force its own immediate camera framing');
    assert.ok(clock.countTimers() <= idleTimerCount, 'target replacement clears the old settle timer immediately');
    await advance(2_500);
    assert.equal(map.cameras.length, cameraCount, 'target setup does not inherit or restart the old motion-settle timer');
    assert.equal(map.markers.length, ending.markerCount);
  });
});

test('explicit recenter settles a paused mid-turn camera to the latest car heading without new GPS or marker frames', async () => {
  await withMap(async (map, advance) => {
    await advance(200);
    map.clearWrites();
    await map.update({ longitude: start.lng + 0.00012, locationTimestamp: Date.now() });
    await advance(50);
    await map.press('Explore map');
    const pausedCamera = map.cameras.at(-1);
    assert.ok(pausedCamera);
    await advance(150);
    const beforeRecenter = map.cameras.length;
    const markerCount = map.markers.length;
    const liveBearing = latestMarker(map).marker.rotation;
    assert.equal(latestMarker(map).marker.position.lng, start.lng + 0.00012);
    assert.ok(Math.abs(signedTurn(pausedCamera.camera.bearing, liveBearing)) > 2, 'camera paused before the real turn completed');
    await map.press('Recenter navigation');
    assert.ok(map.cameras.length > beforeRecenter, 'recenter immediately returns to the live vehicle');
    await advance(2_000);
    assert.equal(map.markers.length, markerCount, 'recenter settle must not fabricate car frames');
    assert.ok(Math.abs(signedTurn(map.cameras.at(-1)!.camera.bearing, liveBearing)) <= 2,
      'explicit recenter restores residual heading even though no GPS motion is left to drive it');
  });
});

test('explicit recenter on a genuinely stationary car preserves its bearing and does not start a heading poller', async () => {
  await withMap(async (map, advance, clock) => {
    const idleTimerCount = clock.countTimers();
    const initial = map.cameras.at(-1);
    assert.ok(initial);
    await map.press('Explore map');
    await advance(200);
    await map.update({ heading: 180, locationTimestamp: Date.now() });
    const cameraCount = map.cameras.length;
    await map.press('Recenter navigation');
    assert.ok(map.cameras.length > cameraCount);
    assert.equal(map.cameras.at(-1)!.camera.bearing, initial.camera.bearing, 'parked compass drift is not accepted travel authority');
    assert.equal(clock.countTimers(), idleTimerCount, 'stationary recenter does not schedule heading settle');
    const recenteredCount = map.cameras.length;
    await advance(2_000);
    assert.equal(map.cameras.length, recenteredCount);
  });
});

test('reviewer: recenter during a real turn has one moving loop and every camera frame follows the live car', async () => {
  await withMap(async (map, advance, clock) => {
    const idleTimerCount = clock.countTimers();
    await advance(1_000);
    map.clearWrites();
    await map.update({ longitude: start.lng + 0.0006, locationTimestamp: Date.now() });
    await advance(50);
    await map.press('Explore map');
    await advance(180);
    const recenterMarker = latestMarker(map);
    assert.ok(recenterMarker.marker.position.lng < start.lng + 0.0006, 'recenter happens before the 970 ms movement ends');
    const cameraStart = map.cameras.length;
    const markerStart = map.markers.length;
    await map.press('Recenter navigation');
    const recenteredTimerCount = clock.countTimers();
    await advance(600); // Still moving: residual endpoint settling is not due yet.
    const failures: string[] = [];
    if (recenteredTimerCount !== idleTimerCount + 1) failures.push(`moving recenter has ${recenteredTimerCount - idleTimerCount} timers instead of the single car-frame timer`);
    const resumedCameras = map.cameras.slice(cameraStart);
    const resumedMarkers = map.markers.slice(markerStart);
    assert.ok(resumedMarkers.length >= 12, 'the existing car animator keeps its ~50 ms cadence');
    for (const marker of resumedMarkers) {
      if (!resumedCameras.some(write => write.atMs === marker.atMs)) failures.push(`camera skipped moving car frame ${marker.atMs}`);
    }
    for (const write of resumedCameras) {
      const marker = [...map.markers].reverse().find(frame => frame.atMs <= write.atMs);
      assert.ok(marker, 'each camera command has a latest accepted vehicle frame');
      const implied = cameraVehiclePosition(map, write, marker.marker.position.lat);
      if (Math.abs(implied.lat - marker.marker.position.lat) > 1e-8
        || Math.abs(implied.lng - marker.marker.position.lng) > 1e-8) {
        failures.push(`camera at ${write.atMs} uses vehicle (${implied.lat}, ${implied.lng}) instead of live (${marker.marker.position.lat}, ${marker.marker.position.lng})`);
      }
    }
    assert.deepEqual(failures, [], 'recenter must neither launch a captured-position settle loop nor freeze/jump against ongoing vehicle frames');
  });
});

test('reviewer: Explore immediately after the short-turn endpoint preserves actual travel authority for later recenter', async () => {
  await withMap(async (map, advance, clock) => {
    const idleTimerCount = clock.countTimers();
    const ending = await endShortTurn(map, advance);
    await map.press('Explore map'); // No extra GPS or frame after the exact endpoint.
    const exploredCount = map.cameras.length;
    await advance(500);
    assert.equal(map.cameras.length, exploredCount, 'Explore still suppresses residual camera work');
    assert.equal(map.markers.length, ending.markerCount);
    await map.press('Recenter navigation');
    await advance(2_000);
    assert.equal(map.markers.length, ending.markerCount, 'heading recovery does not fabricate movement');
    const final = map.cameras.at(-1);
    assert.ok(final);
    assert.ok(Math.abs(signedTurn(final.camera.bearing, ending.bearing)) <= 2,
      `known accepted turn must converge after endpoint Explore, not stay at ${final.camera.bearing} while the marker is ${ending.bearing}`);
    assert.equal(clock.countTimers(), idleTimerCount, 'completed travel-heading recovery releases its timer');
  });
});

test('reviewer: a blocked bridge damps actual dispatched bearings while retaining the newest pending position and later convergence', async () => {
  await withMap(async (map, advance) => {
    map.holdCameraBridge();
    const ending = await endShortTurn(map, advance);
    await advance(1_500);
    assert.equal(map.cameras.length, 1, 'the blocked native writer remains serial throughout the real turn and settle');
    const first = map.cameras[0];
    const marker = latestMarker(map);
    await map.releaseOne();
    assert.equal(map.cameras.length, 2, 'release selects one newest pending command, not a replay');
    const selected = map.cameras[1];
    const selectedPosition = cameraVehiclePosition(map, selected, marker.marker.position.lat);
    assert.ok(Math.abs(selectedPosition.lat - marker.marker.position.lat) <= 1e-8
      && Math.abs(selectedPosition.lng - marker.marker.position.lng) <= 1e-8,
    'angular dispatch damping must not choose an obsolete pending vehicle position');
    await map.releaseAll();
    await advance(2_000);
    const rateFailures: string[] = [];
    let previous = first;
    for (const write of map.cameras.slice(1)) {
      const elapsed = Math.min(100, write.atMs - previous.atMs);
      const turn = Math.abs(signedTurn(previous.camera.bearing, write.camera.bearing));
      if (turn > 120 * elapsed / 1_000 + 1e-8) rateFailures.push(`${previous.camera.bearing} -> ${write.camera.bearing} at ${write.atMs}: ${turn} degrees exceeds ${120 * elapsed / 1_000}`);
      previous = write;
    }
    assert.deepEqual(rateFailures, [], 'the 100 ms/12 degree cap is measured between actual bridge submissions, not dropped calculated samples');
    assert.ok(Math.abs(signedTurn(map.cameras.at(-1)!.camera.bearing, ending.bearing)) <= 2,
      'after the bridge drains, actual submitted commands finish the accepted turn instead of stopping at a capped intermediate bearing');
    assert.equal(map.markers.length, ending.markerCount, 'bridge recovery does not invent additional car frames');
    assert.equal(map.maxConcurrentCameraWrites(), 1);
  });
});

test('reviewer: removing only MapView for unavailable coordinates cancels residual settle and restores exclusively through a new controller', async () => {
  await withMap(async (map, advance, clock) => {
    const idleTimerCount = clock.countTimers();
    const ending = await endShortTurn(map, advance);
    const oldControllerId = map.visibleControllerId();
    assert.ok(clock.countTimers() > idleTimerCount, 'a real residual settle timer exists before the location gate');
    await map.update({ latitude: undefined, longitude: undefined });
    assert.equal(map.mapVisible(), false, 'the component stays mounted but its MapView is removed by the location gate');
    const failures: string[] = [];
    if (clock.countTimers() > idleTimerCount) failures.push('location gate retained an old residual settle timer');
    const hiddenCameraCount = map.cameras.length;
    await advance(2_000);
    if (map.cameras.length !== hiddenCameraCount) failures.push(`removed MapView received ${map.cameras.length - hiddenCameraCount} future camera writes`);
    assert.equal(map.markers.length, ending.markerCount, 'the endpoint remains stationary while MapView is absent');

    map.deferNextMapController();
    const beforeRestoreCount = map.cameras.length;
    await map.update({ latitude: start.lat, longitude: start.lng + 0.00012, locationTimestamp: Date.now() });
    assert.equal(map.mapVisible(), true);
    const replacementId = map.visibleControllerId();
    assert.notEqual(replacementId, oldControllerId, 'a remounted MapView has a different native controller');
    await advance(250); // The new native controller is deliberately not ready yet.
    if (map.cameras.length !== beforeRestoreCount) failures.push('restored MapView reused a detached controller before its own controller-created callback');
    await map.publishMapController();
    await advance(200);
    assert.ok(map.cameras.some(write => write.controllerId === replacementId), 'the newly announced controller receives restored following');
    await map.update({ latitude: start.lat + 0.00036, locationTimestamp: Date.now() });
    await advance(2_000);
    if (map.cameras.slice(beforeRestoreCount).some(write => write.controllerId !== replacementId)) failures.push('restored camera or timers submitted to the obsolete MapView controller');
    assert.ok(map.markers.some(write => write.controllerId === replacementId && write.marker.position.lat === start.lat + 0.00036),
      'the replacement controller owns fresh accepted marker motion');
    assert.deepEqual(failures, [], 'MapView visibility, not merely surface unmount, invalidates native camera ownership');
  });
});

test('reviewer: location-gate removal immediately cancels motion/settle timers and discards blocked bridge pending commands', async () => {
  for (const phase of ['active-motion', 'residual-settle'] as const) {
    await withMap(async (map, advance, clock) => {
      const idleTimerCount = clock.countTimers();
      map.holdCameraBridge();
      if (phase === 'active-motion') {
        await beginStraightMotion(map, advance);
        await advance(200);
      } else {
        await endShortTurn(map, advance);
        await advance(200);
      }
      assert.equal(map.cameras.length, 1);
      assert.ok(clock.countTimers() > idleTimerCount, `real ${phase} and pending camera work precede the gate`);
      await map.update({ latitude: undefined, longitude: undefined });
      assert.equal(map.mapVisible(), false);
      const timerCount = clock.countTimers();
      const cameraCount = map.cameras.length;
      const markerCount = map.markers.length;
      await map.releaseAll();
      await advance(2_500);
      const failures: string[] = [];
      if (timerCount > idleTimerCount) failures.push(`the gate retained an active ${phase} timer`);
      if (map.cameras.length !== cameraCount) failures.push(`the detached controller received ${map.cameras.length - cameraCount} pending/future camera commands after native release`);
      if (map.markers.length !== markerCount) failures.push(`the detached controller received ${map.markers.length - markerCount} stale vehicle frames`);
      assert.deepEqual(failures, [], 'the already in-flight command may complete, but hidden-map pending work and motion/settle timers must be discarded');
      assert.equal(map.maxConcurrentCameraWrites(), 1);
    });
  }
});

test('Android retains the legacy camera cadence and undamped heading rather than opting in to iOS policy', async () => {
  await withMap(async (map, advance) => {
    await advance(1_000);
    map.clearWrites();
    await map.update({ latitude: start.lat + 0.00036, heading: 90, locationTimestamp: Date.now() });
    await advance(1_000);
    assert.equal(map.markers.length, 20);
    assert.ok(map.cameras.length > 0 && map.cameras.length < map.markers.length / 2, 'Android keeps the released 100 ms gate on ~50 ms car frames');
    for (let index = 1; index < map.cameras.length; index++) assert.ok(map.cameras[index].atMs - map.cameras[index - 1].atMs >= 100);
    for (const write of map.cameras) {
      const marker = map.markers.find(frame => frame.atMs === write.atMs);
      assert.ok(marker);
      assert.ok(Math.abs(signedTurn(write.camera.bearing, marker.marker.rotation)) < 1e-8, 'legacy Android camera takes the current car heading without iOS damping');
      assert.equal(write.camera.tilt, 45);
      assert.equal(write.camera.zoom, 17.2);
    }
  }, 'android');
});
