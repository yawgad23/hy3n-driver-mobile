import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverNavigationDiagnostics, navigationErrorCode } from '../lib/driver-navigation-diagnostics';
import { driverRouteStartsAtLocation } from '../lib/driver-route-progress';

test('navigation diagnostics drop coordinates, identities, credentials and raw messages', () => {
  const rows: any[] = [];
  const trace = createDriverNavigationDiagnostics(true, (stage, fields) => rows.push({ stage, fields }));
  trace('route.response', { request: 2, status: 'NETWORK_ERROR', latitude: 5.7, longitude: -0.1,
    riderId: 'rider-example', token: 'sensitive-example', message: 'sensitive address', reason: 'https://private.example/token', ageMs: Number.NaN } as any);
  assert.deepEqual(rows, [{ stage: 'route.response', fields: { request: 2, status: 'NETWORK_ERROR' } }]);
  assert.equal(navigationErrorCode({ code: 'sensitive-example' }), 'native_error');
  assert.equal(navigationErrorCode({ code: 'NO_VIEW_CONTROLLER', message: 'sensitive-example' }), 'NO_VIEW_CONTROLLER');
});

test('temporary diagnostic output is bounded and can be disabled', () => {
  let count = 0;
  const trace = createDriverNavigationDiagnostics(true, () => { count++; });
  for (let i = 0; i < 1000; i++) trace('gps.sample', { valid: true });
  assert.equal(count, 240);
  createDriverNavigationDiagnostics(false, () => { count++; })('route.request');
  assert.equal(count, 240);
});

test('a diagnostic sink failure never interrupts navigation', () => {
  const trace = createDriverNavigationDiagnostics(true, () => { throw new Error('sink failed'); });
  assert.doesNotThrow(() => trace('route.response', { status: 'OK' }));
});

test('confirmed route starts must be near the observed driver, not just end at the same target', () => {
  const fix = { latitude: 5.702, longitude: -0.1 };
  const target = { lat: 5.704, lng: -0.096 };
  assert.equal(driverRouteStartsAtLocation([{ lat: fix.latitude, lng: fix.longitude }, target], fix), true);
  assert.equal(driverRouteStartsAtLocation([{ lat: 5.7, lng: -0.1 }, target], fix), false);
  assert.equal(driverRouteStartsAtLocation([], fix), false);
  assert.equal(driverRouteStartsAtLocation([{ lat: Number.NaN, lng: -0.1 }, target], fix), false);
  assert.equal(driverRouteStartsAtLocation([target], null), false);
});
