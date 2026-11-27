import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { addSdkMatchedPhotoDependencies, withoutDriverPhotoLockAdditions } from './helpers/driver-photo-dependencies';

const root = path.join(__dirname, '..');
const baseline = '674e81c0e15353c4e813d5e688fb3d1240ed5d81';
const previous = (file: string) => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
const build130 = 'bfe0522f023fffa264f529b00875df7471513dcd';
const historical = (commit: string, file: string) => execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8' });
const released = (file: string) => historical(build130, file);
const releaseBase = '3548f00ed9c9f6e0bc6ed4b465eae5f32d0188cc';
const releaseSource = (file: string) => historical(releaseBase, file);
const build131 = 'e4fd60fef058866ea57ad65295ca33a89893f90a';
const delivered131 = (file: string) => historical(build131, file);
const soundFix = '05754fe2ccc966c096000c42b8d20e574991ec1f';
const soundSource = (file: string) => historical(soundFix, file);
const build132 = 'cc722a6f16b9c9b17be4752a7e8cd2ed0c44061c';
const releaseNote = 'docs/driver-ios-1.3-132-request-sound-20261126.md';
const goldFeature = '8c3610302610b0578d4787b9b92d085a6be97493';
const goldSource = (file: string) => historical(goldFeature, file);
const approvedSelfie = 'afaecc548b9e1f2c51b71f9788a331c5207b60a6';
const release133Note = 'docs/driver-ios-1.4-133-gold-selfie-20261127.md';
const build133 = 'f4c4649f44f0030248dd8e26f4821f901ca9e9fb';
const delivered133 = (file: string) => historical(build133, file);
import { withoutDriverIos134Counter } from './helpers/driver-ios134-counter';
const current = (file: string) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return file === 'app.config.ts' ? withoutDriverIos134Counter(source) : source;
};
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

