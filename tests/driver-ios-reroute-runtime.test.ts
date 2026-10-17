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

async function mountIos(options: { initialNetworkFailure?: boolean } = {}) {
  let route = initialRoad;
  let currentLeg = initialRoad;
  let props: any = { latitude: 5.703, longitude: origin.lng, locationTimestamp: Date.now(), locationAccuracy: 5,
    target: { latitude: target.lat, longitude: target.lng, label: 'Drop-off' }, tripStatus: 'dropoff' };
  const lines = new Map<string, any>();
  const calls: any[] = [];
  const logs: any[] = [];
  const listeners: Record<string, ((value?: any) => void) | null> = {};
  let currentLegReads = 0;
  let shouldFail = Boolean(options.initialNetworkFailure);
  let geometryFails = false;
  let overlayFails = false;
  let newRoadOnRequest: typeof initialRoad | null = null;
  const mapController = {
    addMarker: async () => ({}), removeMarker: async () => {}, moveCamera: async () => {},
    addPolyline: async (line: any) => { if (overlayFails) throw { code: 'NO_VIEW_CONTROLLER' }; lines.set(line.id, line); return line; },
    removePolyline: async (id: string) => { lines.delete(id); },
    getPolylines: async () => [...lines.values()],
  };
  const navigationController = {
    showTermsAndConditionsDialog: async () => true, init: async () => 'ok',
    setAudioGuidanceType: () => {}, startUpdatingLocation: () => {}, stopUpdatingLocation: () => {},
    setBackgroundLocationUpdatesEnabled: () => {}, startGuidance: async () => {}, stopGuidance: async () => {},
    clearDestinations: async () => {}, cleanup: async () => {},
    getRouteSegments: async () => [{ segmentLatLngList: route }],
    getCurrentRouteSegment: async () => { currentLegReads++; if (geometryFails) throw { code: 'route_not_available' }; return { segmentLatLngList: currentLeg }; },
    setDestination: async (point: any) => {
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
  }), []);
  const sdk = { useNavigation,
    MapView: ({ onMapViewControllerCreated }: any) => { React.useEffect(() => onMapViewControllerCreated(mapController), [onMapViewControllerCreated]); return React.createElement('map'); },
    NavigationProvider: ({ children }: any) => children,
    AudioGuidance: { VOICE_ALERTS_AND_GUIDANCE: 1, BLUETOOTH_AUDIO: 2 }, MapColorScheme: { FOLLOW_SYSTEM: 0 },
    NavigationSessionStatus: { OK: 'ok', NETWORK_ERROR: 'networkError', NOT_AUTHORIZED: 'notAuthorized', LOCATION_PERMISSION_MISSING: 'locationPermissionMissing' },
    RouteStatus: { OK: 'OK', NETWORK_ERROR: 'NETWORK_ERROR', LOCATION_UNKNOWN: 'LOCATION_UNKNOWN', LOCATION_DISABLED: 'LOCATION_DISABLED', NO_ROUTE_FOUND: 'NO_ROUTE_FOUND' },
    TaskRemovedBehavior: { CONTINUE_SERVICE: 0 }, TravelMode: { DRIVING: 0 },
  };
  const native = { View: 'view', Text: 'text', TouchableOpacity: 'button',
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    Linking: { openSettings: () => {} }, Platform: { OS: 'ios', select: (v: any) => v.ios },
    StyleSheet: { create: (v: any) => v, absoluteFillObject: {}, absoluteFill: {} } };
  const result = await build({ entryPoints: [path.join(__dirname, '../components/NativeDriverGoogleMap.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    plugins: [{ name: 'actual-ios-boundary', setup(b) { b.onResolve({ filter: /^(react-native|@googlemaps\/react-native-navigation-sdk)$/ }, args => ({ path: args.path, external: true })); } }] });
  const module = { exports: {} as any };
  const capturedConsole = { ...console, info: (...args: any[]) => logs.push(args), warn: (...args: any[]) => logs.push(args) };
  new Function('require', 'module', 'exports', '__DEV__', 'console', result.outputFiles[0].text)(
    (name: string) => name === 'react-native' ? native : name === '@googlemaps/react-native-navigation-sdk' ? sdk : requireHere(name),
    module, module.exports, true, capturedConsole);
  const Component = module.exports.default;
  let tree!: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
  await act(async () => { tree = create(React.createElement(Component, props)); await flush(); });
  await act(async () => { await flush(); });
  return { lines, calls, logs, listeners, currentLegReads: () => currentLegReads,
    rendered: () => JSON.stringify(tree.toJSON()),
    arrival: async (event: any) => { await act(async () => { listeners.arrival?.(event); await flush(); }); },
    routeChanged: async () => { await act(async () => { listeners.changed?.(); await flush(); }); },
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

test('iOS reports current-leg errors and does not silently repaint cached route legs', async () => {
  const map = await mountIos();
  try {
    map.geometryFails(true);
    await act(async () => { map.listeners.changed?.(); await Promise.resolve(); });
    await map.flush();
    assert.equal(map.lines.has('hy3n-driver-route'), false);
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
