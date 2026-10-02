import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverLocationPublisher } from '../lib/driver-location-publisher-core';

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
