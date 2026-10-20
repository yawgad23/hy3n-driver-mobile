import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const component = readFileSync(path.join(process.cwd(), 'components/NativeDriverGoogleMap.tsx'), 'utf8');
const screen = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');
const configPlugin = readFileSync(path.join(process.cwd(), 'plugins/with-google-navigation.js'), 'utf8');
const appConfig = readFileSync(path.join(process.cwd(), 'app.config.ts'), 'utf8');

test('Driver runs the active iPhone route directly in Google NavigationView', () => {
  assert.match(component, /@googlemaps\/react-native-navigation-sdk/);
  assert.match(component, /NavigationView/);
  assert.match(component, /NavigationUIEnabledPreference\.AUTOMATIC/);
  assert.match(component, /usesNativeIPhoneRouteRenderer = Platform\.OS === 'ios' && hasTarget/);
  assert.match(component, /handleNavigationViewControllerCreated/);
  assert.match(component, /navigationViewControllerRef\.current = controller/);
  assert.match(component, /await navigationViewControllerRef\.current\?\.setNavigationUIEnabled\(true\)/);
  assert.match(component, /await navigationViewControllerRef\.current\?\.setNavigationUIEnabled\(false\)/);
  assert.match(component, /Google owns route replacement/);
  assert.match(component, /if \(Platform\.OS === 'ios'\) return;/);
  assert.match(screen, /NativeDriverGoogleMap/);
  assert.doesNotMatch(screen, /googleMapsTurnByTurnUri/);
  assert.doesNotMatch(screen, /launchGoogleMapsTurnByTurn/);
});

test('Driver retains Google route and voice navigation while preserving the server-owned trip target', () => {
  assert.match(component, /navigationController\.setDestination/);
  assert.match(component, /navigationController\.startGuidance/);
  assert.match(component, /navigationController\.clearDestinations/);
  assert.match(component, /if \(initializedRef\.current\) \{[\s\S]*navigationController\.stopGuidance\(\)/);
  assert.match(component, /AudioGuidance\.VOICE_ALERTS_AND_GUIDANCE/);
  assert.match(component, /AudioGuidance\.BLUETOOTH_AUDIO/);
  assert.match(component, /RouteStatus\.NO_ROUTE_FOUND/);
  assert.match(component, /setOnRouteChanged/);
  assert.match(component, /setOnReroutingRequestedByOffRoute/);
  assert.match(component, /preferSameSideOfRoad: true/);
  assert.match(component, /server-owned target changes/);
  assert.match(component, /Do not leave a prior pickup\/drop-off route visible/);
});

test('Driver keeps its HY3N car only outside active iPhone navigation and retains the Android route path', () => {
  assert.match(component, /DRIVER_VEHICLE_MARKER_ID = 'hy3n-driver-vehicle'/);
  assert.match(component, /driverMapMotionFrames/);
  assert.match(component, /if \(usesNativeIPhoneRouteRenderer\) return;/);
  assert.match(component, /usesNativeIPhoneRouteRenderer \? \(/);
  assert.match(component, /<MapView/);
  assert.match(component, /myLocationEnabled=\{false\}/);
  assert.match(component, /const drawNavigationRoute/);
  assert.match(component, /if \(Platform\.OS === 'ios'\) \{/);
  assert.match(component, /return Promise\.resolve\(Boolean\(hasTarget/);
  assert.match(component, /mapViewController\.addPolyline/);
  assert.match(component, /myLocationEnabled=\{false\}/);
  assert.match(configPlugin, /hy3n_driver_car_marker\.png/);
  assert.match(configPlugin, /IOS_DRIVER_CAR_MARKER = 'HY3NDriverCarMarker'/);
  assert.match(configPlugin, /hy3n-driver-navigation-car\.png/);
  assert.doesNotMatch(configPlugin, /HY3N_DRIVER_DISABLE_DEFAULT_LOCATION_INDICATOR/);
  assert.doesNotMatch(configPlugin, /myLocationEnabled = NO/);
});

test('Driver active navigation keeps the map clean and stable during live movement', () => {
  assert.match(component, /const HY3N_NAVIGATION_TERMS_OPTIONS = \{/);
  assert.match(component, /NavigationProvider builds the native routing engine/);
  assert.match(component, /termsAndConditionsDialogOptions=\{HY3N_NAVIGATION_TERMS_OPTIONS\}/);
  assert.match(component, /CLEAN_GOOGLE_STYLE/);
  assert.match(component, /featureType: 'poi'/);
  assert.match(component, /featureType: 'transit'/);
  assert.match(component, /nativeMapColorScheme/);
  assert.match(component, /mapStyle=\{CLEAN_GOOGLE_STYLE\}/);
  assert.match(component, /headerEnabled/);
  assert.match(component, /footerEnabled/);
  assert.match(component, /lastTargetKeyRef\.current === targetKey/);
});

test('Driver active map cleans up safely and does not fabricate a location', () => {
  assert.match(component, /clearDestinations\(\)/);
  assert.match(component, /stopGuidance\(\)/);
  assert.match(component, /navigationController\.cleanup\(\)/);
  assert.match(component, /native route is safer than/);
  assert.match(component, /Getting your live location/);
  assert.match(component, /does not use a fallback place/);
  assert.match(component, /Check Location Settings/);
  assert.match(component, /Linking\.openSettings\(\)/);
  assert.match(screen, /locationAccuracy=\{location\?\.coords\.accuracy \?\? null\}/);
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
