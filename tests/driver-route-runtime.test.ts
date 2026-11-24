import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// These execute the actual component's effects and asynchronous bridge calls.
// The mock supplies road geometry; it does not pretend to test native iOS GPS.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const requireHere = createRequire(__filename);
const origin = { lat: 5.7, lng: -0.1 };
const corner = { lat: 5.704, lng: -0.1 };
const destination = { lat: 5.704, lng: -0.096 };
const road = [origin, corner, destination];

async function mountMap(initial = { latitude: origin.lat, longitude: origin.lng }, platform: 'ios' | 'android' = 'ios', options: { manualMapReady?: boolean; manualController?: boolean } = {}) {
  let segments = road;
  let currentSegments: typeof road | null = null;
  let currentTraffic: any = undefined;
  let completeTraffic: any = undefined;
  let hasCurrentContext = true;
  let onDestination: ((point: any) => Promise<number>) | null = null;
  const polylines = new Map<string, any>();
  const destinationCalls: any[] = [];
  const cameraCalls: any[] = [];
  const polylineRemovals: string[] = [];
  const listeners: Record<string, ((value?: any) => void) | null> = {};
  const loggingCalls: boolean[] = [];
  let nativeGeneration = 0;
  let nativeTarget = destination;
  const nativeStamp = () => ({ hy3nTargetLatitude: nativeTarget.lat, hy3nTargetLongitude: nativeTarget.lng,
    hy3nRouteGeneration: nativeGeneration, hy3nCapturedAtMs: Date.now() });
  const backgroundLocationCalls: boolean[] = [];
  const keepAwakeCalls: string[] = [];
  let locationStarts = 0;
  let mapReady = !options.manualMapReady;
  let controllerCreated: ((controller: any) => void) | null = null;
  let geometryWaypoint: typeof destination | null = null;
  let onCurrentSegment: (() => Promise<any>) | null = null;
  let onCompleteSegments: (() => Promise<any>) | null = null;
  let beforeReadyWrites = 0;
  let appStateListener: ((state: string) => void) | null = null;
  const controller = {
    addMarker: async () => ({}), removeMarker: async () => {}, moveCamera: (camera: any) => { cameraCalls.push(camera); },
    addPolyline: async (line: any) => {
      if (!mapReady) { beforeReadyWrites++; throw new Error('Native Android map controller is not ready'); }
      polylines.set(line.id, line); return line;
    },
    removePolyline: async (id: string) => {
      if (!mapReady) { beforeReadyWrites++; throw new Error('Native Android map controller is not ready'); }
      polylineRemovals.push(id); polylines.delete(id);
    },
  };
  const navigationController = {
    showTermsAndConditionsDialog: async () => true, init: async () => 0,
    setAudioGuidanceType: () => {}, startUpdatingLocation: () => { locationStarts++; },
    stopUpdatingLocation: () => {},
    setBackgroundLocationUpdatesEnabled: (enabled: boolean) => { backgroundLocationCalls.push(enabled); },
    startGuidance: async () => {}, stopGuidance: async () => {},
    setTurnByTurnLoggingEnabled: (enabled: boolean) => { loggingCalls.push(enabled); },
    getCurrentTimeAndDistance: async () => ({ ...nativeStamp() }),
    clearDestinations: async () => {}, cleanup: async () => {},
    getCurrentRouteSegment: async () => onCurrentSegment ? onCurrentSegment() : ({ segmentLatLngList: currentSegments ?? segments, navigationTrafficData: currentTraffic,
      ...(geometryWaypoint ? { destinationWaypoint: { position: geometryWaypoint } } : {}), ...(hasCurrentContext ? nativeStamp() : {}) }),
    getRouteSegments: async () => onCompleteSegments ? onCompleteSegments() : [{ segmentLatLngList: segments, navigationTrafficData: completeTraffic,
      ...(geometryWaypoint ? { destinationWaypoint: { position: geometryWaypoint } } : {}) }],
    setDestination: async (point: any) => {
      nativeGeneration++;
      nativeTarget = { ...point.position };
      destinationCalls.push(point);
      return onDestination ? onDestination(point) : 0;
    },
  };
  const useNavigation = () => React.useMemo(() => ({
    navigationController,
    removeAllListeners: () => { Object.keys(listeners).forEach(key => { listeners[key] = null; }); },
    setOnArrival: (cb: any) => { listeners.arrival = cb; },
    setOnRouteChanged: (cb: any) => { listeners.changed = cb; },
    setOnReroutingRequestedByOffRoute: (cb: any) => { listeners.offRoute = cb; },
    setOnLocationChanged: (cb: any) => { listeners.location = cb; },
    setOnTurnByTurn: (cb: any) => { listeners.turn = cb; },
    setOnRemainingTimeOrDistanceChanged: (cb: any) => { listeners.remaining = cb; },
    setOnTrafficUpdated: (cb: any) => { listeners.traffic = cb; },
  }), []);
  const MapView = ({ onMapViewControllerCreated, ...props }: any) => {
    React.useEffect(() => {
      controllerCreated = onMapViewControllerCreated;
      if (!options.manualController) onMapViewControllerCreated(controller);
      if (mapReady) props.onMapReady?.();
    }, [onMapViewControllerCreated]);
    return React.createElement('map', props);
  };
  const sdk = {
    useNavigation, MapView, NavigationView: MapView, NavigationProvider: ({ children }: any) => children,
    AudioGuidance: { VOICE_ALERTS_AND_GUIDANCE: 1, BLUETOOTH_AUDIO: 2 },
    MapColorScheme: { FOLLOW_SYSTEM: 0 }, NavigationSessionStatus: { OK: 0 },
    RouteStatus: { OK: 0 }, NavigationUIEnabledPreference: { AUTOMATIC: 0 }, TaskRemovedBehavior: { CONTINUE_SERVICE: 0 },
    TravelMode: { DRIVING: 0 },
  };
  const native = {
    View: 'view', Text: 'text', TouchableOpacity: 'button',
    AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: () => { appStateListener = null; } };
    } },
    Linking: { openSettings: () => {} }, Platform: { OS: platform, select: (v: any) => v[platform] },
    PixelRatio: { get: () => 3 },
    StyleSheet: { create: (v: any) => v, absoluteFillObject: {}, absoluteFill: {} },
  };
  const keepAwake = {
    useKeepAwake: (tag: string) => {
      React.useEffect(() => {
        keepAwakeCalls.push(`activate:${tag}`);
        return () => { keepAwakeCalls.push(`deactivate:${tag}`); };
      }, [tag]);
    },
  };
  const result = await build({
    entryPoints: [path.join(__dirname, '../components/NativeDriverGoogleMap.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react'],
    plugins: [{ name: 'native-boundary-mocks', setup(b) {
      b.onResolve({ filter: /^(react-native|@googlemaps\/react-native-navigation-sdk|expo-keep-awake|@expo\/vector-icons\/MaterialIcons)$/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (name: string) => name === 'react-native' ? native : name === '@googlemaps/react-native-navigation-sdk' ? sdk : name === 'expo-keep-awake' ? keepAwake
      : name === '@expo/vector-icons/MaterialIcons' ? (props: any) => React.createElement('icon', props) : requireHere(name),
    module, module.exports,
  );
  const Component = module.exports.default;
  let props: any = { ...initial, locationTimestamp: Date.now(), locationAccuracy: 5, heading: 0,
    target: { latitude: destination.lat, longitude: destination.lng, label: 'Drop-off' }, tripStatus: 'dropoff' };
  let tree: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  await act(async () => { tree = create(React.createElement(Component, props)); await flush(); });
  // The map controller arrives after the first effect has been scheduled.
  await act(async () => { await flush(); });
  return {
    polylines, destinationCalls, cameraCalls, listeners,
    backgroundLocationCalls, keepAwakeCalls, polylineRemovals,
    loggingCalls, nativeStamp,
    rendered: () => JSON.stringify(tree!.toJSON()),
    mapProps: () => tree!.root.findByType('map').props,
    surfaceProps: () => tree!.root.findAllByType('view').find(view => view.props.onTouchMove)?.props,
    press: async (label: string) => { await act(async () => {
      tree!.root.findByProps({ accessibilityLabel: label }).props.onPress(); await flush();
    }); },
    locationStarts: () => locationStarts,
    appState: async (state: string) => { await act(async () => { appStateListener?.(state); await flush(); }); },
    setSegments: (v: typeof road) => { segments = v; },
    setCurrentSegments: (v: typeof road | null) => { currentSegments = v; },
    setTraffic: (current: any, complete = current) => { currentTraffic = current; completeTraffic = complete; },
    beforeReadyWrites: () => beforeReadyWrites,
    ready: async () => { mapReady = true; await act(async () => { tree!.root.findByType('map').props.onMapReady?.(); await flush(); }); },
    notReady: () => { mapReady = false; },
    createController: async () => { await act(async () => { controllerCreated?.(controller); await flush(); }); },
    setGeometryWaypoint: (value: typeof destination | null) => { geometryWaypoint = value; },
    setGeometryHandlers: (current: (() => Promise<any>) | null, complete: (() => Promise<any>) | null) => {
      onCurrentSegment = current; onCompleteSegments = complete;
    },
    setCurrentContext: (value: boolean) => { hasCurrentContext = value; },
    emit: async (name: string, value?: any) => { await act(async () => { listeners[name]?.(value); await flush(); }); },
    setDestinationHandler: (handler: (point: any) => Promise<number>) => { onDestination = handler; },
    update: async (update: any) => {
      if (typeof update.locationTimestamp === 'number' && update.locationTimestamp < 1000) {
        update = { ...update, locationTimestamp: Date.now() + update.locationTimestamp };
      }
      props = { ...props, ...update };
      await act(async () => { tree!.update(React.createElement(Component, props)); await flush(); });
    },
    flush: async () => { await act(async () => { await flush(); }); },
    dispose: async () => { await act(async () => { tree!.unmount(); await flush(); }); },
  };
}

for (const manualController of [false, true]) {
  test(`Android joins independent map ready and controller callbacks (${manualController ? 'ready first' : 'controller first'}) without premature route writes`, async () => {
    const map = await mountMap(undefined, 'android', { manualMapReady: true, manualController });
    try {
      assert.equal(map.beforeReadyWrites(), 0, 'SDK controller-created is only a JS handle, not native map readiness');
      map.setTraffic(providerTraffic);
      if (manualController) {
        await map.ready();
        await map.emit('changed');
        assert.equal(map.polylines.size, 0, 'map ready alone does not provide a controller');
        await map.createController();
      } else {
        await map.emit('changed');
        assert.equal(map.beforeReadyWrites(), 0, 'early route callback must not write through an unready native controller');
        await map.ready();
      }
      await map.flush();
      assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points, road, 'accepted real geometry is painted promptly, without waiting for the polling timer');
      assert.equal(trafficLines(map).length, 2, 'real provider congestion survives readiness recovery');
      assert.equal(map.destinationCalls.length, 1, 'map readiness must not issue another destination request');
    } finally { await map.dispose(); }
  });
}

test('Android accepts a real snapped-road endpoint when its native destination waypoint matches the server target', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    const snappedRoad = [origin, corner, { lat: 5.704, lng: -0.098 }];
    map.setSegments(snappedRoad);
    map.setGeometryWaypoint(destination);
    await map.update({ target: { latitude: destination.lat, longitude: destination.lng, label: 'Approved off-road pickup' }, tripStatus: 'pickup' });
    assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points, snappedRoad, 'the SDK road endpoint is not required to be the off-road waypoint');
    assert.notDeepEqual(map.polylines.get('hy3n-driver-route')?.points.at(-1), destination, 'never append a fake straight driving connector');
    map.setGeometryWaypoint({ lat: 5.73, lng: -0.11 });
    await map.update({ target: { latitude: destination.lat, longitude: destination.lng, label: 'Next server pickup' } });
    assert.equal(map.polylines.has('hy3n-driver-route'), false, 'another native waypoint is never accepted for this server target');
  } finally { await map.dispose(); }
});

test('Android rejoins map readiness after GPS removes and remounts the map without resetting a healthy server destination', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    map.notReady();
    await map.update({ latitude: undefined, longitude: undefined });
    map.polylines.clear(); // The destroyed native map no longer has its overlays.
    await map.update({ latitude: origin.lat, longitude: origin.lng });
    await map.emit('changed');
    assert.equal(map.beforeReadyWrites(), 0, 'the previous map readiness cannot authorize writes on a recreated Android map');
    await map.ready();
    assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points, road, 'the ready replacement map promptly recovers the accepted native route');
    assert.equal(map.destinationCalls.length, 1, 'recover the map, do not reset the healthy navigation engine');
  } finally { await map.dispose(); }
});

