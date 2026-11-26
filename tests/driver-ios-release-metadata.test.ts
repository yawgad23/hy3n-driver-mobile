import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { addSdkMatchedPhotoDependencies, withoutDriverPhotoLockAdditions } from './helpers/driver-photo-dependencies';

const root = path.join(__dirname, '..');
const baseline = '674e81c0e15353c4e813d5e688fb3d1240ed5d81';
const previous = (file: string) => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
const current = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const clientKeys = { GOOGLE_MAPS_IOS_API_KEY: 'ios-client-test-key', GOOGLE_MAPS_ANDROID_API_KEY: 'android-client-test-key' };

function config(source: string, platform?: string, keys: Record<string, string> = clientKeys) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    process: { env: { ...keys, ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}) } },
    require: (name: string) => {
      assert.equal(name, './scripts/load-env.js');
      return {};
    },
  });
  return JSON.parse(JSON.stringify(exports.default));
}

const ios = config(current('app.config.ts'), 'ios');

test('SDK 27 combined navigation candidate uses approved iOS version 1.2 build 129 and retains Driver identity', () => {
  assert.equal(ios.name, 'HY3N Driver');
  assert.equal(ios.version, '1.2');
  assert.equal(ios.ios.buildNumber, '129');
  assert.equal(ios.ios.bundleIdentifier, 'com.hy3n.driver');
  assert.equal(ios.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(ios.owner, 'yawgad');
});

test('version-train correction changes only iOS release metadata and retains all combined fixes from build 128', () => {
  const combined = 'e37d43892e6e7d4d24d5401edcd6afa8bbcc114b';
  const combinedSource = (file: string) => execFileSync('git', ['show', `${combined}:${file}`], { cwd: root, encoding: 'utf8' });
  for (const platform of ['ios', 'android', undefined, 'web']) {
    const expected = config(combinedSource('app.config.ts'), platform);
    if (platform === 'ios') {
      expected.version = '1.2';
      expected.ios.buildNumber = '129';
    }
    assert.deepEqual(config(current('app.config.ts'), platform), expected);
  }
  for (const file of ['components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts', 'lib/driver-navigation-camera.ts', 'eas.json']) {
    assert.equal(current(file), combinedSource(file), file);
  }
});

test('only the enumerated SDK 27 compatibility and iPhone release metadata differ from build 126', () => {
  for (const platform of ['ios', 'android', undefined, 'web']) {
    const expected = config(previous('app.config.ts'), platform);
    if (platform === 'ios') {
      expected.version = '1.2';
      expected.ios.buildNumber = '129';
    }
    delete expected.newArchEnabled; // SDK 57 makes the New Architecture mandatory.
    delete expected.ios.jsEngine; // SDK 57 no longer exposes this JSC switch.
    delete expected.android.edgeToEdgeEnabled; // SDK 57 makes edge-to-edge mandatory.
    expected.plugins.unshift('./plugins/with-driver-ios-sdk27');
    const properties = expected.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-build-properties')[1];
    Object.assign(properties.ios, {
      enableSceneSupport: true,
      deploymentTarget: '16.4',
      useHermesV1: true,
      usePrecompiledModules: false,
    });
    assert.deepEqual(config(current('app.config.ts'), platform), expected);
  }
});

test('Android identity, version code, permissions and non-obsolete platform fields remain preserved', () => {
  const expected = config(previous('app.config.ts'), 'android').android;
  delete expected.edgeToEdgeEnabled;
  assert.deepEqual(config(current('app.config.ts'), 'android').android, expected);
  assert.equal(expected.versionCode, 57023);
  assert.equal(expected.package, 'com.hy3n.driver');
});

test('native Maps injection retains production key alias precedence without hardcoded keys', () => {
  const plugin = ios.plugins.find((p: any) => Array.isArray(p) && p[0] === './plugins/with-google-navigation');
  assert.deepEqual(plugin, ['./plugins/with-google-navigation', { iosApiKey: clientKeys.GOOGLE_MAPS_IOS_API_KEY, androidApiKey: clientKeys.GOOGLE_MAPS_ANDROID_API_KEY }]);
  const fallback = config(current('app.config.ts'), 'ios', {
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-fallback-client-key',
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-fallback-client-key',
  });
  assert.deepEqual(fallback.plugins.find((p: any) => Array.isArray(p) && p[0] === './plugins/with-google-navigation'), ['./plugins/with-google-navigation', { iosApiKey: 'ios-fallback-client-key', androidApiKey: 'android-fallback-client-key' }]);
  assert.equal(current('plugins/with-google-navigation.js'), previous('plugins/with-google-navigation.js'));
});

test('the exact stable Xcode 27 image is the only EAS configuration change', () => {
  const expected = JSON.parse(previous('eas.json'));
  expected.build.production.ios.image = 'macos-tahoe-26.6-xcode-27.0';
  const eas = JSON.parse(current('eas.json'));
  assert.deepEqual(eas, expected);
  assert.equal(eas.build.production.environment, 'production');
  assert.equal(eas.submit.production.ios.ascAppId, '6798016192');
  assert.equal(eas.submit.production.ios.appleTeamId, '49Q5ZSPMZ9');
});

test('dependency changes are limited to SDK compatibility, the released backend pin and SDK-matched photo modules', () => {
  const expected = JSON.parse(previous('package.json'));
  const catalogue = JSON.parse(current('node_modules/expo/bundledNativeModules.json'));
  for (const group of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(expected[group])) {
      if (catalogue[name]) expected[group][name] = catalogue[name];
    }
  }
  expected.dependencies.expo = '~57.0.34';
  expected.dependencies['@expo/metro-runtime'] = '~57.0.19';
  expected.dependencies['hy3n-backend'] = 'github:yawgad23/backend#0a07115e4afcc28c2dcbabca17280d64230d64f7';
  for (const name of ['@react-navigation/native', '@react-navigation/bottom-tabs', '@react-navigation/elements']) delete expected.dependencies[name];
  expected.devDependencies['@types/react'] = '~19.2.18';
  expected.devDependencies['react-test-renderer'] = catalogue.react;
  expected.devDependencies.typescript = '~6.0.3';
  addSdkMatchedPhotoDependencies(expected, root);
  assert.deepEqual(JSON.parse(current('package.json')), expected);
  assert.equal(JSON.parse(current('node_modules/expo/package.json')).version, '57.0.34');
  assert.equal(JSON.parse(current('node_modules/react-native/package.json')).version, '0.86.3');
});

