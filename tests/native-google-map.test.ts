import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const component = readFileSync(path.join(process.cwd(), 'components/NativeDriverGoogleMap.tsx'), 'utf8');
const screen = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');
const configPlugin = readFileSync(path.join(process.cwd(), 'plugins/with-google-navigation.js'), 'utf8');
const appConfig = readFileSync(path.join(process.cwd(), 'app.config.ts'), 'utf8');

test('Driver active map uses embedded Google Navigation instead of leaving HY3N', () => {
  assert.match(component, /@googlemaps\/react-native-navigation-sdk/);
  assert.match(component, /<NavigationView/);
  assert.match(component, /navigationController\.setDestination/);
  assert.match(component, /navigationController\.startGuidance/);
  assert.match(component, /AudioGuidance\.VOICE_ALERTS_AND_GUIDANCE/);
  assert.match(component, /AudioGuidance\.BLUETOOTH_AUDIO/);
  assert.match(component, /RouteStatus\.NO_ROUTE_FOUND/);
  assert.match(component, /setOnLocationChanged/);
  assert.match(component, /Set the destination immediately/);
  assert.doesNotMatch(component, /if \(!navigationLocationReady\)/);
  assert.match(screen, /NativeDriverGoogleMap/);
  assert.doesNotMatch(screen, /googleMapsTurnByTurnUri/);
  assert.doesNotMatch(screen, /launchGoogleMapsTurnByTurn/);
});

