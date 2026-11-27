import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = path.join(__dirname, '..');
const submitted = 'e3e7b3f17c472fd7971fbc708dcbbcc1a7222165';
const compatibilityRelease = '7c476da16724e22d2e1c11d49cde2806b3650a65';
const original = (file: string) => execFileSync('git', ['show', `${submitted}:${file}`], { cwd: root, encoding: 'utf8' });
const current = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const pluginPath = './plugins/with-android-datastore-16kb';
const plugin = require('../plugins/with-android-datastore-16kb');
const keys = { GOOGLE_MAPS_IOS_API_KEY: 'ios-test-key', GOOGLE_MAPS_ANDROID_API_KEY: 'android-test-key' };
const allowed = new Set([
  'app.config.ts',
  'plugins/with-android-datastore-16kb.js',
  'tests/driver-android-datastore-16kb.test.ts',
  'tests/driver-android-release-metadata.test.ts',
  'docs/driver-android-1.0.7-57027-datastore-16kb-20261126.md',
]);

function evaluate(source: string, platform?: string, clientKeys: Record<string, string> = keys) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    process: { env: { ...clientKeys, ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}) } },
    require: (name: string) => { assert.equal(name, './scripts/load-env.js'); return {}; },
  });
  return JSON.parse(JSON.stringify(exports.default));
}

test('16 KB candidate Android config adds exactly one standalone plugin, with and without Navigation keys', () => {
  const keyScenarios: Record<string, string>[] = [keys, {}, { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'i', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'a' }];
  for (const clientKeys of keyScenarios) {
    const before = evaluate(original('app.config.ts'), 'android', clientKeys);
    const after = evaluate(current('app.config.ts'), 'android', clientKeys);
    assert.equal(before.version, '1.0.6');
    assert.equal(before.android.versionCode, 57026);
    assert.equal(after.version, '1.0.7');
    assert.equal(after.android.versionCode, 57027);
    assert.equal(after.plugins.filter((entry: any) => entry === pluginPath).length, 1);
    after.plugins = after.plugins.filter((entry: any) => entry !== pluginPath);
    before.version = '1.0.7';
    before.android.versionCode = 57027;
    assert.deepEqual(after, before, 'all config outside exact Android metadata and one plugin must remain exact');
  }
});

test('16 KB candidate leaves iOS, web and unspecified configurations exact', () => {
  for (const platform of ['ios', 'web', undefined]) for (const clientKeys of [keys, {}]) {
    const after = evaluate(current('app.config.ts'), platform, clientKeys);
    assert.deepEqual(after, evaluate(original('app.config.ts'), platform, clientKeys));
    assert.ok(!after.plugins.includes(pluginPath));
  }
});

test('app config source changes only exact Android metadata and Android-only plugin registration', () => {
  const registration = '    // Android-only DataStore infrastructure patch; independent of Maps keys.\n    ...(buildPlatform === "android" ? ["./plugins/with-android-datastore-16kb"] : []),\n';
  assert.equal(current('app.config.ts').split(registration).length - 1, 1);
  let expected = original('app.config.ts');
  for (const [before, after] of [
    ['buildPlatform === "android"\n    ? "1.0.6"', 'buildPlatform === "android"\n    ? "1.0.7"'],
    ['    // 1.0.6 (57026) carries the reviewed Android request-sound fix over 57025;', '    // 1.0.7 (57027) adds the Android-only DataStore 16 KB infrastructure patch;'],
    ['versionCode: buildPlatform === "android" ? 57026 : 57023,', 'versionCode: buildPlatform === "android" ? 57027 : 57023,'],
  ]) {
    assert.equal(expected.split(before).length - 1, 1, 'exact baseline metadata must occur once');
    expected = expected.replace(before, after);
  }
  assert.equal(current('app.config.ts').replace(registration, ''), expected);
});

test('DataStore plugin appends the exact scoped constraint once and is idempotent', () => {
  const before = 'apply plugin: "com.android.application"\nandroid { namespace "com.hy3n.driver" }\ndependencies { implementation("com.facebook.react:react-android") }\n';
  const after = plugin.addDataStoreConstraint(before, 'groovy');
  assert.equal(after, `${before.trimEnd()}\n\n${plugin.CONSTRAINT_BLOCK}\n`);
  assert.equal(plugin.addDataStoreConstraint(after, 'groovy'), after);
  assert.equal(after.split('androidx.datastore:datastore-core:1.2.1').length - 1, 1);
  assert.equal(plugin.DATASTORE_VERSION, '1.2.1');
});

test('DataStore plugin refuses silently incomplete, duplicate, changed or unsupported configuration', () => {
  const valid = plugin.addDataStoreConstraint('dependencies {}\n', 'groovy');
  for (const invalid of [
    '// HY3N_ANDROID_DATASTORE_16KB_BEGIN',
    '// HY3N_ANDROID_DATASTORE_16KB_END',
    `${valid}\n${plugin.CONSTRAINT_BLOCK}`,
    valid.replace('datastore-core:1.2.1', 'datastore-core:1.2.0'),
  ]) assert.throws(() => plugin.addDataStoreConstraint(invalid, 'groovy'), /duplicated, incomplete or changed/);
  assert.throws(() => plugin.addDataStoreConstraint('dependencies {}', 'kotlin'), /Groovy/);
});

test('DataStore plugin registers only Android appBuildGradle and does not remove any library or force unrelated upgrades', () => {
  const source = current('plugins/with-android-datastore-16kb.js');
  assert.match(source, /withAppBuildGradle\(config/);
  assert.doesNotMatch(source, /withAppDelegate|withInfoPlist|withDangerousMod|withAndroidManifest|resolutionStrategy|\.force\(|exclude\(|pickFirst|useLegacyPackaging/);
  assert.equal(source.split("implementation('androidx.datastore:").length - 1, 1);
});

test('published 57027 compatibility release changes exactly the explicit config/plugin/test/release-note paths', () => {
  // Audit that release's immutable commit, not unrelated features added later.
  const changed = execFileSync('git', ['diff', '--name-only', submitted, compatibilityRelease, '--'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(changed.split('\n').filter(Boolean)), allowed);
});

test('current navigation, Home, audio controller, registration and native/dependency configuration remain byte-exact', () => {
  for (const file of [
    'app/(tabs)/home.tsx', 'app/driver/register.tsx', 'lib/driver-request-audio.ts',
    'plugins/with-google-navigation.js', 'package.json', 'pnpm-lock.yaml', 'eas.json',
    'firebase/google-services.json', 'firebase/GoogleService-Info.plist',
  ]) {
    const bytes = execFileSync('git', ['show', `${submitted}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    assert.deepEqual(fs.readFileSync(path.join(root, file)), bytes, `${file} must remain exact`);
  }
  // Preserve the historical compatibility-release audio audit, not a rolling old-song requirement.
  const song = 'assets/audio/incoming-trip-alert.wav';
  const submittedSong = execFileSync('git', ['show', `${submitted}:${song}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const compatibilitySong = execFileSync('git', ['show', `${compatibilityRelease}:${song}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.deepEqual(compatibilitySong, submittedSong, 'published 57027 song must match submitted 57026');
});
