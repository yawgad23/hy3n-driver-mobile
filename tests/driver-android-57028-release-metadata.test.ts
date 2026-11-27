import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.join(__dirname, '..');
const releaseBase = 'ddc51e85fd38bac97b416103678aa4eaaf61b9a6';
const previous = (file: string) => execFileSync('git', ['show', `${releaseBase}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const current = (file: string) => fs.readFileSync(path.join(root, file));
const allowed = new Set([
  'app.config.ts',
  'tests/driver-android-datastore-16kb.test.ts',
  'tests/driver-gold-chime.test.ts',
  'tests/driver-android-57028-release-metadata.test.ts',
  'docs/driver-android-1.0.8-57028-gold-selfie-20261127.md',
]);
const keyScenarios: Record<string, string>[] = [
  {},
  { GOOGLE_MAPS_IOS_API_KEY: 'ios-test-key', GOOGLE_MAPS_ANDROID_API_KEY: 'android-test-key' },
  { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-fallback-test-key', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-fallback-test-key' },
  { GOOGLE_MAPS_IOS_API_KEY: 'ios-test-key', GOOGLE_MAPS_ANDROID_API_KEY: 'android-test-key', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'unused-ios-key', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'unused-android-key' },
  { GOOGLE_MAPS_IOS_API_KEY: 'ios-only-test-key' },
  { GOOGLE_MAPS_ANDROID_API_KEY: 'android-only-test-key' },
];
function config(source: Buffer, platform?: string, keys: Record<string, string> = {}) {
  const code = ts.transpileModule(source.toString('utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    process: { env: { ...keys, ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}) } },
    require: (name: string) => { assert.equal(name, './scripts/load-env.js'); return {}; },
  });
  return JSON.parse(JSON.stringify(exports.default));
}

test('tentative 57028 changes exactly Android version/code across every platform and Maps-key configuration', () => {
  for (const keys of keyScenarios) for (const platform of ['android', 'ios', 'web', undefined]) {
    const expected = config(previous('app.config.ts'), platform, keys);
    if (platform === 'android') {
      assert.equal(expected.version, '1.0.7');
      assert.equal(expected.android.versionCode, 57027);
      expected.version = '1.0.8';
      expected.android.versionCode = 57028;
    }
    assert.deepEqual(config(current('app.config.ts'), platform, keys), expected,
      `${platform ?? 'unspecified'}: no other-platform, default, plugin, key, native or permission exceptions`);
  }
});

test('57028 app config text differs only by exact Android version/code literals and their comments', () => {
  let expected = previous('app.config.ts').toString('utf8');
  const changes = [
    ['buildPlatform === "android"\n    ? "1.0.7"', 'buildPlatform === "android"\n    ? "1.0.8"'],
    [
      '    // 1.0.7 (57027) adds the Android-only DataStore 16 KB infrastructure patch;\n    // retain the existing song, photo flow and every other platform configuration.\n    versionCode: buildPlatform === "android" ? 57027 : 57023,',
      '    // 1.0.8 (57028) tentatively packages the reviewed Gold Chime and approved selfie;\n    // preserve DataStore 16 KB and all other config; confirm Play counter before build.\n    versionCode: buildPlatform === "android" ? 57028 : 57023,',
    ],
  ];
  for (const [before, after] of changes) {
    assert.equal(expected.split(before).length - 1, 1, 'exact immutable metadata must occur once');
    expected = expected.replace(before, after);
  }
  assert.equal(current('app.config.ts').toString('utf8'), expected);
});

test('57028 keeps SDK54, DataStore1.2.1, Android Production identity and untouched iPhone/default metadata', () => {
  const android = config(current('app.config.ts'), 'android');
  assert.equal(android.version, '1.0.8');
  assert.equal(android.android.versionCode, 57028);
  assert.equal(android.android.package, 'com.hy3n.driver');
  assert.equal(android.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(android.plugins.filter((entry: any) => entry === './plugins/with-android-datastore-16kb').length, 1);
  assert.equal(require('../plugins/with-android-datastore-16kb').DATASTORE_VERSION, '1.2.1');
  assert.equal(JSON.parse(current('package.json').toString('utf8')).dependencies.expo, '~54.0.37');
  const eas = JSON.parse(current('eas.json').toString('utf8'));
  assert.equal(eas.cli.appVersionSource, 'local');
  assert.equal(eas.build.production.environment, 'production');
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.submit.production.android.track, 'production');
  const ios = config(current('app.config.ts'), 'ios');
  assert.equal(ios.version, '1.0.3');
  assert.equal(ios.ios.buildNumber, '126');
  assert.equal(ios.android.versionCode, 57023);
  for (const platform of ['web', undefined]) {
    const other = config(current('app.config.ts'), platform);
    assert.equal(other.version, '1.0.2');
    assert.equal(other.ios.buildNumber, '124');
    assert.equal(other.android.versionCode, 57023);
  }
});

test('57028 preparation changes exactly five named metadata/test/doc files, including untracked additions', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '-z', releaseBase, '--'], { cwd: root, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(`${changed}${untracked}`.split('\0').filter(Boolean)), allowed);
});

test('every other immutable Gold Chime/selfie base file stays byte-exact, including all other tests/docs and native/dependency sources', () => {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', releaseBase], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    if (allowed.has(file)) continue;
    assert.deepEqual(current(file), previous(file), `${file} changed outside the exact release-source exceptions`);
  }
});