test('Android retries a route callback preceding readable native geometry without inventing a route or resetting the destination', async () => {
  const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const map = await mountMap(undefined, 'android');
  try {
    map.setSegments([]);
    await map.update({ navigationId: 'new-server-ride' });
    await map.emit('changed');
    assert.equal(map.polylines.size, 0, 'no straight-line fallback when native road geometry is not ready');
    map.setSegments(road);
    map.setTraffic(providerTraffic);
    await act(async () => { await clock.tickAsync(250); });
    await map.flush();
    assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points, road);
    assert.equal(trafficLines(map).length, 2);
    assert.equal(map.destinationCalls.length, 2, 'only the new server ride triggers another destination mutation');
  } finally { await map.dispose(); clock.uninstall(); }
});

test('Android pending native geometry cannot repaint a route after the active server target clears', async () => {
  const map = await mountMap(undefined, 'android');
  let resolveCurrent!: (value: any) => void;
  let resolveComplete!: (value: any) => void;
  try {
    map.setGeometryHandlers(
      () => new Promise(resolve => { resolveCurrent = resolve; }),
      () => new Promise(resolve => { resolveComplete = resolve; }),
    );
    await map.emit('changed');
    await map.update({ target: null, tripStatus: null });
    resolveCurrent({ segmentLatLngList: road, ...map.nativeStamp() });
    resolveComplete([{ segmentLatLngList: road }]);
    await map.flush();
    assert.equal(map.polylines.size, 0, 'late accepted geometry and traffic must stay fenced from an idle map');
  } finally { await map.dispose(); }
});

