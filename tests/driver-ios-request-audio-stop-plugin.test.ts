import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const requireHere = createRequire(__filename);
type ExpoConfig = Record<string, any>;
const plugin: ((config: ExpoConfig) => ExpoConfig) & {
  transformPlayer: (source: string) => string;
  transformModule: (source: string) => string;
  patchAudioPackage: (projectRoot: string) => void;
} = requireHere('../plugins/with-driver-ios-request-audio-stop.js');
const { transformPlayer, transformModule, patchAudioPackage } = plugin;

// SOURCE STRUCTURAL TESTS ONLY: no Swift compilation or AVFoundation/JSI,
// device audio, native thread interleaving, or navigation SDK is executed here.
// There is deliberately no JS callback model presented as native runtime proof.
const files = ['package.json', 'ios/AudioPlayer.swift', 'ios/AudioModule.swift'];
const installedRoot = path.dirname(requireHere.resolve('expo-audio/package.json'));
const installedBefore = files.map(file => fs.readFileSync(path.join(installedRoot, file)));
const playerFixture = installedBefore[1].toString();
const moduleFixture = installedBefore[2].toString();
const patchedPlayer = transformPlayer(playerFixture);
const patchedModule = transformModule(moduleFixture);
const sha256 = (source: string | Buffer) => createHash('sha256').update(source).digest('hex');
const hashes = {
  player: ['ec25a72a075180123437450350e7eed1ab7ef669645ebed901c4470c039ee41c', 'b4608d764c384580e2c2543e501a1cf1cc4558f04e69aaaba950ff4dcefffcf2'],
  module: ['988bad3ed7eadf2b79d0de2a02529862e7e04cf5d52c9e8ddb65b55acb133e52', 'a0129186b0f10f78c6eb5cf7efbd1ba90af508a77483aa01bf003aaaeb746885'],
};
after(() => {
  for (const [index, file] of files.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(installedRoot, file)), installedBefore[index], `Shared installed ${file} MUST remain read-only`);
  }
});

function count(source: string, needle: string) {
  return source.split(needle).length - 1;
}
function between(source: string, start: string, end: string) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, `Missing source section ${start} .. ${end}`);
  return source.slice(begin, finish);
}
function mutate(source: string, anchor: string, replacement: string) {
  assert.equal(count(source, anchor), 1, `Unique mutation anchor: ${anchor}`);
  return source.replace(anchor, replacement);
}
function method(source: string, signature: string) {
  const start = source.indexOf(`  ${signature} {\n`);
  assert.ok(start >= 0, `Missing method ${signature}`);
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start);
  return source.slice(start, end + 4);
}
function scratchAudio(version = '57.0.5', player = playerFixture, module = moduleFixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hy3n-request-audio-native-'));
  const packageRoot = path.join(root, 'node_modules', 'expo-audio');
  fs.mkdirSync(path.join(packageRoot, 'ios'), { recursive: true });
  // Only the two required Swift sources and package.json, never whole node_modules.
  const manifest = JSON.parse(installedBefore[0].toString());
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ ...manifest, version }));
  fs.writeFileSync(path.join(packageRoot, files[1]), player);
  fs.writeFileSync(path.join(packageRoot, files[2]), module);
  assert.equal(requireHere.resolve('expo-audio/package.json', { paths: [root] }), path.join(packageRoot, 'package.json'));
  return { root, packageRoot };
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else result[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
    }
  }
  visit(root);
  return result;
}
function cleanup(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
}

for (const [name, transform, fixture, patched] of [
  ['player', transformPlayer, playerFixture, patchedPlayer],
  ['module', transformModule, moduleFixture, patchedModule],
] as const) {
  test(`${name}: reviewed original/exact patched SHA256 accepted and transform is byte-idempotent`, () => {
    assert.equal(JSON.parse(installedBefore[0].toString()).version, '57.0.5');
    assert.ok(hashes[name].includes(sha256(fixture)));
    assert.equal(sha256(patched), hashes[name][1]);
    assert.equal(transform(patched), patched);
  });
  test(`${name}: changed original, marker-only, truncated and modified patched source all fail closed`, () => {
    for (const source of [
      fixture + '// changed original\n',
      '// HY3N_DRIVER_REQUEST_AUDIO_TERMINAL\n' + fixture,
      patched.slice(0, -3),
      patched + '\n',
      patched.replace('import ExpoModulesCore', 'import WrongModule'),
    ]) {
      assert.throws(() => transform(source), /source changed|incomplete|review/);
    }
  });
}

