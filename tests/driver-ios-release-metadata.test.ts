import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = path.join(__dirname, '..');
const baseline = '3aed02cdf4dfe02da445e2592112ed894226c59a';
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

test('Driver iOS release is explicitly 1.0.3 (125) for the correct app', () => {
  assert.equal(ios.name, 'HY3N Driver');
  assert.equal(ios.version, '1.0.3');
  assert.equal(ios.ios.buildNumber, '125');
  assert.equal(ios.ios.bundleIdentifier, 'com.hy3n.driver');
  assert.equal(ios.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
  assert.equal(ios.owner, 'yawgad');
});

test('every Android config field remains identical to the released 57023 source', () => {
  assert.deepEqual(config(current('app.config.ts'), 'android'), config(previous('app.config.ts'), 'android'));
});

test('unspecified and web config remain identical to the preserved source', () => {
  for (const platform of [undefined, 'web']) {
    assert.deepEqual(config(current('app.config.ts'), platform), config(previous('app.config.ts'), platform));
  }
});

test('the only iOS configuration changes are marketing version and build number', () => {
  const expected = config(previous('app.config.ts'), 'ios');
  expected.version = '1.0.3';
  expected.ios.buildNumber = '125';
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

test('no dependency, lockfile or native Maps plugin drift is introduced for the iOS port', () => {
  for (const file of ['package.json', 'pnpm-lock.yaml', 'plugins/with-google-navigation.js']) {
    assert.equal(current(file), previous(file), `${file} must remain unchanged`);
  }
});
