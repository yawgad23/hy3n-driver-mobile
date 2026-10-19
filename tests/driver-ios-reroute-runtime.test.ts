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
const target = { lat: 5.704, lng: -0.096 };

/**
 * Exercises the real component module while mocking only the native SDK bridge.
 * It does not claim to emulate a physical iPhone. Its purpose is to prevent a
 * future return to the JavaScript-owned active iPhone green/white polyline.
 */
async function mountIPhoneNavigation() {
  let props: any = {
    latitude: origin.lat,
    longitude: origin.lng,
    locationTimestamp: Date.now(),
    locationAccuracy: 5,
    target: { latitude: target.lat, longitude: target.lng, label: 'Drop-off' },
    tripStatus: 'dropoff',
  };
  const calls: string[] = [];
  const destinations: any[] = [];
  const polylineCalls: any[] = [];
  const markerCalls: any[] = [];
  const listeners: Record<string, ((value?: any) => void) | null> = {};
  const logs: any[] = [];
  let navigationViewMounts = 0;
  let mapViewMounts = 0;
  const navigationViewController = {
    setNavigationUIEnabled: async (enabled: boolean) => { calls.push(`ui:${enabled}`); },
    showRouteOverview: async () => {},
    setFollowingPerspective: async () => {},
  };
  const mapController = {
    addMarker: async (marker: any) => { markerCalls.push(marker); return marker; },
    removeMarker: async () => {},
    moveCamera: async () => {},
    addPolyline: async (line: any) => { polylineCalls.push(line); return line; },
    removePolyline: async () => {},
    getPolylines: async () => [],
  };
  const navigationController = {
    showTermsAndConditionsDialog: async () => true,
    init: async () => 'OK',
    setAudioGuidanceType: () => {},
    startUpdatingLocation: () => { calls.push('location:start'); },
    stopUpdatingLocation: () => { calls.push('location:stop'); },
    setBackgroundLocationUpdatesEnabled: (enabled: boolean) => { calls.push(`background:${enabled}`); },
    startGuidance: async () => { calls.push('guidance:start'); },
    stopGuidance: async () => { calls.push('guidance:stop'); },
    clearDestinations: async () => { calls.push('destination:clear'); },
    cleanup: async () => { calls.push('cleanup'); },
    getRouteSegments: async () => [],
    getCurrentRouteSegment: async () => ({ segmentLatLngList: [] }),
    setDestination: async (point: any) => {
      destinations.push(point);
      calls.push(`destination:${point.title}`);
      return 'OK';
    },
  };
  const useNavigation = () => React.useMemo(() => ({
    navigationController,
    removeAllListeners: () => { Object.keys(listeners).forEach(key => { listeners[key] = null; }); },
    setOnArrival: (callback: any) => { listeners.arrival = callback; },
    setOnRouteChanged: (callback: any) => { listeners.routeChanged = callback; },
    setOnReroutingRequestedByOffRoute: (callback: any) => { listeners.offRoute = callback; },
    setOnLocationChanged: (callback: any) => { listeners.location = callback; },
  }), []);
  const NavigationView = ({ onNavigationViewControllerCreated }: any) => {
    React.useEffect(() => {
      navigationViewMounts += 1;
      onNavigationViewControllerCreated(navigationViewController);
    }, [onNavigationViewControllerCreated]);
    return React.createElement('google-native-navigation-view');
  };
  const MapView = ({ onMapViewControllerCreated }: any) => {
    React.useEffect(() => {
      mapViewMounts += 1;
      onMapViewControllerCreated(mapController);
    }, [onMapViewControllerCreated]);
    return React.createElement('map');
  };
  const sdk = {
    useNavigation,
    NavigationView,
    MapView,
    NavigationProvider: ({ children }: any) => children,
    NavigationUIEnabledPreference: { AUTOMATIC: 0, DISABLED: 1 },
    AudioGuidance: { VOICE_ALERTS_AND_GUIDANCE: 1, BLUETOOTH_AUDIO: 2 },
    MapColorScheme: { FOLLOW_SYSTEM: 0 },
    NavigationSessionStatus: { OK: 'OK', NETWORK_ERROR: 'NETWORK_ERROR', NOT_AUTHORIZED: 'NOT_AUTHORIZED', LOCATION_PERMISSION_MISSING: 'LOCATION_PERMISSION_MISSING' },
    RouteStatus: { OK: 'OK', NETWORK_ERROR: 'NETWORK_ERROR', LOCATION_UNKNOWN: 'LOCATION_UNKNOWN', LOCATION_DISABLED: 'LOCATION_DISABLED', NO_ROUTE_FOUND: 'NO_ROUTE_FOUND' },
    TaskRemovedBehavior: { CONTINUE_SERVICE: 0 },
    TravelMode: { DRIVING: 0 },
  };
  const native = {
    View: 'view', Text: 'text', TouchableOpacity: 'button',
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    Linking: { openSettings: () => {} },
    Platform: { OS: 'ios', select: (value: any) => value.ios },
    StyleSheet: { create: (value: any) => value, absoluteFillObject: {}, absoluteFill: {} },
  };
  const result = await build({
    entryPoints: [path.join(__dirname, '../components/NativeDriverGoogleMap.tsx')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react'],
    plugins: [{ name: 'native-navigation-mock', setup(plugin) {
      plugin.onResolve({ filter: /^(react-native|@googlemaps\/react-native-navigation-sdk|expo-keep-awake)$/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  const module = { exports: {} as any };
  const capturedConsole = { ...console, info: (...args: any[]) => logs.push(args), warn: (...args: any[]) => logs.push(args) };
  new Function('require', 'module', 'exports', '__DEV__', 'console', result.outputFiles[0].text)(
    (name: string) => name === 'react-native' ? native : name === '@googlemaps/react-native-navigation-sdk' ? sdk : name === 'expo-keep-awake' ? { useKeepAwake: () => {} } : requireHere(name),
    module,
    module.exports,
    true,
    capturedConsole,
  );
  const Component = module.exports.default;
  let tree!: ReactTestRenderer;
  const flush = async () => { for (let index = 0; index < 35; index += 1) await Promise.resolve(); };
  await act(async () => { tree = create(React.createElement(Component, props)); await flush(); });
  await act(async () => { await flush(); });
  return {
    calls,
    destinations,
    polylineCalls,
    markerCalls,
    logs,
    navigationViewMounts: () => navigationViewMounts,
    mapViewMounts: () => mapViewMounts,
    rendered: () => JSON.stringify(tree.toJSON()),
    nativeLocation: async (location: any) => { await act(async () => { listeners.location?.(location); await flush(); }); },
    routeChanged: async () => { await act(async () => { listeners.routeChanged?.(); await flush(); }); },
    offRoute: async () => { await act(async () => { listeners.offRoute?.(); await flush(); }); },
    arrival: async (event: any) => { await act(async () => { listeners.arrival?.(event); await flush(); }); },
    update: async (values: any) => {
      props = { ...props, ...values };
      await act(async () => { tree.update(React.createElement(Component, props)); await flush(); });
    },
    dispose: async () => { await act(async () => { tree.unmount(); await flush(); }); },
  };
}

test('iPhone active trip uses Google NavigationView and does not create a HY3N polyline copy', async () => {
  const map = await mountIPhoneNavigation();
  try {
    assert.ok(map.navigationViewMounts() >= 1, 'active iPhone trip mounts the native Google navigation surface');
    assert.equal(map.mapViewMounts(), 0, 'the idle HY3N MapView is not mounted over active iPhone guidance');
    assert.deepEqual(map.destinations.map(item => item.position), [target], 'the first native route uses the unchanged server-owned target');
    assert.ok(map.calls.includes('guidance:start'));
    assert.equal(map.calls.at(-1), 'ui:true', 'Google route UI is enabled only after guidance starts');
    assert.deepEqual(map.polylineCalls, [], 'no green/white JavaScript route may be drawn over Google navigation');
    assert.deepEqual(map.markerCalls, [], 'no second HY3N vehicle marker competes with the native Google navigation vehicle');
  } finally { await map.dispose(); }
});

test('iPhone native route-change and off-route events never reintroduce the stale JavaScript polyline', async () => {
  const map = await mountIPhoneNavigation();
  try {
    await map.nativeLocation({ lat: 5.702, lng: -0.102, time: Date.now() + 1, accuracy: 5, bearing: 180 });
    await map.nativeLocation({ lat: 5.7022, lng: -0.102, time: Date.now() + 2, accuracy: 5, bearing: 180 });
    await map.routeChanged();
    await map.offRoute();

    assert.equal(map.destinations.length, 1, 'the old JavaScript fallback cannot compete with Google native rerouting');
    assert.deepEqual(map.destinations[0].position, target, 'a native reroute callback cannot change the HY3N trip target');
    assert.deepEqual(map.polylineCalls, [], 'old or delayed route geometry is never redrawn through the bridge');
    assert.ok(map.logs.some(row => row[1] === 'route.native-change'));
    assert.ok(!JSON.stringify(map.logs).includes('5.702'), 'diagnostics do not expose precise Driver coordinates');
  } finally { await map.dispose(); }
});

test('iPhone clears the prior Google route before setting a different server-backed trip target', async () => {
  const map = await mountIPhoneNavigation();
  try {
    const nextTarget = { lat: 5.708, lng: -0.102 };
    await map.update({ target: { latitude: nextTarget.lat, longitude: nextTarget.lng, label: 'Next stop' } });

    assert.deepEqual(map.destinations.map(item => item.position), [target, nextTarget]);
    const firstClear = map.calls.lastIndexOf('destination:clear');
    const nextDestination = map.calls.lastIndexOf('destination:Next stop');
    assert.ok(firstClear >= 0 && firstClear < nextDestination, 'the previous native route clears before the new target is set');
    assert.equal(map.calls.at(-1), 'ui:true', 'native Google UI resumes only after the replacement target is accepted');
    assert.deepEqual(map.polylineCalls, []);
  } finally { await map.dispose(); }
});

test('iPhone arrival clears Google native guidance only after the target and fresh GPS agree', async () => {
  const map = await mountIPhoneNavigation();
  try {
    const stopsBeforeDelayedArrival = map.calls.filter((call) => call === 'guidance:stop').length;
    await map.arrival({ waypoint: { position: { lat: 5.699, lng: -0.11 } }, isFinalDestination: true });
    assert.equal(map.calls.filter((call) => call === 'guidance:stop').length, stopsBeforeDelayedArrival,
      'a delayed prior-waypoint callback cannot clear current guidance');

    await map.update({ latitude: target.lat, longitude: target.lng, locationTimestamp: Date.now() + 1, locationAccuracy: 5 });
    await map.arrival({ waypoint: { position: target }, isFinalDestination: true });
    assert.match(map.rendered(), /You have reached this stop/);
    assert.ok(map.calls.includes('ui:false'));
    assert.ok(map.calls.includes('guidance:stop'));
    assert.ok(map.calls.includes('destination:clear'));
    assert.deepEqual(map.polylineCalls, [], 'arrival cannot leave a HY3N route line behind');
  } finally { await map.dispose(); }
});

test('iPhone invalid or stale navigation locations do not mutate the route target or draw a fallback line', async () => {
  const map = await mountIPhoneNavigation();
  try {
    await map.nativeLocation({ lat: 91, lng: -0.1, time: Date.now() + 1, accuracy: 5 });
    await map.nativeLocation({ lat: 5.702, lng: -0.102, time: Date.now() - 60_000, accuracy: 5 });
    assert.equal(map.destinations.length, 1);
    assert.deepEqual(map.destinations[0].position, target);
    assert.deepEqual(map.polylineCalls, []);
    assert.ok(map.logs.some(row => row[1] === 'native.gps'));
  } finally { await map.dispose(); }
});
