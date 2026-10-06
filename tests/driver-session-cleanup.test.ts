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
