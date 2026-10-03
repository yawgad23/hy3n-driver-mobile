import assert from 'node:assert/strict';
import test from 'node:test';
import { DRIVER_FEE_STATUS_REFRESH_MS } from '../lib/driver-fee-polling';

test('Driver fee status refresh stays separate from critical offer polling', () => {
  assert.equal(DRIVER_FEE_STATUS_REFRESH_MS, 60_000);
});
