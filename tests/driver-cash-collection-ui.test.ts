import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

test('Driver earnings labels direct Rider collections without a withdrawal claim', () => {
  const earnings = read('app/(tabs)/earnings.tsx');
  assert.match(earnings, /Collected directly from Riders/);
  assert.match(earnings, /not a HY3N withdrawal balance/);
  assert.doesNotMatch(earnings, /Available to withdraw/);
});

test('Driver MoMo information screen does not expose a payout request form', () => {
  const momo = read('app/driver/momo-settings.tsx');
  assert.match(momo, /Riders pay you directly/);
  assert.doesNotMatch(momo, /Request a payout/);
  assert.doesNotMatch(momo, /Amount to withdraw/);
});
