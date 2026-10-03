import assert from 'node:assert/strict';
import test from 'node:test';
import { driverTripTerminalStatus } from '../lib/driver-trip-lifecycle';

test('Driver clears a trip only for a server-authoritative terminal status', () => {
  assert.equal(driverTripTerminalStatus({ status: 'completed' }), 'completed');
  assert.equal(driverTripTerminalStatus({ status: 'cancelled' }), 'cancelled');
  assert.equal(driverTripTerminalStatus({ status: 'in_progress' }), null);
  assert.equal(driverTripTerminalStatus({ status: 'COMPLETED' }), 'completed');
  assert.equal(driverTripTerminalStatus(null), null);
});
