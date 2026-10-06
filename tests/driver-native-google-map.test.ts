import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const nativeMapSource = readFileSync(
  path.join(__dirname, '../components/NativeDriverGoogleMap.tsx'),
  'utf8',
);
const driverHomeSource = readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');

test('Driver native map cancels marker animation before an updated target and on unmount', () => {
  assert.match(nativeMapSource, /animatedDriverCoordinate\.stopAnimation\(\(\) => \{\}\);\s*animatedDriverCoordinate\.timing/);
  assert.match(
    nativeMapSource,
    /useEffect\(\(\) => \(\) => \{\s*animatedDriverCoordinate\.stopAnimation\(\(\) => \{\}\);\s*\}, \[animatedDriverCoordinate\]\)/,
  );
});

test('Driver Home retains one branded request sound per ride ID', () => {
  assert.match(driverHomeSource, /const playedOfferAlertIdsRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(driverHomeSource, /playedOfferAlertIdsRef\.current\.has\(offerId\)/);
  assert.match(driverHomeSource, /playedOfferAlertIdsRef\.current\.add\(offerId\)/);
});
