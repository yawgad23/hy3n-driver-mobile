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
  assert.match(nativeMapSource, /React\.memo\(NativeDriverGoogleMap\)/);
});

test('Driver Home uses one server push alert and serializes incoming-offer refreshes', () => {
  assert.match(driverHomeSource, /createSingleFlightDriverOfferRefresher/);
  assert.match(driverHomeSource, /offerRefresherRef\.current\.refresh\(inputs\.refetch\)/);
  assert.match(driverHomeSource, /refetchInterval: false/);
  assert.match(driverHomeSource, /const interval = setInterval\(refreshAvailableOffers, DRIVER_OFFER_POLL_INTERVAL_MS\)/);
  assert.match(driverHomeSource, /useAudioPlayer\(/);
  assert.match(driverHomeSource, /incoming-trip-alert\.wav/);
  assert.match(driverHomeSource, /shouldPlayIncomingTripAlert/);
  assert.match(driverHomeSource, /incomingTripAudioRuntimeRef/);
  assert.match(driverHomeSource, /useAudioPlayerStatus/);
  assert.match(driverHomeSource, /incomingTripAlertStatus\.isLoaded/);
  assert.match(driverHomeSource, /driverOfferExpiryMs/);
  assert.match(driverHomeSource, /isDriverOfferWithinWindow/);
  assert.match(driverHomeSource, /retiredOfferLeaseRef/);
  assert.match(driverHomeSource, /shouldPresentDriverOffer/);
  assert.match(driverHomeSource, /isUnavailableDriverOfferError/);
  assert.match(driverHomeSource, /stopIncomingTripAlert\(true\)/);
  assert.match(driverHomeSource, /const activeNavigationTarget = useMemo/);
  assert.match(driverHomeSource, /transient empty response/);
  assert.doesNotMatch(driverHomeSource, /new Set/);
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
  assert.match(nativeMapSource, /NavigationView owns the live route/);
  assert.match(nativeMapSource, /Google owns route replacement/);
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
