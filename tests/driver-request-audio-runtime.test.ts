import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createDriverRequestAudio } from '../lib/driver-request-audio';

// Execute the actual Home callback, not a regex assertion that an API name exists.
function actualHomeCallback(extra: Record<string, any> = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
  const tree = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arrow: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'playIncomingTripAlert' && node.initializer && ts.isCallExpression(node.initializer)) {
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

// The corrected shared runtime is injected when it exists. Before correction,
// the actual old callback still executes and fails these same assertions.
async function dependencies(player: any, configure: (mode: any) => Promise<void>) {
  let runtime: any = null;
  const filename = path.join(__dirname, '../lib/driver-request-audio.ts');
  if (fs.existsSync(filename)) {
    const mod = await import('../lib/driver-request-audio');
    runtime = mod.createDriverRequestAudio();
  }
  return { incomingTripAlertPlayer: player, incomingTripAlertedRideIdRef: { current: null },
    incomingTripAudioRuntimeRef: { current: runtime }, setAudioModeAsync: configure };
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
  fn('ride-1'); await flush();
  assert.equal(plays, 1, 'the same pending request must play when its asset becomes ready');
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

test('failed Accept restores sound eligibility while the same offer remains visible', () => {
  const body = homeHandlerBody('handleAcceptRide');
  assert.match(body, /if \(String\(incomingRide\?\.id \|\| ''\) === rideId\) acceptedOfferAudioSuppressionRef\.current = null/);
  assert.match(homeSource, /acceptedOfferAudioSuppressionRef\.current === incomingRideId \|\| !shouldPlayIncomingTripAlert/);
});
