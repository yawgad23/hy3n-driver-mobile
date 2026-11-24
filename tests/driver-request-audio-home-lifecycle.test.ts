import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createDriverRequestAudio } from '../lib/driver-request-audio';
import { shouldPlayIncomingTripAlert } from '../lib/incoming-trip-alert';
import { driverOfferAcceptedByServer } from '../lib/driver-offer-lifecycle';
import { driverOfferExpiryMs, isDriverOfferWithinWindow } from '../lib/driver-offer-expiry';
import { driverOfferLeaseKey, isUnavailableDriverOfferError, shouldPresentDriverOffer } from '../lib/driver-offer-lease';
import { offerMatchesDriverPreferences } from '../lib/driver-offer-preferences';

// Execute actual Home handlers/effect/dependencies. Async handlers capture a
// render snapshot; only refs see subsequent renders, as they do in React.
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
function assignment(name: string) {
  let result: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.left.getText(tree) === name) result = node.right;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(result, `Home ${name} assignment must exist`);
  return result.getText(tree);
}
function playbackHook() {
  let result: ts.CallExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect') {
      if (node.arguments[0]?.getText(tree).includes('shouldPlayIncomingTripAlert({')) result = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(result, 'actual Home foreground alert effect must exist');
  return { callback: result.arguments[0].getText(tree), dependencies: result.arguments[1].getText(tree) };
}
function evaluate(code: string, env: Record<string, any>) {
  const js = ts.transpileModule(`const value = ${code};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('env', `with (env) { ${js}; return value; }`)(env);
}
const hook = playbackHook();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const assignedRide = () => ({ id: 'offer-A', status: 'driver_arriving', driver_id: 'driver-1' });
function offer(id = 'offer-A', expiresAt = Date.now() + 60_000) { return { id, driver_offer_expires_at: new Date(expiresAt).toISOString(), distance_km: 20 }; }

function setup(platform: 'ios' | 'android') {
  const players: any[] = [];
  const configurationModes: any[] = [];
  let configure = async () => {};
  let seek = async () => {};
  const factory = () => {
    const p = { isLoaded: true, playing: false, muted: true, volume: 0, loop: false, released: false, removes: 0, plays: 0,
      play() { this.playing = true; this.plays++; }, pause() { this.playing = false; }, seekTo: () => seek(),
      addListener: () => ({ remove() {} }), remove() { this.removes++; }, release() { this.released = true; } };
    players.push(p); return p;
  };
  const placeholder = factory();
  const runtime = createDriverRequestAudio({ platform, createPlayer: factory });
  const rearmCalls: string[] = [];
  const originalRearm = runtime.rearmAfterFailedAccept;
  runtime.rearmAfterFailedAccept = (id: string) => { rearmCalls.push(id); return originalRearm(id); };
  const response = deferred<any>();
  let serverRide: any = null;
  let serverReadError: Error | null = null;
  let serverRead: (() => Promise<any>) | null = null;
  let requests = 0;
  let previousDependencies: any[] | undefined;
  const env: Record<string, any> = {
    Platform: { OS: platform }, incomingRide: offer(), incomingTripAlertStatus: { isLoaded: true },
    activeTrip: null, isOnline: true, hasCurrentLocation: true, prefs: { soundAlerts: true }, user: { uid: 'driver-1' }, driverProfile: {},
    tripActionPending: false, tripActionInFlightRef: { current: false },
    acceptedOfferAudioSuppressionRef: { current: null }, incomingOfferReceivedAtRef: { current: Date.now() },
    incomingOfferAudioEligibilityRef: { current: null }, retiredOfferLeaseRef: { current: null },
    incomingTripAudioRuntimeRef: { current: runtime },
    DRIVER_OFFER_REVIEW_SECONDS: 60, DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS: [],
    COLLECTIONS: { RIDES: 'rides' }, firestoreDB: { get: async () => { if (serverReadError) throw serverReadError; return serverRead ? serverRead() : serverRide; } },
    driverOfferAcceptedByServer, driverOfferExpiryMs, isDriverOfferWithinWindow,
    isUnavailableDriverOfferError, shouldPresentDriverOffer, offerMatchesDriverPreferences,
    buildVehicleFields: () => ({}), Alert: { alert() {} }, refreshAvailableOffers() {},
    shouldPlayIncomingTripAlert,
    setTripActionPending(value: boolean) { env.tripActionPending = value; syncEligibility(); },
    setActiveTrip(value: any) { env.activeTrip = value; syncEligibility(); },
    setIncomingRide(value: any) { env.incomingRide = value; syncEligibility(); },
    setRideOfferSeconds() {}, stopIncomingTripAlert(force = false) { runtime.stop(placeholder, { force }); },
    playIncomingTripAlert(id: string) { void runtime.play(id, placeholder, async (mode) => { configurationModes.push(mode); await configure(); }); },
    respondToOffer: { mutateAsync() { requests++; assert.equal(players.every(p => !p.playing), true, 'request audio stops before server mutation'); return response.promise; } },
  };
  function syncEligibility() {
    env.incomingOfferAudioEligibilityRef.current = evaluate(assignment('incomingOfferAudioEligibilityRef.current'), { ...env });
  }
  function effect(force = false) {
    syncEligibility();
    const snapshot = { ...env };
    const dependencies = evaluate(hook.dependencies, snapshot) as any[];
    if (force || !previousDependencies || dependencies.some((value, i) => !Object.is(value, previousDependencies![i]))) {
      previousDependencies = dependencies;
      evaluate(hook.callback, snapshot)();
    }
  }
  const accept = () => { syncEligibility(); return evaluate(expression('handleAcceptRide'), { ...env })() as Promise<void>; };
  return { env, players, placeholder, response, accept, effect, runtime, rearmCalls, configurationModes,
    setServerRide: (ride: any) => { serverRide = ride; }, setServerReadError: (error: Error) => { serverReadError = error; },
    setServerRead: (read: () => Promise<any>) => { serverRead = read; }, requestCount: () => requests,
    setConfigure: (fn: () => Promise<void>) => { configure = fn; }, setSeek: (fn: () => Promise<void>) => { seek = fn; },
    plays: () => players.reduce((sum, p) => sum + p.plays, 0), playing: () => players.some(p => p.playing) };
}

for (const platform of ['ios', 'android'] as const) {
  test(`${platform}: actual Home keeps refreshed DIFFERENT offer B silent while accepting A`, async () => {
    const h = setup(platform); h.effect(); await flush(); assert.equal(h.plays(), 1);
    const pending = h.accept();
    h.env.incomingRide = offer('offer-B'); h.effect(); await flush();
    assert.equal(h.playing(), false, 'B cannot re-arm while A acceptance stalls');
    assert.equal(h.plays(), 1);
    h.response.resolve({ ride: assignedRide() }); await pending; h.effect(); await flush();
    assert.equal(h.env.activeTrip.id, 'offer-A'); assert.equal(h.playing(), false);
  });

  test(`${platform}: actual pending dependency cancels a different eligible offer without another state change`, async () => {
    const h = setup(platform); h.effect(); await flush();
    h.env.acceptedOfferAudioSuppressionRef.current = 'other-offer';
    h.env.tripActionPending = true; h.effect(); await flush();
    assert.equal(h.playing(), false, 'tripActionPending must independently rerun the actual effect');
  });

  test(`${platform}: genuine failed/unassigned Accept replays SAME eligible offer exactly once`, async () => {
    const h = setup(platform); h.effect(); await flush();
    const pending = h.accept(); h.effect(); await flush(); assert.equal(h.playing(), false);
    h.response.reject(Error('temporary connection failure')); await pending;
    assert.equal(h.env.activeTrip, null); assert.equal(h.env.acceptedOfferAudioSuppressionRef.current, null);
    assert.deepEqual(h.rearmCalls, platform === 'ios' ? ['offer-A'] : []);
    h.effect(); await flush(); assert.equal(h.playing(), true); assert.equal(h.plays(), 2);
    h.effect(true); await flush(); assert.equal(h.plays(), 2, 'duplicate effect cannot replay twice');
    if (platform === 'ios') {
      assert.equal(h.players.length, 1, 'iOS must keep its hook-owned WAV player');
      assert.equal(h.placeholder.released, false); assert.equal(h.placeholder.removes, 0);
      assert.equal(h.configurationModes.every(mode => mode.playsInSilentMode && !mode.allowsRecording && !mode.shouldPlayInBackground), true);
    } else {
      assert.equal(h.players.length, 3); assert.equal(h.players[1].released, true);
      assert.equal(h.players[2].released, false);
    }
  });

  test(`${platform}: reconciled assignment stays silent and fresh later offer plays after completion`, async () => {
    const h = setup(platform); h.effect(); await flush(); const pending = h.accept();
    h.setServerRide(assignedRide()); h.response.reject(Error('response lost')); await pending; h.effect(); await flush();
    assert.equal(h.env.activeTrip.id, 'offer-A'); assert.equal(h.playing(), false); assert.deepEqual(h.rearmCalls, []);
    h.env.incomingRide = offer('queued-B'); h.env.activeTrip = { ...h.env.activeTrip, status: 'in_progress' }; h.effect(); await flush();
    assert.equal(h.playing(), false, 'queued offers stay silent');
    h.env.activeTrip = null; h.env.incomingRide = offer('fresh-C'); h.effect(); await flush();
    assert.equal(h.playing(), true); assert.equal(h.plays(), 2);
  });

  test(`${platform}: successful assignment never rearms the accepted request`, async () => {
    const h = setup(platform); h.effect(); await flush(); const pending = h.accept();
    h.response.resolve({ ride: assignedRide() }); await pending; h.effect(); await flush();
    assert.equal(h.playing(), false); assert.deepEqual(h.rearmCalls, []);
    h.env.activeTrip = null; h.env.incomingRide = offer('offer-A'); h.effect(); await flush();
    assert.equal(h.playing(), false, 'accepted offer remains suppressed even after an old query returns');
    h.env.incomingRide = offer('later-B'); h.effect(); await flush(); assert.equal(h.playing(), true);
  });

  for (const message of ['ride has expired', 'ride no longer available', 'ride has already been accepted']) {
    test(`${platform}: unavailable Accept (${message}) stays silent without inventing assignment`, async () => {
      const h = setup(platform); h.effect(); await flush(); const pending = h.accept();
      h.response.reject(Error(message)); await pending; h.effect(); await flush();
      assert.equal(h.env.activeTrip, null); assert.equal(h.env.incomingRide, null);
      assert.equal(h.playing(), false); assert.deepEqual(h.rearmCalls, []);
    });
  }

  for (const trigger of ['auto', 'swipe']) {
    test(`${platform}: actual ${trigger} invokes server-authoritative stop-on-tap Accept`, async () => {
      const h = setup(platform); h.effect(); await flush();
      let pending: Promise<void> | undefined;
      h.env.handleAcceptRide = () => { pending = h.accept(); return pending; };
      if (trigger === 'auto') {
        h.env.acceptRideRef = { current: () => {} };
        evaluate(assignment('acceptRideRef.current'), h.env)();
      } else {
        h.env.useMemo = (fn: () => any) => fn(); h.env.PanResponder = { create: (handlers: any) => handlers };
        h.env.Animated = { event: () => () => {}, spring: () => ({ start() {} }) };
        h.env.offerSwipeX = {}; h.env.handleDeclineRide = () => { throw Error('must not decline'); };
        evaluate(expression('offerPanResponder'), h.env).onPanResponderRelease(null, { dx: 120 });
      }
      assert.equal(h.requestCount(), 1); assert.equal(h.playing(), false);
      h.response.resolve({ ride: assignedRide() }); await pending;
    });
  }

  for (const stage of ['configure', 'seek'] as const) {
    test(`${platform}: actual Accept during async ${stage} prevents stale late playback`, async () => {
      const h = setup(platform); const wait = deferred<void>();
      if (stage === 'configure') h.setConfigure(() => wait.promise); else h.setSeek(() => wait.promise);
      h.effect(); await flush(); const pending = h.accept(); h.effect();
      wait.resolve(); await flush(); assert.equal(h.plays(), 0); assert.equal(h.playing(), false);
      if (platform === 'ios') { assert.equal(h.players.length, 1); assert.equal(h.placeholder.released, false); }
      else assert.equal(h.players[1].released, true);
      h.response.resolve({ ride: assignedRide() }); await pending; h.effect(); await flush(); assert.equal(h.plays(), 0);
    });
  }
}

const iOSGuards: Array<[string, (h: ReturnType<typeof setup>) => void]> = [
  ['current offer expired while response was pending', h => { h.env.incomingRide = offer('offer-A', Date.now() - 1); }],
  ['offer was removed by expiry cleanup', h => { h.env.incomingRide = null; }],
  ['offer changed to B in a later render', h => { h.env.incomingRide = offer('offer-B'); }],
  ['driver went offline', h => { h.env.isOnline = false; }],
  ['sound preference was disabled', h => { h.env.prefs = { soundAlerts: false }; }],
  ['driver no longer has usable location', h => { h.env.hasCurrentLocation = false; }],
  ['driver changed preferences and current offer is excluded', h => { h.env.prefs = { soundAlerts: true, longTripsOnly: true }; h.env.incomingRide = { ...h.env.incomingRide, distance_km: 2 }; }],
  ['lease was retired', h => { h.env.retiredOfferLeaseRef.current = driverOfferLeaseKey(h.env.incomingRide); }],
  ['another server trip is active', h => { h.env.activeTrip = { id: 'another-trip' }; }],
  ['authenticated driver changed', h => { h.env.user = { uid: 'driver-2' }; }],
  ['fallback local window elapsed despite accept clearing receipt ref', h => { delete h.env.incomingRide.driver_offer_expires_at; h.env.incomingOfferReceivedAtRef.current = Date.now() - 60_001; }],
];
for (const [reason, change] of iOSGuards) {
  test(`ios: failed Accept does not rearm when ${reason}`, async () => {
    const h = setup('ios'); h.effect(); await flush();
    // The fallback receipt must be captured before Accept nulls that ref.
    if (reason.startsWith('fallback')) change(h);
    const pending = h.accept(); h.effect(); await flush();
    if (!reason.startsWith('fallback')) change(h);
    h.effect(); await flush();
    h.response.reject(Error('temporary connection failure')); await pending; h.effect(); await flush();
    assert.deepEqual(h.rearmCalls, []); assert.equal(h.plays(), reason.includes('changed to B') ? 2 : 1);
    assert.equal(h.env.acceptedOfferAudioSuppressionRef.current, 'offer-A');
    // A fresh B may play after pending clears; none of these paths may replay A.
    if (!reason.includes('changed to B')) assert.equal(h.playing(), false);
    else { assert.equal(h.players.length, 1); assert.equal(h.playing(), true); }
  });
}

test('ios: unreadable server reconciliation is not a genuinely confirmed unassigned failure', async () => {
  const h = setup('ios'); h.effect(); await flush(); const pending = h.accept(); h.effect();
  h.setServerReadError(Error('Firestore unavailable')); h.response.reject(Error('mutation response lost'));
  await pending; h.effect(); await flush();
  assert.deepEqual(h.rearmCalls, []); assert.equal(h.playing(), false); assert.equal(h.plays(), 1);
});

test('ios: late failure cannot rearm after another reconciliation already confirmed assignment', async () => {
  const h = setup('ios'); h.effect(); await flush();
  h.env.DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS = [0];
  const finalRead = deferred<any>(); let reads = 0;
  h.setServerRead(async () => ++reads === 1 ? assignedRide() : finalRead.promise);
  const pending = h.accept(); h.response.reject(Error('response lost'));
  await new Promise(resolve => setTimeout(resolve, 10)); await flush();
  assert.equal(h.env.activeTrip.id, 'offer-A');
  finalRead.resolve(null); await pending; h.effect(); await flush();
  assert.deepEqual(h.rearmCalls, []); assert.equal(h.playing(), false);
});

test('ios: same eligible offer rearm waits for hook readiness and then plays once', async () => {
  const h = setup('ios'); h.effect(); await flush(); const pending = h.accept(); h.effect();
  h.placeholder.isLoaded = false; h.env.incomingTripAlertStatus = { isLoaded: false };
  h.response.reject(Error('temporary connection failure')); await pending; h.effect(); await flush();
  assert.equal(h.plays(), 1); assert.equal(h.playing(), false);
  h.placeholder.isLoaded = true; h.env.incomingTripAlertStatus = { isLoaded: true }; h.effect(); await flush();
  assert.equal(h.plays(), 2); assert.equal(h.playing(), true); assert.equal(h.players.length, 1);
  h.effect(true); await flush(); assert.equal(h.plays(), 2);
});
