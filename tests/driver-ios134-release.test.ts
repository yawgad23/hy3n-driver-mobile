import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = path.join(__dirname, '..');
const correction = 'd3988e1fcf538e09948b591e552bc10a14a73b81';
const raw = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const base = (file: string) => execFileSync('git', ['show', `${correction}:${file}`], { cwd: root, encoding: 'utf8' });
function config(source: string, platform: string | undefined, keys: Record<string, string> = {}) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, process: { env: { ...keys, ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}) } },
    require(name: string) { assert.equal(name, './scripts/load-env.js'); return {}; },
  });
  return JSON.parse(JSON.stringify(exports.default));
}

test('raw release configuration identifies HY3N Driver iPhone 1.4 (134), not normalized historical metadata', () => {
  const actual = config(raw('app.config.ts'), 'ios');
  assert.equal(actual.version, '1.4'); assert.equal(actual.ios.buildNumber, '134');
  assert.equal(actual.ios.bundleIdentifier, 'com.hy3n.driver');
  assert.equal(actual.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(actual.owner, 'yawgad');
  assert.equal(actual.plugins.filter((p: unknown) => p === './plugins/with-driver-ios-request-audio-stop').length, 1);
});

test('release changes only build 133 to 134 for iPhone under every Maps-key and platform scenario', () => {
  const keys: Array<Record<string, string>> = [
    {}, { GOOGLE_MAPS_IOS_API_KEY: 'ios', GOOGLE_MAPS_ANDROID_API_KEY: 'android' },
    { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-public', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-public' },
    { GOOGLE_MAPS_IOS_API_KEY: ' ios ', GOOGLE_MAPS_ANDROID_API_KEY: '\tandroid\n' },
    { GOOGLE_MAPS_IOS_API_KEY: ' ', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'fallback', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-fallback' },
    { GOOGLE_MAPS_IOS_API_KEY: 'ios-only' }, { GOOGLE_MAPS_ANDROID_API_KEY: 'android-only' },
  ];
  for (const platform of ['ios', 'android', 'web', undefined]) for (const scenario of keys) {
    const expected = config(base('app.config.ts'), platform, scenario);
    if (platform === 'ios') expected.ios.buildNumber = '134';
    assert.deepEqual(config(raw('app.config.ts'), platform, scenario), expected);
  }
});

test('raw app.config differs from the tested correction by exactly one counter literal', () => {
  const before = '    buildNumber: buildPlatform === "ios" ? "133" : "124",';
  const after = '    buildNumber: buildPlatform === "ios" ? "134" : "124",';
  const source = base('app.config.ts');
  assert.equal(source.split(before).length - 1, 1);
  assert.equal(raw('app.config.ts'), source.replace(before, after));
});

test('production still requires exact Xcode 27/SDK 27 image, local counters and no automatic increments', () => {
  const eas = JSON.parse(raw('eas.json'));
  assert.equal(raw('eas.json'), base('eas.json'));
  assert.equal(eas.cli.appVersionSource, 'local');
  assert.deepEqual(eas.build.production.ios, { buildConfiguration: 'Release', image: 'macos-tahoe-26.6-xcode-27.0' });
  assert.equal(eas.build.production.autoIncrement, undefined);
  assert.equal(eas.build.production.ios.autoIncrement, undefined);
  assert.equal(eas.submit.production.ios.ascAppId, '6798016192');
});

test('release preserves all reviewed audio, maps, camera, registration, auth, photo and dependency code bytes', () => {
  for (const file of [
    'app/(tabs)/home.tsx', 'lib/driver-request-audio.ts', 'lib/driver-request-audio-diagnostics.ts', 'lib/firebase.ts',
    'plugins/with-driver-ios-request-audio-stop.js', 'plugins/with-driver-ios-sdk27.js', 'plugins/with-google-navigation.js',
    'components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts', 'lib/driver-navigation-camera.ts',
    'lib/driver-location-publisher.ts', 'lib/notifications.ts', 'lib/driver-auth-context.tsx', 'app/driver/register.tsx',
    'app/(tabs)/profile.tsx', 'lib/driver-profile-photo.ts', 'package.json', 'pnpm-lock.yaml',
  ]) assert.equal(raw(file), base(file), file);
  const asset = fs.readFileSync(path.join(root, 'assets/audio/incoming-trip-alert.wav'));
  assert.equal(createHash('sha256').update(asset).digest('hex'), '1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240');
});

test('release production-code scope contains only app.config counter change beyond the reviewed correction', () => {
  const changed = execFileSync('git', ['diff', '--name-only', correction, '--', '.', ':!tests/**', ':!docs/**'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(changed.trim().split('\n').filter(Boolean), ['app.config.ts']);
});
