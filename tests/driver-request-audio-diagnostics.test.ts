import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverRequestAudio, type OwnedDriverRequestAudioPlayer } from '../lib/driver-request-audio';
import { createDriverRequestAudioDiagnostics, getDriverRequestAudioDiagnostics, type DriverRequestAudioEvent } from '../lib/driver-request-audio-diagnostics';

function player(id = 'native-player-1'): OwnedDriverRequestAudioPlayer {
  return {
    id, isLoaded: true, playing: false, muted: true, volume: 0, loop: false,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async seekTo() {}, addListener() { return { remove() {} }; }, remove() {}, release() {},
  };
}

test('request diagnostics distinguish player creation, playback and terminal retirement on one owner', async () => {
  const events: DriverRequestAudioEvent[] = [];
  const p = player(); const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: () => p, onDiagnostic: event => events.push(event) });
  await runtime.play('private-trip-id', p, async () => {}); runtime.stop(p, { force: true });
  assert.deepEqual(events.map(event => event.event), ['play-requested', 'player-created', 'play-started', 'stop-requested', 'player-retired']);
  assert.equal(new Set(events.map(event => event.owner)).size, 1);
  assert.equal(events[2].playerId, 'native-player-1');
  assert.ok(events[3].generation > events[2].generation);
  assert.equal(p.playing, false); assert.equal(p.muted, true); assert.equal(p.volume, 0); assert.equal(p.loop, false);
  assert.ok(!JSON.stringify(events).includes('private-trip-id'));
});

test('an exception from a diagnostic listener cannot skip native silence or release', async () => {
  const operations: string[] = []; const p = player();
  p.remove = () => { operations.push('remove'); }; p.release = () => { operations.push('release'); };
  const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: () => p, onDiagnostic() { throw Error('diagnostic consumer failed'); } });
  assert.equal(await runtime.play('A', p, async () => {}), true);
  assert.doesNotThrow(() => runtime.stop(p, { force: true }));
  assert.equal(p.playing, false); assert.deepEqual(operations, ['remove', 'release']);
});

test('native pause failure is visible without blocking loop/mute/volume/remove/release', async () => {
  const events: DriverRequestAudioEvent[] = []; const p = player(); let released = false;
  const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: () => p, onDiagnostic: event => events.push(event) });
  await runtime.play('A', p, async () => {});
  p.pause = () => { throw Error('private error payload must not be logged'); };
  p.release = () => { released = true; p.playing = false; };
  runtime.stop(p, { force: true });
  assert.ok(events.some(event => event.event === 'native-operation-failed' && event.operation === 'pause'));
  assert.equal(p.loop, false); assert.equal(p.muted, true); assert.equal(p.volume, 0); assert.equal(released, true);
  assert.ok(!JSON.stringify(events).includes('private error'));
});

test('native removal and release failures are both recorded instead of silently disappearing', async () => {
  const events: DriverRequestAudioEvent[] = []; const p = player();
  const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: () => p, onDiagnostic: event => events.push(event) });
  await runtime.play('A', p, async () => {});
  p.remove = () => { throw Error('remove failed'); }; p.release = () => { throw Error('release failed'); };
  runtime.stop(p, { force: true });
  assert.deepEqual(events.filter(event => event.event === 'native-operation-failed').map(event => event.operation), ['remove', 'release']);
  assert.equal(p.playing, false); assert.equal(p.muted, true);
});

test('independent controller owners and different native players are distinguishable without trip IDs', async () => {
  const events: DriverRequestAudioEvent[] = [];
  const first = player('first-player'), second = player('second-player');
  const a = createDriverRequestAudio({ platform: 'ios', createPlayer: () => first, onDiagnostic: event => events.push(event) });
  const b = createDriverRequestAudio({ platform: 'ios', createPlayer: () => second, onDiagnostic: event => events.push(event) });
  await a.play('same-private-trip', first, async () => {}); await b.play('same-private-trip', second, async () => {});
  a.stop(first, { force: true }); b.stop(second, { force: true });
  assert.equal(new Set(events.map(event => event.owner)).size, 2);
  assert.deepEqual(new Set(events.filter(event => event.event === 'play-started').map(event => event.playerId)), new Set(['first-player', 'second-player']));
  assert.ok(!JSON.stringify(events).includes('same-private-trip'));
});

test('local diagnostic buffer is bounded and callers cannot mutate stored entries', () => {
  const record = createDriverRequestAudioDiagnostics();
  for (let generation = 0; generation < 100; generation++) record({ generation, event: 'stop-requested' });
  const copy = getDriverRequestAudioDiagnostics();
  assert.equal(copy.length, 64); assert.equal(copy[0].generation, 36); assert.equal(copy[63].generation, 99);
  assert.equal(Object.isFrozen(copy[0]), true);
  (copy as DriverRequestAudioEvent[]).pop(); assert.equal(getDriverRequestAudioDiagnostics().length, 64);
});

test('unsafe native IDs and throwing native identity getters do not leak payloads or break stop', async () => {
  for (const id of ['https://example.com/private-token', 'personal value with spaces']) {
    const events: DriverRequestAudioEvent[] = []; const p = player(id);
    const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: () => p, onDiagnostic: event => events.push(event) });
    await runtime.play('A', p, async () => {}); runtime.stop(p, { force: true });
    assert.ok(events.every(event => event.playerId === undefined)); assert.equal(p.playing, false);
  }
  const p = player(); Object.defineProperty(p, 'id', { get() { throw Error('disposed identity'); } });
  const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: () => p });
  await runtime.play('A', p, async () => {}); assert.doesNotThrow(() => runtime.stop(p, { force: true }));
});
