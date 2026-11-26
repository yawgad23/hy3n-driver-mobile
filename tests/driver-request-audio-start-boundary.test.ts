import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createDriverRequestAudio, DRIVER_REQUEST_AUDIO_MODE } from '../lib/driver-request-audio';
import { INCOMING_TRIP_ALERT_PLAYBACK } from '../lib/incoming-trip-alert';

// Execute Home's actual handlers, stop callback, and native player factory.
// Setters record state but NEVER invoke a React render or playback effect: a
// terminal Start boundary must stop the native request source synchronously.
const source = fs.readFileSync(
  process.env.DRIVER_REQUEST_AUDIO_HOME_SOURCE || path.join(__dirname, '../app/(tabs)/home.tsx'),
  'utf8',
);
const tree = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) {
  let result: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, `actual Home ${name} initializer must exist`);
  return result.getText(tree);
}
function evaluate(code: string, env: Record<string, any>) {
  const js = ts.transpileModule(`const value = ${code};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('env', `with (env) { ${js}; return value; }`)(env);
}
const expressions = Object.fromEntries([
  'incomingTripAudioRuntimeRef', 'stopIncomingTripAlert', 'beginTrip',
  'handleStartTrip', 'handleVerifyPickupCode',
].map(name => [name, expression(name)]));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Handler = 'beginTrip' | 'handleStartTrip' | 'handleVerifyPickupCode';
type Platform = 'ios' | 'android';
const WAV = '@/assets/audio/incoming-trip-alert.wav';
const arrivedRide = () => ({
  id: 'trip-A', status: 'driver_arrived', pickup_code: '1234', pickup_verified_at: null,
});
const startedRide = () => ({
  ...arrivedRide(), status: 'in_progress', pickup_verified_at: '2026-11-26T13:00:00.000Z',
  trip_started_at: '2026-11-26T13:00:01.000Z',
});

function setup(platform: Platform) {
  const events: string[] = [];
  const registered = new Set<NativePlayer>();
  const players: NativePlayer[] = [];
  const factoryCalls: Array<{ asset: string; options: any }> = [];
  let seek = async (_seconds: number) => {};
  let configure = async (_mode: typeof DRIVER_REQUEST_AUDIO_MODE) => {};
  class NativePlayer {
    isLoaded = true;
    // Deliberately separate stale Expo JS status from continuous native audio.
    playing = false;
    nativePlaying = false;
    muted = true;
    volume = 0;
    loop = false;
    removed = false;
    released = false;
    plays = 0;
    pauses = 0;
    seekCalls: number[] = [];
    listeners = new Set<(status: { isLoaded: boolean }) => void>();
    constructor(readonly name: string) { registered.add(this); }
    play() {
      assert.equal(this.released, false, 'retired player must not be played');
      this.playing = true; this.nativePlaying = true; this.plays++;
      events.push(`${this.name}:play`);
    }
    pause() {
      this.pauses++; this.playing = false; this.nativePlaying = false;
      events.push(`${this.name}:pause`);
    }
    seekTo(seconds: number) { this.seekCalls.push(seconds); return seek(seconds); }
    addListener(_event: string, listener: (status: { isLoaded: boolean }) => void) {
      this.listeners.add(listener);
      return { remove: () => { this.listeners.delete(listener); } };
    }
    remove() { this.removed = true; registered.delete(this); events.push(`${this.name}:remove`); }
    release() {
      this.released = true; this.playing = false; this.nativePlaying = false;
      events.push(`${this.name}:release`);
    }
  }
  const placeholder = new NativePlayer('placeholder');
  const modes: Array<typeof DRIVER_REQUEST_AUDIO_MODE> = [];
  const stopCalls: boolean[] = [];
  const startResponse = deferred<any>();
  const verifyResponse = deferred<any>();
  const requests: Array<{ mutation: 'startTrip' | 'verifyAndStart'; payload: any }> = [];
  const boundaries: Array<{ name: string; stopCount: number; states: ReturnType<typeof states> }> = [];
  function states() {
    return players.map(p => ({
      nativePlaying: p.nativePlaying, playing: p.playing, muted: p.muted,
      volume: p.volume, loop: p.loop, removed: p.removed, released: p.released,
      registered: registered.has(p), pauses: p.pauses,
    }));
  }
  function boundary(name: string) {
    events.push(name);
    boundaries.push({ name, stopCount: stopCalls.length, states: states() });
  }
  const env: Record<string, any> = {
    Platform: { OS: platform }, activeTrip: arrivedRide(), user: { uid: 'driver-1' },
    pickupCode: ' 1234 ', showOtp: false, tripActionPending: false,
    tripActionInFlightRef: { current: false },
    location: { coords: { latitude: 5.6037, longitude: -0.187 }, timestamp: 1_000 },
    tripStartedAt: null, tripDistanceKm: 2.5, arrivedAt: 'arrival-time',
    lastTripLocationRef: { current: null }, lastTripMeterPublishedAtRef: { current: 42 },
    incomingTripAlertPlayer: placeholder,
    createDriverRequestAudio,
    require(asset: string) { assert.equal(asset, WAV, 'request player must use the SAME bundled WAV'); return asset; },
    createAudioPlayer(asset: string, options: any) {
      factoryCalls.push({ asset, options });
      const p = new NativePlayer(`request-${players.length + 1}`); players.push(p); return p;
    },
    useRef: (current: any) => ({ current }), useCallback: (callback: any) => callback,
    setTripActionPending(value: boolean) {
      if (value) boundary('pending:true');
      else events.push('pending:false');
      env.tripActionPending = value;
    },
    setShowOtp(value: boolean) {
      if (value) boundary('otp:open');
      else events.push('otp:close');
      env.showOtp = value;
    },
    setPickupCode(value: string) { env.pickupCode = value; },
    setActiveTrip(value: any) { env.activeTrip = value; events.push('activeTrip:update'); },
    setTripStartedAt(value: string) { env.tripStartedAt = value; },
    setTripDistanceKm(value: number) { env.tripDistanceKm = value; },
    setArrivedAt(value: string | null) { env.arrivedAt = value; },
    alerts: [] as any[], Alert: { alert(...args: any[]) { env.alerts.push(args); } },
    startTrip: { mutateAsync(payload: any) {
      boundary('mutation:startTrip'); requests.push({ mutation: 'startTrip', payload });
      return startResponse.promise;
    } },
    verifyAndStart: { mutateAsync(payload: any) {
      boundary('mutation:verifyAndStart'); requests.push({ mutation: 'verifyAndStart', payload });
      return verifyResponse.promise;
    } },
  };
  // This executes Home's factory wiring, rather than a test-only replacement
  // factory, including its platform and unchanged WAV/session options.
  env.incomingTripAudioRuntimeRef = evaluate(expressions.incomingTripAudioRuntimeRef, env);
  const runtime = env.incomingTripAudioRuntimeRef.current as ReturnType<typeof createDriverRequestAudio>;
  const realStop = runtime.stop;
  runtime.stop = (player, options = {}) => {
    stopCalls.push(options.force === true); events.push(`stop:${options.force === true}`);
    realStop(player, options); events.push('stop:complete');
  };
  env.stopIncomingTripAlert = evaluate(expressions.stopIncomingTripAlert, env);
  // Each invocation captures a render snapshot. Mutating a setter does not
  // refresh closures, but the in-flight ref remains shared, exactly as in Home.
  function invoke(handler: Handler, ...args: any[]): Promise<void> {
    const snapshot = { ...env };
    const actualBegin = evaluate(expressions.beginTrip, snapshot);
    snapshot.beginTrip = (...beginArgs: any[]) => {
      boundary('beginTrip:enter'); return actualBegin(...beginArgs);
    };
    return evaluate(expressions[handler], snapshot)(...args);
  }
  function assertStoppedAt(name: string) {
    const matches = boundaries.filter(b => b.name === name);
    assert.ok(matches.length, `actual Home must reach ${name}`);
    for (const b of matches) {
      assert.ok(b.stopCount > 0, `${platform}: force-stop must precede ${name}, without a React effect`);
      assert.equal(b.states.length, 1, `${platform}: controller must own one native WAV request player`);
      for (const state of b.states) {
        assert.equal(state.nativePlaying, false, `${name}: continuous native request audio must already be silent`);
        assert.equal(state.playing, false, `${name}: request player must not be playing`);
        assert.equal(state.muted, true, `${name}: request player must already be muted`);
        assert.equal(state.volume, 0, `${name}: request volume must already be zero`);
        assert.equal(state.loop, false, `${name}: looping request must already be disarmed`);
        assert.equal(state.removed, true, `${name}: request player must already be unregistered`);
        assert.equal(state.released, true, `${name}: request player must already be retired`);
        assert.equal(state.registered, false, `${name}: native auto-resume ownership must already be gone`);
        assert.ok(state.pauses > 0, `${name}: force-stop must pause despite stale JS playing=false`);
      }
    }
    assert.equal(stopCalls.every(force => force), true, 'Start boundaries must use force:true');
    assert.ok(events.indexOf('stop:complete') < events.indexOf(name), `native retirement must complete before ${name}`);
  }
  async function playRequest() {
    return runtime.play('stale-offer-A', placeholder, async mode => { modes.push(mode); await configure(mode); });
  }
  function staleNativePlayback() {
    assert.equal(players.length, 1, `${platform}: native factory ownership change has not landed`);
    const p = players[0];
    assert.equal(p.nativePlaying, true, 'fixture starts with a continuously playing native request');
    p.playing = false; // Expo's last JS status is stale, native audio is NOT paused.
    assert.equal(p.muted, false); assert.equal(p.volume, 0.92); assert.equal(p.loop, true);
  }
  function nativeResume() {
    // A queued iOS loop completion or Android lifecycle/focus callback can only
    // resume registered, live sources. A retired request never participates.
    for (const p of registered) if (p.loop && !p.released) p.play();
  }
  return {
    env, runtime, players, placeholder, modes, factoryCalls, events, boundaries, stopCalls,
    requests, startResponse, verifyResponse, invoke, assertStoppedAt, playRequest,
    staleNativePlayback, nativeResume,
    setConfigure: (fn: typeof configure) => { configure = fn; },
    setSeek: (fn: typeof seek) => { seek = fn; },
    playing: () => players.some(p => p.nativePlaying),
    plays: () => players.reduce((sum, p) => sum + p.plays, 0),
  };
}

for (const platform of ['ios', 'android'] as const) {
  test(`${platform}: Home native request factory preserves the same WAV and foreground playback policy`, async () => {
    const h = setup(platform);
    assert.equal(await h.playRequest(), true);
    assert.equal(h.factoryCalls.length, 1, 'iOS and Android must both use the real native request factory');
    assert.equal(h.factoryCalls[0].asset, WAV);
    assert.deepEqual(h.factoryCalls[0].options, { keepAudioSessionActive: false });
    assert.deepEqual(INCOMING_TRIP_ALERT_PLAYBACK, { loop: true, volume: 0.92 });
    assert.equal(h.modes.length, 1);
    assert.deepEqual(h.modes[0], {
      playsInSilentMode: true, interruptionMode: 'duckOthers', allowsRecording: false,
      shouldPlayInBackground: false, shouldRouteThroughEarpiece: false,
    });
    assert.equal(h.players[0].volume, 0.92); assert.equal(h.players[0].loop, true);
    assert.deepEqual(h.players[0].seekCalls, [0]);
    h.runtime.stop(h.placeholder, { force: true });
    assert.equal(h.playing(), false);
  });

  test(`${platform}: valid Start tap retires stale native request BEFORE OTP opens, without rendering`, async () => {
    const h = setup(platform); assert.equal(await h.playRequest(), true); h.staleNativePlayback();
    await h.invoke('handleStartTrip');
    h.assertStoppedAt('otp:open');
    assert.equal(h.env.showOtp, true); assert.equal(h.requests.length, 0);
    assert.equal(h.boundaries.some(b => b.name === 'beginTrip:enter'), false);
    assert.equal(h.env.tripActionPending, false); assert.equal(h.env.tripActionInFlightRef.current, false);
    h.nativeResume(); await flush(); assert.equal(h.playing(), false); assert.equal(h.plays(), 1);
  });

  for (const codePolicy of ['no-code', 'already-verified'] as const) {
    test(`${platform}: ${codePolicy} Start tap stops BEFORE entering actual beginTrip and server mutation`, async () => {
      const h = setup(platform); assert.equal(await h.playRequest(), true); h.staleNativePlayback();
      if (codePolicy === 'no-code') h.env.activeTrip.pickup_code = null;
      else h.env.activeTrip.pickup_verified_at = 'verified';
      const pending = h.invoke('handleStartTrip');
      h.assertStoppedAt('beginTrip:enter'); h.assertStoppedAt('pending:true'); h.assertStoppedAt('mutation:startTrip');
      assert.ok(h.stopCalls.length >= 2, 'Start tap and normal beginTrip must each directly force-stop');
      assert.equal(h.env.showOtp, false); assert.equal(h.requests.length, 1);
      await h.invoke('handleStartTrip');
      assert.equal(h.requests.length, 1, 'duplicate Start while mutation is pending cannot mutate again');
      // Start may harmlessly re-issue its idempotent stop; beginTrip's shared
      // ref must still reject the duplicate before pending state or mutation.
      assert.equal(h.boundaries.filter(b => b.name === 'pending:true').length, 1);
      assert.equal(h.boundaries.filter(b => b.name === 'mutation:startTrip').length, 1);
      h.startResponse.resolve({ ride: startedRide() }); await pending;
      assert.equal(h.env.activeTrip.status, 'in_progress'); assert.equal(h.playing(), false);
    });
  }

  for (const handler of ['beginTrip', 'handleVerifyPickupCode'] as const) {
    for (const result of ['success', 'failure'] as const) {
      test(`${platform}: actual ${handler} ${result} directly stops before pending/mutation despite stale JS status`, async () => {
        const h = setup(platform); assert.equal(await h.playRequest(), true); h.staleNativePlayback();
        if (handler === 'handleVerifyPickupCode') h.env.showOtp = true;
        const originalRide = h.env.activeTrip;
        const pending = h.invoke(handler);
        const mutation = handler === 'beginTrip' ? 'startTrip' : 'verifyAndStart';
        h.assertStoppedAt('pending:true'); h.assertStoppedAt(`mutation:${mutation}`);
        assert.equal(h.requests.length, 1); assert.equal(h.env.tripActionPending, true);
        assert.equal(h.env.tripActionInFlightRef.current, true);
        assert.deepEqual(h.requests[0].payload, {
          driverId: 'driver-1', rideId: 'trip-A',
          ...(handler === 'handleVerifyPickupCode' ? { pickupCode: '1234' } : {}),
          startLocation: { latitude: 5.6037, longitude: -0.187 },
        });
        const stops = h.stopCalls.length;
        await h.invoke(handler);
        assert.equal(h.requests.length, 1, 'shared ref must block a duplicate before another render');
        assert.equal(h.stopCalls.length, stops, 'duplicate guard must not issue a second action');
        const response = handler === 'beginTrip' ? h.startResponse : h.verifyResponse;
        if (result === 'success') response.resolve({ ride: startedRide() });
        else response.reject(Error('test mutation failed'));
        await pending; await flush();
        assert.equal(h.env.tripActionPending, false); assert.equal(h.env.tripActionInFlightRef.current, false);
        if (result === 'success') {
          assert.equal(h.env.activeTrip.status, 'in_progress');
          assert.equal(h.env.tripStartedAt, startedRide().trip_started_at);
          assert.equal(h.env.tripDistanceKm, 0); assert.equal(h.env.arrivedAt, null);
          assert.equal(h.env.lastTripLocationRef.current, h.env.location);
          assert.equal(h.env.lastTripMeterPublishedAtRef.current, 0);
          assert.equal(h.env.alerts.length, 0);
          if (handler === 'handleVerifyPickupCode') {
            assert.equal(h.env.pickupCode, ''); assert.equal(h.env.showOtp, false);
          }
        } else {
          assert.equal(h.env.activeTrip, originalRide); assert.equal(h.env.alerts.length, 1);
          assert.equal(h.env.alerts[0][0], handler === 'beginTrip' ? 'Error' : 'Unable to verify code');
          if (handler === 'handleVerifyPickupCode') {
            assert.equal(h.env.pickupCode, ' 1234 '); assert.equal(h.env.showOtp, true);
          }
        }
        h.nativeResume(); await flush();
        assert.equal(h.playing(), false, 'neither success nor failure can resurrect request audio');
        assert.equal(h.plays(), 1, 'Start failure does not invent an offer-audio replay');
      });
    }
  }

  for (const handler of ['beginTrip', 'handleStartTrip', 'handleVerifyPickupCode'] as const) {
    for (const stage of ['configure', 'seek'] as const) {
      test(`${platform}: actual ${handler} cancels delayed ${stage} before its start boundary, with no playback effect`, async () => {
        const h = setup(platform); const gate = deferred<void>(); let reached = false;
        if (stage === 'configure') h.setConfigure(async () => { reached = true; await gate.promise; });
        else h.setSeek(async () => { reached = true; await gate.promise; });
        const audioPending = h.playRequest(); await flush();
        assert.equal(reached, true, `fixture must reach asynchronous ${stage}`);
        assert.equal(h.plays(), 0);
        const actionPending = h.invoke(handler);
        if (handler === 'handleStartTrip') h.assertStoppedAt('otp:open');
        else {
          h.assertStoppedAt('pending:true');
          h.assertStoppedAt(`mutation:${handler === 'beginTrip' ? 'startTrip' : 'verifyAndStart'}`);
        }
        gate.resolve(); assert.equal(await audioPending, false, 'stopped async continuation must be invalidated');
        h.startResponse.resolve({ ride: startedRide() }); h.verifyResponse.resolve({ ride: startedRide() });
        await actionPending; h.nativeResume(); await flush();
        assert.equal(h.plays(), 0); assert.equal(h.playing(), false);
        assert.equal(h.players[0].released, true); assert.equal(h.players[0].removed, true);
      });
    }
  }

  const guardCases: Array<[Handler, string, (h: ReturnType<typeof setup>) => void]> = [];
  for (const handler of ['beginTrip', 'handleStartTrip', 'handleVerifyPickupCode'] as const) {
    guardCases.push([handler, 'missing ride', h => { h.env.activeTrip = null; }]);
  }
  for (const handler of ['beginTrip', 'handleVerifyPickupCode'] as const) {
    guardCases.push(
      [handler, 'missing signed-in driver', h => { h.env.user = null; }],
      [handler, 'duplicate action in flight', h => { h.env.tripActionInFlightRef.current = true; }],
    );
  }
  guardCases.push(
    ['handleVerifyPickupCode', 'blank pickup code', h => { h.env.pickupCode = ' \t\n '; }],
    ['handleStartTrip', 'driver has not arrived', h => { h.env.activeTrip.status = 'driver_arriving'; }],
  );
  for (const [handler, reason, guard] of guardCases) {
    test(`${platform}: actual ${handler} guards ${reason} before stopping, OTP, pending state or mutation`, async () => {
      const h = setup(platform); assert.equal(await h.playRequest(), true); h.staleNativePlayback();
      guard(h); await h.invoke(handler);
      assert.equal(h.stopCalls.length, 0, 'invalid/duplicate action must return before force-stop');
      assert.equal(h.requests.length, 0); assert.equal(h.boundaries.length, 0);
      assert.equal(h.env.showOtp, false); assert.equal(h.env.tripActionPending, false);
      assert.equal(h.playing(), true, 'guard does not perform a terminal request-audio action');
      assert.equal(h.players[0].released, false);
      if (reason === 'driver has not arrived') {
        assert.equal(h.env.alerts.length, 1); assert.equal(h.env.alerts[0][0], 'Arrive first');
      } else assert.equal(h.env.alerts.length, 0);
      h.runtime.stop(h.placeholder, { force: true });
    });
  }
}
