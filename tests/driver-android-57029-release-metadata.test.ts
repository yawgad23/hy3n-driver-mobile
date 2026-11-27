import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { ANDROID_REQUEST_STOP_FIX, RELEASE_57029_PATHS, with57029Metadata, without57029Metadata } from './helpers/driver-android-57029-metadata';

const root = path.join(__dirname, '..');
const previous = (file: string) => execFileSync('git', ['show', `${ANDROID_REQUEST_STOP_FIX}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const current = (file: string) => fs.readFileSync(path.join(root, file));
const keyScenarios: Record<string, string>[] = [
  {},
  { GOOGLE_MAPS_IOS_API_KEY: 'ios-test-key', GOOGLE_MAPS_ANDROID_API_KEY: 'android-test-key' },
  { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-fallback', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-fallback' },
  { GOOGLE_MAPS_IOS_API_KEY: 'ios-test-key', GOOGLE_MAPS_ANDROID_API_KEY: 'android-test-key', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'unused-ios', EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'unused-android' },
  { GOOGLE_MAPS_IOS_API_KEY: 'ios-only' },
  { GOOGLE_MAPS_ANDROID_API_KEY: 'android-only' },
];
function config(source: Buffer, platform?: string, keys: Record<string, string> = {}) {
  const code = ts.transpileModule(source.toString('utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, process: { env: { ...keys, ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}) } }, require: (name: string) => { assert.equal(name, './scripts/load-env.js'); return {}; } });
  return JSON.parse(JSON.stringify(exports.default));
}

test('raw 57029 config changes exactly Android version/code for every platform and Maps-key scenario', () => {
  for (const keys of keyScenarios) for (const platform of ['android', 'ios', 'web', undefined]) {
    const expected = config(previous('app.config.ts'), platform, keys);
    if (platform === 'android') { assert.equal(expected.version, '1.0.8'); assert.equal(expected.android.versionCode, 57028); expected.version = '1.0.9'; expected.android.versionCode = 57029; }
    assert.deepEqual(config(current('app.config.ts'), platform, keys), expected);
  }
});

test('raw 57029 config text is exactly the two approved metadata/comment replacements, and normalization rejects malformed literals', () => {
  const raw = current('app.config.ts').toString('utf8');
  const base = previous('app.config.ts').toString('utf8');
  assert.equal(raw, with57029Metadata(base));
  assert.equal(without57029Metadata(raw), base);
  assert.throws(() => without57029Metadata(raw.replace('? "1.0.9"', '? "1.0.10"')), /exact 57029 metadata/);
  assert.throws(() => without57029Metadata(raw.replace('? 57029 : 57023', '? 57030 : 57023')), /exact 57029 metadata/);
});

test('57029 raw package/counter, SDK54, Gold volume, DataStore1.2.1 and frozen Production AAB identity', () => {
  const android = config(current('app.config.ts'), 'android');
  assert.equal(android.version, '1.0.9'); assert.equal(android.android.versionCode, 57029);
  assert.equal(android.android.package, 'com.hy3n.driver');
  assert.equal(android.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(android.plugins.filter((p: any) => p === './plugins/with-android-datastore-16kb').length, 1);
  assert.equal(require('../plugins/with-android-datastore-16kb').DATASTORE_VERSION, '1.2.1');
  const pkg = JSON.parse(current('package.json').toString('utf8'));
  assert.equal(pkg.dependencies.expo, '~54.0.37'); assert.equal(pkg.dependencies['expo-audio'], '~1.1.1');
  const eas = JSON.parse(current('eas.json').toString('utf8'));
  assert.equal(eas.cli.appVersionSource, 'local'); assert.equal(eas.build.production.autoIncrement, undefined);
  assert.equal(eas.build.production.environment, 'production'); assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.submit.production.android.track, 'production');
});

test('57029 release preparation changes exactly six named metadata/test/doc paths including untracked additions', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '-z', ANDROID_REQUEST_STOP_FIX, '--'], { cwd: root, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(`${changed}${untracked}`.split('\0').filter(Boolean)), RELEASE_57029_PATHS);
});

test('57029 preserves every other tested correction byte, including all production audio/server-read source and normalization literals', () => {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', ANDROID_REQUEST_STOP_FIX], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) if (!RELEASE_57029_PATHS.has(file)) assert.deepEqual(current(file), previous(file), `${file}: release metadata preparation changed protected correction bytes`);
});