test('Driver embedded navigation retains the existing HY3N car marker on both native maps', () => {
  assert.match(component, /DRIVER_VEHICLE_MARKER_ID = 'hy3n-driver-vehicle'/);
  assert.match(component, /regular Google map rather/);
  assert.match(component, /one heading-aware HY3N car/);
  assert.match(component, /mapViewController\.addMarker/);
  assert.match(component, /imgPath: DRIVER_VEHICLE_MARKER_ASSET/);
  assert.match(component, /rotation: Number\(heading\) \|\| 0/);
  assert.match(component, /flat: true/);
  assert.match(component, /if \(!mapViewController \|\| !hasDeviceLocation \|\| hasTarget\) return/);
  assert.match(component, /<MapView/);
  assert.match(component, /hasDeviceLocation && hasTarget \? \(/);
  assert.match(component, /: hasDeviceLocation \? \(/);
  assert.match(component, /onMapViewControllerCreated=\{setMapViewController\}/);
  assert.match(component, /removeMarker\(DRIVER_VEHICLE_MARKER_ID\)/);
  assert.match(component, /myLocationEnabled=\{false\}/);
  assert.match(component, /myLocationButtonEnabled=\{false\}/);
  assert.match(configPlugin, /hy3n_driver_car_marker\.png/);
  assert.match(configPlugin, /IOS_DRIVER_CAR_MARKER = 'HY3NDriverCarMarker'/);
  assert.match(configPlugin, /\$\{IOS_DRIVER_CAR_MARKER\}\.imageset/);
  assert.match(configPlugin, /HY3N_DRIVER_DISABLE_DEFAULT_LOCATION_INDICATOR/);
  assert.match(configPlugin, /_mapView\.myLocationEnabled = NO/);
});

test('Driver active navigation keeps the map clean and does not restart for each live-location render', () => {
  assert.match(component, /const HY3N_NAVIGATION_TERMS_OPTIONS = \{/);
  assert.match(component, /NavigationProvider builds its native controller/);
  assert.match(component, /termsAndConditionsDialogOptions=\{HY3N_NAVIGATION_TERMS_OPTIONS\}/);
  assert.match(component, /CLEAN_DAY_GOOGLE_STYLE/);
  assert.match(component, /featureType: 'poi'/);
  assert.match(component, /featureType: 'transit'/);
  assert.match(component, /mapColorScheme=\{MapColorScheme\.LIGHT\}/);
  assert.match(component, /navigationNightMode=\{NavigationNightMode\.FORCE_DAY\}/);
  assert.match(component, /mapStyle=\{CLEAN_DAY_GOOGLE_STYLE\}/);
  assert.doesNotMatch(component, /CLEAN_NIGHT_GOOGLE_STYLE/);
  assert.match(component, /CameraPerspective\.TOP_DOWN_NORTH_UP/);
  assert.match(component, /CameraPerspective\.TILTED/);
  assert.match(component, /NavigationView is reserved for an accepted trip/);
  assert.match(component, /The online map deliberately has no Navigation SDK guidance UI/);
  assert.match(component, /trafficIncidentCardsEnabled=\{false\}/);
  assert.match(component, /reportIncidentButtonEnabled=\{false\}/);
  assert.match(component, /buildingsEnabled=\{false\}/);
  assert.match(component, /lastTargetKeyRef\.current === targetKey/);
  assert.doesNotMatch(component, /navigationViewController, target, targetKey/);
});

test('Driver active map follows the Driver, re-routes for each pickup or drop-off, and cleans up safely', () => {
  assert.match(component, /hasTarget\s*\?\s*CameraPerspective\.TILTED/);
  assert.match(component, /CameraPerspective\.TOP_DOWN_NORTH_UP/);
  assert.match(component, /setFollowingPerspective\(perspective\)/);
  assert.match(component, /lastTargetKeyRef\.current === targetKey/);
  assert.match(component, /clearDestinations\(\)/);
  assert.match(component, /stopGuidance\(\)/);
  assert.match(component, /navigationController\.cleanup\(\)/);
  assert.match(screen, /DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS/);
  assert.match(screen, /firestoreDB\.get\(COLLECTIONS\.RIDES, rideId\)/);
  assert.match(screen, /driverOfferAcceptedByServer/);
});

test('Driver navigation never substitutes a fake map location and exposes settings recovery', () => {
  assert.match(component, /Getting your live location/);
  assert.match(component, /does not use a fallback place/);
  assert.match(component, /Check Location Settings/);
  assert.match(component, /Linking\.openSettings\(\)/);
  assert.match(screen, /getLastKnownPositionAsync/);
  assert.match(screen, /watchPositionAsync/);
  assert.match(screen, /hasBootstrapDriverLocation/);
});

test('Driver presents a map-app choice when Navigate is tapped during a trip', () => {
  assert.match(screen, /const openTripNavigation/);
  assert.match(screen, /setShowNavigationChooser\(true\)/);
  assert.match(screen, /const openSelectedTripNavigation/);
  assert.match(screen, /tripNavigationDestination\(activeTrip, phase\)/);
  assert.match(screen, /driverGoogleMapsAppUri/);
  assert.match(screen, /driverOtherAndroidMapsUri/);
  assert.match(screen, /driverMapAppNavigationUri/);
  assert.match(screen, /driverMapAppWebFallbackUri/);
  assert.match(screen, /Choose navigation app/);
  assert.match(screen, /Apple Maps/);
  assert.match(screen, /Google Maps/);
  assert.match(screen, /Other map app/);
  assert.match(screen, /style=\{\[styles\.navigateTripIconBtn, \{ backgroundColor: '#075985' \}\]\}/);
  assert.match(screen, /accessibilityHint="Choose Apple Maps, Google Maps, or another map app for this trip"/);
  assert.match(screen, /<MaterialIcons name="navigation" size=\{22\} color="#FFF" \/>/);
  assert.doesNotMatch(screen, /<Text style=\{styles\.actionBtnText\}>Navigate<\/Text>/);
  assert.match(screen, /navigateTripIconBtn: \{ alignItems: 'center', borderRadius: 12, height: 48, justifyContent: 'center', width: 48 \}/);
});

test('native build configuration persists the Navigation SDK API key and Android desugaring support', () => {
  assert.match(appConfig, /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID/);
  assert.match(appConfig, /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS/);
  assert.match(appConfig, /nativeGoogleNavigationPlugin/);
  assert.match(configPlugin, /com\.google\.android\.geo\.API_KEY/);
  assert.match(configPlugin, /coreLibraryDesugaringEnabled true/);
  assert.match(configPlugin, /desugar_jdk_libs_nio:2\.0\.4/);
  assert.match(configPlugin, /GMSServices\.provideAPIKey/);
});
