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

async function mountMap(initial = { latitude: origin.lat, longitude: origin.lng }) {
  let segments = road;
  let onDestination: ((point: any) => Promise<number>) | null = null;
  const polylines = new Map<string, any>();
  const destinationCalls: any[] = [];
  const listeners: Record<string, (() => void) | null> = {};
  const controller = {
    addMarker: async () => ({}), removeMarker: async () => {}, moveCamera: () => {},
    addPolyline: async (line: any) => { polylines.set(line.id, line); return line; },
    removePolyline: async (id: string) => { polylines.delete(id); },
  };
  const navigationController = {
    showTermsAndConditionsDialog: async () => true, init: async () => 0,
    setAudioGuidanceType: () => {}, startUpdatingLocation: () => {},
    startGuidance: async () => {}, stopGuidance: async () => {},
    clearDestinations: async () => {}, cleanup: async () => {},
    getRouteSegments: async () => [{ segmentLatLngList: segments }],
    setDestination: async (point: any) => { destinationCalls.push(point); return onDestination ? onDestination(point) : 0; },
  };
  const useNavigation = () => React.useMemo(() => ({
    navigationController,
    removeAllListeners: () => { Object.keys(listeners).forEach(key => { listeners[key] = null; }); },
    setOnArrival: (cb: any) => { listeners.arrival = cb; },
    setOnRouteChanged: (cb: any) => { listeners.changed = cb; },
    setOnReroutingRequestedByOffRoute: (cb: any) => { listeners.offRoute = cb; },
  }), []);
  const MapView = ({ onMapViewControllerCreated }: any) => {
    React.useEffect(() => { onMapViewControllerCreated(controller); }, [onMapViewControllerCreated]);
    return React.createElement('map');
  };
  const sdk = {
    useNavigation, MapView, NavigationProvider: ({ children }: any) => children,
    AudioGuidance: { VOICE_ALERTS_AND_GUIDANCE: 1, BLUETOOTH_AUDIO: 2 },
    MapColorScheme: { FOLLOW_SYSTEM: 0 }, NavigationSessionStatus: { OK: 0 },
    RouteStatus: { OK: 0 }, TaskRemovedBehavior: { CONTINUE_SERVICE: 0 },
    TravelMode: { DRIVING: 0 },
  };
  const native = {
    View: 'view', Text: 'text', TouchableOpacity: 'button',
    Linking: { openSettings: () => {} }, Platform: { OS: 'ios', select: (v: any) => v.ios },
    StyleSheet: { create: (v: any) => v, absoluteFillObject: {}, absoluteFill: {} },
  };
  const result = await build({
    entryPoints: [path.join(__dirname, '../components/NativeDriverGoogleMap.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react'],
    plugins: [{ name: 'native-boundary-mocks', setup(b) {
      b.onResolve({ filter: /^(react-native|@googlemaps\/react-native-navigation-sdk)$/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (name: string) => name === 'react-native' ? native : name === '@googlemaps/react-native-navigation-sdk' ? sdk : requireHere(name),
    module, module.exports,
  );
  const Component = module.exports.default;
  let props: any = { ...initial, locationTimestamp: 1, locationAccuracy: 5, heading: 0,
    target: { latitude: destination.lat, longitude: destination.lng, label: 'Drop-off' }, tripStatus: 'dropoff' };
  let tree: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  await act(async () => { tree = create(React.createElement(Component, props)); await flush(); });
  // The map controller arrives after the first effect has been scheduled.
  await act(async () => { await flush(); });
  return {
    polylines, destinationCalls, listeners,
    setSegments: (v: typeof road) => { segments = v; },
    setDestinationHandler: (handler: (point: any) => Promise<number>) => { onDestination = handler; },
    update: async (update: any) => {
      props = { ...props, ...update };
      await act(async () => { tree!.update(React.createElement(Component, props)); await flush(); });
    },
    flush: async () => { await act(async () => { await flush(); }); },
    dispose: async () => { await act(async () => { tree!.unmount(); await flush(); }); },
  };
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
