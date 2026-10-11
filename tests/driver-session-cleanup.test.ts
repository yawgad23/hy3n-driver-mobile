import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanUpDriverSession } from '../lib/driver-session-cleanup';

test('Driver sign-out clears queued GPS work before stopping native location tracking', async () => {
  const order: string[] = [];

  await cleanUpDriverSession({
    clearQueuedLocationUpdates: () => order.push('clear'),
    stopBackgroundLocationUpdates: async () => { order.push('stop'); },
  });

  assert.deepEqual(order, ['clear', 'stop']);
});

test('Driver sign-out stops foreground GPS work before location publication and native tracking cleanup', async () => {
  const order: string[] = [];

  await cleanUpDriverSession({
    stopForegroundLocationWork: async () => { order.push('foreground'); },
    clearQueuedLocationUpdates: () => order.push('clear'),
    stopBackgroundLocationUpdates: async () => { order.push('background'); },
  });

  assert.deepEqual(order, ['foreground', 'clear', 'background']);
});

test('Driver sign-out remains available when native tracking was already stopped', async () => {
  const reported: string[] = [];
  let cleared = false;

  await cleanUpDriverSession({
    clearQueuedLocationUpdates: () => { cleared = true; },
    stopBackgroundLocationUpdates: async () => { throw new Error('Location task was not found'); },
    report: (message) => reported.push(message),
  });

  assert.equal(cleared, true);
  assert.equal(reported.length, 1);
  assert.match(reported[0], /Location task was not found/);
});

test('Driver sign-out continues when foreground GPS cleanup has already failed', async () => {
  const order: string[] = [];
  const reported: string[] = [];

  await cleanUpDriverSession({
    stopForegroundLocationWork: async () => { throw new Error('watch already removed'); },
    clearQueuedLocationUpdates: () => order.push('clear'),
    stopBackgroundLocationUpdates: async () => { order.push('background'); },
    report: (message) => reported.push(message),
  });

  assert.deepEqual(order, ['clear', 'background']);
  assert.equal(reported.length, 1);
  assert.match(reported[0], /watch already removed/);
});
