import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createDriverRequestAudio } from '../lib/driver-request-audio';
import { shouldPlayIncomingTripAlert } from '../lib/incoming-trip-alert';
import { driverOfferExpiryMs, isDriverOfferWithinWindow } from '../lib/driver-offer-expiry';
import { driverOfferLeaseKey, shouldPresentDriverOffer } from '../lib/driver-offer-lease';
import { offerMatchesDriverPreferences } from '../lib/driver-offer-preferences';

// Execute the actual Home callback, not a regex assertion that an API name exists.
function actualHomeCallback(extra: Record<string, any> = {}, name = 'playIncomingTripAlert') {
  const source = fs.readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
  const tree = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arrow: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      arrow = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(arrow, 'actual Home playback callback must be found');
  const code = ts.transpileModule(`const callback = ${arrow!.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(extra), `${code}; return callback;`)(...Object.values(extra));
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// Execute Home's current-ref eligibility callback with an owned native player.
async function dependencies(player: any, configure: (mode: any) => Promise<void>, rideId = 'ride-1') {
  const listeners = new Set<(status: { isLoaded: boolean }) => void>();
  Object.assign(player, {
    addListener: (_event: string, listener: (status: { isLoaded: boolean }) => void) => { listeners.add(listener); return { remove() { listeners.delete(listener); } }; },
    load() { for (const listener of [...listeners]) listener({ isLoaded: true }); },
    remove(this: any) { this.removed = true; }, release(this: any) { this.released = true; this.playing = false; },
  });
  const prefs = { soundAlerts: true };
  return { incomingTripAlertPlayer: { isLoaded: false },
    Platform: { OS: 'ios' }, AppState: { currentState: 'active' },
    incomingOfferAudioEligibilityRef: { current: { incomingRide: { id: rideId, driver_offer_expires_at: new Date(Date.now() + 60_000).toISOString() }, driverId: 'driver-1', hasCurrentLocation: true, activeTripId: null, isOnline: true, prefs } },
    tripActionInFlightRef: { current: false }, acceptedOfferAudioSuppressionRef: { current: null },
    incomingOfferReceivedAtRef: { current: Date.now() }, retiredOfferLeaseRef: { current: null },
    shouldPlayIncomingTripAlert, driverOfferExpiryMs, isDriverOfferWithinWindow, shouldPresentDriverOffer, offerMatchesDriverPreferences,
    incomingTripAudioRuntimeRef: { current: createDriverRequestAudio({ platform: 'ios', createPlayer: () => player }) }, setAudioModeAsync: configure };
}

test('actual Home configures iPhone silent-mode playback before starting its request song', async () => {
  const events: string[] = [];
  let mode: any = {};
  const player = { isLoaded: true, playing: false, muted: false, volume: 0, loop: true,
    pause: () => { events.push('pause'); }, seekTo: async () => { events.push('seek'); },
    play: () => { events.push(mode.playsInSilentMode ? 'audible-play' : 'silent-play'); } };
  const fn = actualHomeCallback(await dependencies(player, async (next) => { mode = next; events.push('configure'); }));
  fn('ride-1'); await flush();
  assert.ok(events.includes('audible-play'), 'bundled audio must not remain in an iPhone silent-switch audio category');
  assert.ok(events.indexOf('configure') < events.indexOf('audible-play'));
  assert.equal(mode.allowsRecording, false);
  assert.equal(mode.shouldPlayInBackground, false);
  assert.equal(player.volume, 0.92);
  assert.equal(player.loop, true);
});

test('actual Home does not consume the looping request alert before the audio is loaded', async () => {
  let plays = 0;
  const player = { isLoaded: false, playing: false, muted: false, volume: 0, loop: true,
    pause: () => {}, seekTo: async () => {}, play: () => { plays++; } };
  const fn = actualHomeCallback(await dependencies(player, async () => {}));
  fn('ride-1'); await flush();
  assert.equal(plays, 0, 'unloaded audio must not be counted as a played request');
  player.isLoaded = true;
  (player as any).load(); await flush();
  assert.equal(plays, 1, 'the owned pending request plays on readiness without another render');
});


const homeSource = fs.readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');

function homeHandlerBody(name: 'handleAcceptRide' | 'handleDeclineRide') {
  const tree = ts.createSourceFile('home.tsx', homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(initializer, `actual Home handler ${name} must exist`);
  return initializer.getText(tree);
}

test('actual Accept handler force-stops request audio before calling the server', () => {
  const body = homeHandlerBody('handleAcceptRide');
  const stop = body.indexOf('stopIncomingTripAlert(true)');
  const request = body.indexOf('respondToOffer.mutateAsync');
  assert.ok(stop >= 0, 'Accept must force-stop the ringtone');
  assert.ok(request > stop, 'ringtone must stop before the network request begins');
});

test('assignment confirmation force-stops request audio before showing the active trip', () => {
  const body = homeHandlerBody('handleAcceptRide');
  const stop = body.indexOf('stopIncomingTripAlert(true)');
  const activeTrip = body.indexOf('setActiveTrip(ride)');
  assert.ok(stop >= 0, 'assignment confirmation must force-stop the ringtone');
  assert.ok(activeTrip > stop, 'the active trip must be shown only after the ringtone stop is issued');
});

test('starting a trip force-stops any stale request ringtone', () => {
  const start = homeSource.indexOf('const beginTrip = async');
  const body = homeSource.slice(start, homeSource.indexOf('// Verify the rider\'s pickup code', start));
  assert.match(body, /stopIncomingTripAlert\(true\)/);
});

test('actual Decline handler force-stops request audio before calling the server', () => {
  const body = homeHandlerBody('handleDeclineRide');
  const stop = body.indexOf('stopIncomingTripAlert(true)');
  const request = body.indexOf('respondToOffer.mutateAsync');
  assert.ok(stop >= 0, 'Decline must force-stop the ringtone');
  assert.ok(request > stop, 'ringtone must stop before the network request begins');
});

test('stopping while audio configuration is pending prevents a late ringtone start', async () => {
  let releaseConfigure!: () => void;
  let plays = 0;
  const player = { isLoaded: true, playing: false, muted: false, volume: 0, loop: true,
    pause: () => {}, seekTo: async () => {}, play: () => { plays++; } };
  const runtime = createDriverRequestAudio();
  const pending = runtime.play('ride-accepting', player, () => new Promise<void>((resolve) => { releaseConfigure = resolve; }));
  await flush();
  runtime.stop(player, { force: true });
  releaseConfigure();
  await pending;
  assert.equal(plays, 0, 'a stopped request must not start after an async audio setup completes');
});

test('audio stop still pauses playback if a native audio property setter throws', () => {
  let paused = false;
  const player: any = { isLoaded: true, playing: true, pause: () => { paused = true; },
    seekTo: async () => {}, play: () => {}, loop: true };
  Object.defineProperty(player, 'muted', { set() { throw new Error('native muted setter failed'); } });
  Object.defineProperty(player, 'volume', { set() { throw new Error('native volume setter failed'); } });
  createDriverRequestAudio().stop(player, { force: true });
  assert.equal(paused, true, 'native property failures must not prevent pause');
});

test('actual Home iOS stop keeps the same-offer latch until explicit failed-Accept rearm', async () => {
  let plays = 0;
  const player = { isLoaded: true, playing: false, muted: true, volume: 0, loop: false,
    pause() { this.playing = false; }, seekTo: async () => {}, play() { this.playing = true; plays++; } };
  const env = await dependencies(player, async () => {}, 'offer-A');
  const created: any[] = [];
  env.incomingTripAudioRuntimeRef.current = createDriverRequestAudio({ platform: 'ios', createPlayer: () => {
    const fresh = { ...player }; created.push(fresh); return fresh as any;
  } });
  const play = actualHomeCallback(env);
  const stop = actualHomeCallback(env, 'stopIncomingTripAlert');
  play('offer-A'); await flush(); assert.equal(plays, 1);
  stop(true); play('offer-A'); await flush();
  assert.equal(created[0].playing, false); assert.equal(created[0].released, true);
  assert.equal(plays, 1, 'ordinary stop cannot clear iOS ride latch');
  assert.equal(env.incomingTripAudioRuntimeRef.current.rearmAfterFailedAccept('offer-B'), false);
  assert.equal(env.incomingTripAudioRuntimeRef.current.rearmAfterFailedAccept('offer-A'), true);
  play('offer-A'); await flush(); play('offer-A'); await flush();
  assert.equal(plays, 2, 'explicit eligible retry replays once using a fresh owned player');
  assert.equal(created.length, 2); assert.equal(created[1].released, undefined);
});

const eligibilityChanges: Array<[string, (env: any) => void]> = [
  ['background', env => { env.AppState.currentState = 'background'; }],
  ['inactive', env => { env.AppState.currentState = 'inactive'; }],
  ['active trip', env => { env.incomingOfferAudioEligibilityRef.current.activeTripId = 'trip-A'; }],
  ['offline', env => { env.incomingOfferAudioEligibilityRef.current.isOnline = false; }],
  ['signed out', env => { env.incomingOfferAudioEligibilityRef.current.driverId = null; }],
  ['different signed-in driver', env => { env.incomingOfferAudioEligibilityRef.current.driverId = 'driver-2'; }],
  ['unusable location', env => { env.incomingOfferAudioEligibilityRef.current.hasCurrentLocation = false; }],
  ['sound disabled', env => { env.incomingOfferAudioEligibilityRef.current.prefs.soundAlerts = false; }],
  ['different offer', env => { env.incomingOfferAudioEligibilityRef.current.incomingRide.id = 'B'; }],
  ['expired lease', env => { env.incomingOfferAudioEligibilityRef.current.incomingRide.driver_offer_expires_at = new Date(Date.now() - 1).toISOString(); }],
  ['retired lease', env => { env.retiredOfferLeaseRef.current = driverOfferLeaseKey(env.incomingOfferAudioEligibilityRef.current.incomingRide); }],
  ['Accept suppression', env => { env.acceptedOfferAudioSuppressionRef.current = 'ride-1'; }],
  ['pending trip action', env => { env.tripActionInFlightRef.current = true; }],
  ['changed trip preferences', env => { env.incomingOfferAudioEligibilityRef.current.prefs.longTripsOnly = true; env.incomingOfferAudioEligibilityRef.current.incomingRide.distance_km = 2; }],
];
for (const stage of ['configure', 'seek'] as const) {
  for (const [reason, change] of eligibilityChanges) {
    test(`actual Home ${stage}: ${reason} prevents a late request song without an effect render`, async () => {
      let finish!: () => void; const wait = new Promise<void>(r => { finish = r; }); let plays = 0;
      const player = { isLoaded: true, playing: false, muted: false, volume: 1, loop: false,
        pause() { this.playing = false; }, seekTo: () => stage === 'seek' ? wait : Promise.resolve(), play() { this.playing = true; plays++; } };
      const env = await dependencies(player, stage === 'configure' ? () => wait : async () => {});
      actualHomeCallback(env)('ride-1'); await flush(); change(env); finish(); await flush();
      assert.equal(plays, 0); assert.equal((player as any).released, true);
      assert.equal(player.muted, true); assert.equal(player.volume, 0); assert.equal(player.loop, false);
    });
  }
}
