import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createDriverRequestAudio } from '../lib/driver-request-audio';
import { shouldPlayIncomingTripAlert } from '../lib/incoming-trip-alert';
import { driverOfferAcceptedByServer } from '../lib/driver-offer-lifecycle';

// Execute the actual Home accept handler and playback effect, not source-name
// assertions. Home integration is deliberately owned/applied by the parent.
const source = fs.readFileSync(process.env.DRIVER_REQUEST_AUDIO_HOME_SOURCE || path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
const tree = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) {
  let result: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(result, `Home ${name} must exist`);
  return result.getText(tree);
}
function playbackEffect() {
  let result: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect') {
      const callback = node.arguments[0];
      if (callback?.getText(tree).includes('shouldPlayIncomingTripAlert({')) result = callback;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(result, 'actual Home foreground alert effect must exist');
  return result.getText(tree);
}
function evaluate(code: string, env: Record<string, any>) {
  const js = ts.transpileModule(`const value = ${code};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('env', `with (env) { ${js}; return value; }`)(env);
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup() {
  const players: any[] = [];
  const factory = () => {
    const p = { isLoaded: true, playing: false, muted: true, volume: 0, loop: false, released: false,
      play() { this.playing = true; }, pause() { this.playing = false; }, seekTo: async () => {},
      addListener: () => ({ remove() {} }), remove() {}, release() { this.released = true; } };
    players.push(p); return p;
  };
  const placeholder = factory();
  const runtime = createDriverRequestAudio({ platform: 'android', createPlayer: factory });
  const response = deferred<any>();
  let serverRide: any = null;
  let requests = 0;
  const env: Record<string, any> = {
    Platform: { OS: 'android' }, incomingRide: { id: 'offer-A' }, incomingTripAlertStatus: { isLoaded: true },
    activeTrip: null, isOnline: true, prefs: { soundAlerts: true }, user: { uid: 'driver-1' }, driverProfile: {},
    tripActionPending: false, tripActionInFlightRef: { current: false },
    acceptedOfferAudioSuppressionRef: { current: null }, incomingOfferReceivedAtRef: { current: 123 },
    DRIVER_OFFER_REVIEW_SECONDS: 60, DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS: [],
    COLLECTIONS: { RIDES: 'rides' }, firestoreDB: { get: async () => serverRide }, driverOfferAcceptedByServer,
    buildVehicleFields: () => ({}), Alert: { alert() {} }, refreshAvailableOffers() {},
    shouldPlayIncomingTripAlert, setTripActionPending(value: boolean) { env.tripActionPending = value; },
    setActiveTrip(value: any) { env.activeTrip = value; }, setIncomingRide(value: any) { env.incomingRide = value; },
    setRideOfferSeconds() {}, stopIncomingTripAlert(force = false) { runtime.stop(placeholder, { force }); },
    playIncomingTripAlert(id: string) { void runtime.play(id, placeholder, async () => {}); },
    respondToOffer: { mutateAsync() { requests++; assert.equal(players.every(p => !p.playing), true, 'request audio stops before server mutation'); return response.promise; } },
  };
  const accept = evaluate(expression('handleAcceptRide'), env);
  const effect = evaluate(playbackEffect(), env);
  return { env, players, response, accept, effect, setServerRide: (ride: any) => { serverRide = ride; }, requestCount: () => requests };
}

test('actual Home keeps a refreshed DIFFERENT offer silent while Android acceptance is pending', async () => {
  const h = setup(); h.effect(); await flush();
  const pending = h.accept();
  // The server offer query can refresh to B while A's acceptance response stalls.
  h.env.incomingRide = { id: 'offer-B' }; h.effect(); await flush();
  h.response.resolve({ ride: { id: 'offer-A', status: 'driver_arriving', driver_id: 'driver-1' } });
  assert.equal(h.players.some(p => p.playing), false, 'offer B must not re-arm the request song while accepting A');
  await pending; h.effect(); await flush();
  assert.equal(h.env.activeTrip.id, 'offer-A');
  assert.equal(h.players.some(p => p.playing), false);
});

test('actual Home failed/unassigned Accept re-arms the SAME eligible offer once through the effect', async () => {
  const h = setup(); h.effect(); await flush();
  const pending = h.accept(); h.effect(); await flush();
  assert.equal(h.players.some(p => p.playing), false);
  h.response.reject(Error('temporary connection failure')); await pending;
  assert.equal(h.env.activeTrip, null, 'a failed request cannot invent a server assignment');
  assert.equal(h.env.acceptedOfferAudioSuppressionRef.current, null);
  h.effect(); await flush(); const count = h.players.length;
  assert.equal(h.players.some(p => p.playing), true);
  h.effect(); await flush(); assert.equal(h.players.length, count);
});

test('actual Home reconciled server assignment remains silent and allows a fresh offer after completion', async () => {
  const h = setup(); h.effect(); await flush();
  const pending = h.accept();
  h.setServerRide({ id: 'offer-A', status: 'driver_arriving', driver_id: 'driver-1' });
  h.response.reject(Error('response lost')); await pending; h.effect(); await flush();
  assert.equal(h.env.activeTrip.id, 'offer-A');
  assert.equal(h.players.some(p => p.playing), false);
  h.env.incomingRide = { id: 'queued-B' }; h.env.activeTrip.status = 'in_progress'; h.effect(); await flush();
  assert.equal(h.players.some(p => p.playing), false, 'queued offers stay silent on active trip');
  h.env.activeTrip = null; h.env.incomingRide = { id: 'fresh-C' }; h.effect(); await flush();
  assert.equal(h.players.some(p => p.playing), true);
});

test('actual Home unavailable acceptance retires the offer rather than inventing assignment', async () => {
  const h = setup(); h.effect(); await flush(); const pending = h.accept();
  h.response.reject(Error('ride has expired')); await pending; h.effect(); await flush();
  assert.equal(h.env.activeTrip, null);
  assert.equal(h.env.incomingRide, null);
  assert.equal(h.players.some(p => p.playing), false);
});

test('actual Home auto-accept ref and swipe invoke the same server-authoritative stop-on-tap handler', async () => {
  for (const trigger of ['auto', 'swipe']) {
    const h = setup(); h.effect(); await flush();
    let pending: Promise<void> | undefined;
    h.env.handleAcceptRide = () => { pending = h.accept(); return pending; };
    if (trigger === 'auto') {
      h.env.acceptRideRef = { current: () => {} };
      let assignment: ts.Expression | undefined;
      function visit(node: ts.Node) {
        if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'acceptRideRef.current') assignment = node.right;
        ts.forEachChild(node, visit);
      }
      visit(tree); assert.ok(assignment);
      evaluate(assignment.getText(tree), h.env)();
    } else {
      const memo = expression('offerPanResponder');
      h.env.useMemo = (fn: () => any) => fn();
      h.env.PanResponder = { create: (handlers: any) => handlers };
      h.env.Animated = { event: () => () => {}, spring: () => ({ start() {} }) };
      h.env.offerSwipeX = {}; h.env.handleDeclineRide = () => { throw Error('must not decline'); };
      evaluate(memo, h.env).onPanResponderRelease(null, { dx: 120 });
    }
    assert.equal(h.requestCount(), 1);
    assert.equal(h.players.some(p => p.playing), false);
    h.response.resolve({ ride: { id: 'offer-A', status: 'driver_arriving', driver_id: 'driver-1' } });
    await pending;
  }
});