test('Android ignores stale-target arrival and removes the route only for independently confirmed current arrival', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    await map.emit('arrival', { waypoint: { position: { lat: 5.73, lng: -0.11 } } });
    assert.ok(map.polylines.has('hy3n-driver-route'));
    await map.emit('arrival', { waypoint: { position: destination } });
    assert.ok(map.polylines.has('hy3n-driver-route'), 'correct waypoint but distant GPS cannot clear the route');
    await map.update({ latitude: destination.lat, longitude: destination.lng, locationTimestamp: Date.now(), locationAccuracy: 5 });
    await map.emit('arrival', { waypoint: { position: destination } });
    assert.equal(map.polylines.has('hy3n-driver-route'), false);
    await map.emit('changed');
    assert.equal(map.polylines.has('hy3n-driver-route'), false, 'confirmed display-only arrival remains cleared until the server target changes');
  } finally { await map.dispose(); }
});

for (const platform of ['ios', 'android'] as const) {
  test(`${platform} follows by default, lets Explore map pause GPS camera writes, and recenters explicitly`, async () => {
    const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const map = await mountMap(undefined, platform);
    try {
      assert.ok(map.cameraCalls.length > 0, 'active navigation starts in following mode');
      assert.equal(map.cameraCalls.at(-1).tilt, 45);
      assert.equal(map.cameraCalls.at(-1).zoom, 17.2);
      const followingCalls = map.cameraCalls.length;
      await act(async () => { await clock.tickAsync(150); });
      await map.update({ latitude: 5.701, locationTimestamp: 2 });
      await act(async () => { await clock.tickAsync(250); });
      assert.ok(map.cameraCalls.length > followingCalls, 'subsequent GPS movement advances the following camera');
      await map.press('Explore map');
      const pausedCalls = map.cameraCalls.length;
      await map.update({ latitude: 5.702, locationTimestamp: 3 });
      await act(async () => { await clock.tickAsync(500); });
      assert.equal(map.cameraCalls.length, pausedCalls, 'manual exploration must not snap the viewport back to the car');
      await map.press('Recenter navigation');
      assert.ok(map.cameraCalls.length > pausedCalls, 'recenter immediately restores the latest car view');
      const recenteredCalls = map.cameraCalls.length;
      await act(async () => { await clock.tickAsync(150); });
      await map.update({ latitude: 5.7025, locationTimestamp: 4 });
      await act(async () => { await clock.tickAsync(250); });
      assert.ok(map.cameraCalls.length > recenteredCalls, 'GPS following remains active after recenter');
      assert.equal(map.mapProps().trafficEnabled, true);
      assert.equal(map.mapProps().mapPadding.left, platform === 'android' ? 12 * 3 : 12);
      assert.ok(map.mapProps().mapPadding.top > map.mapProps().mapPadding.bottom, 'turn banner has reserved native map space');
    } finally { await map.dispose(); clock.uninstall(); }
  });
}