test('automatic-photo preparation preserves every pre-existing dependency and lock resolution', () => {
  const photoBase = '032312f35570136da4dd4b8a1c8f81f78c89e6c6';
  const source = (file: string) => execFileSync('git', ['show', `${photoBase}:${file}`], { cwd: root, encoding: 'utf8' });
  const expected = JSON.parse(source('package.json'));
  addSdkMatchedPhotoDependencies(expected, root);
  assert.deepEqual(JSON.parse(current('package.json')), expected);
  assert.equal(withoutDriverPhotoLockAdditions(current('pnpm-lock.yaml')), withoutDriverPhotoLockAdditions(source('pnpm-lock.yaml')));
});

test('the backend source revision and pinned Google Navigation/Firebase modules stay fixed', () => {
  const lock = current('pnpm-lock.yaml');
  assert.match(lock, /hy3n-backend:\n\s+specifier: github:yawgad23\/backend#0a07115e4afcc28c2dcbabca17280d64230d64f7\n\s+version: https:\/\/codeload\.github\.com\/yawgad23\/backend\/tar\.gz\/0a07115e4afcc28c2dcbabca17280d64230d64f7/);
  const pkg = JSON.parse(current('package.json'));
  for (const name of ['@googlemaps/react-native-navigation-sdk', '@react-native-firebase/app', '@react-native-firebase/auth', '@trpc/client', '@trpc/react-query']) {
    assert.equal(pkg.dependencies[name], JSON.parse(previous('package.json')).dependencies[name]);
  }
  assert.doesNotMatch(lock, /expo-apple-authentication@58\./);
});

test('scene-aware Apple sign-in uses the reviewed SDK 57 package and source compilation', () => {
  const moduleRoot = path.dirname(require.resolve('expo-apple-authentication/package.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8')).version, '57.0.2');
  const podspec = fs.readFileSync(path.join(moduleRoot, 'ios/ExpoAppleAuthentication.podspec'), 'utf8');
  assert.match(podspec, /:ios\s*=>\s*'16\.4'/);
  const properties = ios.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-build-properties')[1].ios;
  assert.equal(properties.enableSceneSupport, true);
  assert.equal(properties.usePrecompiledModules, false);
  assert.equal(properties.useHermesV1, true);
  const plugin = current('plugins/with-driver-ios-sdk27.js');
  assert.match(plugin, /runOnQueue\(\.main\)/);
  assert.match(plugin, /foregroundActive/);
  assert.match(plugin, /RequestNotInteractiveException/);
});

