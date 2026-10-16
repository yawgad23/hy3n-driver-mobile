import assert from 'node:assert/strict';
import test from 'node:test';
import { createSingleFlightDriverOfferRefresher } from '../lib/driver-offer-refresh';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('Driver offer refresh serializes push, poll, and resume requests into one trailing fetch', async () => {
  const gate = createSingleFlightDriverOfferRefresher();
  const first = deferred<void>();
  const second = deferred<void>();
  const started: number[] = [];
  let call = 0;

  const request = () => {
    call += 1;
    started.push(call);
    return call === 1 ? first.promise : second.promise;
  };

  gate.refresh(request);
  gate.refresh(request);
  gate.refresh(request);
  await flushAsyncWork();
  assert.deepEqual(started, [1]);

  first.resolve();
  await flushAsyncWork();
  assert.deepEqual(started, [1, 2]);

  second.resolve();
  await flushAsyncWork();
  assert.deepEqual(started, [1, 2]);
});

test('Driver offer refresh clears an obsolete queued refresh while offline', async () => {
  const gate = createSingleFlightDriverOfferRefresher();
  const first = deferred<void>();
  let calls = 0;
  const request = () => {
    calls += 1;
    return first.promise;
  };

  gate.refresh(request);
  gate.refresh(request);
  gate.clearPending();
  first.resolve();
  await flushAsyncWork();

  assert.equal(calls, 1);
});
