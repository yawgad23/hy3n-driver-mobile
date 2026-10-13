import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForDriverNativeUnmount } from '../lib/driver-signout-transition';

test('Driver sign-out waits for two render frames before Firebase auth changes', async () => {
  const frames: Array<() => void> = [];
  let settled = false;
  const barrier = waitForDriverNativeUnmount((callback) => frames.push(callback))
    .then(() => { settled = true; });

  assert.equal(frames.length, 1);
  frames.shift()?.();
  await Promise.resolve();
  assert.equal(frames.length, 1);
  assert.equal(settled, false);

  frames.shift()?.();
  await barrier;
  assert.equal(settled, true);
});
