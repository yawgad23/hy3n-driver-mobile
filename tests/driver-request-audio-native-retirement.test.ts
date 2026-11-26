import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverRequestAudio, type OwnedDriverRequestAudioPlayer } from '../lib/driver-request-audio';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

// Deterministic SDK-behavior model, NOT an AVFoundation/device test. iOS pause
// preserves wasPlaying; media reset rebuilds a default-unmuted AVPlayer.
// Native release cancels seeks/observers, and registry removal prevents future
// reset/resume dispatch. An already-running native completion is not retractable.
function native() {
  const registered = new Set<Player>();
  const created: Player[] = [];
  class Player implements OwnedDriverRequestAudioPlayer {
    isLoaded = true;
    playing = false;
    muted = false;
    volume = 1;
    loop = false;
    wasPlaying = false;
    released = false;
    plays = 0;
    events: string[] = [];
    listeners = new Set<(status: { isLoaded: boolean }) => void>();
    failPause = false;
    failRemove = false;
    failRelease = false;
    play() { if (this.released) throw Error('released'); this.playing = true; this.plays++; }
    pause() { this.events.push('pause'); if (this.failPause) throw Error('pause failed'); this.playing = false; }
    seekTo = async (_seconds: number) => {};
    addListener(_event: 'playbackStatusUpdate', listener: (status: { isLoaded: boolean }) => void) {
      this.listeners.add(listener); return { remove: () => { this.listeners.delete(listener); } };
    }
    load() { this.isLoaded = true; for (const listener of [...this.listeners]) listener({ isLoaded: true }); }
    remove() { this.events.push('remove'); if (this.failRemove) throw Error('remove failed'); registered.delete(this); }
    release() { this.events.push('release'); if (this.failRelease) throw Error('release failed'); registered.delete(this); this.released = true; this.playing = false; this.listeners.clear(); }
    get audible() { return this.playing && !this.muted && this.volume > 0 && !this.released; }
  }
  const create = () => { const p = new Player(); created.push(p); registered.add(p); return p; };
  const background = () => { for (const p of registered) if (p.playing) { p.wasPlaying = true; p.playing = false; } };
  const foreground = () => { for (const p of registered) if (p.wasPlaying) { p.play(); p.wasPlaying = false; } };
  const mediaReset = () => {
    for (const p of registered) {
      const resume = p.wasPlaying;
      p.playing = false; p.muted = false; p.volume = 1;
      if (resume) p.play();
      p.wasPlaying = false;
    }
  };
  return { create, created, registered, background, foreground, mediaReset };
}