test('all unrelated iPhone UI, trip and authenticated GPS publisher source remains preserved', () => {
  for (const file of [
    'app/(tabs)/home.tsx',
    'components/DriverNavigationBanner.tsx',
    'lib/driver-ios-overlay-theme.ts',
    'hooks/use-driver-ios-overlay-palette.ts',
    'lib/native-map-camera.ts',
    'lib/driver-navigation-guidance.ts',
    'lib/driver-android-home-layout.tsx',
    'lib/driver-location-publisher.ts',
    'lib/driver-turn-navigation.ts',
    'lib/driver-request-audio.ts',
  ]) {
    assert.equal(current(file), previous(file), file);
  }
  // Navigation behavior is intentionally fixed after the SDK checkpoint.
  // Preserve the actual map/banner/provider UI byte-for-byte while its motion
  // and reroute implementation is covered by the actual-component regressions.
  const uiTail = (source: string) => source.slice(source.indexOf('  const visibleGuidance ='));
  const referenceCameraUi = previous('components/NativeDriverGoogleMap.tsx')
    .replaceAll('StyleSheet.absoluteFillObject', 'StyleSheet.absoluteFill')
    .replace('zoom: closeDrivingView ? 18 : hasTarget ? 17 : 16', 'zoom: routeForwardView ? 17.6 : closeDrivingView ? 18 : hasTarget ? 17 : 16')
    .replace('tilt: hasTarget ? 45 : 0', 'tilt: routeForwardView ? 0 : hasTarget ? 45 : 0');
  assert.equal(uiTail(current('components/NativeDriverGoogleMap.tsx')),
    uiTail(referenceCameraUi));
});

test('navigation fixes preserve the released default motion branch and opt in only on iPhone', () => {
  const legacyMotion = (source: string) => source.slice(source.lastIndexOf('  const next = {'));
  assert.equal(legacyMotion(current('lib/driver-map-motion.ts')), legacyMotion(previous('lib/driver-map-motion.ts')));
  const map = current('components/NativeDriverGoogleMap.tsx');
  assert.match(map, /if \(Platform\.OS === 'ios'\) \{\s+animateVehicleObservation\(currentNavigationLocation\(\)\);\s+return;/);
  assert.match(map, /alignHeadingToMovement: true/);
  assert.match(map, /acceptedMovementMeters: now <= cameraMovementRef\.current\.untilMs/);
  const camera = current('lib/driver-navigation-camera.ts');
  assert.match(camera, /\? acceptedMovement : movement/);
  assert.match(camera, /const zoom = routeForwardView \? 17\.6 : closeDrivingView \? 18 : 17\.2/);
  assert.match(map, /const routeForwardView = Platform\.OS === 'ios' && hasTarget && !navigationPaused/);
});

test('the tab layout contains only the intended document-recovery correction', () => {
  const recovery = execFileSync('git', ['show', '85ac0e57b19289b655eb58979dcc387b7fc6fe70:app/(tabs)/_layout.tsx'], { cwd: root, encoding: 'utf8' });
  assert.equal(current('app/(tabs)/_layout.tsx'), recovery);
});
