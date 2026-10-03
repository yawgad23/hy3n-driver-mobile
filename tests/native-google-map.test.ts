import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const component = readFileSync(path.join(process.cwd(), 'components/NativeDriverGoogleMap.tsx'), 'utf8');
const screen = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');
const camera = readFileSync(path.join(process.cwd(), 'lib/native-map-camera.ts'), 'utf8');

test('Driver active map uses native Google Maps rather than a WebView', () => {
  assert.match(component, /provider=\{PROVIDER_GOOGLE\}/);
  assert.match(component, /Marker\.Animated/);
  assert.match(component, /animatedDriverCoordinate\.timing/);
  assert.doesNotMatch(component, /react-native-webview/);
  assert.match(screen, /NativeDriverGoogleMap/);
});

test('Driver map keeps a close road-level follow camera and reconciles an accepted ride', () => {
  assert.match(component, /nativeTrackingRegion\(driverPoint, targetPoint, driverPoint\)/);
  assert.match(camera, /const DRIVER_FOLLOW_DELTA = 0\.008/);
  assert.match(camera, /MAX_TARGET_DISTANCE_KM_FOR_DRIVER_FRAME/);
  assert.match(screen, /DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS/);
  assert.match(screen, /firestoreDB\.get\(COLLECTIONS\.RIDES, rideId\)/);
  assert.match(screen, /driverOfferAcceptedByServer/);
});
