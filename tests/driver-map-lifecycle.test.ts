import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriverMapLifecycle, type DriverMapStatus } from '../lib/driver-map-lifecycle';

// This test-only package does not ship TypeScript declarations at this version.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FakeTimers = require('@sinonjs/fake-timers') as {
  install(options: { toFake: string[] }): { tick(ms: number): void; uninstall(): void };
};

type Harness = ReturnType<typeof harness>;
function harness() {
  const remounts: number[] = [];
  const probes: number[] = [];
  const statuses: DriverMapStatus[] = [];
  let replayed = 0;
  const map = new DriverMapLifecycle({
    onRemount: (generation) => remounts.push(generation),
    onProbe: (generation) => probes.push(generation),
    onReady: () => { replayed++; },
    onStatus: (status) => statuses.push(status),
  });
  return { map, remounts, probes, statuses, get replayed() { return replayed; } };
}

function ready(h: Harness) {
  h.map.setVisible(true);
  h.map.onLoadStart(0);
  h.map.onReadyMessage(0);
}

test('onLoadEnd alone is not a map-ready signal; HTML handshake replays latest GPS', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    h.map.setVisible(true);
    h.map.onLoadStart(0);
    assert.equal(h.map.isReady, false);
    assert.equal(h.replayed, 0);
    h.map.onReadyMessage(0);
    assert.equal(h.map.isReady, true);
    assert.equal(h.replayed, 1);
    clock.tick(13_000);
    assert.deepEqual(h.remounts, []);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('terminated iOS content process remounts once; stale events cannot remount again', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    ready(h);
    h.map.onFailure(0);
    h.map.onFailure(0);
    assert.deepEqual(h.remounts, [1]);
    h.map.onReadyMessage(0);
    assert.equal(h.map.isReady, false);
    h.map.onReadyMessage(1);
    assert.equal(h.replayed, 2);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('a process lost in the background is recovered only when foregrounded', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    ready(h);
    h.map.setVisible(false);
    h.map.onFailure(0);
    clock.tick(30_000);
    assert.deepEqual(h.remounts, []);
    h.map.setVisible(true);
    assert.deepEqual(h.remounts, [1]);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('a foreground health probe remounts once if the WebView stopped answering', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    ready(h);
    h.map.setVisible(false);
    h.map.setVisible(true);
    assert.deepEqual(h.probes, [0]);
    clock.tick(3_100);
    assert.deepEqual(h.remounts, [1]);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('a successful health pong keeps the map mounted; focus replays current GPS', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    ready(h);
    h.map.setVisible(false);
    h.map.setVisible(true);
    h.map.onPong(0);
    clock.tick(3_100);
    assert.deepEqual(h.remounts, []);
    assert.equal(h.replayed, 2);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('an iOS foreground event remounts a blank compositor even when JavaScript still responds', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    ready(h);
    h.map.setVisible(false);
    h.map.setVisible(true);
    h.map.onPong(0);
    h.map.recoverFromForeground();
    assert.deepEqual(h.remounts, [1]);
    assert.equal(h.map.isReady, false);
    h.map.onReadyMessage(1);
    assert.equal(h.map.isReady, true);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('map initialization errors and timeouts are bounded, then expose manual retry', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    h.map.setVisible(true);
    clock.tick(12_100);
    assert.deepEqual(h.remounts, [1]);
    h.map.onFailure(1);
    h.map.onFailure(2);
    assert.deepEqual(h.remounts, [1, 2]);
    assert.equal(h.statuses.at(-1), 'unavailable');
    clock.tick(60_000);
    assert.deepEqual(h.remounts, [1, 2]);
    h.map.retryManually();
    assert.deepEqual(h.remounts, [1, 2, 3]);
    h.map.dispose();
  } finally { clock.uninstall(); }
});

test('tile failures show a network warning but never remount or alter Driver online state', () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const h = harness();
    ready(h);
    h.map.onTileError(0);
    assert.equal(h.statuses.at(-1), 'tiles-unavailable');
    assert.deepEqual(h.remounts, []);
    h.map.onTilesRecovered(0);
    assert.equal(h.statuses.at(-1), 'ready');
    h.map.dispose();
  } finally { clock.uninstall(); }
});
