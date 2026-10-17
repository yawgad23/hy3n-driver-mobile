import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
