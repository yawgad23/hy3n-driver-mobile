import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const component = readFileSync(path.join(process.cwd(), 'components/NativeDriverGoogleMap.tsx'), 'utf8');
const screen = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');
const configPlugin = readFileSync(path.join(process.cwd(), 'plugins/with-google-navigation.js'), 'utf8');

test('Driver active map uses embedded Google Navigation instead of leaving HY3N', () => {
  assert.match(component, /@googlemaps\/react-native-navigation-sdk/);
  assert.match(component, /<NavigationView/);
  assert.match(component, /navigationController\.setDestination/);
  assert.match(component, /navigationController\.startGuidance/);
  assert.match(component, /AudioGuidance\.VOICE_ALERTS_AND_GUIDANCE/);
  assert.match(component, /AudioGuidance\.BLUETOOTH_AUDIO/);
  assert.match(component, /RouteStatus\.NO_ROUTE_FOUND/);
  assert.match(component, /setOnLocationChanged/);
  assert.match(component, /Finding your position for turn-by-turn guidance/);
  assert.match(screen, /NativeDriverGoogleMap/);
  assert.doesNotMatch(screen, /googleMapsTurnByTurnUri/);
  assert.doesNotMatch(screen, /launchGoogleMapsTurnByTurn/);
});

test('Driver active map follows the Driver, re-routes for each pickup or drop-off, and cleans up safely', () => {
  assert.match(component, /setFollowingPerspective\(CameraPerspective\.TILTED\)/);
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

test('native build configuration persists the Navigation SDK API key and Android desugaring support', () => {
  assert.match(configPlugin, /com\.google\.android\.geo\.API_KEY/);
  assert.match(configPlugin, /coreLibraryDesugaringEnabled true/);
  assert.match(configPlugin, /desugar_jdk_libs_nio:2\.0\.4/);
  assert.match(configPlugin, /GMSServices\.provideAPIKey/);
});
