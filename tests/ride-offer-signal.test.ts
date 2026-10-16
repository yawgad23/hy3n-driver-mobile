import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { emitDriverRideOffer, subscribeDriverRideOffer } from '../lib/ride-offer-signal';

const driverHomeSource = readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
const offerSignalSource = readFileSync(path.join(__dirname, '../lib/ride-offer-signal.ts'), 'utf8');

test('Driver offer signal notifies foreground offer queries and cleans up', () => {
  let received = 0;
  const unsubscribe = subscribeDriverRideOffer(() => { received += 1; });
  emitDriverRideOffer();
  unsubscribe();
  unsubscribe();
  emitDriverRideOffer();
  assert.equal(received, 1);
});

test('Driver offer listeners may unsubscribe during delivery without skipping a different listener', () => {
  const delivered: string[] = [];
  let unsubscribeFirst = () => {};
  unsubscribeFirst = subscribeDriverRideOffer(() => {
    delivered.push('first');
    unsubscribeFirst();
  });
  const unsubscribeSecond = subscribeDriverRideOffer(() => delivered.push('second'));

  emitDriverRideOffer();
  emitDriverRideOffer();
  unsubscribeSecond();

  assert.deepEqual(delivered, ['first', 'second', 'second']);
});

test('incoming offer refresh keeps one stable subscription and avoids a duplicate local iPhone notification', () => {
  assert.match(driverHomeSource, /const offerRefreshInputsRef = useRef\(/);
  assert.match(driverHomeSource, /const refreshAvailableOffers = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/);
  assert.match(driverHomeSource, /useEffect\(\(\) => subscribeDriverRideOffer\(refreshAvailableOffers\), \[refreshAvailableOffers\]\);/);
  assert.doesNotMatch(offerSignalSource, /new Set<OfferListener>/);
  assert.doesNotMatch(offerSignalSource, /listeners\.delete\(/);

  const offerEffect = driverHomeSource.slice(
    driverHomeSource.indexOf('// Receive only server-filtered, unassigned offers.'),
    driverHomeSource.indexOf('// Recover a trip if the app is reopened while the driver is already assigned.'),
  );
  assert.doesNotMatch(offerEffect, /scheduleNotificationAsync/);
  assert.doesNotMatch(offerEffect, /notifiedOfferIds/);
});
