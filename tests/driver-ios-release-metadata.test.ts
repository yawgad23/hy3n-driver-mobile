import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { addSdkMatchedPhotoDependencies, withoutDriverPhotoLockAdditions } from './helpers/driver-photo-dependencies';

const root = path.join(__dirname, '..');
const baseline = '3aed02cdf4dfe02da445e2592112ed894226c59a';
const previous = (file: string) => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
const delivered57025 = 'f50da8cc6bc405afcde69e0548b197ab8d948d81';
const deliveredSource = (file: string) => execFileSync('git', ['show', `${delivered57025}:${file}`], { cwd: root, encoding: 'utf8' });
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

test('Driver iOS release is explicitly 1.0.3 (126) for the correct app', () => {
  assert.equal(ios.name, 'HY3N Driver');
  assert.equal(ios.version, '1.0.3');
  assert.equal(ios.ios.buildNumber, '126');
  assert.equal(ios.ios.bundleIdentifier, 'com.hy3n.driver');
  assert.equal(ios.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(ios.owner, 'yawgad');
});

test('historical Android 57025 changes only marketing version and version code from the released 57023 source', () => {
  const expected = config(previous('app.config.ts'), 'android');
  expected.version = '1.0.5';
  expected.android.versionCode = 57025;
  assert.deepEqual(config(deliveredSource('app.config.ts'), 'android'), expected);
});

test('unspecified and web config remain identical to the preserved source', () => {
  for (const platform of [undefined, 'web']) {
    assert.deepEqual(config(current('app.config.ts'), platform), config(previous('app.config.ts'), platform));
  }
});

test('the only iOS configuration changes are marketing version and build number', () => {
  const expected = config(previous('app.config.ts'), 'ios');
  expected.version = '1.0.3';
  expected.ios.buildNumber = '126';
  assert.deepEqual(ios, expected);
});

test('iOS keeps native Maps injection and restricted-key alias precedence', () => {
  const plugin = ios.plugins.find((p: any) => Array.isArray(p) && p[0] === './plugins/with-google-navigation');
  assert.deepEqual(plugin, ['./plugins/with-google-navigation', { iosApiKey: clientKeys.GOOGLE_MAPS_IOS_API_KEY, androidApiKey: clientKeys.GOOGLE_MAPS_ANDROID_API_KEY }]);
  const fallback = config(current('app.config.ts'), 'ios', {
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS: 'ios-fallback-client-key',
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID: 'android-fallback-client-key',
  });
  assert.deepEqual(fallback.plugins.find((p: any) => Array.isArray(p) && p[0] === './plugins/with-google-navigation'), ['./plugins/with-google-navigation', { iosApiKey: 'ios-fallback-client-key', androidApiKey: 'android-fallback-client-key' }]);
});

test('production EAS profile and existing Driver Apple submission destination are unchanged', () => {
  assert.equal(current('eas.json'), previous('eas.json'));
  const eas = JSON.parse(current('eas.json'));
  assert.equal(eas.cli.appVersionSource, 'local');
  assert.equal(eas.build.production.environment, 'production');
  assert.equal(eas.build.production.ios.buildConfiguration, 'Release');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_API_BASE_URL, 'https://api-yvurtipaxq-ew.a.run.app');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_DRIVER_NAV_DIAGNOSTICS, undefined);
  assert.equal(eas.submit.production.ios.ascAppId, '6798016192');
  assert.equal(eas.submit.production.ios.appleTeamId, '49Q5ZSPMZ9');
});

test('only the approved Apple sign-in pin and SDK-matched photo modules change the dependency manifest', () => {
  const expected = JSON.parse(previous('package.json'));
  expected.dependencies['expo-apple-authentication'] = '8.0.8';
  addSdkMatchedPhotoDependencies(expected, root);
  assert.deepEqual(JSON.parse(current('package.json')), expected);
  assert.equal(current('plugins/with-google-navigation.js'), previous('plugins/with-google-navigation.js'));
});

test('every other lock resolution, including the backend Git pin, remains unchanged', () => {
  const withoutApple = (source: string) => withoutDriverPhotoLockAdditions(source)
    .replace(/^      expo-apple-authentication:\n.*?(?=^      \S|^    \S|^\S|$(?![\s\S]))/gms, '')
    .replace(/^  expo-apple-authentication@[^\n]*:\n.*?(?=^  \S|^\S|$(?![\s\S]))/gms, '');
  assert.equal(withoutApple(current('pnpm-lock.yaml')), withoutApple(previous('pnpm-lock.yaml')));
  assert.match(current('pnpm-lock.yaml'), /expo-apple-authentication:\n        specifier: 8\.0\.8\n        version: 8\.0\.8\(/);
  assert.doesNotMatch(current('pnpm-lock.yaml'), /expo-apple-authentication@58\./);
});

test('installed Apple sign-in source passes the iOS 16 target and avoids the missing Core API', () => {
  const moduleRoot = path.dirname(require.resolve('expo-apple-authentication/package.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8')).version, '8.0.8');
  const podspec = fs.readFileSync(path.join(moduleRoot, 'ios/ExpoAppleAuthentication.podspec'), 'utf8');
  assert.match(podspec, /:ios\s*=>\s*'15\.1'/);
  const request = fs.readFileSync(path.join(moduleRoot, 'ios/AppleAuthenticationRequest.swift'), 'utf8');
  assert.doesNotMatch(request, /Utilities\.keyWindow\(/);
  const modules = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8'));
  assert.ok(modules.platforms.includes('apple'));
  assert.ok(modules.apple.modules.includes('AppleAuthenticationModule'));
});
