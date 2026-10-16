import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const nativeMapSource = readFileSync(
  path.join(__dirname, '../components/NativeDriverGoogleMap.tsx'),
  'utf8',
);
const driverHomeSource = readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');

test('Driver native navigation keeps route, traffic, voice, and branded map controls inside HY3N', () => {
  assert.match(nativeMapSource, /trafficEnabled/);
  assert.match(nativeMapSource, /myLocationEnabled/);
  assert.match(nativeMapSource, /showTermsAndConditionsDialog/);
  assert.match(nativeMapSource, /setOnRouteChanged/);
  assert.match(nativeMapSource, /getRouteSegments/);
  assert.match(nativeMapSource, /mapViewController\.addPolyline/);
});

test('Driver Home retains one branded request sound per ride ID', () => {
  assert.match(driverHomeSource, /const playedOfferAlertIdsRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(driverHomeSource, /playedOfferAlertIdsRef\.current\.has\(offerId\)/);
  assert.match(driverHomeSource, /playedOfferAlertIdsRef\.current\.add\(offerId\)/);
  assert.doesNotMatch(driverHomeSource, /const notifiedOfferIds = useRef/);
});

test('Driver Home shows a prominent Android location disclosure before requesting background tracking', () => {
  assert.match(driverHomeSource, /DRIVER_BACKGROUND_LOCATION_DISCLOSURE/);
  assert.match(driverHomeSource, /shouldShowDriverBackgroundLocationDisclosure/);
  assert.match(driverHomeSource, /backgroundLocationDisclosureDecisionRef\.current = 'accepted'/);
  assert.match(driverHomeSource, /backgroundLocationDisclosureDecisionRef\.current = 'declined'/);
  assert.match(driverHomeSource, /if \(!cancelled\) requestBackgroundLocation\(\)/);
});

test('accepted queued trips activate immediately after the current trip ends', () => {
  assert.match(driverHomeSource, /const queuedRide = nextRide\?\.status === 'driver_queued' \? nextRide : null/);
  assert.match(driverHomeSource, /await activateQueuedTrip\.mutateAsync/);
  assert.match(driverHomeSource, /setActiveTrip\(activation\.ride\)/);
  assert.match(driverHomeSource, /setNextRide\(null\)/);
});

test('the trip screen stays map-first while retaining availability and destination controls', () => {
  assert.match(driverHomeSource, /!incomingRide && <View style=\{\[styles\.onlineCard/);
  assert.match(driverHomeSource, /You are Online/);
  assert.match(driverHomeSource, /Go Offline/);
  assert.match(driverHomeSource, /isOnline && !activeTrip && \(/);
  assert.match(driverHomeSource, /styles\.destFilterBar/);
  assert.match(nativeMapSource, /The branded MapView never switches at acceptance/);
  assert.match(nativeMapSource, /The HY3N car is/);
  assert.match(driverHomeSource, /activeTripDetails\(incomingRide\)\.bookedFare/);
  assert.match(driverHomeSource, /BOOKED FARE/);
  assert.doesNotMatch(driverHomeSource, /Active Trip Navigation Card/);
});

test('the normal online map is quiet until a ride needs the Driver’s attention', () => {
  assert.doesNotMatch(driverHomeSource, /Earnings trends/);
  assert.doesNotMatch(driverHomeSource, /styles\.trendsShortcut/);
  assert.match(driverHomeSource, /Set destination filter/);
  assert.match(driverHomeSource, /You are Online/);
  assert.match(driverHomeSource, /Go Offline/);
  assert.match(driverHomeSource, /triggerSOS/);
  assert.match(driverHomeSource, /notifications-none/);
  assert.match(driverHomeSource, /incomingRide && !activeTrip/);
  assert.match(driverHomeSource, /activeTrip && nextRide/);
});
