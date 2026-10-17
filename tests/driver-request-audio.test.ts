import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverRequestAudio, DRIVER_REQUEST_AUDIO_MODE } from '../lib/driver-request-audio';

function player() {
  const calls: string[] = [];
  return { calls, isLoaded: true, playing: false, muted: true, volume: 0, loop: true,
    pause: () => { calls.push('pause'); }, seekTo: async (_seconds: number) => { calls.push('seek'); }, play: () => { calls.push('play'); } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('accept/decline during an asynchronous seek cannot cause a late ringtone', async () => {
  const runtime = createDriverRequestAudio(); const p = player(); const wait = deferred();
  p.seekTo = async () => { p.calls.push('seek'); await wait.promise; };
  const started = runtime.play('ride-1', p, async () => {});
  await Promise.resolve(); await Promise.resolve();
  runtime.stop(p);
  wait.resolve();
  assert.equal(await started, false);
  assert.deepEqual(p.calls, ['seek']);
});

test('a failed audio configuration does not consume the pending request', async () => {
  const runtime = createDriverRequestAudio(); const p = player();
  assert.equal(await runtime.play('ride-1', p, async () => { throw Error('native session temporarily unavailable'); }), false);
  assert.equal(await runtime.play('ride-1', p, async () => {}), true);
  assert.equal(p.calls.filter(x => x === 'play').length, 1);
});

test('a duplicate request cannot start a second player or repeated ringtone', async () => {
  const runtime = createDriverRequestAudio(); const p = player(); const wait = deferred();
  const first = runtime.play('ride-1', p, async () => { await wait.promise; });
  assert.equal(await runtime.play('ride-1', p, async () => {}), false);
  wait.resolve(); assert.equal(await first, true);
  assert.equal(await runtime.play('ride-1', p, async () => {}), false);
  assert.equal(p.calls.filter(x => x === 'play').length, 1);
});

test('stopping an idle player does not deactivate the shared native guidance audio session', () => {
  const runtime = createDriverRequestAudio(); const p = player();
  runtime.stop(p);
  assert.deepEqual(p.calls, []);
  p.playing = true;
  runtime.stop(p);
  assert.deepEqual(p.calls, ['pause']);
});

test('an Accept or Decline can force immediate pause when iPhone player status is stale', () => {
  const runtime = createDriverRequestAudio(); const p = player();
  // Native audio can still be audible while Expo has not yet propagated the
  // updated `playing` status through JavaScript.
  p.playing = false;
  runtime.stop(p, { force: true });
  assert.deepEqual(p.calls, ['pause']);
});

test('released native audio objects are safe during Home cleanup', () => {
  const runtime = createDriverRequestAudio(); const p = player();
  Object.defineProperty(p, 'playing', { get: () => { throw Error('shared object released'); } });
  assert.doesNotThrow(() => runtime.stop(p));
});

test('audio that loses readiness during a seek is not played and can retry after loading', async () => {
  const runtime = createDriverRequestAudio(); const p = player();
  p.seekTo = async () => { p.isLoaded = false; };
  assert.equal(await runtime.play('ride-1', p, async () => {}), false);
  assert.equal(p.calls.includes('play'), false);
  p.isLoaded = true; p.seekTo = async () => {};
  assert.equal(await runtime.play('ride-1', p, async () => {}), true);
});

test('foreground request audio uses playback/speaker options without recording or background media', () => {
  assert.equal(DRIVER_REQUEST_AUDIO_MODE.playsInSilentMode, true);
  assert.equal(DRIVER_REQUEST_AUDIO_MODE.shouldRouteThroughEarpiece, false);
  assert.equal(DRIVER_REQUEST_AUDIO_MODE.allowsRecording, false);
  assert.equal(DRIVER_REQUEST_AUDIO_MODE.shouldPlayInBackground, false);
});
