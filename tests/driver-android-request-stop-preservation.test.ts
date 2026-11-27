import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REQUEST_STOP_BASELINE, withoutAndroidRequestStopAdditions, assertReviewedRequestAudio } from './helpers/driver-android-request-stop-scope';

const root = path.join(__dirname, '..');
const previous = (file: string) => execFileSync('git', ['show', `${REQUEST_STOP_BASELINE}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const current = (file: string) => fs.readFileSync(path.join(root, file));
// Every exception is a named audio/server-read implementation or regression path.
// No native plugin, asset, dependency, config, documentation or unrelated UI path.
const allowed = new Set([
  'app/(tabs)/home.tsx', 'lib/driver-request-audio.ts', 'lib/driver-request-audio-diagnostics.ts', 'lib/firebase.ts',
  'tests/driver-accept-server-read.test.ts', 'tests/driver-request-audio-android-global-stop.test.ts',
  'tests/driver-request-audio-global-stop.test.ts', 'tests/driver-request-audio-diagnostics.test.ts',
  'tests/driver-request-audio-home-lifecycle.test.ts', 'tests/driver-request-audio-start-boundary.test.ts',
  'tests/driver-request-audio.test.ts', 'tests/native-google-map.test.ts',
  'tests/helpers/driver-server-trip-read.ts', 'tests/helpers/driver-android-request-stop-scope.ts',
  'tests/driver-android-home-layout.test.ts', 'tests/driver-android-release-metadata.test.ts',
  'tests/driver-android-datastore-16kb.test.ts', 'tests/driver-android-57028-release-metadata.test.ts',
  'tests/driver-android-request-stop-preservation.test.ts',
]);

test('Android request-stop implementation changes exactly its named source/regression paths, including untracked additions', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '-z', REQUEST_STOP_BASELINE, '--'], { cwd: root, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(`${changed}${untracked}`.split('\0').filter(Boolean)), allowed);
});

test('every other 57028 source byte stays exact: Gold WAV/volume, 16KB/navigation plugins, maps/car/camera, auth/approval/registration, profile/selfie, Driver types/Call and package/lock/eas/app configuration', () => {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', REQUEST_STOP_BASELINE], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    if (allowed.has(file)) continue;
    assert.deepEqual(current(file), previous(file), `${file}: protected baseline source must remain byte-identical`);
  }
});

test('Home UI/map/other handlers and Firebase auth/registration remain byte-identical after only exact reviewed request-stop/server-read normalization', () => {
  for (const file of ['app/(tabs)/home.tsx', 'lib/firebase.ts']) {
    assert.equal(withoutAndroidRequestStopAdditions(file, current(file).toString('utf8')), previous(file).toString('utf8'), file);
    const scopedToken = file === 'lib/firebase.ts' ? 'getDocFromServer' : 'stopAllDriverRequestAudio';
    assert.throws(() => withoutAndroidRequestStopAdditions(file, current(file).toString('utf8').replace(scopedToken, 'unreviewedAddition')), /exact reviewed addition/);
  }
  assertReviewedRequestAudio(current('lib/driver-request-audio.ts'));
  assert.throws(() => assertReviewedRequestAudio(Buffer.concat([current('lib/driver-request-audio.ts'), Buffer.from('\n')])), /exact reviewed implementation/);
});

test('Android request audio keeps own-player disposal and does not disable the shared audio session or install an iOS/native patch', () => {
  const audio = current('lib/driver-request-audio.ts').toString('utf8');
  assert.match(audio, /options.platform === 'ios' && player.hy3nStopRequestAudio/);
  assert.match(audio, /nativeOperation\(player, 'remove', \(\) => player.remove\(\)\)/);
  assert.match(audio, /nativeOperation\(player, 'release', \(\) => player.release\(\)\)/);
  assert.doesNotMatch(audio, /setIsAudioActiveAsync|deactivateAudioSession/);
  assert.doesNotMatch(current('app.config.ts').toString('utf8'), /with-driver-ios-request-audio-stop|with-driver-ios-sdk27/);
  assert.equal(JSON.parse(current('package.json').toString('utf8')).dependencies.expo, '~54.0.37');
  assert.equal(JSON.parse(current('package.json').toString('utf8')).dependencies['expo-audio'], '~1.1.1');
});
