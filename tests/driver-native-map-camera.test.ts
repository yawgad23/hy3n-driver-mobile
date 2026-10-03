import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeTrackingRegion } from '../lib/native-map-camera';

test('Driver follow camera stays close when no navigation target is active', () => {
  const region = nativeTrackingRegion([5.6037, -0.187], null, [5.6037, -0.187]);
  assert.ok(region);
  assert.ok(Math.abs(region.latitude - 5.60242) < 0.0000001);
  assert.equal(region.longitude, -0.187);
  assert.equal(region.latitudeDelta, 0.008);
  assert.equal(region.longitudeDelta, 0.008);
});

test('Driver follow camera does not zoom out for a city-spanning pickup or drop-off', () => {
  const region = nativeTrackingRegion([5.6037, -0.187], [5.74, -0.02], [5.6037, -0.187]);
  assert.ok(region);
  assert.ok(Math.abs(region.latitude - 5.60242) < 0.0000001);
  assert.equal(region.longitude, -0.187);
  assert.equal(region.latitudeDelta, 0.008);
  assert.equal(region.longitudeDelta, 0.008);
});

test('Driver follow camera keeps a genuinely nearby next stop in a bounded frame', () => {
  const region = nativeTrackingRegion([5.6037, -0.187], [5.609, -0.184], [5.6037, -0.187]);
  assert.ok(region);
  assert.ok(region.latitudeDelta >= 0.0065 && region.latitudeDelta <= 0.024);
  assert.ok(region.longitudeDelta >= 0.0065 && region.longitudeDelta <= 0.028);
});
