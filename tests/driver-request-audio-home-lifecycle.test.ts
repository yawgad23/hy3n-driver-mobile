import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createDriverRequestAudio, createDriverRequestAudioSession } from '../lib/driver-request-audio';
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

function setup(platform: 'ios' | 'android', session = createDriverRequestAudioSession()) {
  const players: any[] = [];
  const configurationModes: any[] = [];
  const registered = new Set<any>();
  const events: string[] = [];
  const factoryCalls: Array<{ asset: string; options: any }> = [];
  const forceStops: boolean[] = [];
  let configure = async () => {};
  let seek = async () => {};
  let nextPlayerLoaded = true;
  const factory = () => {
    const listeners = new Set<(status: { isLoaded: boolean }) => void>();
    const p = { isLoaded: nextPlayerLoaded, playing: false, nativePlaying: false, muted: true, volume: 0, loop: false, released: false, removes: 0, plays: 0, pauses: 0, seeks: 0,
      play() { assert.equal(this.released, false); this.playing = true; this.nativePlaying = true; this.plays++; },
      pause() { this.playing = false; this.nativePlaying = false; this.pauses++; events.push('pause'); },
      seekTo() { this.seeks++; return seek(); },
      addListener: (_event: string, listener: (status: { isLoaded: boolean }) => void) => { listeners.add(listener); return { remove() { listeners.delete(listener); } }; },
      get listenerCount() { return listeners.size; },
      terminalStops: 0,
      load() { this.isLoaded = true; for (const listener of [...listeners]) listener({ isLoaded: true }); },
      remove() { this.removes++; registered.delete(this); events.push('remove'); },
      release() { this.released = true; this.playing = false; this.nativePlaying = false; registered.delete(this); events.push('release'); } };
    players.push(p); registered.add(p); return p;
  };
  const placeholder = factory();
  registered.delete(placeholder); // The empty React hook is not an owned source.
  const rearmCalls: string[] = [];
  const response = deferred<any>();
  let serverRide: any = null;
  let serverReadError: Error | null = null;
  let serverRead: (() => Promise<any>) | null = null;
  let requests = 0;
  let previousDependencies: any[] | undefined;
  const env: Record<string, any> = {
    Platform: { OS: platform }, AppState: { currentState: 'active' }, requestAudioForeground: true, incomingRide: offer(), incomingTripAlertStatus: { isLoaded: true },
    activeTrip: null, isOnline: true, hasCurrentLocation: true, prefs: { soundAlerts: true }, user: { uid: 'driver-1' }, driverProfile: {},
    tripActionPending: false, tripActionInFlightRef: { current: false },
    acceptedOfferAudioSuppressionRef: { current: null }, incomingOfferReceivedAtRef: { current: Date.now() },
    incomingOfferAudioEligibilityRef: { current: null }, retiredOfferLeaseRef: { current: null },
    createDriverRequestAudio: (options: Parameters<typeof createDriverRequestAudio>[0]) => createDriverRequestAudio({ ...options, session }),
    stopAllDriverRequestAudio: session.stopAll, useRef: (current: any) => ({ current }),
    require(asset: string) { assert.equal(asset, '@/assets/audio/incoming-trip-alert.wav'); return asset; },
    createAudioPlayer(asset: string, options: any) { factoryCalls.push({ asset, options }); return factory(); },
    DRIVER_OFFER_REVIEW_SECONDS: 60, DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS: [],
    COLLECTIONS: { RIDES: 'rides' }, firestoreDB: {
      get: async () => { throw Error('Accept reconciliation must never use a cache-capable read'); },
      getFromServer: async () => { if (serverReadError) throw serverReadError; return serverRead ? serverRead() : serverRide; },
    },
    driverOfferAcceptedByServer, driverOfferExpiryMs, isDriverOfferWithinWindow,
    isUnavailableDriverOfferError, shouldPresentDriverOffer, offerMatchesDriverPreferences,
    buildVehicleFields: () => ({}), Alert: { alert() {} }, refreshAvailableOffers() {},
    shouldPlayIncomingTripAlert,
    setTripActionPending(value: boolean) { env.tripActionPending = value; syncEligibility(); },
    setActiveTrip(value: any) { env.activeTrip = value; syncEligibility(); },
    setIncomingRide(value: any) { env.incomingRide = value; syncEligibility(); },
    setRideOfferSeconds() {},
    incomingTripAlertPlayer: placeholder, useCallback: (callback: any) => callback,
    setAudioModeAsync: async (mode: any) => { configurationModes.push(mode); await configure(); },
    playIncomingTripAlert(id: string) { evaluate(expression('playIncomingTripAlert'), env)(id); },
    respondToOffer: { mutateAsync() {
      requests++; events.push('mutation');
      for (const player of players.slice(1)) assertRetired(player);
      assert.equal(registered.size, 0, 'no owned native request remains registered before the server call');
      assert.equal(placeholder.released, false, 'the empty hook must not be released');
      return response.promise;
    } },
  };
  // Execute Home's actual factory and stop callback; setters update eligibility
  // refs but never render or run an effect, so only the direct Accept stop can
  // satisfy the native assertions at the unresolved server mutation boundary.
  env.incomingTripAudioRuntimeRef = evaluate(expression('incomingTripAudioRuntimeRef'), env);
  const runtime = env.incomingTripAudioRuntimeRef.current as ReturnType<typeof createDriverRequestAudio>;
  env.stopIncomingTripAlert = evaluate(expression('stopIncomingTripAlert'), env);
  const originalStop = runtime.stop;
  runtime.stop = (player, options = {}) => { forceStops.push(options.force === true); originalStop(player, options); };
  const originalRearm = runtime.rearmAfterFailedAccept;
  runtime.rearmAfterFailedAccept = (id: string) => { rearmCalls.push(id); return originalRearm(id); };
  function assertRetired(player: any) {
    assert.equal(player.nativePlaying, false, 'native audio is silent even when JS status was stale');
    assert.equal(player.playing, false);
    assert.equal(player.loop, false, 'loop is disarmed before mutation');
    assert.equal(player.muted, true, 'request player is muted before mutation');
    assert.equal(player.volume, 0, 'request volume is zero before mutation');
    assert.equal(player.removes, 1, 'owned source was removed exactly once');
    assert.equal(player.released, true, 'owned source was released before mutation');
    assert.equal(registered.has(player), false);
    assert.equal(player.listenerCount, 0, 'pending readiness subscription was cancelled');
    assert.ok(player.pauses > 0, 'force pause is required even when JS playing is false');
  }
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
  return { env, players, placeholder, response, accept, effect, runtime, session, rearmCalls, configurationModes, registered, events, factoryCalls, forceStops, assertRetired,
    setServerRide: (ride: any) => { serverRide = ride; }, setServerReadError: (error: Error) => { serverReadError = error; },
    setServerRead: (read: () => Promise<any>) => { serverRead = read; }, requestCount: () => requests,
    setConfigure: (fn: () => Promise<void>) => { configure = fn; }, setSeek: (fn: () => Promise<void>) => { seek = fn; },
    setNextPlayerLoaded: (loaded: boolean) => { nextPlayerLoaded = loaded; },
    nativeResume() { for (const p of registered) if (p.loop && !p.released) p.play(); },
    plays: () => players.reduce((sum, p) => sum + p.plays, 0), playing: () => players.some(p => p.nativePlaying) };
}

