import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const requireHere = createRequire(__filename);
const origin = { lat: 5.7, lng: -0.1 };
const corner = { lat: 5.704, lng: -0.1 };
const target = { lat: 5.704, lng: -0.096 };
const initialRoad = [origin, corner, target];

// Execute the real React effects with mocked bridge calls. Passing here is not
// proof of native SDK delivery, road traffic, or camera behavior on a device.
async function mountIos(options: { initialNetworkFailure?: boolean; partialCurrentLeg?: boolean; platform?: 'ios' | 'android' } = {}) {
  let route = initialRoad;
  let currentLeg = options.partialCurrentLeg ? [origin, corner] : initialRoad;
  let props: any = { latitude: 5.703, longitude: origin.lng, locationTimestamp: Date.now(), locationAccuracy: 5,
    target: { latitude: target.lat, longitude: target.lng, label: 'Drop-off' }, tripStatus: 'dropoff', navigationId: 'ride-one' };
  const lines = new Map<string, any>();
  const markers = new Map<string, any>();
  const calls: any[] = [];
  const logs: any[] = [];
  const loggingCalls: boolean[] = [];
  const cameraCalls: any[] = [];
  let nativeGeneration = 0;
  let nativeTarget = target;
  let metricsReads = 0;
  let metricsHandler: (() => Promise<any>) | null = null;
  // Captured by the mock native source, before any Promise/bridge delay. Tests
  // must never stamp a late old callback as fresh on its JS receipt.
  const nativeStamp = () => ({ hy3nTargetLatitude: nativeTarget.lat, hy3nTargetLongitude: nativeTarget.lng,
    hy3nRouteGeneration: nativeGeneration, hy3nCapturedAtMs: Date.now() });
  const listeners: Record<string, ((value?: any) => void) | null> = {};
  let currentLegReads = 0;
  let shouldFail = Boolean(options.initialNetworkFailure);
  let geometryFails = false;
  let overlayFails = false;
  let newRoadOnRequest: typeof initialRoad | null = null;
  const mapController = {
    addMarker: async (marker: any) => { markers.set(marker.id, marker); return marker; },
    removeMarker: async (id: string) => { markers.delete(id); }, moveCamera: async (camera: any) => { cameraCalls.push(camera); },
    addPolyline: async (line: any) => { if (overlayFails) throw { code: 'NO_VIEW_CONTROLLER' }; lines.set(line.id, line); return line; },
    removePolyline: async (id: string) => { lines.delete(id); },
    getPolylines: async () => [...lines.values()],
  };
  const navigationController = {
    showTermsAndConditionsDialog: async () => true, init: async () => 'ok',
    setAudioGuidanceType: () => {}, startUpdatingLocation: () => {}, stopUpdatingLocation: () => {},
    setBackgroundLocationUpdatesEnabled: () => {}, startGuidance: async () => {}, stopGuidance: async () => {},
    setTurnByTurnLoggingEnabled: (enabled: boolean) => { loggingCalls.push(enabled); },
    getCurrentTimeAndDistance: async () => {
      metricsReads++;
      return metricsHandler ? metricsHandler() : { ...nativeStamp() };
    },
    clearDestinations: async () => {}, cleanup: async () => {},
    getRouteSegments: async () => [{ segmentLatLngList: route, ...nativeStamp() }],
    getCurrentRouteSegment: async () => { currentLegReads++; if (geometryFails) throw { code: 'route_not_available' }; return { segmentLatLngList: currentLeg, ...nativeStamp() }; },
    setDestination: async (point: any) => {
      nativeGeneration++;
      nativeTarget = { ...point.position };
      calls.push({ point, observedLocation: { latitude: props.latitude, longitude: props.longitude } });
      if (shouldFail) return 'NETWORK_ERROR';
      if (newRoadOnRequest) { route = newRoadOnRequest; currentLeg = newRoadOnRequest; }
      return 'OK';
    },
  };
  const useNavigation = () => React.useMemo(() => ({ navigationController,
    removeAllListeners: () => { Object.keys(listeners).forEach(key => { listeners[key] = null; }); },
    setOnArrival: (cb: any) => { listeners.arrival = cb; },
    setOnRouteChanged: (cb: any) => { listeners.changed = cb; },
    setOnReroutingRequestedByOffRoute: (cb: any) => { listeners.offRoute = cb; },
    setOnLocationChanged: (cb: any) => { listeners.location = cb; },
    setOnTurnByTurn: (cb: any) => { listeners.turn = cb; },
    setOnRemainingTimeOrDistanceChanged: (cb: any) => { listeners.remaining = cb; },
    setOnTrafficUpdated: (cb: any) => { listeners.traffic = cb; },
  }), []);
  const sdk = { useNavigation,
    MapView: ({ onMapViewControllerCreated, ...viewProps }: any) => { React.useEffect(() => onMapViewControllerCreated(mapController), [onMapViewControllerCreated]); return React.createElement('map', viewProps); },
    NavigationView: ({ onMapViewControllerCreated, ...viewProps }: any) => { React.useEffect(() => onMapViewControllerCreated(mapController), [onMapViewControllerCreated]); return React.createElement('map', viewProps); },
    NavigationProvider: ({ children }: any) => children,
    AudioGuidance: { VOICE_ALERTS_AND_GUIDANCE: 1, BLUETOOTH_AUDIO: 2 }, MapColorScheme: { FOLLOW_SYSTEM: 0 },
    NavigationSessionStatus: { OK: 'ok', NETWORK_ERROR: 'networkError', NOT_AUTHORIZED: 'notAuthorized', LOCATION_PERMISSION_MISSING: 'locationPermissionMissing' },
    NavigationUIEnabledPreference: { AUTOMATIC: 0 },
    RouteStatus: { OK: 'OK', NETWORK_ERROR: 'NETWORK_ERROR', LOCATION_UNKNOWN: 'LOCATION_UNKNOWN', LOCATION_DISABLED: 'LOCATION_DISABLED', NO_ROUTE_FOUND: 'NO_ROUTE_FOUND' },
    TaskRemovedBehavior: { CONTINUE_SERVICE: 0 }, TravelMode: { DRIVING: 0 },
  };
  const native = { View: 'view', Text: 'text', TouchableOpacity: 'button',
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    Linking: { openSettings: () => {} }, Platform: { OS: options.platform || 'ios', select: (v: any) => v[options.platform || 'ios'] },
    PixelRatio: { get: () => 3 },
    StyleSheet: { create: (v: any) => v, absoluteFillObject: {}, absoluteFill: {} } };
  const keepAwake = { useKeepAwake: () => {} };
  const result = await build({ entryPoints: [path.join(__dirname, '../components/NativeDriverGoogleMap.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    plugins: [{ name: 'actual-ios-boundary', setup(b) { b.onResolve({ filter: /^(react-native|@googlemaps\/react-native-navigation-sdk|expo-keep-awake|@expo\/vector-icons\/MaterialIcons)$/ }, args => ({ path: args.path, external: true })); } }] });
  const module = { exports: {} as any };
  const capturedConsole = { ...console, info: (...args: any[]) => logs.push(args), warn: (...args: any[]) => logs.push(args) };
  new Function('require', 'module', 'exports', '__DEV__', 'console', result.outputFiles[0].text)(
    (name: string) => name === 'react-native' ? native : name === '@googlemaps/react-native-navigation-sdk' ? sdk : name === 'expo-keep-awake' ? keepAwake
      : name === '@expo/vector-icons/MaterialIcons' ? (iconProps: any) => React.createElement('icon', iconProps) : requireHere(name),
    module, module.exports, true, capturedConsole);
  const Component = module.exports.default;
  let tree!: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
  await act(async () => { tree = create(React.createElement(Component, props)); await flush(); });
  await act(async () => { await flush(); });
  return { lines, markers, calls, logs, listeners, currentLegReads: () => currentLegReads,
    loggingCalls, cameraCalls, nativeStamp, metricsReads: () => metricsReads,
    setMetricsHandler: (handler: (() => Promise<any>) | null) => { metricsHandler = handler; },
    emit: async (name: string, value?: any) => { await act(async () => { listeners[name]?.(value); await flush(); }); },
    rendered: () => JSON.stringify(tree.toJSON()),
    arrival: async (event: any) => { await act(async () => { listeners.arrival?.(event); await flush(); }); },
    routeChanged: async () => { await act(async () => { listeners.changed?.(); await flush(); }); },
    nativeLocation: async (location: any) => { await act(async () => { listeners.location?.(location); await flush(); }); },
    providerRecovers: () => { shouldFail = false; },
    providerFails: () => { shouldFail = true; },
    geometryFails: (value: boolean) => { geometryFails = value; },
    overlayFails: (value: boolean) => { overlayFails = value; },
    currentLeg: (points: typeof initialRoad) => { currentLeg = points; },
    nextRoute: (points: typeof initialRoad) => { newRoadOnRequest = points; },
    update: async (values: any) => { props = { ...props, ...values }; await act(async () => { tree.update(React.createElement(Component, props)); await flush(); }); },
    flush: async () => { await act(async () => { await flush(); }); },
    dispose: async () => { await act(async () => { tree.unmount(); await flush(); }); } };
}

test('iOS accepts a successful same-road reroute whose fresh current leg begins at the latest driver fix', async () => {
  const map = await mountIos();
  try {
    assert.ok(map.lines.has('hy3n-driver-route'), 'initial native polyline exists');
    await map.update({ latitude: 5.7028, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: 5.7024, locationTimestamp: Date.now() + 2 });
    const newOrigin = { lat: 5.702, lng: origin.lng };
    map.nextRoute([newOrigin, corner, target]);
    await map.update({ latitude: newOrigin.lat, locationTimestamp: Date.now() + 3 });
    assert.equal(map.calls.length, 2, 'same-road reversal should cause one Google route request');
    assert.deepEqual(map.calls.at(-1).point.position, target);
    assert.deepEqual(map.calls.at(-1).observedLocation, { latitude: newOrigin.lat, longitude: newOrigin.lng });
    const shown = map.lines.get('hy3n-driver-route')?.points;
    assert.deepEqual(shown?.[0], newOrigin, 'provider-confirmed remaining route must not be quarantined merely for using the same road');
    assert.deepEqual(shown?.at(-1), target);
    assert.ok(map.currentLegReads() > 0, 'iOS must inspect the live currentRouteLeg, not only the complete leg array');
  } finally { await map.dispose(); }
});

test('iOS falls back to complete route geometry when the first current segment is partial', async () => {
  const map = await mountIos({ partialCurrentLeg: true });
  try {
    assert.ok(map.lines.has('hy3n-driver-route'), 'complete fallback route polyline exists');
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); }
});

test('iOS logs each stage of a genuine deviation without precise coordinates or rider data', async () => {
  const map = await mountIos();
  try {
    map.nextRoute([{ lat: 5.702, lng: -0.102 }, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.update({ latitude: 5.7021, longitude: -0.102, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: Date.now() + 2 });
    const text = JSON.stringify(map.logs);
    for (const event of ['gps.sample','route.assessment','route.request','route.response','geometry.received','polyline.applied','polyline.verified']) assert.ok(text.includes(event), `missing diagnostic stage ${event}`);
    assert.ok(!text.includes('latitude') && !text.includes('longitude') && !text.includes('Drop-off'), 'trace must not expose locations or addresses');
    assert.ok(map.logs.some((row) => row[1] === 'polyline.verified' && row[2].nativePathMatches === true));
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); }
});


test('iOS exposes native Google location movement separately from the Expo car feed', async () => {
  const map = await mountIos();
  try {
    map.listeners.location?.({ lat: 5.703, lng: origin.lng, time: Date.now(), accuracy: 5 });
    map.listeners.location?.({ lat: 5.7032, lng: origin.lng, time: Date.now(), accuracy: 5 });
    const events = map.logs.filter(row => row[1] === 'native.gps');
    assert.equal(events.length, 2);
    assert.ok(events[1][2].movementMeters > 0);
    assert.ok(!JSON.stringify(events).includes('5.703'));
  } finally { await map.dispose(); }
});

test('iOS clears the old branded line and replaces it when Navigation moves but Expo is stale', async () => {
  const map = await mountIos();
  try {
    // This is the reported phone failure: Google Navigation has advanced onto a
    // different road, while the Expo prop remains at the earlier point. The
    // custom HY3N route must use the valid native iOS feed for safety rather
    // than continue drawing the passed green/white line from stale Expo state.
    const nativeStart = { lat: 5.702, lng: -0.102 };
    const nativeLater = { lat: 5.7022, lng: -0.102 };
    map.nextRoute([nativeLater, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.nativeLocation({ ...nativeStart, time: Date.now() + 1, accuracy: 5 });
    await map.nativeLocation({ ...nativeLater, time: Date.now() + 2, accuracy: 5 });

    assert.equal(map.calls.length, 2, 'two valid native iOS off-route samples must request one replacement route');
    assert.deepEqual(map.calls.at(-1).point.position, target, 'the server-owned trip target must remain unchanged');
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points[0], nativeLater,
      'the visible line must begin on the current native road, not the stale Expo point');
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); }
});

test('iOS reroutes from fresh Navigation GPS when the Expo foreground watcher has no current fix', async () => {
  const map = await mountIos();
  try {
    // A real iPhone can keep Google Navigation's CLLocation callbacks alive
    // while Expo's foreground watcher has stopped or failed. The branded
    // overlay must use the current validated native fix; retaining the passed
    // line simply because Expo is absent would direct a Driver from an old road.
    await map.update({ latitude: undefined, longitude: undefined, locationTimestamp: null, locationAccuracy: null });
    const nativeStart = { lat: 5.702, lng: -0.102 };
    const nativeLater = { lat: 5.7022, lng: -0.102 };
    map.nextRoute([nativeLater, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.nativeLocation({ ...nativeStart, time: Date.now() + 1, accuracy: 5 });
    await map.nativeLocation({ ...nativeLater, time: Date.now() + 2, accuracy: 5 });

    assert.equal(map.calls.length, 2, 'fresh native iOS movement must still request one safe replacement route');
    assert.deepEqual(map.calls.at(-1).point.position, target, 'native-only GPS may not change the server-owned destination');
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points[0], nativeLater,
      'the old green/white road must be replaced even when Expo currently has no fix');
    assert.deepEqual(map.markers.get('hy3n-driver-vehicle')?.position, { lat: nativeLater.lat, lng: nativeLater.lng },
      'the branded car must not remain at the last Expo point when Navigation has the current valid iPhone fix');
  } finally { await map.dispose(); }
});

test('iOS rejects an older native sample and keeps the newer valid Expo fix authoritative', async () => {
  const map = await mountIos();
  try {
    // Native must be fresh and newer to win. A delayed native bridge event may
    // not roll the custom line back over a newer foreground device fix.
    await map.nativeLocation({ lat: 5.702, lng: -0.102, time: Date.now() - 1_000, accuracy: 5 });
    assert.equal(map.calls.length, 1, 'older native data cannot create a reroute by itself');

    const expoLater = { lat: 5.7022, lng: -0.102 };
    map.nextRoute([expoLater, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.update({ latitude: 5.7021, longitude: -0.102, locationTimestamp: Date.now() + 1, locationAccuracy: 5 });
    await map.update({ latitude: expoLater.lat, longitude: expoLater.lng, locationTimestamp: Date.now() + 2, locationAccuracy: 5 });

    assert.equal(map.calls.length, 2);
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points[0], expoLater);
  } finally { await map.dispose(); }
});

test('iOS retains branded guidance while every location source is temporarily stale', async () => {
  const map = await mountIos();
  try {
    assert.ok(map.lines.has('hy3n-driver-route'));
    await map.update({ latitude: 5.702, locationTimestamp: Date.now() - 60_000, locationAccuracy: 5 });
    assert.equal(map.lines.has('hy3n-driver-route'), true,
      'a stale phone fix must not erase the last verified route line');
  } finally { await map.dispose(); }
});

test('Android keeps its existing Expo route path and ignores the iPhone-only Navigation location bridge', async () => {
  const map = await mountIos({ platform: 'android' });
  try {
    await map.nativeLocation({ lat: 5.702, lng: -0.102, time: Date.now() + 1, accuracy: 5 });
    assert.equal(map.calls.length, 1, 'the iOS bridge callback cannot alter Android rerouting');

    const expoLater = { lat: 5.7022, lng: -0.102 };
    map.nextRoute([expoLater, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.update({ latitude: 5.7021, longitude: -0.102, locationTimestamp: Date.now() + 2, locationAccuracy: 5 });
    await map.update({ latitude: expoLater.lat, longitude: expoLater.lng, locationTimestamp: Date.now() + 3, locationAccuracy: 5 });

    assert.equal(map.calls.length, 2);
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points[0], expoLater);
  } finally { await map.dispose(); }
});

test('imprecise iPhone GPS does not cause false rerouting, and accurate fixes recover', async () => {
  const map = await mountIos();
  try {
    await map.update({ latitude: 5.702, longitude: -0.102, locationAccuracy: 250, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: 5.7022, longitude: -0.102, locationTimestamp: Date.now() + 2 });
    assert.equal(map.calls.length, 1);
    await map.update({ latitude: 5.7023, locationAccuracy: 5, locationTimestamp: Date.now() + 3 });
    await map.update({ latitude: 5.7024, locationTimestamp: Date.now() + 4 });
    assert.equal(map.calls.length, 2);
  } finally { await map.dispose(); }
});

test('invalid iPhone coordinates never become a native route request', async () => {
  const map = await mountIos();
  try {
    await map.update({ latitude: Number.NaN, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: 91, locationTimestamp: Date.now() + 2 });
    assert.equal(map.calls.length, 1);
    assert.deepEqual(map.calls[0].point.position, target);
  } finally { await map.dispose(); }
});

test('iOS reports current-leg errors and preserves the last visible route line', async () => {
  const map = await mountIos();
  try {
    map.geometryFails(true);
    await act(async () => { map.listeners.changed?.(); await Promise.resolve(); });
    await map.flush();
    assert.equal(map.lines.has('hy3n-driver-route'), true,
      'a temporary native geometry failure must not leave the Driver map blank');
    assert.ok(map.logs.some(row => row[1] === 'geometry.failed' && row[2].code === 'route_not_available'));
    map.geometryFails(false);
    map.currentLeg([{ lat: 5.703, lng: origin.lng }, corner, target]);
    await act(async () => { map.listeners.changed?.(); await Promise.resolve(); });
    await map.flush();
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); }
});

test('iOS identifies a failed native polyline operation without crashing the trip map', async () => {
  const map = await mountIos();
  try {
    map.overlayFails(true);
    await act(async () => { map.listeners.changed?.(); await Promise.resolve(); });
    await map.flush();
    assert.ok(map.logs.some(row => row[1] === 'polyline.failed' && row[2].code === 'NO_VIEW_CONTROLLER'));
    map.overlayFails(false);
    await act(async () => { map.listeners.changed?.(); await Promise.resolve(); });
    await map.flush();
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); }
});

test('an active iPhone trip recovers from a failed reroute after the cooldown with the latest GPS fix', async () => {
  const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000, toFake: ['Date','setTimeout','clearTimeout','setInterval','clearInterval'] });
  const map = await mountIos();
  try {
    map.providerFails();
    await map.update({ latitude: 5.7021, longitude: -0.102, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: 5.7022, longitude: -0.102, locationTimestamp: Date.now() + 2 });
    assert.equal(map.calls.length, 2);
    assert.ok(map.logs.some(row => row[1] === 'route.response' && row[2].status === 'NETWORK_ERROR'));
    map.providerRecovers();
    await act(async () => { await clock.tickAsync(12_001); });
    const latest = { lat: 5.7025, lng: -0.102 };
    map.nextRoute([latest, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.update({ latitude: latest.lat, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: latest.lat + 0.00002, locationTimestamp: Date.now() + 2 });
    assert.equal(map.calls.length, 3, 'recovery must not produce duplicate immediate requests');
    assert.deepEqual(map.calls.at(-1).point.position, target);
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); clock.uninstall(); }
});


test('stale iPhone fixes cannot trigger rerouting and fresh GPS resumes detection', async () => {
  const map = await mountIos();
  try {
    await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: Date.now() - 60_000 });
    await map.update({ latitude: 5.7022, longitude: -0.102, locationTimestamp: Date.now() - 59_000 });
    assert.equal(map.calls.length, 1);
    assert.ok(map.logs.some(row => row[1] === 'route.assessment' && row[2].reason === 'stale_or_imprecise_gps'));
    map.nextRoute([{ lat: 5.7023, lng: -0.102 }, { lat: 5.704, lng: -0.102 }, corner, target]);
    await map.update({ latitude: 5.7023, locationTimestamp: Date.now() + 1 });
    await map.update({ latitude: 5.7024, locationTimestamp: Date.now() + 2 });
    assert.equal(map.calls.length, 2);
    assert.deepEqual(map.lines.get('hy3n-driver-route')?.points.at(-1), target);
  } finally { await map.dispose(); }
});

test('iOS ignores an arrival callback for a previous waypoint and keeps the current route visible', async () => {
  const map = await mountIos();
  try {
    assert.ok(map.lines.has('hy3n-driver-route'));
    await map.arrival({
      waypoint: { position: { lat: 5.699, lng: -0.11 } },
      isFinalDestination: true,
    });
    assert.doesNotMatch(map.rendered(), /You have reached this stop/);
    assert.ok(map.lines.has('hy3n-driver-route'), 'an obsolete arrival must not erase current guidance');
  } finally { await map.dispose(); }
});

test('iOS shows arrival guidance and clears only the current target route after a fresh matching phone fix', async () => {
  const map = await mountIos();
  try {
    await map.update({ latitude: target.lat, longitude: target.lng, locationTimestamp: Date.now() + 1 });
    await map.arrival({ waypoint: { position: { lat: target.lat, lng: target.lng } }, isFinalDestination: true });
    assert.match(map.rendered(), /You have reached this stop/);
    assert.equal(map.lines.has('hy3n-driver-route'), false, 'a genuine arrival must not leave an old route behind');
    await map.routeChanged();
    assert.equal(map.lines.has('hy3n-driver-route'), false, 'a delayed native route event must not redraw a completed target');
  } finally { await map.dispose(); }
});

function liveTurn(stamp: Record<string, number>, instruction = 'Turn right onto Independence Avenue') {
  return {
    ...stamp,
    navState: 1,
    currentStep: { instruction, fullRoadName: 'Independence Avenue', maneuver: 7 },
    distanceToCurrentStepMeters: 140,
    distanceToNextDestinationMeters: 6400,
    timeToNextDestinationSeconds: 780,
    distanceToFinalDestinationMeters: 99_000,
    timeToFinalDestinationSeconds: 9_900,
    // Not SDK StepInfo fields. They must not replace current-step distance.
    remainingdistance: 88_000,
    remainingtime: 8_800,
  };
}

for (const platform of ['ios', 'android'] as const) {
  test(`${platform} renders the real numeric currentStep turn, road and turn distance separately from native remaining ETA`, async () => {
    const map = await mountIos({ platform });
    try {
      assert.equal(typeof map.listeners.turn, 'function', 'the live turn callback must be registered');
      assert.equal(typeof map.listeners.remaining, 'function', 'the native ETA callback must be registered');
      assert.equal(typeof map.listeners.traffic, 'function', 'traffic changes must refresh the live navigation surface');
      await map.emit('turn', [liveTurn(map.nativeStamp())]);
      assert.match(map.rendered(), /Turn right onto Independence Avenue/);
      assert.match(map.rendered(), /Independence Avenue/);
      assert.match(map.rendered(), /"name":"turn-right"/);
      assert.match(map.rendered(), /140 m/);
      assert.match(map.rendered(), /6\.4 km/);
      assert.match(map.rendered(), /13 min/);
      assert.doesNotMatch(map.rendered(), /99 km|88 km|165 min/);
      await map.emit('remaining', { ...map.nativeStamp(), meters: 2450, seconds: 481 });
      assert.match(map.rendered(), /2\.5 km/);
      assert.match(map.rendered(), /9 min/);
      assert.match(map.rendered(), /arrival/);
      assert.match(map.rendered(), /140 m/, 'ETA total distance cannot become the next-turn distance');
      assert.doesNotMatch(map.rendered(), /13 min/);
    } finally { await map.dispose(); }
  });

  test(`${platform} rejects unstamped, wrong-target, stale-capture and wrong-generation turn and ETA events`, async () => {
    const map = await mountIos({ platform });
    try {
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'Current verified instruction')]);
      await map.emit('remaining', { ...map.nativeStamp(), meters: 2450, seconds: 481 });
      const stamp = map.nativeStamp();
      const rejectedStamps = [
        {},
        { ...stamp, hy3nTargetLatitude: target.lat + 0.01 },
        { ...stamp, hy3nTargetLongitude: target.lng + 0.01 },
        { ...stamp, hy3nRouteGeneration: stamp.hy3nRouteGeneration - 1 },
        { ...stamp, hy3nRouteGeneration: stamp.hy3nRouteGeneration + 1 },
        { ...stamp, hy3nCapturedAtMs: Date.now() - 15_001 },
        { ...stamp, hy3nCapturedAtMs: Date.now() + 60_000 },
      ];
      for (const context of rejectedStamps) {
        await map.emit('turn', [liveTurn(context, 'OBSOLETE turn must not appear')]);
        await map.emit('remaining', { ...context, meters: 99_000, seconds: 9_900 });
        assert.match(map.rendered(), /Current verified instruction/);
        assert.match(map.rendered(), /9 min/);
        assert.match(map.rendered(), /2\.5 km/);
        assert.doesNotMatch(map.rendered(), /OBSOLETE|99 km|2 hr 45 min/);
      }
    } finally { await map.dispose(); }
  });

  test(`${platform} target replacement clears the old turn and rejects delayed events from the previous target`, async () => {
    const map = await mountIos({ platform });
    try {
      const oldStamp = map.nativeStamp();
      await map.emit('turn', [liveTurn(oldStamp, 'OLD target instruction')]);
      const nextTarget = { lat: 5.708, lng: -0.096 };
      map.nextRoute([{ lat: 5.703, lng: origin.lng }, corner, nextTarget]);
      await map.update({ target: { latitude: nextTarget.lat, longitude: nextTarget.lng, label: 'Next stop', kind: 'stop' } });
      assert.doesNotMatch(map.rendered(), /OLD target instruction/);
      await map.emit('turn', [liveTurn(oldStamp, 'OLD delayed target instruction')]);
      await map.emit('remaining', { ...oldStamp, meters: 99_000, seconds: 9_900 });
      assert.doesNotMatch(map.rendered(), /OLD|99 km|2 hr 45 min/);
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'NEW target instruction')]);
      assert.match(map.rendered(), /NEW target instruction/);
      assert.deepEqual(map.calls.at(-1).point.position, nextTarget, 'native guidance must still follow the server target');
    } finally { await map.dispose(); }
  });

  test(`${platform} changing ride identity at identical coordinates clears the old turn and native generation`, async () => {
    const map = await mountIos({ platform });
    try {
      const oldStamp = map.nativeStamp();
      await map.emit('turn', [liveTurn(oldStamp, 'OLD ride instruction')]);
      await map.update({ navigationId: 'ride-two' });
      assert.equal(map.calls.length, 2, 'identical destination coordinates do not make two server rides the same navigation');
      assert.ok(map.nativeStamp().hy3nRouteGeneration > oldStamp.hy3nRouteGeneration);
      assert.doesNotMatch(map.rendered(), /OLD ride instruction/);
      await map.emit('turn', [liveTurn({ ...oldStamp, hy3nCapturedAtMs: Date.now() }, 'OLD ride delayed instruction')]);
      await map.emit('remaining', { ...oldStamp, hy3nCapturedAtMs: Date.now(), meters: 99_000, seconds: 9_900 });
      assert.doesNotMatch(map.rendered(), /OLD|99 km|2 hr 45 min/);
      // Even the current generation cannot freshen a source capture from before
      // the new ride's valid-after cutoff.
      await map.emit('turn', [liveTurn({ ...map.nativeStamp(), hy3nCapturedAtMs: oldStamp.hy3nCapturedAtMs - 1 }, 'OLD source capture')]);
      assert.doesNotMatch(map.rendered(), /OLD source capture/);
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'NEW ride instruction')]);
      assert.match(map.rendered(), /NEW ride instruction/);
    } finally { await map.dispose(); }
  });

  test(`${platform} rerouting clears an old turn immediately and old-generation events cannot restore it`, async () => {
    const map = await mountIos({ platform });
    try {
      const oldStamp = map.nativeStamp();
      await map.emit('turn', [liveTurn(oldStamp, 'OLD road turn')]);
      const later = { lat: 5.7022, lng: -0.102 };
      map.nextRoute([later, { lat: 5.704, lng: -0.102 }, corner, target]);
      await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: Date.now() + 1 });
      await map.update({ latitude: later.lat, longitude: later.lng, locationTimestamp: Date.now() + 2 });
      assert.equal(map.calls.length, 2);
      assert.doesNotMatch(map.rendered(), /OLD road turn/);
      await map.emit('turn', [liveTurn({ ...oldStamp, hy3nCapturedAtMs: Date.now() }, 'OLD reroute callback')]);
      await map.emit('remaining', { ...oldStamp, hy3nCapturedAtMs: Date.now(), meters: 99_000, seconds: 9_900 });
      assert.doesNotMatch(map.rendered(), /OLD|99 km|2 hr 45 min/);
    } finally { await map.dispose(); }
  });

  test(`${platform} native route invalidation clears a turn before replacement geometry is available`, async () => {
    const map = await mountIos({ platform });
    try {
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'OLD native-route instruction')]);
      map.geometryFails(true);
      await map.routeChanged();
      assert.doesNotMatch(map.rendered(), /OLD native-route instruction/);
      await map.emit('offRoute');
      assert.doesNotMatch(map.rendered(), /OLD native-route instruction/);
      await map.emit('turn', [liveTurn({ ...map.nativeStamp(), hy3nCapturedAtMs: Date.now() - 1 }, 'OLD queued instruction')]);
      assert.doesNotMatch(map.rendered(), /OLD queued instruction/);
    } finally { await map.dispose(); }
  });

  test(`${platform} traffic updates read native ETA and do not reset a healthy server destination`, async () => {
    const map = await mountIos({ platform });
    try {
      await map.emit('turn', [liveTurn(map.nativeStamp())]);
      map.setMetricsHandler(async () => ({ ...map.nativeStamp(), meters: 3500, seconds: 721 }));
      const reads = map.metricsReads();
      const geometryReads = map.currentLegReads();
      await map.emit('traffic');
      await map.flush();
      assert.ok(map.metricsReads() > reads, 'traffic changes must retrieve provider time and distance');
      assert.ok(map.currentLegReads() > geometryReads, 'traffic changes refresh the branded road geometry');
      assert.equal(map.calls.length, 1, 'a traffic ETA refresh is not a destination mutation');
      assert.match(map.rendered(), /3\.5 km/);
      assert.match(map.rendered(), /13 min/);
      assert.match(map.rendered(), /Turn right onto Independence Avenue/);
    } finally { await map.dispose(); }
  });

  for (const transition of ['target', 'ride', 'reroute', 'arrival', 'idle'] as const) {
    test(`${platform} delayed native ETA from before ${transition} cannot overwrite current navigation`, async () => {
      const map = await mountIos({ platform });
      let resolveOld!: (value: any) => void;
      try {
        await map.emit('turn', [liveTurn(map.nativeStamp(), 'OLD pending ETA turn')]);
        const capturedOldMetrics = { ...map.nativeStamp(), meters: 99_000, seconds: 9_900 };
        map.setMetricsHandler(() => new Promise(resolve => { resolveOld = resolve; }));
        await map.emit('traffic');
        assert.equal(typeof resolveOld, 'function', 'the mock must actually suspend a native source-captured ETA read');
        map.setMetricsHandler(null);
        if (transition === 'target') {
          const nextTarget = { lat: 5.708, lng: -0.096 };
          map.nextRoute([{ lat: 5.703, lng: origin.lng }, corner, nextTarget]);
          await map.update({ target: { latitude: nextTarget.lat, longitude: nextTarget.lng, label: 'Next stop' } });
        } else if (transition === 'ride') {
          await map.update({ navigationId: 'ride-two' });
        } else if (transition === 'reroute') {
          const later = { lat: 5.7022, lng: -0.102 };
          map.nextRoute([later, { lat: 5.704, lng: -0.102 }, corner, target]);
          await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: Date.now() + 1 });
          await map.update({ latitude: later.lat, locationTimestamp: Date.now() + 2 });
        } else if (transition === 'arrival') {
          await map.update({ latitude: target.lat, longitude: target.lng, locationTimestamp: Date.now() + 1 });
          await map.arrival({ waypoint: { position: target }, isFinalDestination: true });
        } else {
          await map.update({ target: null, tripStatus: null });
        }
        if (transition === 'target' || transition === 'ride' || transition === 'reroute') {
          await map.emit('remaining', { ...map.nativeStamp(), meters: 2450, seconds: 481 });
        }
        resolveOld(capturedOldMetrics);
        await map.flush();
        assert.doesNotMatch(map.rendered(), /99 km|2 hr 45 min|OLD pending ETA turn/);
        if (transition === 'target' || transition === 'ride' || transition === 'reroute') {
          assert.match(map.rendered(), /9 min/);
          assert.match(map.rendered(), /2\.5 km/);
        }
      } finally { await map.dispose(); }
    });
  }

  test(`${platform} arrival and target removal clear turns, stop native feed logging, and detach listeners on unmount`, async () => {
    const map = await mountIos({ platform });
    let disposed = false;
    try {
      assert.equal(map.loggingCalls.at(-1), true, 'active guidance enables the native turn feed');
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'OLD turn before idle')]);
      const oldStamp = map.nativeStamp();
      await map.update({ target: null, tripStatus: null });
      assert.doesNotMatch(map.rendered(), /OLD turn before idle/);
      assert.equal(map.loggingCalls.at(-1), false, 'idle state must stop native turn logging');
      await map.emit('turn', [liveTurn(oldStamp, 'OLD turn after idle')]);
      await map.emit('remaining', { ...oldStamp, meters: 99_000, seconds: 9_900 });
      assert.doesNotMatch(map.rendered(), /OLD turn after idle|99 km|2 hr 45 min/);
      await map.update({ target: { latitude: target.lat, longitude: target.lng, label: 'Drop-off' }, tripStatus: 'dropoff', navigationId: 'ride-two' });
      assert.equal(map.loggingCalls.at(-1), true, 'a reused native session re-enables live turn delivery');
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'OLD turn before arrival')]);
      const arrivalStamp = map.nativeStamp();
      await map.update({ latitude: target.lat, longitude: target.lng, locationTimestamp: Date.now() + 1 });
      await map.arrival({ waypoint: { position: target }, isFinalDestination: true });
      assert.match(map.rendered(), /You have reached this stop/);
      assert.doesNotMatch(map.rendered(), /OLD turn before arrival/);
      assert.equal(map.loggingCalls.at(-1), false, 'confirmed local arrival stops the turn feed, not the server trip');
      await map.emit('turn', [liveTurn(arrivalStamp, 'OLD turn after arrival')]);
      await map.emit('remaining', { ...arrivalStamp, meters: 99_000, seconds: 9_900 });
      assert.doesNotMatch(map.rendered(), /OLD turn after arrival|99 km|2 hr 45 min/);
      await map.dispose();
      disposed = true;
      assert.equal(map.loggingCalls.at(-1), false);
      assert.ok(Object.values(map.listeners).every(listener => listener === null), 'unmount detaches every native listener');
    } finally { if (!disposed) await map.dispose(); }
  });
}

