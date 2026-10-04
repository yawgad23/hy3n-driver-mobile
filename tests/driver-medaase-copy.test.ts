import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('Driver runtime thank-you copy uses Medaase', () => {
  const home = read('app/(tabs)/home.tsx');
  const layout = read('app/(tabs)/_layout.tsx');

  assert.match(home, /Medaase!/);
  assert.match(layout, /Medaase for your payment/);
  assert.doesNotMatch(home, /thank you/i);
  assert.doesNotMatch(layout, /thank you/i);
});