test('real Driver component erases the passed road after a new GPS sample', async () => {
  const map = await mountMap();
  try {
    assert.ok(map.polylines.get('hy3n-driver-route'), 'initial route was actually painted');
    await map.update({ latitude: 5.702, locationTimestamp: 2 });
    const points = map.polylines.get('hy3n-driver-route')?.points;
    assert.ok(points?.length >= 2);
    assert.ok(points[0].lat >= 5.7019, 'passed road must no longer begin at original pickup');
    assert.deepEqual(points.at(-1), destination);
  } finally { await map.dispose(); }
});

test('real Driver component does not repaint a disconnected old route while Google reroutes', async () => {
  const map = await mountMap();
  try {
    await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: 2 });
    await map.update({ latitude: 5.7022, longitude: -0.102, locationTimestamp: 3 });
    assert.ok(map.destinationCalls.length >= 2, 'two off-route samples request Google rerouting');
    assert.deepEqual(map.destinationCalls.at(-1).position, destination, 'destination must not change');
    assert.equal(map.polylines.has('hy3n-driver-route'), false, 'old geometry must stay hidden until it reaches current GPS');
  } finally { await map.dispose(); }
});

test('wrong-way movement along the old road still requests rerouting', async () => {
  const map = await mountMap({ latitude: 5.703, longitude: origin.lng });
  try {
    await map.update({ latitude: 5.7028, locationTimestamp: 2 });
    await map.update({ latitude: 5.7024, locationTimestamp: 3 });
    await map.update({ latitude: 5.7020, locationTimestamp: 4 });
    assert.ok(map.destinationCalls.length >= 2, 'distance-to-road alone must not miss reversing along the route');
    assert.deepEqual(map.destinationCalls.at(-1).position, destination);
    assert.equal(map.polylines.has('hy3n-driver-route'), false, 'old forward route must remain hidden during a wrong-way reroute');
  } finally { await map.dispose(); }
});

