import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDriverRequestAudio,
  createDriverRequestAudioSession,
  stopAllDriverRequestAudio,
  type DriverRequestAudioSession,
  type OwnedDriverRequestAudioPlayer,
} from '../lib/driver-request-audio';
import type { DriverRequestAudioEvent } from '../lib/driver-request-audio-diagnostics';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class NativePlayer implements OwnedDriverRequestAudioPlayer {
  id = 'request-player';
  isLoaded = true;
  playing = false;
  muted = false;
  volume = 1;
  loop = false;
  released = false;
  removed = false;
  plays = 0;
  events: string[] = [];
  listeners = new Set<(status: { isLoaded: boolean }) => void>();
  hy3nStopRequestAudio?: () => void;
  pause() { this.events.push('pause'); this.playing = false; }
  seekTo = async (_seconds: number) => {};
  play() { assert.equal(this.released, false); this.plays++; this.playing = true; }
  remove() { this.events.push('remove'); this.removed = true; }
  release() { this.events.push('release'); this.released = true; this.playing = false; }
  addListener(_event: 'playbackStatusUpdate', listener: (status: { isLoaded: boolean }) => void) {
    this.listeners.add(listener);
    return { remove: () => { this.listeners.delete(listener); } };
  }
  load() { this.isLoaded = true; for (const listener of [...this.listeners]) listener({ isLoaded: true }); }
  get audible() { return this.playing && !this.muted && this.volume > 0 && !this.released; }
}

function fixture(session?: DriverRequestAudioSession, configurePlayer: (player: NativePlayer, index: number) => void = () => {}, platform = 'ios') {
  const created: NativePlayer[] = [];
  const diagnostics: DriverRequestAudioEvent[] = [];
  const hook = new NativePlayer();
  hook.isLoaded = false;
  hook.playing = true;
  const runtime = createDriverRequestAudio({
    platform, session, onDiagnostic: event => { diagnostics.push(event); },
    createPlayer: () => {
      const player = new NativePlayer();
      created.push(player);
      configurePlayer(player, created.length - 1);
      return player;
    },
  });
  const play = (id: string, configure: () => Promise<void> = async () => {}, isEligible?: () => boolean) => runtime.play(id, hook, configure, isEligible);
  return { runtime, created, hook, diagnostics, play };
}

function assertRetired(player: NativePlayer) {
  assert.equal(player.plays <= 1, true);
  assert.equal(player.audible, false);
  assert.equal(player.removed, true);
  assert.equal(player.released, true);
  assert.equal(player.loop, false);
  assert.equal(player.muted, true);
  assert.equal(player.volume, 0);
  assert.equal(player.listeners.size, 0);
}

for (const sameOffer of [true, false]) {
  test(`terminal stop reaches two audible retained owners with ${sameOffer ? 'same' : 'different'} offers`, async () => {
    const session = createDriverRequestAudioSession();
    const first = fixture(session); const second = fixture(session);
    assert.equal(await first.play('accepted-A'), true);
    assert.equal(await second.play(sameOffer ? 'accepted-A' : 'stale-B'), true);
    assert.equal(first.created[0].audible, true); assert.equal(second.created[0].audible, true);
    session.stopAll('accepted-A');
    assertRetired(first.created[0]); assertRetired(second.created[0]);
    first.runtime.suspend(first.hook); second.runtime.suspend(second.hook);
    const remounted = fixture(session);
    assert.equal(await remounted.play('accepted-A'), false);
    assert.equal(await remounted.play(sameOffer ? 'accepted-A' : 'stale-B'), false);
    assert.equal(remounted.created.length, 0, 'suppression precedes native creation');
    assert.equal(await remounted.play('genuinely-new-later-offer'), true);
    assert.equal(remounted.created[0].audible, true);
    remounted.runtime.stop(remounted.hook);
  });
}

test('the exported production terminal API reaches default shared owners and explicit IDs before creation', async () => {
  const first = fixture(); const second = fixture();
  await first.play('shared-default-A'); await second.play('shared-default-B');
  stopAllDriverRequestAudio('not-yet-created-confirmed-C');
  assertRetired(first.created[0]); assertRetired(second.created[0]);
  const third = fixture();
  assert.equal(await third.play('shared-default-A'), false);
  assert.equal(await third.play('shared-default-B'), false);
  assert.equal(await third.play('not-yet-created-confirmed-C'), false);
  assert.equal(third.created.length, 0);
});

