import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDriverLocationPublisher,
  publishableDriverHeading,
  publishableDriverSpeedKmh,
} from '../lib/driver-location-publisher-core';

const sample = (seconds: number) => ({
  latitude: 5.6037 + seconds / 100_000,
  longitude: -0.187,
  heading: 90,
  speedKmh: 20,
  recordedAt: new Date(1_700_000_000_000 + seconds * 1_000).toISOString(),
});

test('Driver location publisher serialises samples and rejects an older replay', async () => {
  const seen: string[] = [];
  let unblockFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { unblockFirst = resolve; });
  const publisher = createDriverLocationPublisher({
    baseUrl: 'https://api.example.test',
    getToken: async () => 'token',
    post: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      seen.push(body.recordedAt);
      if (seen.length === 1) await firstGate;
      return { ok: true, status: 200 };
    },
  });

  const first = publisher.publish(sample(1));
  const second = publisher.publish(sample(2));
  unblockFirst?.();
  await Promise.all([first, second]);
  const replayed = await publisher.publish(sample(1));

  assert.deepEqual(seen, [sample(1).recordedAt, sample(2).recordedAt]);
  assert.equal(replayed, false);
});

test('Driver location publisher drops obsolete queued GPS points while a slow upload is in flight', async () => {
  const seen: string[] = [];
  let unblockFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { unblockFirst = resolve; });
  const publisher = createDriverLocationPublisher({
    baseUrl: 'https://api.example.test',
    getToken: async () => 'token',
    post: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      seen.push(body.recordedAt);
      if (seen.length === 1) await firstGate;
      return { ok: true, status: 200 };
    },
  });

  const first = publisher.publish(sample(1));
  await publisher.publish(sample(2));
  await publisher.publish(sample(3));
  const newest = publisher.publish(sample(4));
  unblockFirst?.();
  await Promise.all([first, newest]);

  assert.deepEqual(seen, [sample(1).recordedAt, sample(4).recordedAt]);
});

test('Driver session cleanup drops queued location work after sign-out', async () => {
  const seen: string[] = [];
  let unblockFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { unblockFirst = resolve; });
  const publisher = createDriverLocationPublisher({
    baseUrl: 'https://api.example.test',
    getToken: async () => 'token',
    post: async (_url, init) => {
      seen.push(JSON.parse(String(init.body)).recordedAt);
      if (seen.length === 1) await firstGate;
      return { ok: true, status: 200 };
    },
  });

  const first = publisher.publish(sample(1));
  await publisher.publish(sample(2));
  publisher.clear();
  unblockFirst?.();
  await first;

  assert.deepEqual(seen, [sample(1).recordedAt]);
  assert.equal(await publisher.publish(sample(3)), true);
  assert.deepEqual(seen, [sample(1).recordedAt, sample(3).recordedAt]);
});

test('Driver location publisher sends a repeated stationary iOS timestamp as an availability heartbeat', async () => {
  const seen: string[] = [];
  const publisher = createDriverLocationPublisher({
    baseUrl: 'https://api.example.test',
    getToken: async () => 'token',
    post: async (_url, init) => {
      seen.push(JSON.parse(String(init.body)).recordedAt);
      return { ok: true, status: 200 };
    },
  });

  const parkedSample = sample(1);
  assert.equal(await publisher.publish(parkedSample), true);
  assert.equal(await publisher.publish(parkedSample), true);
  assert.deepEqual(seen, [parkedSample.recordedAt, parkedSample.recordedAt]);
});

test('Driver location publisher treats iOS unknown heading as absent', () => {
  assert.equal(publishableDriverHeading(-1), null);
  assert.equal(publishableDriverHeading(null), null);
  assert.equal(publishableDriverHeading(270), 270);
  assert.equal(publishableDriverSpeedKmh(-1), null);
  assert.equal(publishableDriverSpeedKmh(0), 0);
});