for (const platform of ['ios', 'android'] as const) {
  test(`${platform} explicit navigation pause stops live logging and resumed guidance accepts only current feed context`, async () => {
    const map = await mountIos({ platform });
    try {
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'OLD instruction before pause')]);
      const beforePause = map.nativeStamp();
      await map.update({ navigationPaused: true });
      assert.equal(map.loggingCalls.at(-1), false);
      assert.doesNotMatch(map.rendered(), /OLD instruction before pause/);
      await map.emit('turn', [liveTurn(beforePause, 'OLD queued instruction while paused')]);
      await map.emit('remaining', { ...beforePause, meters: 99_000, seconds: 9_900 });
      assert.doesNotMatch(map.rendered(), /OLD queued instruction while paused|99 km|2 hr 45 min/);
      await map.update({ navigationPaused: false });
      assert.equal(map.loggingCalls.at(-1), true);
      await map.emit('turn', [liveTurn({ ...map.nativeStamp(), hy3nCapturedAtMs: beforePause.hy3nCapturedAtMs - 1 }, 'OLD captured instruction before resume')]);
      assert.doesNotMatch(map.rendered(), /OLD captured instruction before resume/);
      await map.emit('turn', [liveTurn(map.nativeStamp(), 'NEW instruction after resume')]);
      assert.match(map.rendered(), /NEW instruction after resume/);
    } finally { await map.dispose(); }
  });
}