test('a new road route is recovered even if the native route-changed callback is lost', async () => {
  const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const map = await mountMap();
  try {
    await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: 2 });
    await map.update({ latitude: 5.7022, longitude: -0.102, locationTimestamp: 3 });
    // No listeners.changed() call. The native provider finally supplies a
    // genuine road path from the new GPS point after the quick retries end.
    await act(async () => { await clock.tickAsync(5_000); });
    map.setSegments([{ lat: 5.7022, lng: -0.102 }, { lat: 5.704, lng: -0.102 }, corner, destination]);
    await act(async () => { await clock.tickAsync(3_000); });
    await map.flush();
    const points = map.polylines.get('hy3n-driver-route')?.points;
    assert.deepEqual(points?.[0], { lat: 5.7022, lng: -0.102 });
    assert.deepEqual(points?.at(-1), destination);
    assert.equal(map.destinationCalls.length, 2, 'geometry recovery must not restart navigation repeatedly');
  } finally { await map.dispose(); clock.uninstall(); }
});

test('a pending old reroute cannot override a newly selected server trip target', async () => {
  const map = await mountMap();
  let resolveOld!: (value: number) => void;
  try {
    map.setDestinationHandler(() => new Promise<number>(resolve => { resolveOld = resolve; }));
    await map.update({ latitude: 5.702, longitude: -0.102, locationTimestamp: 2 });
    await map.update({ latitude: 5.7022, longitude: -0.102, locationTimestamp: 3 });
    assert.equal(map.destinationCalls.length, 2);
    const nextDestination = { lat: 5.708, lng: -0.102 };
    await map.update({ target: { latitude: nextDestination.lat, longitude: nextDestination.lng, label: 'Next stop' } });
    assert.equal(map.destinationCalls.length, 2, 'new destination must wait for the prior native mutation');
    map.setDestinationHandler(async () => { map.setSegments([{ lat: 5.7022, lng: -0.102 }, nextDestination]); return 0; });
    resolveOld(0);
    await map.flush();
    assert.equal(map.destinationCalls.length, 3);
    assert.deepEqual(map.destinationCalls.at(-1).position, nextDestination);
    assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points.at(-1), nextDestination);
  } finally { await map.dispose(); }
});

test('old-target geometry returned by Google is never drawn for a new destination', async () => {
  const map = await mountMap();
  try {
    await map.update({ target: { latitude: 5.73, longitude: -0.11, label: 'Next stop' } });
    assert.equal(map.polylines.has('hy3n-driver-route'), false);
    await map.update({ latitude: 5.702, locationTimestamp: 2 });
    assert.equal(map.polylines.has('hy3n-driver-route'), false, 'GPS progress must not resurrect the old target route');
  } finally { await map.dispose(); }
});

