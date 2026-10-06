import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverTrackingSession } from '../lib/driver-tracking-session';

test('sign-out invalidates a pending Driver background-tracking start', () => {
  const session = createDriverTrackingSession();
  const pendingStart = session.capture();

  assert.equal(session.isCurrent(pendingStart), true);
  session.invalidate();
  assert.equal(session.isCurrent(pendingStart), false);
  assert.equal(session.isCurrent(session.capture()), true);
});
