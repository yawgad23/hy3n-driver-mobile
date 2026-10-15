import assert from 'node:assert/strict';
import test from 'node:test';
import { isLatestDriverProfileLoad } from '../lib/driver-profile-load-order';

test('a post-phone-link profile refresh wins over the earlier session profile read', () => {
  const initialSessionRead = 1;
  const postLinkRefresh = 2;

  assert.equal(isLatestDriverProfileLoad(initialSessionRead, postLinkRefresh), false);
  assert.equal(isLatestDriverProfileLoad(postLinkRefresh, postLinkRefresh), true);
});
