import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { addSdkMatchedPhotoDependencies, withoutDriverPhotoLockAdditions } from './helpers/driver-photo-dependencies';

const root = path.join(__dirname, '..');
const baseline = '1f219aa7c3ef3573d08f265d060409d6a8ad4f59';
const previous = (file: string) => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
const releaseBase = '38c2443127ee375b710dcbae27a0f5a48ff913d0';
const releaseSource = (file: string) => execFileSync('git', ['show', `${releaseBase}:${file}`], { cwd: root, encoding: 'utf8' });
const delivered57025 = 'f50da8cc6bc405afcde69e0548b197ab8d948d81';
const deliveredSource = (file: string) => execFileSync('git', ['show', `${delivered57025}:${file}`], { cwd: root, encoding: 'utf8' });
const soundFix = '30f4f1227e2ce56e522722e58c07279bc64308bd';
const soundFixSource = (file: string) => execFileSync('git', ['show', `${soundFix}:${file}`], { cwd: root, encoding: 'utf8' });
const submitted57026 = 'e3e7b3f17c472fd7971fbc708dcbbcc1a7222165';
const submittedSource = (file: string) => execFileSync('git', ['show', `${submitted57026}:${file}`], { cwd: root, encoding: 'utf8' });
const current = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const clientKeys = {
  GOOGLE_MAPS_IOS_API_KEY: 'ios-client-test-key',
  GOOGLE_MAPS_ANDROID_API_KEY: 'android-client-test-key',
};

function config(source: string, platform?: string, keys: Record<string, string> = clientKeys) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
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

const android = config(current('app.config.ts'), 'android');
const baselineAndroid = config(previous('app.config.ts'), 'android');

