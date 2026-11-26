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
const current = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const clientKeys = {
  GOOGLE_MAPS_IOS_API_KEY: 'ios-client-test-key',
  GOOGLE_MAPS_ANDROID_API_KEY: 'android-client-test-key',
};

function config(source: string, platform?: string) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    process: { env: { ...clientKeys, ...(platform ? { EAS_BUILD_PLATFORM: platform } : {}) } },
    require: (name: string) => {
      assert.equal(name, './scripts/load-env.js');
      return {};
    },
  });
  return JSON.parse(JSON.stringify(exports.default));
}

const android = config(current('app.config.ts'), 'android');
const baselineAndroid = config(previous('app.config.ts'), 'android');

 test('Android 57024 config differs from clean HEAD only by version and versionCode', () => {
  const expected = structuredClone(baselineAndroid);
  expected.version = '1.0.4';
  expected.android.versionCode = 57024;
  assert.deepEqual(android, expected);
  assert.equal(android.name, 'HY3N Driver');
  assert.equal(android.android.package, 'com.hy3n.driver');
  assert.equal(android.extra.eas.projectId, 'd19afe45-8e3d-42f9-ad5e-70b12b2c2ce9');
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
