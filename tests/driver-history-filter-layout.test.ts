import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Driver History filter chips wrap instead of clipping the Cancelled control on a narrow iPhone', () => {
  const source = readFileSync('app/(tabs)/history.tsx', 'utf8');

  assert.match(source, /filterRow:\s*\{[^}]*flexWrap:\s*'wrap'/s);
  assert.doesNotMatch(source, /filterRow:\s*\{[^}]*flexWrap:\s*'nowrap'/s);
  assert.match(source, /\{ key: 'cancelled', label: 'Cancelled' \}/);
});
