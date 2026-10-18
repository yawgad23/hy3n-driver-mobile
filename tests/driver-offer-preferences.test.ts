import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DRIVER_HIGH_RATED_RIDER_MINIMUM,
  DRIVER_LONG_TRIP_MINIMUM_KM,
  driverOfferRiderRating,
  mergeDriverOfferPreferences,
  offerMatchesDriverPreferences,
} from '../lib/driver-offer-preferences';

const homeSource = fs.readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
const hookSource = fs.readFileSync(path.join(__dirname, '../hooks/use-driver-preferences.ts'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '../app/(tabs)/settings.tsx'), 'utf8');

test('Long Trips Only is exactly over 10 km, not the former 8 km threshold', () => {
  const preferences = { longTripsOnly: true, preferHighRated: false };
  assert.equal(DRIVER_LONG_TRIP_MINIMUM_KM, 10);
  assert.equal(offerMatchesDriverPreferences({ distance_km: 10 }, preferences), false);
  assert.equal(offerMatchesDriverPreferences({ distance_km: 10.01 }, preferences), true);
  assert.equal(offerMatchesDriverPreferences({ estimated_distance_km: 8.5 }, preferences), false);
});

test('unrated Riders are not manufactured into a 5.0 rating', () => {
  assert.equal(DRIVER_HIGH_RATED_RIDER_MINIMUM, 4.5);
  assert.equal(driverOfferRiderRating({ rider_rating: null, rider_rating_count: 0 }), null);
  assert.equal(driverOfferRiderRating({ rider_rating: 4.6, rider_rating_count: 2 }), 4.6);
});

test('server preferences win over a stale device cache for every mounted Driver screen', () => {
  const merged = mergeDriverOfferPreferences(
    { autoAccept: false, soundAlerts: false, notifications: false },
    { autoAccept: true, soundAlerts: true, notifications: true },
  );
  assert.equal(merged.autoAccept, true);
  assert.equal(merged.soundAlerts, true);
  assert.equal(merged.notifications, true);
  assert.match(hookSource, /const listeners = new Set<Listener>\(\)/);
  assert.match(hookSource, /publish\(next\)/);
  assert.match(hookSource, /preferenceWriteQueueRef/);
});

test('Home invokes the current accept callback and Settings exposes a sync failure instead of a false confirmation', () => {
  assert.match(homeSource, /setTimeout\(\(\) => acceptRideRef\.current\(\), 2500\)/);
  assert.match(homeSource, /offerMatchesDriverPreferences\(ride, prefs\)/);
  assert.doesNotMatch(homeSource, /estimatedDistance >= 8/);
  assert.match(settingsSource, /syncError/);
  assert.match(settingsSource, /cloud-off/);
});