for (const platform of ['ios', 'android'] as const) {
  function setup() {
    const n = native();
    // Empty hook is not part of the native request registry and never disposed.
    const placeholder: any = { isLoaded: false, release() { throw Error('must not release hook'); } };
    const runtime = createDriverRequestAudio({ platform, createPlayer: n.create });
    return { n, runtime, placeholder };
  }

  for (const resume of ['foreground', 'mediaReset'] as const) {
    test(`${platform}: terminal stop prevents future native ${resume} from replaying the request song`, async () => {
      const { n, runtime, placeholder } = setup();
      assert.equal(await runtime.play('accepted-A', placeholder, async () => {}), true);
      const p = n.created[0]; assert.equal(p.loop, true); assert.equal(p.volume, 0.92);
      n.background(); assert.equal(p.wasPlaying, true);
      runtime.stop(placeholder, { force: true }); n[resume]();
      assert.equal(n.registered.size, 0); assert.equal(p.released, true);
      assert.equal(p.audible, false); assert.equal(p.plays, 1);
      assert.equal(p.loop, false); assert.equal(p.muted, true); assert.equal(p.volume, 0);
      assert.deepEqual(p.events.slice(-3), ['pause', 'remove', 'release']);
      assert.doesNotThrow(() => runtime.stop(placeholder, { force: true }));
    });
  }

  test(`${platform}: a new later request gets a different native player after terminal retirement`, async () => {
    const { n, runtime, placeholder } = setup();
    await runtime.play('A', placeholder, async () => {}); runtime.stop(placeholder, { force: true });
    assert.equal(await runtime.play('B', placeholder, async () => {}), true);
    assert.notEqual(n.created[0], n.created[1]); assert.equal(n.created[0].released, true);
    assert.equal(n.created[1].audible, true); assert.equal(n.created[1].loop, true);
  });

  test(`${platform}: inactive disposal allows only the still-eligible unanswered request to play on resume`, async () => {
    const { n, runtime, placeholder } = setup(); let eligible = true;
    await runtime.play('unanswered', placeholder, async () => {}, () => eligible);
    runtime.suspend(placeholder); eligible = false; n.foreground();
    assert.equal(await runtime.play('unanswered', placeholder, async () => {}, () => eligible), false);
    assert.equal(n.created.length, 1); assert.equal(n.created[0].audible, false);
    eligible = true;
    assert.equal(await runtime.play('unanswered', placeholder, async () => {}, () => eligible), true);
    assert.equal(n.created.length, 2); assert.equal(n.created[1].audible, true);
  });

  for (const stage of ['configure', 'readiness', 'seek'] as const) {
    test(`${platform}: terminal stop during ${stage} cancels pending play and removes readiness listeners`, async () => {
      const { n, runtime, placeholder } = setup(); const wait = deferred();
      const factory = () => {
        const p = n.create();
        if (stage === 'readiness') p.isLoaded = false;
        if (stage === 'seek') p.seekTo = () => wait.promise;
        return p;
      };
      const owned = createDriverRequestAudio({ platform, createPlayer: factory });
      const pending = owned.play('A', placeholder, stage === 'configure' ? () => wait.promise : async () => {});
      await flush(); const p = n.created[0]; owned.stop(placeholder, { force: true });
      wait.resolve(); p.load(); assert.equal(await pending, false);
      assert.equal(p.plays, 0); assert.equal(p.released, true); assert.equal(p.listeners.size, 0);
      assert.equal(n.registered.size, 0);
      runtime.stop(placeholder);
    });

    test(`${platform}: lost eligibility during ${stage} retires only its current player, without consuming the offer`, async () => {
      const { n, placeholder } = setup(); const wait = deferred(); let eligible = true;
      const runtime = createDriverRequestAudio({ platform, createPlayer: () => {
        const p = n.create();
        if (n.created.length === 1 && stage === 'readiness') p.isLoaded = false;
        if (n.created.length === 1 && stage === 'seek') p.seekTo = () => wait.promise;
        return p;
      } });
      const pending = runtime.play('A', placeholder, stage === 'configure' ? () => wait.promise : async () => {}, () => eligible);
      await flush(); eligible = false; wait.resolve(); n.created[0].load();
      assert.equal(await pending, false); assert.equal(n.created[0].released, true);
      assert.equal(n.created[0].plays, 0); assert.equal(n.registered.size, 0);
      eligible = true;
      assert.equal(await runtime.play('A', placeholder, async () => {}, () => eligible), true);
      assert.equal(n.created[1].audible, true);
    });
  }

  test(`${platform}: old pending continuation never disposes the newer eligible request`, async () => {
    const { n, runtime, placeholder } = setup(); const wait = deferred();
    const old = runtime.play('A', placeholder, () => wait.promise); await flush();
    assert.equal(await runtime.play('B', placeholder, async () => {}), true);
    wait.resolve(); assert.equal(await old, false);
    assert.equal(n.created[0].released, true); assert.equal(n.created[1].released, false);
    assert.equal(n.created[1].audible, true); assert.equal(n.registered.has(n.created[1]), true);
  });

  test(`${platform}: retirement continues to unregister and release when pause fails`, async () => {
    const { n, runtime, placeholder } = setup(); await runtime.play('A', placeholder, async () => {});
    n.created[0].failPause = true; runtime.stop(placeholder, { force: true }); n.mediaReset();
    assert.equal(n.created[0].released, true); assert.equal(n.created[0].audible, false);
  });

  test(`${platform}: unregister failure does not skip release; release failure does not undo unregister`, async () => {
    const first = setup(); await first.runtime.play('A', first.placeholder, async () => {});
    first.n.created[0].failRemove = true; first.runtime.stop(first.placeholder, { force: true });
    assert.equal(first.n.created[0].released, true);
    const second = setup(); await second.runtime.play('B', second.placeholder, async () => {});
    second.n.created[0].failRelease = true; second.runtime.stop(second.placeholder, { force: true });
    assert.equal(second.n.registered.size, 0); assert.equal(second.n.created[0].audible, false);
  });
}

test('ios: background event after successful Accept cannot clear its accepted-offer latch', async () => {
  const n = native(); const placeholder: any = {};
  const runtime = createDriverRequestAudio({ platform: 'ios', createPlayer: n.create });
  await runtime.play('accepted', placeholder, async () => {});
  runtime.stop(placeholder, { force: true }); runtime.suspend(placeholder);
  assert.equal(await runtime.play('accepted', placeholder, async () => {}), false);
  assert.equal(n.created.length, 1); assert.equal(n.created[0].released, true);
  assert.equal(runtime.rearmAfterFailedAccept('other'), false);
  assert.equal(runtime.rearmAfterFailedAccept('accepted'), true);
  assert.equal(await runtime.play('accepted', placeholder, async () => {}), true);
  assert.equal(n.created[1].audible, true);
});

test('iOS native model documents the old retained-player reset replay and its one-shot limit', async () => {
  const n = native(); const p = n.create(); const legacy = createDriverRequestAudio({ platform: 'ios' });
  await legacy.play('A', p, async () => {}); n.background(); legacy.stop(p, { force: true });
  assert.equal(p.audible, false); assert.equal(p.wasPlaying, true);
  n.mediaReset(); assert.equal(p.audible, true); assert.equal(p.loop, false);
  assert.equal(p.plays, 2, 'this baseline models one replay, not the reported continuous incident');
});