for (const stage of ['configure', 'readiness', 'seek', 'seek-readiness'] as const) {
  test(`terminal stop cancels every pending ${stage} owner, even after permitted failed-Accept rearm`, async () => {
    const session = createDriverRequestAudioSession(); const wait = deferred();
    const configurePlayer = (player: NativePlayer) => {
      if (stage === 'readiness') player.isLoaded = false;
      if (stage === 'seek') player.seekTo = () => wait.promise;
      if (stage === 'seek-readiness') player.seekTo = async () => { player.isLoaded = false; };
    };
    const first = fixture(session, configurePlayer); const second = fixture(session, configurePlayer);
    const configure = stage === 'configure' ? () => wait.promise : async () => {};
    const pendingFirst = first.play('pending-A', configure); const pendingSecond = second.play('pending-B', configure);
    await flush();
    if (stage === 'readiness' || stage === 'seek-readiness') {
      assert.equal(first.created[0].listeners.size, 1); assert.equal(second.created[0].listeners.size, 1);
    }
    session.stopAll();
    const remounted = fixture(session);
    assert.equal(await remounted.play('pending-A'), false);
    assert.equal(await remounted.play('pending-B'), false);
    assert.equal(first.runtime.rearmAfterFailedAccept('pending-A'), true);
    assert.equal(await remounted.play('pending-A'), true, 'fresh eligible attempt may rearm, old generation may not');
    wait.resolve(); first.created[0].load(); second.created[0].load();
    assert.equal(await pendingFirst, false); assert.equal(await pendingSecond, false);
    assert.equal(first.created[0].plays, 0); assert.equal(second.created[0].plays, 0);
    assertRetired(first.created[0]); assertRetired(second.created[0]);
    remounted.runtime.stop(remounted.hook);
  });
}

test('explicit failed-Accept rearm clears only the matching shared offer and is one-shot', async () => {
  const session = createDriverRequestAudioSession(); const first = fixture(session); const second = fixture(session);
  await first.play('failure-A'); await second.play('other-B'); session.stopAll();
  assert.equal(first.runtime.rearmAfterFailedAccept(''), false);
  assert.equal(first.runtime.rearmAfterFailedAccept('never-consumed-C'), false);
  assert.equal(first.runtime.rearmAfterFailedAccept('failure-A'), true);
  assert.equal(first.runtime.rearmAfterFailedAccept('failure-A'), false);
  assert.equal(await first.play('failure-A'), true);
  const remount = fixture(session);
  assert.equal(await remount.play('other-B'), false);
  first.runtime.stop(first.hook);
});

test('explicit terminal consumption after a local pre-RPC stop prevents stale remounts', async () => {
  const session = createDriverRequestAudioSession(); const first = fixture(session);
  await first.play('locally-stopped-A'); first.runtime.stop(first.hook, { force: true });
  session.stopAll('locally-stopped-A');
  assert.equal(await fixture(session).play('locally-stopped-A'), false);
});

test('a fresh iOS controller may explicitly rearm an ID consumed before native creation', async () => {
  const session = createDriverRequestAudioSession(); session.stopAll('early-A');
  const remount = fixture(session);
  assert.equal(await remount.play('early-A'), false);
  assert.equal(remount.runtime.rearmAfterFailedAccept('early-A'), true);
  assert.equal(remount.runtime.rearmAfterFailedAccept('early-A'), false);
  assert.equal(await remount.play('early-A'), true);
  remount.runtime.stop(remount.hook);
});

test('eager unused constructors never enter the live/pending owner registry', () => {
  const session = createDriverRequestAudioSession(); const fixtures = [];
  for (let i = 0; i < 500; i++) fixtures.push(fixture(session));
  session.stopAll();
  assert.equal(fixtures.every(owner => owner.created.length === 0 && owner.diagnostics.length === 0 && owner.hook.events.length === 0), true);
});