test('historical Android 57024 config differs from its released baseline only by version and versionCode', () => {
  const expected = structuredClone(baselineAndroid);
  expected.version = '1.0.4';
  expected.android.versionCode = 57024;
  assert.deepEqual(config(releaseSource('app.config.ts'), 'android'), expected);
  assert.equal(android.name, 'HY3N Driver');
  assert.equal(android.android.package, 'com.hy3n.driver');
  assert.equal(android.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
});

test('historical Android 1.0.5 (57025) candidate changes exactly version and versionCode from the automatic-photo base', () => {
  for (const platform of ['android', 'ios', 'web', undefined]) {
    const expected = config(releaseSource('app.config.ts'), platform);
    if (platform === 'android') {
      expected.version = '1.0.5';
      expected.android.versionCode = 57025;
    }
    // Preserve the exact delivered 57025 proof, not a rolling current-version allowance.
    assert.deepEqual(config(deliveredSource('app.config.ts'), platform), expected);
  }
});

test('historical 57025 release preparation preserves every automatic-photo base file outside explicit metadata/test paths', () => {
  const allowed = new Set([
    'app.config.ts', 'tests/driver-android-release-metadata.test.ts', 'tests/driver-ios-release-metadata.test.ts',
  ]);
  const changed = execFileSync('git', ['diff', '--name-only', releaseBase, delivered57025, '--'], { cwd: root, encoding: 'utf8' });
  for (const file of changed.split('\n').filter(Boolean)) {
    assert.ok(allowed.has(file), `non-metadata automatic-photo base source changed in delivered 57025: ${file}`);
  }
});

test('submitted Android 1.0.6 (57026) changes exactly version and versionCode from the reviewed sound fix for every platform/key configuration', () => {
  const keyScenarios: Record<string, string>[] = [
    clientKeys,
    {},
    { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-fallback-test-key', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-fallback-test-key' },
    { ...clientKeys, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'unused-ios-fallback-test-key', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'unused-android-fallback-test-key' },
  ];
  for (const keys of keyScenarios) for (const platform of ['android', 'ios', 'web', undefined]) {
    const expected = config(soundFixSource('app.config.ts'), platform, keys);
    if (platform === 'android') {
      expected.version = '1.0.6';
      expected.android.versionCode = 57026;
    }
    // No SDK, plugin, dependency, other-platform or default/web allowances.
    assert.deepEqual(config(submittedSource('app.config.ts'), platform, keys), expected);
  }
});

test('submitted 57026 config source differs from the reviewed sound fix only by exact Android version/code literals and comments', () => {
  let expected = soundFixSource('app.config.ts');
  const changes = [
    ['buildPlatform === "android"\n    ? "1.0.5"', 'buildPlatform === "android"\n    ? "1.0.6"'],
    [
      '    // 1.0.5 (57025) is the source-only automatic-photo release candidate;\n    // retain every existing Android fix without importing the iOS camera changes.\n    versionCode: buildPlatform === "android" ? 57025 : 57023,',
      '    // 1.0.6 (57026) carries the reviewed Android request-sound fix over 57025;\n    // retain the existing song, photo flow and every other platform configuration.\n    versionCode: buildPlatform === "android" ? 57026 : 57023,',
    ],
  ];
  for (const [before, after] of changes) {
    assert.equal(expected.split(before).length - 1, 1, 'exact Android metadata baseline must occur once');
    expected = expected.replace(before, after);
  }
  assert.equal(submittedSource('app.config.ts'), expected, 'all submitted default/web/iOS, native-key, API and plugin configuration text must remain exact');
});

test('submitted 57026 release changes only the exact Android config, metadata test, stale Home guard and release note paths', () => {
  const allowed = new Set([
    'app.config.ts',
    'tests/driver-android-release-metadata.test.ts',
    'tests/driver-android-home-layout.test.ts',
    'tests/driver-ios-release-metadata.test.ts',
    'docs/driver-android-1.0.6-57026-request-sound-20261126.md',
  ]);
  const changed = execFileSync('git', ['diff', '--name-only', soundFix, submitted57026, '--'], { cwd: root, encoding: 'utf8' });
  for (const file of changed.split('\n').filter(Boolean)) {
    assert.ok(allowed.has(file), `non-release-preparation file changed from reviewed sound fix: ${file}`);
  }
});

test('current Home/controller remain exact and submitted 57026 song matches its reviewed sound fix', () => {
  for (const file of ['app/(tabs)/home.tsx', 'lib/driver-request-audio.ts']) {
    const expected = execFileSync('git', ['show', `${soundFix}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    assert.deepEqual(fs.readFileSync(path.join(root, file)), expected, `${file} must remain byte-identical`);
  }
  // Audit immutable release audio; the current chosen Gold Chime has its own exact-asset tests.
  const song = 'assets/audio/incoming-trip-alert.wav';
  const reviewedSong = execFileSync('git', ['show', `${soundFix}:${song}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const submittedSong = execFileSync('git', ['show', `${submitted57026}:${song}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.deepEqual(submittedSong, reviewedSong, 'submitted 57026 song must match its reviewed sound fix');
  assert.equal(current('package.json'), soundFixSource('package.json'));
  assert.equal(current('pnpm-lock.yaml'), soundFixSource('pnpm-lock.yaml'));
  const dependencies = JSON.parse(current('package.json')).dependencies;
  assert.equal(dependencies.expo, '~54.0.37');
  assert.equal(dependencies['expo-audio'], '~1.1.1');
});

test('iOS, web, and unspecified configs remain identical to clean HEAD', () => {
  for (const platform of ['ios', 'web', undefined]) {
    assert.deepEqual(config(current('app.config.ts'), platform), config(previous('app.config.ts'), platform));
  }
});

test('Android Maps and existing dependencies remain unchanged except SDK-matched photo modules', () => {
  assert.equal(current('plugins/with-google-navigation.js'), previous('plugins/with-google-navigation.js'));
  assert.equal(current('eas.json'), previous('eas.json'));
  const expected = JSON.parse(previous('package.json'));
  addSdkMatchedPhotoDependencies(expected, root);
  assert.deepEqual(JSON.parse(current('package.json')), expected);
  assert.equal(withoutDriverPhotoLockAdditions(current('pnpm-lock.yaml')), withoutDriverPhotoLockAdditions(previous('pnpm-lock.yaml')));
  assert.equal(current('firebase/google-services.json'), previous('firebase/google-services.json'));
  assert.equal(current('firebase/GoogleService-Info.plist'), previous('firebase/GoogleService-Info.plist'));

  const mapsPlugin = android.plugins.find((plugin: any) => Array.isArray(plugin) && plugin[0] === './plugins/with-google-navigation');
  assert.deepEqual(mapsPlugin, ['./plugins/with-google-navigation', {
    iosApiKey: clientKeys.GOOGLE_MAPS_IOS_API_KEY,
    androidApiKey: clientKeys.GOOGLE_MAPS_ANDROID_API_KEY,
  }]);
  const eas = JSON.parse(current('eas.json'));
  assert.equal(eas.build.production.environment, 'production');
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.submit.production.android.track, 'production');
});