test('native path-prefix updates do not erase consecutive wrong-way evidence', async () => {
  const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const map = await mountMap({ latitude: 5.703, longitude: origin.lng });
  try {
    await map.update({ latitude: 5.7028, locationTimestamp: 2 });
    await map.update({ latitude: 5.7024, locationTimestamp: 3 });
    // The actual native leg can shorten its prefix on a progress/traffic read.
    // The road/direction did not change. JSON inequality must not erase the
    // first confirmed wrong-way sample before the next real GPS observation.
    map.setSegments([{ lat: 5.70005, lng: origin.lng }, corner, destination]);
    await act(async () => { await clock.tickAsync(3_000); });
    await map.update({ latitude: 5.7020, locationTimestamp: 4 });
    assert.equal(map.destinationCalls.length, 2, 'native progress refresh must not prevent a wrong-way reroute');
  } finally { await map.dispose(); clock.uninstall(); }
});

test('Google native location continues when Driver is backgrounded, separately from Expo GPS', async () => {
  const map = await mountMap();
  try {
    assert.ok(map.backgroundLocationCalls.includes(true), 'native Google location must explicitly be enabled in the background');
    await map.appState('background');
    assert.notEqual(map.backgroundLocationCalls.at(-1), false, 'switching to Rider must not disable active-trip native tracking');
  } finally { await map.dispose(); }
});

test('returning to Driver explicitly restarts native location and refreshes route geometry', async () => {
  const map = await mountMap();
  try {
    const starts = map.locationStarts();
    await map.appState('background');
    map.setSegments([origin, { lat: 5.7, lng: -0.096 }, destination]);
    await map.appState('active');
    assert.equal(map.locationStarts(), starts + 1, 'a moving Expo car does not establish that Google native location resumed');
    await map.flush();
    assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points[1], { lat: 5.7, lng: -0.096 });
    assert.equal(map.destinationCalls.length, 1, 'foreground recovery must not reset a healthy destination');
  } finally { await map.dispose(); }
});

test('native navigation location is stopped without a target and restarted for the next trip', async () => {
  const map = await mountMap();
  try {
    await map.update({ target: null, tripStatus: null });
    assert.equal(map.backgroundLocationCalls.at(-1), false, 'active-trip native background tracking must not leak into idle state');
    const starts = map.locationStarts();
    await map.update({ target: { latitude: destination.lat, longitude: destination.lng, label: 'Next trip' }, tripStatus: 'dropoff' });
    assert.equal(map.backgroundLocationCalls.at(-1), true);
    assert.equal(map.locationStarts(), starts + 1, 'a reused native session must restart its location provider');
  } finally { await map.dispose(); }
});

test('active Driver navigation keeps the display awake and releases it after the current target clears', async () => {
  const map = await mountMap();
  try {
    assert.deepEqual(map.keepAwakeCalls, ['activate:hy3n-driver-active-navigation']);
    await map.update({ target: null, tripStatus: null });
    assert.deepEqual(map.keepAwakeCalls, [
      'activate:hy3n-driver-active-navigation',
      'deactivate:hy3n-driver-active-navigation',
    ]);
    await map.update({ target: { latitude: destination.lat, longitude: destination.lng, label: 'Next trip' }, tripStatus: 'dropoff' });
    assert.deepEqual(map.keepAwakeCalls.at(-1), 'activate:hy3n-driver-active-navigation');
  } finally { await map.dispose(); }
});