for (const retirement of ['stop', 'suspend', 'failed-configure', 'failed-factory', 'ineligible'] as const) {
  test(`${retirement} unregisters retired owners and does not globally consume viable offers`, async () => {
    const session = createDriverRequestAudioSession(); const owner = fixture(session); const id = `viable-${retirement}`;
    if (retirement === 'failed-factory') {
      const events: DriverRequestAudioEvent[] = [];
      const failed = createDriverRequestAudio({ platform: 'ios', session, createPlayer: () => { throw Error('factory failed'); }, onDiagnostic: e => { events.push(e); } });
      assert.equal(await failed.play(id, owner.hook, async () => {}), false);
      const count = events.length; session.stopAll(); assert.equal(events.length, count);
    } else if (retirement === 'failed-configure') {
      assert.equal(await owner.play(id, async () => { throw Error('configure failed'); }), false);
    } else if (retirement === 'ineligible') {
      let eligible = true; const wait = deferred();
      const pending = owner.play(id, () => wait.promise, () => eligible); await flush();
      eligible = false; wait.resolve(); assert.equal(await pending, false);
    } else {
      await owner.play(id); owner.runtime[retirement](owner.hook);
    }
    const count = owner.diagnostics.length;
    session.stopAll();
    assert.equal(owner.diagnostics.length, count, 'retired owner must not receive another terminal stop');
    const remount = fixture(session);
    assert.equal(await remount.play(id), true, 'local lifecycle retirement must not suppress a viable cached offer globally');
    remount.runtime.stop(remount.hook);
  });
}

test('replacing pending work unregisters old ownership without stale continuation releasing the new source', async () => {
  const session = createDriverRequestAudioSession(); const owner = fixture(session); const wait = deferred();
  const pending = owner.play('old-pending', () => wait.promise); await flush();
  assert.equal(await owner.play('new-live'), true);
  session.stopAll(); wait.resolve(); assert.equal(await pending, false);
  const remount = fixture(session);
  assert.equal(await remount.play('new-live'), false);
  assert.equal(await remount.play('old-pending'), true, 'retired replaced offer was not live at terminal boundary');
  remount.runtime.stop(remount.hook);
});

test('successful native stop skips session-deactivating ordinary pause; old binaries retain fallback retirement', async () => {
  const session = createDriverRequestAudioSession();
  const owner = fixture(session, player => { player.hy3nStopRequestAudio = () => { player.events.push('native-terminal'); player.playing = false; }; });
  await owner.play('patched-A'); session.stopAll();
  assert.deepEqual(owner.created[0].events, ['native-terminal', 'remove', 'release']);
  assertRetired(owner.created[0]);
  const oldBinary = fixture(session); await oldBinary.play('unpatched-B'); session.stopAll();
  assert.deepEqual(oldBinary.created[0].events, ['pause', 'remove', 'release']); assertRetired(oldBinary.created[0]);
});

test('throwing native stop hook is diagnosed locally and cannot skip pause/remove/release', async () => {
  const session = createDriverRequestAudioSession();
  const owner = fixture(session, player => { player.hy3nStopRequestAudio = () => { throw Error('private native failure'); }; });
  await owner.play('private-offer-ID'); session.stopAll();
  assertRetired(owner.created[0]);
  assert.equal(owner.diagnostics.filter(event => event.event === 'native-operation-failed').length, 1);
  assert.equal(JSON.stringify(owner.diagnostics).includes('private-offer-ID'), false);
  assert.equal(JSON.stringify(owner.diagnostics).includes('private native failure'), false);
});

test('terminal stop neither disposes borrowed hook players nor touches unrelated audio', async () => {
  const session = createDriverRequestAudioSession(); const native = fixture(session);
  const guidance = new NativePlayer(); guidance.play();
  const borrowed = new NativePlayer();
  const legacyRequest = createDriverRequestAudio({ platform: 'ios', session });
  assert.equal(await legacyRequest.play('borrowed-request', borrowed, async () => {}), true);
  await native.play('owned-request'); session.stopAll();
  assert.equal(borrowed.playing, false); assert.equal(borrowed.muted, true); assert.equal(borrowed.volume, 0);
  assert.equal(borrowed.removed, false); assert.equal(borrowed.released, false);
  assert.equal(native.hook.playing, true); assert.equal(native.hook.events.length, 0);
  assert.equal(guidance.audible, true); assert.equal(guidance.removed, false); assert.equal(guidance.released, false);
  assert.equal(guidance.events.length, 0);
});

