import assert from 'node:assert/strict';
import test from 'node:test';
import { driverNavigationFeedMatchesTarget, driverNavigationRemainingMetrics } from '../lib/driver-navigation-feed';

const target = { latitude: 5.704, longitude: -0.096 };
const nowMs = 100_000;
const validAfterMs = 90_000;
const nativeEvent = {
  hy3nTargetLatitude: target.latitude,
  hy3nTargetLongitude: target.longitude,
  hy3nRouteGeneration: 2,
  hy3nCapturedAtMs: nowMs,
};
const matches = (value: unknown, generation: number | null = 2) =>
  driverNavigationFeedMatchesTarget(value, target, validAfterMs, nowMs, generation);

// A stamped mock establishes JS filtering policy only, not native device proof.
test('a native-captured envelope for the active target and route generation is accepted', () => {
  assert.equal(matches(nativeEvent), true);
  assert.equal(matches({ ...nativeEvent, hy3nTargetLatitude: target.latitude + 1e-7 }), true);
  assert.equal(matches({ ...nativeEvent, hy3nCapturedAtMs: validAfterMs }), true);
  assert.equal(matches(nativeEvent, null), true, 'unknown expected generation still requires a native generation');
  assert.equal(driverNavigationFeedMatchesTarget(nativeEvent, target, validAfterMs, nowMs), true);
});

test('absent native capture context is never replaced by the JS receipt time', () => {
  for (const value of [null, undefined, 1, 'event', [], {}, { meters: 1200, seconds: 300 }, { ...nativeEvent, time: nowMs, hy3nCapturedAtMs: undefined }]) {
    assert.equal(matches(value), false);
  }
  for (const key of Object.keys(nativeEvent)) {
    const incomplete: Record<string, unknown> = { ...nativeEvent };
    delete incomplete[key];
    assert.equal(matches(incomplete), false, `missing ${key} must fail closed`);
  }
});

test('wrong targets, idle navigation and old or future route generations cannot leak across trips', () => {
  assert.equal(matches({ ...nativeEvent, hy3nTargetLatitude: target.latitude + 0.001 }), false);
  assert.equal(matches({ ...nativeEvent, hy3nTargetLongitude: target.longitude + 0.001 }), false);
  assert.equal(driverNavigationFeedMatchesTarget(nativeEvent, null, validAfterMs, nowMs, 2), false);
  assert.equal(matches({ ...nativeEvent, hy3nRouteGeneration: 1 }), false, 'same-coordinate previous ride is still stale');
  assert.equal(matches({ ...nativeEvent, hy3nRouteGeneration: 3 }), false);
  assert.equal(matches({ ...nativeEvent, hy3nRouteGeneration: 0 }, null), false);
  assert.equal(matches({ ...nativeEvent, hy3nRouteGeneration: -1 }, null), false);
});

test('native source capture time must follow invalidation and remain within the freshness window', () => {
  assert.equal(matches({ ...nativeEvent, hy3nCapturedAtMs: validAfterMs - 1 }), false);
  assert.equal(driverNavigationFeedMatchesTarget({ ...nativeEvent, hy3nCapturedAtMs: nowMs - 15_000 }, target, 0, nowMs, 2), true);
  assert.equal(driverNavigationFeedMatchesTarget({ ...nativeEvent, hy3nCapturedAtMs: nowMs - 15_001 }, target, 0, nowMs, 2), false);
  assert.equal(matches({ ...nativeEvent, hy3nCapturedAtMs: nowMs + 5_000 }), true);
  assert.equal(matches({ ...nativeEvent, hy3nCapturedAtMs: nowMs + 5_001 }), false);
});

test('non-numeric and non-finite context fields fail closed', () => {
  for (const key of Object.keys(nativeEvent)) {
    for (const invalid of [String(nativeEvent[key as keyof typeof nativeEvent]), null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(matches({ ...nativeEvent, [key]: invalid }), false, `${key}: ${String(invalid)}`);
    }
  }
  assert.equal(driverNavigationFeedMatchesTarget(nativeEvent, target, Number.NaN, nowMs, 2), false);
  assert.equal(driverNavigationFeedMatchesTarget(nativeEvent, target, validAfterMs, Number.POSITIVE_INFINITY, 2), false);
});

test('SDK remaining metrics use meters/seconds, not turn distance or guessed field names', () => {
  assert.deepEqual(driverNavigationRemainingMetrics({ meters: 2450, seconds: 481 }), { meters: 2450, seconds: 481 });
  assert.deepEqual(driverNavigationRemainingMetrics({ ...nativeEvent, meters: 0, seconds: 0 }), { meters: 0, seconds: 0 });
  assert.deepEqual(driverNavigationRemainingMetrics({ meters: 500 }), { meters: 500, seconds: null });
  assert.deepEqual(driverNavigationRemainingMetrics({ seconds: 60 }), { meters: null, seconds: 60 });
  assert.equal(driverNavigationRemainingMetrics({ remainingdistance: 2450, remainingtime: 481 }), null);
  assert.equal(driverNavigationRemainingMetrics({ distanceToCurrentStepMeters: 120 }), null);
});

test('malformed remaining metrics never invent zero ETA or total distance', () => {
  for (const value of [null, undefined, 'metrics', [], {}, { meters: -1, seconds: -1 }, { meters: '500', seconds: '60' }, { meters: Number.NaN, seconds: Number.POSITIVE_INFINITY }]) {
    assert.equal(driverNavigationRemainingMetrics(value), null);
  }
  assert.deepEqual(driverNavigationRemainingMetrics({ meters: -1, seconds: 60 }), { meters: null, seconds: 60 });
  assert.deepEqual(driverNavigationRemainingMetrics({ meters: 500, seconds: Number.NaN }), { meters: 500, seconds: null });
});