test('native progress-only prefix changes cannot resurrect a quarantined wrong-way route', async () => {
  const clock = requireHere('@sinonjs/fake-timers').install({ now: 100_000, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const map = await mountMap({ latitude: 5.703, longitude: origin.lng });
  try {
    await map.update({ latitude: 5.7028, locationTimestamp: 2 });
    await map.update({ latitude: 5.7024, locationTimestamp: 3 });
    await map.update({ latitude: 5.7020, locationTimestamp: 4 });
    assert.equal(map.polylines.has('hy3n-driver-route'), false);
    map.setSegments([{ lat: 5.70005, lng: origin.lng }, corner, destination]);
    await act(async () => { await clock.tickAsync(3_000); });
    await map.flush();
    assert.equal(map.polylines.has('hy3n-driver-route'), false, 'an old-direction road with a shortened prefix is not a genuine replacement route');
  } finally { await map.dispose(); clock.uninstall(); }
});

const providerTraffic = {
  status: 'OK',
  roadStretchRenderingDataList: [
    { style: 'TRAFFIC_JAM', offsetMeters: 0, lengthMeters: 300 },
    { style: 'SLOWER_TRAFFIC', offsetMeters: 400, lengthMeters: 350 },
  ],
};
const trafficLines = (map: Awaited<ReturnType<typeof mountMap>>) =>
  [...map.polylines.values()].filter(line => line.id.startsWith('hy3n-driver-traffic-'));

test('Android paints actual string provider traffic styles above the blue base and trims passed traffic in place', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    map.setTraffic(providerTraffic);
    await map.emit('traffic');
    assert.equal(map.polylines.get('hy3n-driver-route')?.color, '#387DF3');
    assert.deepEqual(trafficLines(map).map(line => [line.id, line.color]), [
      ['hy3n-driver-traffic-0', '#DC2626'],
      ['hy3n-driver-traffic-1', '#F59E0B'],
    ]);
    for (const line of trafficLines(map)) {
      assert.equal(line.width, 8);
      assert.equal(line.visible, true);
      assert.ok(line.zIndex > map.polylines.get('hy3n-driver-route').zIndex, 'provider congestion is above the blue base');
      assert.ok(line.points.length >= 2);
    }
    assert.deepEqual(trafficLines(map)[0].points[0], origin, 'red geometry uses the provider road, not a speed-derived connector');
    const originalJamEnd = { ...trafficLines(map)[0].points.at(-1) };
    const removals = map.polylineRemovals.length;
    await map.update({ latitude: 5.702, locationTimestamp: 2 });
    const remainingJam = trafficLines(map).find(line => line.color === '#DC2626');
    assert.ok(remainingJam);
    assert.ok(remainingJam.points[0].lat >= 5.7019, 'passed red road is erased with GPS progress');
    assert.deepEqual(remainingJam.points.at(-1), originalJamEnd);
    assert.equal(map.polylineRemovals.length, removals, 'healthy progress updates existing native IDs instead of clearing/recreating lines');
    await map.update({ latitude: 5.7035, locationTimestamp: 3 });
    assert.equal(trafficLines(map).some(line => line.color === '#DC2626'), false, 'a fully passed jam must disappear');
    assert.equal(trafficLines(map).length, 1, 'the unpassed provider slowdown remains');
    assert.equal(trafficLines(map)[0].color, '#F59E0B');
    assert.deepEqual(map.polylines.get('hy3n-driver-route')?.points.at(-1), destination);
    assert.equal(map.destinationCalls.length, 1, 'traffic/progress does not restart routing or alter the server target');
  } finally { await map.dispose(); }
});

test('Android route traffic is measured against the exact selected current or complete native snapshot', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    const currentJam = { status: 'OK', roadStretchRenderingDataList: [{ style: 'TRAFFIC_JAM', offsetMeters: 0, lengthMeters: 150 }] };
    const completeSlowdown = { status: 'OK', roadStretchRenderingDataList: [{ style: 'SLOWER_TRAFFIC', offsetMeters: 0, lengthMeters: 250 }] };
    const currentStart = { lat: 5.701, lng: origin.lng };
    map.setCurrentSegments([currentStart, corner, destination]);
    map.setTraffic(currentJam, completeSlowdown);
    await map.emit('traffic');
    assert.equal(trafficLines(map).length, 1, 'current and complete snapshots must never be concatenated/doubled');
    assert.equal(trafficLines(map)[0].color, '#DC2626');
    assert.deepEqual(trafficLines(map)[0].points[0], currentStart, 'offset zero belongs to the selected current road prefix');
    map.setCurrentSegments([origin, corner]);
    await map.emit('traffic');
    assert.equal(trafficLines(map).length, 1);
    assert.equal(trafficLines(map)[0].color, '#F59E0B', 'a partial current leg selects the complete snapshot and its own traffic');
    assert.deepEqual(trafficLines(map)[0].points[0], origin);
  } finally { await map.dispose(); }
});

test('Android missing provider traffic clears old congestion but preserves the genuine blue road', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    map.setTraffic(providerTraffic);
    await map.emit('traffic');
    assert.equal(trafficLines(map).length, 2);
    map.setTraffic(undefined);
    await map.emit('traffic');
    assert.equal(trafficLines(map).length, 0, 'missing traffic is unknown, not a stale red-road claim');
    assert.ok(map.polylines.has('hy3n-driver-route'));
    assert.equal(map.polylines.get('hy3n-driver-route')?.color, '#387DF3', 'no data does not imply free-flow green');
    assert.ok(map.polylineRemovals.includes('hy3n-driver-traffic-0'));
    assert.ok(map.polylineRemovals.includes('hy3n-driver-traffic-1'));
    assert.equal(map.destinationCalls.length, 1);
  } finally { await map.dispose(); }
});