test('historical SDK 27 automatic-photo release uses iOS version 1.2 build 130 and retains Driver identity', () => {
  const historicalIos = config(released('app.config.ts'), 'ios');
  assert.equal(historicalIos.name, 'HY3N Driver');
  assert.equal(historicalIos.version, '1.2');
  assert.equal(historicalIos.ios.buildNumber, '130');
  assert.equal(historicalIos.ios.bundleIdentifier, 'com.hy3n.driver');
  assert.equal(historicalIos.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(historicalIos.owner, 'yawgad');
});

test('historical iOS 1.3 (131) changes exactly version and buildNumber from the camera-stability base', () => {
  for (const keys of [clientKeys, {}]) {
    for (const platform of ['ios', 'android', undefined, 'web']) {
      const expected = config(releaseSource('app.config.ts'), platform, keys);
      if (platform === 'ios') {
        expected.version = '1.3';
        expected.ios.buildNumber = '131';
      }
      // No SDK, plugin, dependency, other-platform or default/web allowances.
      assert.deepEqual(config(delivered131('app.config.ts'), platform, keys), expected);
      assert.deepEqual(config(soundSource('app.config.ts'), platform, keys), expected);
    }
  }
});

test('historical iOS 1.3 (132) changes only buildNumber from the reviewed request-sound fix; other platforms are identical', () => {
  for (const keys of [clientKeys, {}]) {
    for (const platform of ['ios', 'android', undefined, 'web']) {
      const expected = config(soundSource('app.config.ts'), platform, keys);
      const actual = config(historical(build132, 'app.config.ts'), platform, keys);
      if (platform === 'ios') {
        assert.equal(expected.version, '1.3');
        assert.equal(expected.ios.buildNumber, '131');
        expected.ios.buildNumber = '132';
        assert.equal(actual.version, '1.3');
        assert.equal(actual.ios.buildNumber, '132');
      }
      // Only the iPhone build number changes: no version, SDK, plugin,
      // Firebase, Android, default or web configuration allowances.
      assert.deepEqual(actual, expected);
    }
  }
});

test('delivered iOS 1.4 (133) changes exactly version/buildNumber; current candidate adds only the iPhone request-stop plugin across every Maps key scenario', () => {
  const keyScenarios: Array<Record<string, string>> = [
    clientKeys,
    {},
    { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-public', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-public' },
    { ...clientKeys, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ignored-ios', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'ignored-android' },
    { GOOGLE_MAPS_IOS_API_KEY: '  ios-private  ', GOOGLE_MAPS_ANDROID_API_KEY: '\tandroid-private\n' },
    { GOOGLE_MAPS_IOS_API_KEY: ' ', GOOGLE_MAPS_ANDROID_API_KEY: '', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: ' ios-fallback ', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: ' android-fallback ' },
    { GOOGLE_MAPS_IOS_API_KEY: clientKeys.GOOGLE_MAPS_IOS_API_KEY },
    { GOOGLE_MAPS_ANDROID_API_KEY: clientKeys.GOOGLE_MAPS_ANDROID_API_KEY },
    { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-only' },
    { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-only' },
    { GOOGLE_MAPS_IOS_API_KEY: 'ios-private', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-public' },
    { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-public', GOOGLE_MAPS_ANDROID_API_KEY: 'android-private' },
  ];
  const before = goldSource('app.config.ts');
  const after = current('app.config.ts');
  for (const [scenario, keys] of keyScenarios.entries()) {
    for (const platform of ['ios', 'android', undefined, 'web']) {
      const expected = config(before, platform, keys);
      if (platform === 'ios') {
        assert.equal(expected.version, '1.3');
        assert.equal(expected.ios.buildNumber, '132');
        expected.version = '1.4';
        expected.ios.buildNumber = '133';
      }
      assert.deepEqual(config(delivered133('app.config.ts'), platform, keys), expected, `delivered 133 ${platform ?? 'default'}: native Maps keys ${scenario}`);
      if (platform === 'ios') expected.plugins.splice(1, 0, './plugins/with-driver-ios-request-audio-stop');
      assert.deepEqual(config(after, platform, keys), expected, `${platform ?? 'default'}: native Maps keys ${scenario}`);
    }
  }
});

test('delivered app.config metadata is exact; current adds only one explicit iPhone-gated request-stop plugin literal', () => {
  const edits: Array<[string, string]> = [
    ['const appVersion = buildPlatform === "ios" ? "1.3"', 'const appVersion = buildPlatform === "ios" ? "1.4"'],
    ['    buildNumber: buildPlatform === "ios" ? "132" : "124",', '    buildNumber: buildPlatform === "ios" ? "133" : "124",'],
    [
      '    // 1.3 (132) adds the request-song terminal-stop fix while preserving\n    // SDK 27, automatic registration photos and camera/heading stability.',
      '    // 1.4 (133) includes the approved profile selfie and louder Gold Chime.\n    // Preserve SDK 27, automatic photos, request stop and camera stability.',
    ],
  ];
  let expected = goldSource('app.config.ts');
  for (const [before, after] of edits) {
    assert.equal(expected.split(before).length - 1, 1, `exactly one reviewed replacement: ${before}`);
    expected = expected.replace(before, after);
  }
  assert.equal(delivered133('app.config.ts'), expected);
  const nativeAddition = '    ...(buildPlatform === "ios" ? ["./plugins/with-driver-ios-request-audio-stop"] : []),\n';
  assert.equal(current('app.config.ts').split(nativeAddition).length - 1, 1);
  assert.equal(current('app.config.ts').replace(nativeAddition, ''), expected);
});

test('delivered 133 release preparation has an exact four-file scope at its pinned commit', () => {
  const allowed = new Set([
    'app.config.ts', 'tests/driver-ios-release-metadata.test.ts',
    'tests/driver-gold-chime.test.ts', release133Note,
  ]);
  const changed = execFileSync('git', ['diff', '--name-only', goldFeature, build133, '--'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(changed.split('\n').filter(Boolean)), allowed);
});

test('current 133 preserves every other native/configuration/dependency/lock byte from Gold Chime and the exact SDK 27 production profile', () => {
  for (const file of [
    'eas.json', 'package.json', 'pnpm-lock.yaml', '.watchmanconfig', 'babel.config.js',
    'eslint.config.js', 'metro.config.js', 'tailwind.config.js', 'theme.config.js',
    'theme.config.d.ts', 'tsconfig.json', 'scripts/load-env.js',
    'firebase/GoogleService-Info.plist', 'firebase/google-services.json',
    'plugins/with-driver-ios-sdk27.js', 'plugins/with-google-navigation.js',
    'plugins/driver-navigation-feed-patch.js', 'plugins/driver-navigation-polyline-patch.js',
  ]) assert.deepEqual(fs.readFileSync(path.join(root, file)), Buffer.from(goldSource(file)), file);
  const eas = JSON.parse(current('eas.json'));
  assert.equal(eas.cli.appVersionSource, 'local');
  assert.equal(eas.build.production.environment, 'production');
  assert.deepEqual(eas.build.production.ios, { buildConfiguration: 'Release', image: 'macos-tahoe-26.6-xcode-27.0' });
  assert.equal(ios.ios.bundleIdentifier, 'com.hy3n.driver');
  assert.equal(ios.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
});

test('current 133 preserves approved selfie/Gold Chime; pinned delivered 133 retains historical Home and request-controller behavior', () => {
  for (const file of [
    'app/(tabs)/profile.tsx', 'components/DriverProfilePhoto.tsx',
    'lib/driver-profile-photo.ts', 'lib/driver-auth-context.tsx', 'tests/driver-profile-selfie.test.ts',
  ]) {
    assert.equal(goldSource(file), historical(approvedSelfie, file), `${file}: reviewed selfie included in Gold Chime`);
    assert.equal(current(file), goldSource(file), `${file}: preserve approved selfie`);
  }
  const asset = fs.readFileSync(path.join(root, 'assets/audio/incoming-trip-alert.wav'));
  assert.equal(createHash('sha256').update(asset).digest('hex'), '1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240');
  const goldAsset = execFileSync('git', ['show', `${goldFeature}:assets/audio/incoming-trip-alert.wav`], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  assert.deepEqual(asset, goldAsset);
  for (const file of [
    'lib/incoming-trip-alert.ts', 'tests/driver-request-audio-native-retirement.test.ts',
    'tests/driver-request-audio-runtime.test.ts',
  ]) assert.equal(current(file), goldSource(file), `${file}: retain tested Gold Chime/Accept behavior`);
  const startFile = 'tests/driver-request-audio-start-boundary.test.ts';
  let startCandidate = current(startFile);
  const extraCases = "\nfor (const handler of ['beginTrip', 'handleStartTrip', 'handleVerifyPickupCode'] as const) {\n  test(`ios: actual ${handler} retires request players owned by two retained controllers`, async () => {";
  assert.equal(startCandidate.split(extraCases).length - 1, 1);
  startCandidate = startCandidate.slice(0, startCandidate.indexOf(extraCases));
  for (const [addition, original] of [
    ["import { createDriverRequestAudio, createDriverRequestAudioSession, DRIVER_REQUEST_AUDIO_MODE } from '../lib/driver-request-audio';", "import { createDriverRequestAudio, DRIVER_REQUEST_AUDIO_MODE } from '../lib/driver-request-audio';"],
    ['  const session = createDriverRequestAudioSession();\n', ''],
    ['    createDriverRequestAudio: (options: Parameters<typeof createDriverRequestAudio>[0]) => createDriverRequestAudio({ ...options, session }),\n    stopAllDriverRequestAudio: session.stopAll,', '    createDriverRequestAudio,'],
  ]) {
    assert.equal(startCandidate.split(addition).length - 1, 1);
    startCandidate = startCandidate.replace(addition, original);
  }
  assert.equal(startCandidate, goldSource(startFile), 'all pre-existing Start assertions and test bodies remain byte-exact');
  assert.equal(delivered133(startFile), goldSource(startFile), 'historical delivered Start test remains exact');
  // The server-authoritative reconciliation correction has current-specific
  // regressions; the original release's source audit remains byte-exact here.
  for (const file of [
    'app/(tabs)/home.tsx', 'lib/driver-request-audio.ts',
    'tests/driver-request-audio-home-lifecycle.test.ts',
  ]) assert.equal(delivered133(file), goldSource(file), `${file}: delivered 133 retains tested Gold Chime/Accept behavior`);
});

test('132 preparation preserves every reviewed request-sound source file outside the exact metadata/test/new-note paths', () => {
  const allowed = new Set(['app.config.ts', 'tests/driver-ios-release-metadata.test.ts', 'tests/driver-android-home-layout.test.ts', releaseNote]);
  // Keep this historical release audit exact without rejecting later features.
  const changed = execFileSync('git', ['diff', '--name-only', soundFix, build132, '--'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(changed.split('\n').filter(Boolean)), allowed);
});

test('132 retains delivered 131 camera/navigation source and regressions byte-for-byte', () => {
  for (const file of [
    'components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts', 'lib/driver-navigation-camera.ts',
    'lib/native-map-camera.ts', 'lib/driver-navigation-guidance.ts', 'lib/driver-turn-navigation.ts',
    'tests/driver-map-motion.test.ts', 'tests/driver-navigation-camera.test.ts',
    'tests/driver-ios-camera-stability-runtime.test.ts', 'tests/driver-ios-reroute-runtime.test.ts',
  ]) {
    assert.equal(soundSource(file), delivered131(file), `${file}: sound fix preserves delivered 131`);
    assert.equal(current(file), delivered131(file), `${file}: 132 preserves delivered 131`);
  }
});

test('build 130 changes only the iPhone build number from the tested photo-fix source', () => {
  const photoCommit = '90e416716d7b0cf05a68b71c2cd4e5e55409e9ac';
  const photoSource = (file: string) => execFileSync('git', ['show', `${photoCommit}:${file}`], { cwd: root, encoding: 'utf8' });
  assert.equal(releaseSource('app.config.ts'), released('app.config.ts'));
  for (const platform of ['ios', 'android', undefined, 'web']) {
    const expected = config(photoSource('app.config.ts'), platform);
    if (platform === 'ios') expected.ios.buildNumber = '130';
    assert.deepEqual(config(released('app.config.ts'), platform), expected);
  }
  for (const file of [
    'app/driver/register.tsx', 'lib/driver-photo-native.ts', 'lib/driver-photo-preparation.ts',
    'lib/firebase.ts', 'package.json', 'pnpm-lock.yaml', 'eas.json',
    'plugins/with-google-navigation.js', 'plugins/with-driver-ios-sdk27.js',
    'components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts', 'lib/driver-navigation-camera.ts',
  ]) assert.equal(released(file), photoSource(file), file);
});

test('version-train correction changes only iOS release metadata and retains all combined fixes from build 128', () => {
  const corrected = '032312f35570136da4dd4b8a1c8f81f78c89e6c6';
  const correctedSource = (file: string) => historical(corrected, file);
  const combined = 'e37d43892e6e7d4d24d5401edcd6afa8bbcc114b';
  const combinedSource = (file: string) => execFileSync('git', ['show', `${combined}:${file}`], { cwd: root, encoding: 'utf8' });
  for (const platform of ['ios', 'android', undefined, 'web']) {
    const expected = config(combinedSource('app.config.ts'), platform);
    if (platform === 'ios') {
      expected.version = '1.2';
      expected.ios.buildNumber = '129';
    }
    assert.deepEqual(config(correctedSource('app.config.ts'), platform), expected);
  }
  for (const file of ['components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts', 'lib/driver-navigation-camera.ts', 'eas.json']) {
    assert.equal(correctedSource(file), combinedSource(file), file);
  }
});

test('build 132 changes since build 130 stay in enumerated camera/heading, request-audio and release-preparation scope', () => {
  const allowed = new Set([
    'components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts', 'lib/driver-navigation-camera.ts',
    'app/(tabs)/home.tsx', 'lib/driver-request-audio.ts',
    'tests/driver-request-audio-android-lifecycle.test.ts', 'tests/driver-request-audio-home-lifecycle.test.ts',
    'tests/driver-request-audio-native-retirement.test.ts', 'tests/driver-request-audio-runtime.test.ts',
    'tests/driver-request-audio-start-boundary.test.ts',
    'app.config.ts',
    'tests/driver-ios-release-metadata.test.ts', 'tests/driver-map-motion.test.ts',
    'tests/driver-navigation-camera.test.ts', 'tests/driver-ios-camera-stability-runtime.test.ts',
    'tests/driver-ios-reroute-runtime.test.ts', 'tests/driver-android-home-layout.test.ts',
    releaseNote,
  ]);
  // Audit immutable release history. Current SDK/native configuration and
  // camera behavior still have their own byte-exact checks below.
  const changed = execFileSync('git', ['diff', '--name-only', build130, build132, '--'], { cwd: root, encoding: 'utf8' });
  for (const file of changed.split('\n').filter(Boolean)) {
    assert.ok(allowed.has(file), `unrelated release source changed: ${file}`);
  }

  const scope = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `missing camera scope: ${start}`);
    return source.slice(0, from) + `/* camera scope: ${end} */\n` + source.slice(to);
  };
  const outsideCamera = (source: string) => {
    source = scope(source, '  const pendingCameraRef =', '  const [bannerHeight,');
    source = scope(source, source.includes('  const clearCameraSettle =')
      ? '  const clearCameraSettle =' : '  const updateFollowingCamera =', '  const mapPadding =');
    source = scope(source, '  const clearVehicleMotion =', '  const clearRouteRefresh =');
    source = scope(source, '    vehicleObservationRef.current = null;', '    return clearVehicleMotion;');
    return source
      .replace('  const hasDeviceLocation = hasPoint(latitude, longitude);\n', '')
      .replace("    || Platform.OS === 'ios' && !hasDeviceLocation ? null : createdMapViewController;", '    ? null : createdMapViewController;')
      .replace("    if (hasDeviceLocation) return;\n    // The location gate", "    if (Platform.OS !== 'android' || hasDeviceLocation) return;\n    // The location gate")
      .replace("    if (Platform.OS === 'android') setAndroidMapReady(false);", '    setAndroidMapReady(false);')
      .replace('    stabilizeFollowing: Platform.OS === \'ios\' && !navigationPaused,\n', '')
      .replace('      stabilizeHeadingCorrections: true,\n', '')
      .replace('        settleFollowingCamera(frame, movement);\n', '')
      .replace('[clearVehicleMotion, mapViewController, settleFollowingCamera, updateFollowingCamera]', '[clearVehicleMotion, mapViewController, updateFollowingCamera]')
      .replace("    if ((Platform.OS === 'android' && !androidMapReady) || !mapViewController", "    if (Platform.OS !== 'android' || !androidMapReady || !mapViewController")
      .replaceAll('    cameraHeadingAuthorityRef.current = null;\n', '')
      .replace('    expectedNativeGenerationRef.current = null;\n    pendingCameraRef.current = null;\n    clearCameraSettle();', '    expectedNativeGenerationRef.current = null;\n    pendingCameraRef.current = null;')
      .replace('[androidMapReady, clearCameraSettle, clearGuidance,', '[androidMapReady, clearGuidance,');
  };
  assert.equal(outsideCamera(current('components/NativeDriverGoogleMap.tsx')),
    outsideCamera(released('components/NativeDriverGoogleMap.tsx')));
  // Framing, native padding, coordinate validation, projection validation and
  // the default motion branch are not part of the new bearing/cadence opt-in.
  const camera = current('lib/driver-navigation-camera.ts');
  const referenceCamera = released('lib/driver-navigation-camera.ts');
  assert.equal(camera.slice(camera.indexOf('  const radians =')), referenceCamera.slice(referenceCamera.indexOf('  const radians =')));
  const motion = current('lib/driver-map-motion.ts');
  const referenceMotion = released('lib/driver-map-motion.ts');
  assert.equal(motion.slice(motion.indexOf('type RouteSegmentLike ='), motion.indexOf('const MAX_ROUTE_PROJECTION_METRES')),
    referenceMotion.slice(referenceMotion.indexOf('type RouteSegmentLike ='), referenceMotion.indexOf('const MAX_ROUTE_PROJECTION_METRES')));
  assert.equal(motion.slice(motion.indexOf('function projectOntoRoute('), motion.indexOf('  // Only the two endpoint-to-projection legs')),
    referenceMotion.slice(referenceMotion.indexOf('function projectOntoRoute('), referenceMotion.indexOf('  return path;')));
  assert.equal(motion.slice(motion.indexOf('/** Align visual movement')),
    referenceMotion.slice(referenceMotion.indexOf('/** Align visual movement')));
});

test('historical build 130 differs from build 126 only by enumerated SDK 27 compatibility and iPhone release metadata', () => {
  for (const platform of ['ios', 'android', undefined, 'web']) {
    const expected = config(previous('app.config.ts'), platform);
    if (platform === 'ios') {
      expected.version = '1.2';
      expected.ios.buildNumber = '130';
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
    assert.deepEqual(config(released('app.config.ts'), platform), expected);
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

test('pinned delivered 133 preserves Home/request audio from 057, while current unrelated iPhone UI/trip/GPS source remains at its existing baseline', () => {
  for (const file of ['app/(tabs)/home.tsx', 'lib/driver-request-audio.ts']) {
    assert.equal(delivered133(file), soundSource(file), `${file}: delivered 133 preserves reviewed request-sound fix`);
  }
  for (const file of [
    'components/DriverNavigationBanner.tsx',
    'lib/driver-ios-overlay-theme.ts',
    'hooks/use-driver-ios-overlay-palette.ts',
    'lib/native-map-camera.ts',
    'lib/driver-navigation-guidance.ts',
    'lib/driver-android-home-layout.tsx',
    'lib/driver-location-publisher.ts',
    'lib/driver-turn-navigation.ts',
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
  const iosAnimator = map.slice(map.indexOf('  const animateVehicleObservation ='), map.indexOf('  useLayoutEffect(() => {\n    animateObservationRef.current'));
  assert.match(iosAnimator, /alignHeadingToMovement: true,\s+stabilizeHeadingCorrections: true/);
  assert.equal((map.match(/stabilizeHeadingCorrections: true/g) ?? []).length, 1);
  assert.match(map, /stabilizeFollowing: Platform\.OS === 'ios' && !navigationPaused/);
  // Settling/recentering may supply the accepted GPS interval explicitly; the
  // normal frame path still falls back to the bounded observation window.
  assert.match(map, /const options = Platform\.OS === 'ios' \? \{ \.\.\.cameraOptionsRef\.current,\s+acceptedMovementMeters: acceptedMovementMeters \?\? \(now <= cameraMovementRef\.current\.untilMs \? cameraMovementRef\.current\.metres : 0\),\s+\} : cameraOptionsRef\.current;/);
  const androidBranch = (source: string) => {
    const start = source.indexOf('    // Preserve the released Android Expo interpolation');
    const end = source.indexOf('\n  }, [', start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  assert.equal(androidBranch(map), androidBranch(released('components/NativeDriverGoogleMap.tsx')));
  const camera = current('lib/driver-navigation-camera.ts');
  assert.match(camera, /\? acceptedMovement : movement/);
  assert.match(camera, /const zoom = routeForwardView \? 17\.6 : closeDrivingView \? 18 : 17\.2/);
  assert.match(map, /const routeForwardView = Platform\.OS === 'ios' && hasTarget && !navigationPaused/);
});

test('the tab layout contains only the intended document-recovery correction', () => {
  const recovery = execFileSync('git', ['show', '85ac0e57b19289b655eb58979dcc387b7fc6fe70:app/(tabs)/_layout.tsx'], { cwd: root, encoding: 'utf8' });
  assert.equal(current('app/(tabs)/_layout.tsx'), recovery);
});
