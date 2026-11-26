import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createDriverRequestAudio, type DriverRequestAudioPlayer } from '../lib/driver-request-audio';

// Executable behavior model checked against SDK 57's expo-audio 57.0.5 Android.
// AudioModule pause still does not clear isPaused; allPlayables focus/lifecycle
// handlers resume with playable.play(). remove unregisters the player.
// SDK 57 moved mute-aware setVolume into Playable.kt and disposal into BaseAudioPlayer.
// These source assertions keep the existing interruption/acceptance tests honest.
const moduleSource = fs.readFileSync(path.join(__dirname, '../node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt'), 'utf8');
const playerSource = fs.readFileSync(path.join(__dirname, '../node_modules/expo-audio/android/src/main/java/expo/modules/audio/Playable.kt'), 'utf8');
assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/expo-audio/package.json'), 'utf8')).version, '57.0.5');
assert.match(moduleSource, /Function\("pause"\)[\s\S]*?player\.ref\.pause\(\)[\s\S]*?Function\("replace"\)/);
assert.match(moduleSource, /if \(playable\.isPaused\) \{\s*playable\.isPaused = false\s*playable\.play\(\)/);
assert.match(playerSource, /if \(isMuted\) \{[\s\S]*?player\.volume = 0f/);

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

function androidNative() {
  const registered = new Set<NativePlayer>();
  const created: NativePlayer[] = [];
  const queue: Array<() => void> = [];
  const drain = () => { while (queue.length) queue.shift()!(); };
  class NativePlayer implements DriverRequestAudioPlayer {
    isLoaded = true;
    playing = false;
    isPaused = false;
    isMuted = false;
    previousVolume = 1;
    nativeVolume = 1;
    loop = false;
    released = false;
    plays = 0;
    pauses = 0;
    failPause = false;
    failLoop = false;
    failMuted = false;
    failRemove = false;
    failRelease = false;
    listeners = new Set<(status: { isLoaded: boolean }) => void>();
    get muted() { return this.isMuted; }
    set muted(value: boolean) {
      if (this.failMuted) throw Error('muted failed');
      this.isMuted = value;
      this.setVolume(value ? 0 : this.previousVolume);
    }
    get volume() { return this.nativeVolume; }
    set volume(value: number) { this.setVolume(value); }
    setVolume(value: number) {
      queue.push(() => {
        if (this.isMuted) {
          if (value > 0) this.previousVolume = value;
          this.nativeVolume = 0;
        } else {
          this.previousVolume = value;
          this.nativeVolume = value;
        }
      });
    }
    pause = () => {
      this.pauses++;
      if (this.failPause) throw Error('pause failed');
      this.playing = false;
      // Native Function("pause") does not change this.isPaused.
    };
    play = () => { this.playing = true; this.plays++; };
    seekTo = async (_seconds: number) => {};
    addListener = (_event: string, listener: (status: { isLoaded: boolean }) => void) => {
      this.listeners.add(listener);
      return { remove: () => { this.listeners.delete(listener); } };
    };
    load() { this.isLoaded = true; for (const listener of [...this.listeners]) listener({ isLoaded: true }); }
    remove = () => { if (this.failRemove) throw Error('remove failed'); registered.delete(this); };
    release = () => {
      if (this.failRelease) throw Error('release failed');
      queue.push(() => { this.released = true; this.playing = false; });
    };
    get audible() { return !this.released && this.playing && this.nativeVolume > 0; }
  }
  const create = () => { const p = new NativePlayer(); registered.add(p); created.push(p); return p; };
  const suspend = () => {
    for (const p of registered) if (p.playing) { p.isPaused = true; p.playing = false; }
  };
  const foreground = () => {
    for (const p of registered) if (p.isPaused) { p.isPaused = false; p.play(); }
    drain();
  };
  const focusGain = () => {
    for (const p of registered) {
      p.setVolume(p.previousVolume);
      if (p.isPaused) { p.isPaused = false; p.play(); }
    }
    drain();
  };
  return { create, created, registered, drain, suspend, foreground, focusGain };
}
function setup(loaded = true) {
  const native = androidNative();
  const hookPlayer = native.create();
  hookPlayer.isLoaded = loaded;
  let first = true;
  // In the red baseline, the current controller ignores the Android option
  // and operates the same native player supplied by Home. In the fix, the
  // factory owns that first player and later creates a fresh offer player.
  const runtime = createDriverRequestAudio({ platform: 'android', createPlayer: () => {
    if (first) { first = false; return hookPlayer; }
    return native.create();
  } } as any);
  return { native, hookPlayer, runtime };
}

test('native fixture confirms existing stop silences but does not cancel Android resume ownership', async () => {
  const native = androidNative(); const p = native.create(); const runtime = createDriverRequestAudio();
  assert.equal(await runtime.play('accepted', p, async () => {}), true); native.drain();
  native.suspend(); runtime.stop(p, { force: true }); native.drain(); native.focusGain();
  assert.equal(p.playing, true, '1.1.1 pause leaves native resume intent armed');
  assert.equal(p.audible, false, 'existing mute already silences the ordinary focus-resume path; do not misreport it as audible');
});

for (const resume of ['foreground', 'focusGain'] as const) {
  test(`Android accepted request cannot resume on ${resume} after native suspension`, async () => {
    const { native, hookPlayer: p, runtime } = setup();
    assert.equal(await runtime.play('accepted', p, async () => {}), true); native.drain();
    native.suspend(); runtime.stop(p, { force: true }); native.drain(); native[resume]();
    assert.equal(p.playing, false, 'accepted request must no longer participate in native auto-resume');
    assert.equal(native.registered.has(p), false);
    assert.equal(p.released, true);
    assert.equal(p.audible, false);
  });
}

test('Android retirement cancels resume even when pause and mute native operations fail', async () => {
  const { native, hookPlayer: p, runtime } = setup();
  await runtime.play('accepted', p, async () => {}); native.drain(); native.suspend();
  p.failPause = true; p.failMuted = true;
  runtime.stop(p, { force: true }); native.drain(); native.focusGain();
  assert.equal(p.playing, false);
  assert.equal(p.audible, false);
});

test('Android cleanup isolates unregister and release failures from remaining stop operations', async () => {
  const { native, hookPlayer: p, runtime } = setup();
  await runtime.play('accepted', p, async () => {}); native.drain();
  p.failRemove = true;
  assert.doesNotThrow(() => runtime.stop(p, { force: true })); native.drain();
  assert.equal(p.released, true, 'remove failure must not skip release');
  const other = setup(); await other.runtime.play('other', other.hookPlayer, async () => {});
  other.hookPlayer.failRelease = true;
  assert.doesNotThrow(() => other.runtime.stop(other.hookPlayer, { force: true }));
  assert.equal(other.native.registered.has(other.hookPlayer), false, 'release failure must not undo unregister');
});

test('Android failed acceptance can re-arm the same visible eligible offer exactly once', async () => {
  const { native, hookPlayer: p, runtime } = setup();
  assert.equal(await runtime.play('still-eligible', p, async () => {}), true);
  runtime.stop(p, { force: true }); native.drain();
  assert.equal(await runtime.play('still-eligible', p, async () => {}), true);
  assert.equal(await runtime.play('still-eligible', p, async () => {}), false);
  assert.equal(native.created.length, 2);
  assert.equal(native.created[1].plays, 1);
});

test('Android new different offer after a completed ride owns a fresh player, not the accepted source', async () => {
  const { native, hookPlayer: p, runtime } = setup();
  await runtime.play('ride-1', p, async () => {}); runtime.stop(p, { force: true }); native.drain();
  assert.equal(await runtime.play('ride-2', p, async () => {}), true); native.drain();
  assert.equal(native.created.length, 2);
  assert.equal(p.plays, 1);
  assert.equal(native.created[1].audible, true);
});

test('Android acceptance before WAV readiness cancels subscription and never starts late', async () => {
  const { native, hookPlayer: p, runtime } = setup(false);
  const pending = runtime.play('loading-offer', p, async () => {}); await flush();
  assert.equal(p.listeners.size, 1, 'pending player must subscribe to its actual readiness');
  runtime.stop(p, { force: true }); p.load(); native.drain();
  assert.equal(await pending, false);
  assert.equal(p.listeners.size, 0);
  assert.equal(p.plays, 0);
});

test('Android readiness event starts the real pending offer without a new render or second player', async () => {
  const { native, hookPlayer: p, runtime } = setup(false);
  const pending = runtime.play('loading-offer', p, async () => {}); await flush();
  p.load(); assert.equal(await pending, true); native.drain();
  assert.equal(p.audible, true);
  assert.equal(native.created.length, 1);
  assert.equal(p.listeners.size, 0);
});

test('Android seek completion waits for STATE_READY before playing its per-offer source', async () => {
  const { native, hookPlayer: p, runtime } = setup();
  // Native seekTo's promise acknowledges dispatch, not completion of buffering.
  p.seekTo = async () => { p.isLoaded = false; };
  const pending = runtime.play('seek-loading', p, async () => {}); await flush();
  assert.equal(p.plays, 0);
  assert.equal(p.listeners.size, 1);
  p.load(); assert.equal(await pending, true); native.drain();
  assert.equal(p.audible, true);
});

test('Android loading-change isLoaded event cannot bypass actual STATE_READY', async () => {
  const { hookPlayer: p, runtime } = setup(false);
  const pending = runtime.play('buffering', p, async () => {}); await flush();
  // AudioPlayer.onIsLoadingChanged emits !isLoading; it is not the same as
  // the native isLoaded getter's STATE_READY (AudioModule.kt 330-334).
  for (const listener of [...p.listeners]) listener({ isLoaded: true });
  await flush(); assert.equal(p.plays, 0);
  p.load(); assert.equal(await pending, true);
});

test('Android replacement offer retires a pending source without letting its stale continuation release the new one', async () => {
  const { native, hookPlayer: p, runtime } = setup(); const wait = deferred();
  const first = runtime.play('old', p, () => wait.promise); await flush();
  assert.equal(await runtime.play('new', p, async () => {}), true); native.drain();
  wait.resolve(); assert.equal(await first, false);
  assert.equal(p.released, true);
  assert.equal(p.plays, 0);
  assert.equal(native.created[1].audible, true);
  assert.equal(native.created[1].released, false);
});

for (const stage of ['configure', 'seek'] as const) {
  test(`Android retirement during asynchronous ${stage} prevents a late start and releases the source`, async () => {
    const { native, hookPlayer: p, runtime } = setup(); const wait = deferred();
    if (stage === 'seek') p.seekTo = () => wait.promise;
    const pending = runtime.play('accepting', p, stage === 'configure' ? () => wait.promise : async () => {});
    await flush(); runtime.stop(p, { force: true }); native.drain(); wait.resolve();
    assert.equal(await pending, false);
    assert.equal(p.plays, 0);
    assert.equal(p.released, true);
  });
}

for (const platform of ['web', undefined]) {
  test(`Android lifecycle opt-in leaves ${String(platform)} playback and retry behavior unchanged`, async () => {
    const native = androidNative(); const p = native.create(); let creates = 0;
    const runtime = createDriverRequestAudio({ platform, createPlayer: () => { creates++; return native.create(); } } as any);
    assert.equal(await runtime.play('offer', p, async () => {}), true);
    runtime.stop(p, { force: true });
    assert.equal(await runtime.play('offer', p, async () => {}), false);
    assert.equal(creates, 0);
    assert.equal(p.released, false);
    assert.equal(native.registered.has(p), true);
  });
}