test('Android clearing the server target removes route traffic and delayed native traffic updates cannot restore it', async () => {
  const map = await mountMap(undefined, 'android');
  try {
    map.setTraffic(providerTraffic);
    await map.emit('traffic');
    assert.equal(trafficLines(map).length, 2);
    await map.update({ target: null, tripStatus: null });
    assert.equal(trafficLines(map).length, 0);
    assert.equal(map.polylines.has('hy3n-driver-route'), false);
    await map.emit('traffic');
    await map.flush();
    assert.equal(trafficLines(map).length, 0, 'obsolete provider geometry cannot paint an idle map');
    assert.equal(map.polylines.has('hy3n-driver-route'), false);
  } finally { await map.dispose(); }
});

test('iOS keeps genuine native traffic enabled without fabricating custom congestion geometry', async () => {
  const map = await mountMap(undefined, 'ios');
  try {
    assert.equal(map.mapProps().trafficEnabled, true);
    assert.equal(trafficLines(map).length, 0);
    // The installed iOS route serializer omits this field. Even an accidental
    // Android-shaped mock field must not imply phone support that does not exist.
    map.setTraffic(providerTraffic);
    await map.emit('traffic');
    await map.update({ latitude: 5.702, locationTimestamp: 2 });
    assert.equal(trafficLines(map).length, 0);
    assert.equal(map.polylines.get('hy3n-driver-route')?.color, '#387DF3');
    assert.equal(map.destinationCalls.length, 1);
  } finally { await map.dispose(); }
});

for (const platform of ['ios', 'android'] as const) {
  test(`${platform} swipe pauses following and route/traffic refresh never silently recenters`, async () => {
    const map = await mountMap(undefined, platform);
    try {
      const start = { nativeEvent: { pageX: 100, pageY: 200, touches: [{}] } };
      const surface = map.surfaceProps();
      assert.ok(surface);
      await act(async () => {
        surface.onTouchStart(start);
        surface.onTouchMove({ nativeEvent: { pageX: 125, pageY: 205, touches: [{}] } });
      });
      const calls = map.cameraCalls.length;
      await map.update({ latitude: 5.701, locationTimestamp: 2 });
      await map.emit('traffic');
      await map.emit('changed');
      assert.equal(map.cameraCalls.length, calls);
      assert.ok(map.rendered().includes('Recenter'));
      await map.press('Recenter navigation');
      assert.ok(map.cameraCalls.length > calls);
    } finally { await map.dispose(); }
  });

  test(`${platform} complete geometry fallback never weakens current native generation matching`, async () => {
    const map = await mountMap(undefined, platform);
    try {
      map.setCurrentSegments([origin, corner]);
      await map.emit('traffic');
      const event = { ...map.nativeStamp(), navState: 1, distanceToCurrentStepMeters: 80,
        currentStep: { maneuver: 6, instruction: 'Turn left onto Native Road', fullRoadName: 'Native Road' } };
      await map.emit('turn', [event]);
      assert.ok(map.rendered().includes('Native Road'), 'a contextual current prefix validates turns even when complete geometry is used');
      await map.emit('turn', [{ ...event, hy3nRouteGeneration: event.hy3nRouteGeneration + 1,
        currentStep: { maneuver: 7, instruction: 'Unbound Turn', fullRoadName: 'Unbound Road' } }]);
      assert.ok(!map.rendered().includes('Unbound Road'));
      map.setCurrentContext(false);
      await map.emit('traffic');
      await map.emit('turn', [event]);
      assert.ok(!map.rendered().includes('Native Road'), 'without current native context, geometry is not turn provenance');
      assert.ok(map.polylines.has('hy3n-driver-route'), 'safe visual geometry may still remain available');
    } finally { await map.dispose(); }
  });

  test(`${platform} the newest malformed turn in a callback batch cannot resurrect an older turn`, async () => {
    const map = await mountMap(undefined, platform);
    try {
      const event = { ...map.nativeStamp(), navState: 1, distanceToCurrentStepMeters: 50,
        currentStep: { maneuver: 7, instruction: 'Older maneuver', fullRoadName: 'Old Road' } };
      await map.emit('turn', [event]);
      assert.ok(map.rendered().includes('Older maneuver'));
      await map.emit('turn', [event, { ...map.nativeStamp(), navState: 'invalid' }]);
      assert.ok(!map.rendered().includes('Older maneuver'));
    } finally { await map.dispose(); }
  });
}