for (const platform of ['ios', 'android'] as const) {
  test(`${platform}: actual Accept immediately retires audible native Gold Chime despite stale JS status and unresolved response`, async () => {
    const h = setup(platform); h.effect(); await flush();
    const player = h.players[1];
    assert.equal(player.nativePlaying, true); assert.equal(player.loop, true);
    assert.equal(player.muted, false); assert.equal(player.volume, 1.0);
    assert.deepEqual(h.factoryCalls, [{ asset: '@/assets/audio/incoming-trip-alert.wav', options: { keepAudioSessionActive: false } }]);
    player.playing = false; // Native audio is still audible; no new status/render.
    let completed = false;
    let confirmedAfterStop = false;
    const setActiveTrip = h.env.setActiveTrip;
    h.env.setActiveTrip = (ride: any) => {
      assert.deepEqual(h.forceStops, [true, true], 'confirmation force-stops again before showing the active trip');
      h.assertRetired(player); confirmedAfterStop = true; setActiveTrip(ride);
    };
    const pending = h.accept().then(() => { completed = true; });
    assert.equal(h.requestCount(), 1); h.assertRetired(player);
    assert.deepEqual(h.forceStops, [true], 'Accept directly force-stops without waiting for an effect');
    assert.deepEqual(h.events.slice(-4), ['pause', 'remove', 'release', 'mutation']);
    assert.equal(h.env.acceptedOfferAudioSuppressionRef.current, 'offer-A');
    h.nativeResume(); await flush();
    assert.equal(completed, false, 'server response must still be unresolved');
    assert.equal(h.playing(), false); assert.equal(h.plays(), 1);
    h.response.resolve({ ride: assignedRide() }); await pending;
    assert.equal(confirmedAfterStop, true); h.assertRetired(player); assert.equal(h.placeholder.released, false);
  });

  for (const readiness of ['initial-loading', 'post-seek-loading'] as const) {
    test(`${platform}: actual Accept cancels ${readiness} native readiness before an unresolved server response`, async () => {
      const h = setup(platform);
      if (readiness === 'initial-loading') h.setNextPlayerLoaded(false);
      else h.setSeek(async () => { h.players[1].isLoaded = false; });
      h.effect(); await flush();
      const player = h.players[1];
      assert.equal(player.isLoaded, false); assert.equal(player.listenerCount, 1);
      assert.equal(player.seeks, readiness === 'initial-loading' ? 0 : 1);
      assert.equal(h.plays(), 0, 'fixture must be waiting for native readiness');
      let completed = false;
      const pending = h.accept().then(() => { completed = true; });
      assert.equal(h.requestCount(), 1); h.assertRetired(player);
      assert.deepEqual(h.events.slice(-4), ['pause', 'remove', 'release', 'mutation']);
      // Delayed native loading and queued resume cannot revive the cancelled
      // generation; no effect/render or server resolution is required to stop.
      player.load(); h.nativeResume(); await flush();
      assert.equal(completed, false); assert.equal(h.plays(), 0); assert.equal(h.playing(), false);
      assert.equal(player.listenerCount, 0); assert.equal(h.registered.size, 0);
      h.response.resolve({ ride: assignedRide() }); await pending; h.effect(); await flush();
      h.assertRetired(player); assert.equal(h.plays(), 0); assert.equal(h.placeholder.released, false);
    });
  }

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
    assert.equal(h.players.length, 3, 'native retry creates a fresh owned source');
    assert.equal(h.placeholder.released, false); assert.equal(h.placeholder.removes, 0, 'never release the empty hook');
    assert.equal(h.players[1].released, true); assert.equal(h.players[1].removes, 1);
    assert.equal(h.players[2].released, false);
    assert.equal(h.configurationModes.every(mode => mode.playsInSilentMode && !mode.allowsRecording && !mode.shouldPlayInBackground), true);
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
      assert.equal(h.placeholder.released, false);
      assert.equal(h.players[1].released, true);
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
    else { assert.equal(h.players.length, 3); assert.equal(h.players[1].released, true); assert.equal(h.playing(), true); }
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

test('ios: same eligible offer rearm waits for its fresh owned player readiness and then plays once', async () => {
  const h = setup('ios'); h.effect(); await flush(); const pending = h.accept(); h.effect();
  h.setNextPlayerLoaded(false); h.env.incomingTripAlertStatus = { isLoaded: false };
  h.response.reject(Error('temporary connection failure')); await pending; h.effect(); await flush();
  assert.equal(h.plays(), 1); assert.equal(h.playing(), false);
  h.players[2].load(); await flush();
  assert.equal(h.plays(), 2); assert.equal(h.playing(), true); assert.equal(h.players.length, 3);
  assert.equal(h.players[1].released, true); assert.equal(h.placeholder.released, false);
  h.effect(true); await flush(); assert.equal(h.plays(), 2);
});

function installActualAppStateHandler(env: Record<string, any>) {
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes('let previousAppState = AppState.currentState')) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(callback, 'actual Home AppState handler must exist');
  let listener: ((state: string) => void) | undefined;
  env.AppState.addEventListener = (_event: string, fn: (state: string) => void) => { listener = fn; return { remove() {} }; };
  env.setRequestAudioForeground = (value: boolean) => { env.requestAudioForeground = value; };
  env.shouldRefreshDriverRideOffersOnAppResume = (input: any) => input.nextAppState === 'active' && input.authenticated && input.online && input.hasCurrentLocation;
  evaluate(callback.getText(tree), env)(); assert.ok(listener);
  return (state: string) => { env.AppState.currentState = state; listener!(state); };
}
for (const platform of ['ios', 'android'] as const) {
  for (const inactive of ['inactive', 'background']) {
    test(`${platform}: actual AppState ${inactive} disposes the request immediately before any render`, async () => {
      const h = setup(platform); h.effect(); await flush(); const change = installActualAppStateHandler(h.env);
      change(inactive);
      assert.equal(h.playing(), false); assert.equal(h.players[1].released, true);
      assert.equal(h.players[1].removes, 1); assert.equal(h.placeholder.released, false);
      h.effect(); change('active'); h.effect(); await flush();
      assert.equal(h.plays(), 2); assert.equal(h.players[2].released, false, 'eligible unanswered request resumes with a fresh player');
    });
  }
  test(`${platform}: actual foreground resume cannot re-ring an offer whose lease expired in background`, async () => {
    const h = setup(platform); h.effect(); await flush(); const change = installActualAppStateHandler(h.env);
    change('background'); h.effect(); h.env.incomingRide.driver_offer_expires_at = new Date(Date.now() - 1).toISOString();
    change('active'); h.effect(); await flush();
    assert.equal(h.plays(), 1); assert.equal(h.players.length, 2); assert.equal(h.playing(), false);
  });
  test(`${platform}: actual background/foreground after accepted assignment stays silent`, async () => {
    const h = setup(platform); h.effect(); await flush(); const pending = h.accept();
    h.response.resolve({ ride: assignedRide() }); await pending; h.effect(); await flush();
    const change = installActualAppStateHandler(h.env); change('background'); h.effect(); change('active'); h.effect(); await flush();
    assert.equal(h.plays(), 1); assert.equal(h.playing(), false); assert.equal(h.players[1].released, true);
  });
}

