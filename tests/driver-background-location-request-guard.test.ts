import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginDriverBackgroundLocationRequest,
  finishDriverBackgroundLocationRequest,
  shouldShowDriverBackgroundLocationWarning,
} from '../lib/driver-background-location-request-guard';

test('a denied iOS or Android background-location request is blocked for the rest of the online session', () => {
  const first = beginDriverBackgroundLocationRequest({ shouldTrack: true, state: 'ready' });
  assert.deepEqual(first, { state: 'requesting', shouldRequest: true });

  const afterDenied = finishDriverBackgroundLocationRequest({
    started: false,
    reason: 'background_denied',
  });
  assert.equal(afterDenied, 'blocked');
  assert.equal(shouldShowDriverBackgroundLocationWarning({ started: false, reason: 'background_denied' }), true);

  const rerender = beginDriverBackgroundLocationRequest({ shouldTrack: true, state: afterDenied });
  assert.deepEqual(rerender, { state: 'blocked', shouldRequest: false });
});

test('the request guard resets only after tracking is stopped and a new online session starts', () => {
  const stopped = beginDriverBackgroundLocationRequest({ shouldTrack: false, state: 'blocked' });
  assert.deepEqual(stopped, { state: 'ready', shouldRequest: false });

  const newSession = beginDriverBackgroundLocationRequest({ shouldTrack: true, state: stopped.state });
  assert.deepEqual(newSession, { state: 'requesting', shouldRequest: true });
});

test('cancelled and unsupported requests do not create a repeat warning', () => {
  assert.equal(
    shouldShowDriverBackgroundLocationWarning({ started: false, reason: 'cancelled' }),
    false,
  );
  assert.equal(
    shouldShowDriverBackgroundLocationWarning({ started: false, reason: 'unsupported' }),
    false,
  );
});