test('independent injected sessions do not share suppression or stop owners in another test', async () => {
  const one = createDriverRequestAudioSession(); const two = createDriverRequestAudioSession();
  const first = fixture(one); const second = fixture(two);
  await first.play('offer-A'); await second.play('offer-A'); one.stopAll();
  assertRetired(first.created[0]); assert.equal(second.created[0].audible, true);
  assert.equal(await fixture(one).play('offer-A'), false);
  second.runtime.stop(second.hook);
  assert.equal(await second.play('offer-A'), false, 'the pre-existing local iOS played latch remains intact');
});

test('bounded suppression remembers 128 recent terminal IDs without retaining unbounded history', async () => {
  const session = createDriverRequestAudioSession();
  for (let i = 0; i < 129; i++) session.stopAll(`bounded-${i}`);
  const owner = fixture(session);
  assert.equal(await owner.play('bounded-128'), false);
  assert.equal(await owner.play('bounded-1'), false);
  assert.equal(await owner.play('bounded-0'), true, 'oldest entry is evicted; Home eligibility remains authoritative');
  owner.runtime.stop(owner.hook);
});

test('auth-style no-ID stop preserves previous terminal suppression', async () => {
  const session = createDriverRequestAudioSession(); session.stopAll('previously-accepted');
  const owner = fixture(session); await owner.play('currently-pending-auth'); session.stopAll();
  assertRetired(owner.created[0]);
  const remount = fixture(session);
  assert.equal(await remount.play('previously-accepted'), false);
  assert.equal(await remount.play('currently-pending-auth'), false);
});

test('Android retains its prior local restart behavior unless the terminal session API is explicitly used', async () => {
  const session = createDriverRequestAudioSession(); const owner = fixture(session, () => {}, 'android');
  await owner.play('android-A'); owner.runtime.stop(owner.hook);
  assert.equal(await owner.play('android-A'), true);
  session.stopAll();
  assert.equal(await owner.play('android-A'), false);
  assert.equal(owner.runtime.rearmAfterFailedAccept('android-A'), true);
  assert.equal(await owner.play('android-A'), true, 'explicit fresh-server permission allows Android retry');
  owner.runtime.stop(owner.hook);
});

test('terminal-stop diagnostics cannot synchronously resurrect a newly named request', async () => {
  const session = createDriverRequestAudioSession(); let replay: Promise<boolean> | undefined;
  const player = new NativePlayer(); const hook = new NativePlayer();
  const runtime = createDriverRequestAudio({ platform: 'ios', session, createPlayer: () => player,
    onDiagnostic: event => { if (event.event === 'stop-requested') replay = runtime.play('new-from-stop-callback', hook, async () => {}); },
  });
  await runtime.play('accepted-before-callback', hook, async () => {}); session.stopAll();
  assert.equal(await replay, false); assertRetired(player);
});

for (const boundary of ['play-requested', 'factory', 'player-created'] as const) {
  test(`terminal stop from synchronous ${boundary} cancels pending ownership before configure`, async () => {
    const session = createDriverRequestAudioSession(); const player = new NativePlayer();
    const events: DriverRequestAudioEvent[] = []; let creates = 0; let configures = 0;
    const runtime = createDriverRequestAudio({ platform: 'ios', session,
      createPlayer: () => { creates++; if (boundary === 'factory') session.stopAll(); return player; },
      onDiagnostic: event => {
        events.push(event);
        if (event.event === boundary) session.stopAll();
      },
    });
    assert.equal(await runtime.play('synchronously-consumed', new NativePlayer(), async () => { configures++; }), false);
    assert.equal(configures, 0);
    assert.equal(creates, boundary === 'play-requested' ? 0 : 1);
    if (creates) assertRetired(player);
    const count = events.length; session.stopAll();
    assert.equal(events.length, count, 'cancelled owner must not remain registered');
    assert.equal(await fixture(session).play('synchronously-consumed'), false);
  });
}