// The existing harness executes actual Home code, not a copied Accept helper.
// Cached reads deliberately return a plausible old offer so the shipped get()
// path fails these cases; only a trusted fresh server read may lift suppression.
for (const stale of [null, { id: 'offer-A', status: 'pending', driver_id: null }]) {
  for (const authority of ['offline', 'cached', 'pending-write'] as const) {
    test(`ios: lost Accept response with ${authority} evidence and cached ${stale ? 'unassigned' : 'missing'} trip stays silent`, async () => {
      const { actualServerTripRead, tripSnapshot } = await import('./helpers/driver-server-trip-read');
      const h = setup('ios'); h.effect(); await flush();
      let cacheReads = 0;
      h.env.firestoreDB.get = async () => { cacheReads++; return stale; };
      const trustedRead = actualServerTripRead(async () => {
        if (authority === 'offline') throw Error('server unavailable');
        return tripSnapshot(stale, { fromCache: authority === 'cached', hasPendingWrites: authority === 'pending-write' });
      });
      h.setServerRead(() => trustedRead('rides', 'offer-A'));
      const pending = h.accept(); h.effect(); await flush();
      h.response.reject(Error('mutation response lost')); await pending; h.effect(); await flush();
      assert.equal(cacheReads, 0, 'never use a cache-capable read to prove non-assignment');
      assert.deepEqual(h.rearmCalls, []);
      assert.equal(h.env.acceptedOfferAudioSuppressionRef.current, 'offer-A');
      assert.equal(h.plays(), 1, 'no fresh native looping player is created after ambiguous acceptance');
      assert.equal(h.playing(), false);
      assert.equal(h.players.length, 2);
    });
  }
}