test('module: synchronous player-scoped Function is inserted before ordinary pause with no global/session operation', () => {
  const stop = between(patchedModule, '      // HY3N_DRIVER_REQUEST_AUDIO_TERMINAL', '      Function("pause")');
  assert.match(stop, /Function\("hy3nStopRequestAudio"\) \{ \(player: AudioPlayer\) in\s*player\.hy3nStopRequestAudio\(\)\s*\}/);
  assert.equal(count(patchedModule, 'Function("hy3nStopRequestAudio")'), 1);
  assert.doesNotMatch(stop, /AsyncFunction|Task\s*\{|DispatchQueue|deactivateSession|setActive\(|registry|navigation/i);
  // The marker comment mentions SDK but no SDK operation exists.
  assert.equal(patchedModule.replace(stop, ''), moduleFixture.includes(stop) ? moduleFixture.replace(stop, '') : moduleFixture);
});

test('terminal stop: disposed/epoch change FIRST, then silence, clear queue, cancel seeks and normal per-player cleanup', () => {
  const stop = method(patchedPlayer, 'func hy3nStopRequestAudio()');
  assert.match(stop, /lifecycleLock\.lock\(\)\s*defer \{ lifecycleLock\.unlock\(\) \}\s*guard !disposed else \{ return \}/);
  const order = ['disposed = true', 'lifecycleEpoch &+= 1', 'rememberedWasPlaying = false', 'source = nil', 'looping = false', 'onPlaybackComplete = nil', 'ref.pause()', 'ref.isMuted = true', 'ref.volume = 0', 'teardownPlayer()', 'queuePlayer.removeAllItems()', 'owningRegistry?.remove(self)'];
  let previous = -1;
  for (const token of order) {
    const index = stop.indexOf(token);
    assert.ok(index > previous, `Terminal ordering: ${token}`);
    previous = index;
  }
  assert.match(stop, /ref\.replaceCurrentItem\(with: nil\)/);
  assert.match(stop, /owningRegistry = nil/);
  assert.match(stop, /if isActiveForLockScreen \{\s*MediaController\.shared\.setActivePlayer\(nil\)\s*\}/);
  assert.match(stop, /isActiveForLockScreen = false\s*metadata = nil/);
  assert.doesNotMatch(stop, /AVAudioSession|deactivateSession|setActive\(false|navigation|AVPlayerLooper/);
  assert.equal(method(patchedPlayer, 'public override func sharedObjectWillRelease()'), '  public override func sharedObjectWillRelease() {\n    hy3nStopRequestAudio()\n  }');
});

test('one recursive instance lock gates callbacks by terminal state AND captured lifecycle epoch under that lock', () => {
  assert.equal(count(patchedPlayer, 'private let lifecycleLock = NSRecursiveLock()'), 1);
  assert.match(patchedPlayer, /private var disposed = false/);
  assert.match(patchedPlayer, /private var lifecycleEpoch: UInt64 = 0/);
  const helper = method(patchedPlayer, 'private func withLifecycleLock<T>(_ body: () -> T) -> T');
  assert.match(helper, /lifecycleLock\.lock\(\)\s*defer \{ lifecycleLock\.unlock\(\) \}\s*return body\(\)/);
  assert.match(method(patchedPlayer, 'private func ifCurrent(_ epoch: UInt64, _ body: () -> Void)'), /withLifecycleLock \{\s*guard !disposed, lifecycleEpoch == epoch else \{ return \}\s*body\(\)/);
});

for (const signature of [
  'func play(at rate: Float)',
  'func replaceWithPreloadedItem(_ item: AVPlayerItem?)',
  'func replaceCurrentSource(source: AudioSource)',
  'func handleMediaServicesReset()',
  'private func replacePlayer(with source: AudioSource, restoreSampling: Bool)',
  'private func replacePlayerItem(with item: AVPlayerItem?)',
  'private func enqueueNextLoopItem()',
  'func resumePlayback()',
  'private func restorePlaybackState(time: Double, shouldResume: Bool, rate: Float)',
  'private func onReady(_ completion: @escaping () -> Void)',
  'private func setupPublisher()',
  'private func installTap()',
  'func setSamplingEnabled(enabled: Bool)',
] as const) {
  test(`source structural guard: ${signature} serializes terminal check and native operation`, () => {
    const body = method(patchedPlayer, signature);
    assert.ok(body.startsWith(`  ${signature} {\n    lifecycleLock.lock()\n    defer { lifecycleLock.unlock() }\n    guard !disposed else { return }\n`));
    assert.doesNotMatch(body, /\bawait\b/);
  });
}

test('loop setter and remembered wasPlaying cannot revive a terminal player from a captured registry snapshot', () => {
  const looping = between(patchedPlayer, '  var isLooping: Bool', '  private var source');
  assert.match(looping, /lifecycleLock\.lock\(\)\s*defer \{ lifecycleLock\.unlock\(\) \}\s*guard !disposed, looping != newValue else \{ return \}\s*looping = newValue/);
  assert.match(looping, /enqueueNextLoopItem\(\)/);
  assert.match(patchedPlayer, /set \{ withLifecycleLock \{ if !disposed \{ rememberedWasPlaying = newValue \} \} \}/);
  assert.match(patchedPlayer, /set \{ withLifecycleLock \{ if !disposed \{ ref.volume = newValue \} \} \}/);
});

test('item/ref replacement increments epoch before teardown and rebuilds publishers on new epoch', () => {
  for (const [signature, rebuild] of [
    ['private func replacePlayer(with source: AudioSource, restoreSampling: Bool)', 'ref = AudioUtils.createAVPlayer'],
    ['private func replacePlayerItem(with item: AVPlayerItem?)', 'queuePlayer.removeAllItems()'],
  ] as const) {
    const body = method(patchedPlayer, signature);
    const epoch = body.indexOf('lifecycleEpoch &+= 1');
    assert.ok(epoch > 0 && epoch < body.indexOf('teardownPlayer()'));
    assert.ok(body.indexOf('teardownPlayer()') < body.indexOf(rebuild));
    assert.ok(body.indexOf(rebuild) < body.indexOf('setupPublisher()'));
  }
});

test('already-captured ready, replacement and reset completions only run within current epoch lock', () => {
  const ready = method(patchedPlayer, 'private func onReady(_ completion: @escaping () -> Void)');
  assert.match(ready, /let epoch = lifecycleEpoch[\s\S]*\.sink \{ \[weak self\] _ in self\?\.ifCurrent\(epoch, completion\) \}/);
  assert.match(method(patchedPlayer, 'func replaceCurrentSource(source: AudioSource)'), /onReady \{ \[weak self\] in[\s\S]*self\.play\(at: self\.effectiveRate\)/);
  assert.match(method(patchedPlayer, 'func handleMediaServicesReset()'), /onReady \{ \[weak self\] in[\s\S]*self\.restorePlaybackState/);
});

test('restore seek completion captures epoch and requires success before resuming inside the same lock', () => {
  const restore = method(patchedPlayer, 'private func restorePlaybackState(time: Double, shouldResume: Bool, rate: Float)');
  assert.match(restore, /let epoch = lifecycleEpoch\s*ref\.seek\(to: cmTime\) \{ \[weak self\] finished in\s*guard let self, finished, shouldResume else \{ return \}\s*self\.ifCurrent\(epoch\) \{ self\.play\(at: rate\) \}/);
});

test('async seek schedules within nonasync lock scope; stale/canceled completion still resumes once without stale status', () => {
  const seek = method(patchedPlayer, 'func seekTo(seconds: Double, toleranceMillisBefore: Double? = nil, toleranceMillisAfter: Double? = nil) async');
  assert.equal(count(seek, 'await '), 1);
  assert.ok(seek.indexOf('await withCheckedContinuation') < seek.indexOf('withLifecycleLock {'));
  assert.doesNotMatch(seek, /lifecycleLock\.lock\(\)/);
  assert.match(seek, /withLifecycleLock \{\s*guard !disposed else \{ finish\.resumeOnce\(\); return \}\s*let epoch = lifecycleEpoch\s*ref\.seek/);
  assert.match(seek, /defer \{ finish\.resumeOnce\(\) \}\s*guard let self, finished else \{ return \}\s*self\.ifCurrent\(epoch\) \{\s*self\.updateStatus/);
  const completion = patchedPlayer.slice(patchedPlayer.indexOf('private final class HY3NRequestAudioSeekCompletion'));
  assert.match(completion, /lock\.lock\(\)\s*let pending = continuation\s*continuation = nil\s*lock\.unlock\(\)\s*pending\?\.resume\(\)/);
  assert.doesNotMatch(completion, /\bawait\b|ref\.|updateStatus/);
});

test('publisher callbacks, tap, playback end and periodic time callbacks capture epoch and lock before native/status work', () => {
  const directGuard = /self\.lifecycleLock\.lock\(\)\s*defer \{ self\.lifecycleLock\.unlock\(\) \}\s*guard !self\.disposed, self\.lifecycleEpoch == epoch else \{ return \}/g;
  const publisher = method(patchedPlayer, 'private func setupPublisher()');
  assert.match(publisher, /let epoch = lifecycleEpoch/);
  assert.equal([...publisher.matchAll(directGuard)].length, 2);
  for (const signature of ['private func installTap()', 'private func addPlaybackEndNotification()', 'private func registerTimeObserver()']) {
    const body = method(patchedPlayer, signature);
    assert.match(body, /let epoch = lifecycleEpoch/);
    assert.equal([...body.matchAll(directGuard)].length, 1);
  }
});

test('teardown cancels all queue-item seeks, removes observers, clears cancellables and uninstalls/invalidates tap', () => {
  const body = method(patchedPlayer, 'private func teardownPlayer()');
  assert.match(body, /let items = \(ref as\? AVQueuePlayer\)\?\.items\(\) \?\? ref\.currentItem\.map \{ \[\$0\] \} \?\? \[\]/);
  for (const token of ['items.forEach { $0.cancelPendingSeeks() }', 'uninstallTap()', 'audioProcessor?.invalidate()', 'audioProcessor = nil', 'ref.removeTimeObserver(timeToken)', 'self.timeToken = nil', 'NotificationCenter.default.removeObserver(endObserver)', 'self.endObserver = nil', 'cancellables.removeAll()', 'ref.pause()']) {
    assert.ok(body.includes(token), token);
  }
  const uninstall = method(patchedPlayer, 'private func uninstallTap()');
  assert.match(uninstall, /audioProcessor\?\.uninstallTap\(\)/);
  assert.match(uninstall, /audioProcessor\?\.sampleBufferCallback = nil/);
});

for (const [label, transform, patched, anchor, replacement] of [
  ['terminal flag', transformPlayer, patchedPlayer, 'disposed = true', 'disposed = false'],
  ['terminal epoch', transformPlayer, patchedPlayer, '    disposed = true\n    lifecycleEpoch &+= 1', '    disposed = true\n    // epoch invalidation removed'],
  ['ready epoch guard', transformPlayer, patchedPlayer, 'self?.ifCurrent(epoch, completion)', 'completion()'],
  ['restore epoch guard', transformPlayer, patchedPlayer, 'self.ifCurrent(epoch) { self.play(at: rate) }', 'self.play(at: rate)'],
  ['queue removal', transformPlayer, patchedPlayer, '    ref.volume = 0\n    teardownPlayer()\n    if let queuePlayer = ref as? AVQueuePlayer {\n      queuePlayer.removeAllItems()', '    ref.volume = 0\n    teardownPlayer()\n    if let queuePlayer = ref as? AVQueuePlayer {\n      // queue clearing removed'],
  ['loop lock', transformPlayer, patchedPlayer, 'guard !disposed, looping != newValue else { return }', 'guard looping != newValue else { return }'],
  ['synchronous module binding', transformModule, patchedModule, 'Function("hy3nStopRequestAudio")', 'AsyncFunction("hy3nStopRequestAudio")'],
  ['stop invocation', transformModule, patchedModule, 'player.hy3nStopRequestAudio()', 'player.pause()'],
] as const) {
  test(`strict output digest rejects marked safety tamper: ${label}`, () => {
    assert.throws(() => transform(mutate(patched, anchor, replacement)), /source changed|incomplete|review/);
  });
}

test('scratch-only patch changes just required Swift files; manifest preserved; repeated run performs no writes', () => {
  const scratch = scratchAudio();
  try {
    const before = snapshot(scratch.packageRoot);
    patchAudioPackage(scratch.root);
    assert.equal(fs.readFileSync(path.join(scratch.packageRoot, files[1]), 'utf8'), patchedPlayer);
    assert.equal(fs.readFileSync(path.join(scratch.packageRoot, files[2]), 'utf8'), patchedModule);
    const once = snapshot(scratch.packageRoot);
    assert.equal(once['package.json'], before['package.json']);
    assert.deepEqual(Object.keys(once).sort(), [...files].sort());
    const timestamps = files.map(file => fs.statSync(path.join(scratch.packageRoot, file)).mtimeMs);
    patchAudioPackage(scratch.root);
    assert.deepEqual(snapshot(scratch.packageRoot), once);
    assert.deepEqual(files.map(file => fs.statSync(path.join(scratch.packageRoot, file)).mtimeMs), timestamps);
  } finally { cleanup(scratch.root); }
});

test('scratch-only patch uses staged temporary files and atomic rename, never writes target files directly', () => {
  const scratch = scratchAudio();
  const originalWrite = fs.writeFileSync;
  const originalRename = fs.renameSync;
  const operations: string[] = [];
  try {
    fs.writeFileSync = ((file: any, ...args: any[]) => {
      assert.match(String(file), /\.hy3n-request-audio-[a-f0-9]+\.tmp$/);
      operations.push('stage');
      return (originalWrite as any)(file, ...args);
    }) as typeof fs.writeFileSync;
    fs.renameSync = ((from: any, to: any) => {
      assert.match(String(from), /\.tmp$/);
      assert.ok(String(to).endsWith('AudioPlayer.swift') || String(to).endsWith('AudioModule.swift'));
      operations.push('rename');
      return originalRename(from, to);
    }) as typeof fs.renameSync;
    patchAudioPackage(scratch.root);
    assert.deepEqual(operations, ['stage', 'stage', 'rename', 'rename']);
  } finally {
    fs.writeFileSync = originalWrite;
    fs.renameSync = originalRename;
    cleanup(scratch.root);
  }
});

test('second temporary write failure leaves both original files intact and cleans staged files', () => {
  const scratch = scratchAudio();
  const originalWrite = fs.writeFileSync;
  const before = snapshot(scratch.packageRoot);
  let writes = 0;
  try {
    fs.writeFileSync = ((file: any, ...args: any[]) => {
      if (++writes === 2) throw new Error('simulated stage failure');
      return (originalWrite as any)(file, ...args);
    }) as typeof fs.writeFileSync;
    assert.throws(() => patchAudioPackage(scratch.root), /simulated stage failure/);
    assert.deepEqual(snapshot(scratch.packageRoot), before);
  } finally {
    fs.writeFileSync = originalWrite;
    cleanup(scratch.root);
  }
});

test('versions other than exact 57.0.5 fail before any temporary/source writes', () => {
  for (const version of ['57.0.4', '57.0.6', '58.0.0', '57.0.5-beta.1', undefined]) {
    const scratch = scratchAudio(version);
    try {
      if (version === undefined) fs.writeFileSync(path.join(scratch.packageRoot, 'package.json'), '{}');
      const before = snapshot(scratch.packageRoot);
      assert.throws(() => patchAudioPackage(scratch.root), /requires reviewed 57\.0\.5/);
      assert.deepEqual(snapshot(scratch.packageRoot), before);
    } finally { cleanup(scratch.root); }
  }
});

for (const broken of [1, 2]) {
  test(`invalid source ${files[broken]} prevents ANY package write`, () => {
    const scratch = scratchAudio('57.0.5', broken === 1 ? playerFixture + '// drift\n' : playerFixture, broken === 2 ? moduleFixture + '// drift\n' : moduleFixture);
    try {
      const before = snapshot(scratch.packageRoot);
      assert.throws(() => patchAudioPackage(scratch.root), /source changed|incomplete/);
      assert.deepEqual(snapshot(scratch.packageRoot), before);
    } finally { cleanup(scratch.root); }
  });
}

test('missing second source prevents partial player transformation', () => {
  const scratch = scratchAudio();
  try {
    fs.unlinkSync(path.join(scratch.packageRoot, files[2]));
    const before = snapshot(scratch.packageRoot);
    assert.throws(() => patchAudioPackage(scratch.root), /ENOENT/);
    assert.deepEqual(snapshot(scratch.packageRoot), before);
  } finally { cleanup(scratch.root); }
});

test('mixed exact prepatched/original pair is safely completed; tampered prepatched pair is rejected before writes', () => {
  for (const [player, module] of [[patchedPlayer, moduleFixture], [playerFixture, patchedModule]]) {
    const scratch = scratchAudio('57.0.5', player, module);
    try {
      patchAudioPackage(scratch.root);
      assert.equal(fs.readFileSync(path.join(scratch.packageRoot, files[1]), 'utf8'), patchedPlayer);
      assert.equal(fs.readFileSync(path.join(scratch.packageRoot, files[2]), 'utf8'), patchedModule);
    } finally { cleanup(scratch.root); }
  }
  const scratch = scratchAudio('57.0.5', patchedPlayer, patchedModule + '// tamper\n');
  try {
    const before = snapshot(scratch.packageRoot);
    assert.throws(() => patchAudioPackage(scratch.root), /source changed|incomplete/);
    assert.deepEqual(snapshot(scratch.packageRoot), before);
  } finally { cleanup(scratch.root); }
});

test('external/shared dependency symlink is refused without touching either package source', () => {
  const scratch = scratchAudio();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'hy3n-request-audio-symlink-'));
  try {
    fs.mkdirSync(path.join(project, 'node_modules'));
    fs.symlinkSync(scratch.packageRoot, path.join(project, 'node_modules', 'expo-audio'), 'dir');
    const before = snapshot(scratch.packageRoot);
    assert.throws(() => patchAudioPackage(project), /project-local install|shared\/external/);
    assert.deepEqual(snapshot(scratch.packageRoot), before);
  } finally { cleanup(project); cleanup(scratch.root); }
});

test('plugin only registers ios dangerous mod once and leaves Android, in-app audio and unrelated config unchanged', async () => {
  const scratch = scratchAudio();
  try {
    const config = {
      name: 'Driver', slug: 'driver',
      android: { package: 'com.hy3n.driver', permissions: ['ACCESS_FINE_LOCATION'], edgeToEdgeEnabled: true },
      ios: { bundleIdentifier: 'com.hy3n.driver', infoPlist: { UIBackgroundModes: ['audio', 'location'] } },
      extra: { inAppAudio: { chime: 'gold', keepSession: true }, maps: 'unchanged' },
      plugins: [['expo-audio', { microphonePermission: false }], '@googlemaps/react-native-navigation-sdk'],
    };
    const before = structuredClone(config);
    const packageBefore = snapshot(scratch.packageRoot);
    const once = plugin(config);
    assert.deepEqual(snapshot(scratch.packageRoot), packageBefore, 'Registering a mod must not write native sources');
    for (const key of ['name', 'slug', 'android', 'ios', 'extra', 'plugins'] as const) assert.deepEqual(once[key], before[key]);
    assert.deepEqual(Object.keys(once.mods), ['ios']);
    assert.deepEqual(Object.keys(once.mods.ios), ['dangerous']);
    const mod = once.mods.ios.dangerous;
    const twice = plugin(once);
    assert.equal(twice.mods.ios.dangerous, mod, 'createRunOncePlugin avoids duplicate mod registration');
    const result = await mod({ ...twice, modRequest: { projectRoot: scratch.root, platform: 'ios', modName: 'dangerous' } });
    for (const key of ['name', 'slug', 'android', 'ios', 'extra', 'plugins'] as const) assert.deepEqual(result[key], before[key]);
    assert.equal(fs.readFileSync(path.join(scratch.packageRoot, files[1]), 'utf8'), patchedPlayer);
    assert.equal(fs.readFileSync(path.join(scratch.packageRoot, files[2]), 'utf8'), patchedModule);
  } finally { cleanup(scratch.root); }
});
