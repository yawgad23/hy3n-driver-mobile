import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const component = readFileSync(path.join(process.cwd(), 'components/NativeDriverGoogleMap.tsx'), 'utf8');
const screen = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');

test('Driver active map uses native Google Maps rather than a WebView', () => {
  assert.match(component, /provider=\{PROVIDER_GOOGLE\}/);
  assert.match(component, /Marker\.Animated/);
  assert.match(component, /animatedDriverCoordinate\.timing/);
  assert.doesNotMatch(component, /react-native-webview/);
  assert.match(screen, /NativeDriverGoogleMap/);
});