test('ios: lost Accept response ignores cached unassigned state and uses fresh server assignment', async () => {
  const { actualServerTripRead, tripSnapshot } = await import('./helpers/driver-server-trip-read');
  const h = setup('ios'); h.effect(); await flush();
  let cacheReads = 0;
  h.env.firestoreDB.get = async () => { cacheReads++; return { id: 'offer-A', status: 'pending' }; };
  const trustedRead = actualServerTripRead(async () => tripSnapshot(assignedRide()));
  h.setServerRead(() => trustedRead('rides', 'offer-A'));
  const pending = h.accept(); h.response.reject(Error('mutation response lost')); await pending; h.effect(); await flush();
  assert.equal(cacheReads, 0);
  assert.equal(h.env.activeTrip.id, 'offer-A');
  assert.deepEqual(h.rearmCalls, []);
  assert.equal(h.playing(), false);
});

test('ios: only a fresh server-confirmed unassigned failure can restart the eligible chime', async () => {
  const { actualServerTripRead, tripSnapshot } = await import('./helpers/driver-server-trip-read');
  const h = setup('ios'); h.effect(); await flush();
  h.env.firestoreDB.get = async () => { throw Error('cached read forbidden'); };
  const trustedRead = actualServerTripRead(async () => tripSnapshot({ status: 'pending', driver_id: null }));
  h.setServerRead(() => trustedRead('rides', 'offer-A'));
  const pending = h.accept(); h.effect(); await flush();
  h.response.reject(Error('temporary network failure')); await pending; h.effect(); await flush();
  assert.deepEqual(h.rearmCalls, ['offer-A']);
  assert.equal(h.plays(), 2);
  assert.equal(h.playing(), true);
});

