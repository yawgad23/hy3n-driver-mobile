import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerDriverForegroundLocationCleanup,
  stopDriverForegroundLocationWork,
} from '../lib/driver-foreground-location-runtime';

test('Driver foreground cleanup registry stops active callbacks before auth teardown', async () => {
  const calls: string[] = [];
  const unregisterWatch = registerDriverForegroundLocationCleanup(() => { calls.push('watch'); });
  const unregisterHeartbeat = registerDriverForegroundLocationCleanup(async () => { calls.push('heartbeat'); });

  await stopDriverForegroundLocationWork();
  unregisterWatch();
  unregisterHeartbeat();

  assert.deepEqual(calls.sort(), ['heartbeat', 'watch']);
});

test('Driver foreground cleanup registry does not repeat consumed callbacks', async () => {
  let calls = 0;
  const unregister = registerDriverForegroundLocationCleanup(() => { calls += 1; });

  await stopDriverForegroundLocationWork();
  await stopDriverForegroundLocationWork();
  unregister();

  assert.equal(calls, 1);
});