// These exercise the actual Home boundaries with two retained controllers.
// The native players are controlled doubles, not AVFoundation/device proof.
test('ios: successful actual Accept retires BOTH retained Home owners and blocks a stale remounted request', async () => {
  const session = createDriverRequestAudioSession();
  const visible = setup('ios', session), retained = setup('ios', session);
  visible.effect(); retained.effect(); await flush();
  assert.equal(visible.playing(), true); assert.equal(retained.playing(), true);
  // Model native ref.pause inside the scoped hook, not the exported Expo pause.
  retained.players[1].hy3nStopRequestAudio = function () {
    this.terminalStops++; this.pauses++; this.playing = false; this.nativePlaying = false;
  };
  const mutate = visible.env.respondToOffer.mutateAsync;
  visible.env.respondToOffer.mutateAsync = () => {
    retained.assertRetired(retained.players[1]);
    assert.equal(retained.players[1].terminalStops, 1, 'request-specific native stop precedes mutation');
    return mutate();
  };
  const pending = visible.accept();
  visible.assertRetired(visible.players[1]); retained.assertRetired(retained.players[1]);
  visible.response.resolve({ ride: assignedRide() }); await pending;
  assert.equal(visible.env.activeTrip.id, 'offer-A');
  retained.effect(true); await flush(); assert.equal(retained.playing(), false);
  const remounted = setup('ios', session); remounted.effect(); await flush();
  assert.equal(remounted.plays(), 0); assert.equal(remounted.factoryCalls.length, 0);
  assert.equal(visible.placeholder.released, false); assert.equal(retained.placeholder.released, false);
  remounted.env.incomingRide = offer('genuinely-later'); remounted.effect(); await flush();
  assert.equal(remounted.plays(), 1, 'a different later request still uses the Gold Chime');
});

for (const stage of ['configure', 'seek', 'readiness'] as const) {
  test(`ios: successful actual Accept cancels retained Home ${stage} continuation after the trip appears`, async () => {
    const session = createDriverRequestAudioSession();
    const visible = setup('ios', session), retained = setup('ios', session);
    const wait = deferred<void>();
    if (stage === 'configure') retained.setConfigure(() => wait.promise);
    if (stage === 'seek') retained.setSeek(() => wait.promise);
    if (stage === 'readiness') retained.setNextPlayerLoaded(false);
    visible.effect(); retained.effect(); await flush();
    const pending = visible.accept();
    visible.response.resolve({ ride: assignedRide() }); await pending;
    assert.equal(visible.env.activeTrip.id, 'offer-A');
    wait.resolve(); retained.players[1].load(); await flush();
    retained.assertRetired(retained.players[1]);
    assert.equal(retained.plays(), 0); assert.equal(retained.playing(), false);
  });
}

for (const boundary of ['active-trip', 'signed-out'] as const) {
  test(`ios: actual ${boundary} playback effect stops request owners retained by another Home`, async () => {
    const session = createDriverRequestAudioSession();
    const boundaryHome = setup('ios', session), retained = setup('ios', session);
    retained.effect(); await flush(); assert.equal(retained.playing(), true);
    if (boundary === 'active-trip') boundaryHome.env.activeTrip = assignedRide();
    else boundaryHome.env.user = null;
    boundaryHome.effect(); await flush(); retained.assertRetired(retained.players[1]);
    assert.equal(retained.playing(), false); assert.equal(retained.placeholder.released, false);
    const stale = setup('ios', session); stale.effect(); await flush();
    assert.equal(stale.plays(), 0, 'auth/assignment cleanup does not erase accepted suppression');
  });
}

test('ios: restored active trip stops every request owner BEFORE applying the restored trip', async () => {
  const session = createDriverRequestAudioSession();
  const restoring = setup('ios', session), retained = setup('ios', session);
  restoring.effect(); retained.effect(); await flush();
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes('firestoreDB.list(COLLECTIONS.RIDES')) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(callback, 'actual Home restoration effect must exist');
  restoring.env.firestoreDB.list = async () => [assignedRide()];
  restoring.env.setTripStartedAt = () => {};
  restoring.env.setArrivedAt = () => {};
  const setActiveTrip = restoring.env.setActiveTrip;
  restoring.env.setActiveTrip = (ride: any) => {
    restoring.assertRetired(restoring.players[1]); retained.assertRetired(retained.players[1]);
    setActiveTrip(ride);
  };
  evaluate(callback.getText(tree), restoring.env)(); await flush();
  assert.equal(restoring.env.activeTrip.id, 'offer-A');
  assert.equal(restoring.playing(), false); assert.equal(retained.playing(), false);
});
