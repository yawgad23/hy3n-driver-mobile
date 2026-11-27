const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-driver-ios-request-audio-stop';
const AUDIO_VERSION = '57.0.5';
// Exact published originals AND exact reviewed output, not a marker-only check.
const SOURCE_HASHES = {
  player: {
    original: 'ec25a72a075180123437450350e7eed1ab7ef669645ebed901c4470c039ee41c',
    patched: 'b4608d764c384580e2c2543e501a1cf1cc4558f04e69aaaba950ff4dcefffcf2',
  },
  module: {
    original: '988bad3ed7eadf2b79d0de2a02529862e7e04cf5d52c9e8ddb65b55acb133e52',
    patched: 'a0129186b0f10f78c6eb5cf7efbd1ba90af508a77483aa01bf003aaaeb746885',
  },
};
const hash = source => createHash('sha256').update(source).digest('hex');

function reviewed(source, kind) {
  const digest = hash(source);
  if (digest === SOURCE_HASHES[kind].patched) return true;
  if (digest !== SOURCE_HASHES[kind].original) {
    throw new Error(`ExpoAudio ${kind} source changed or patch is incomplete; review ${AUDIO_VERSION} request audio patch`);
  }
  return false;
}

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('ExpoAudio request audio patch anchor changed; review before building');
  return source.replace(anchor, replacement);
}

// The recursive lock serializes AVPlayer mutations and synchronous Combine/KVO
// re-entry. Every deferred callback captures an epoch; cancellation alone cannot
// revoke a callback that AVFoundation/Combine has already captured.
const LOCK_FIELDS = String.raw`  // HY3N_DRIVER_REQUEST_AUDIO_TERMINAL: per-player only; never deactivate the session.
  private let lifecycleLock = NSRecursiveLock()
  private var disposed = false
  private var lifecycleEpoch: UInt64 = 0
  private var rememberedWasPlaying = false
  private var looping = false

  private func withLifecycleLock<T>(_ body: () -> T) -> T {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    return body()
  }

  private func ifCurrent(_ epoch: UInt64, _ body: () -> Void) {
    withLifecycleLock {
      guard !disposed, lifecycleEpoch == epoch else { return }
      body()
    }
  }

`;
const LIVE_GUARD = `    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    guard !disposed else { return }
`;
const CALLBACK_GUARD = `        self.lifecycleLock.lock()
        defer { self.lifecycleLock.unlock() }
        guard !self.disposed, self.lifecycleEpoch == epoch else { return }
`;

function transformPlayer(source) {
  if (reviewed(source, 'player')) return source;
  source = replaceOnce(source, 'import Combine\n', 'import Combine\nimport Foundation\n');
  source = replaceOnce(source, '  let id = UUID().uuidString\n', LOCK_FIELDS + '  let id = UUID().uuidString\n');
  source = replaceOnce(source, '  var wasPlaying = false\n', `  var wasPlaying: Bool {
    get { withLifecycleLock { rememberedWasPlaying } }
    set { withLifecycleLock { if !disposed { rememberedWasPlaying = newValue } } }
  }
`);
  source = replaceOnce(source, String.raw`  var isLooping = false {
    didSet {
      guard isLooping != oldValue else {
        return
      }`, `  var isLooping: Bool {
    get { withLifecycleLock { looping } }
    set {
      lifecycleLock.lock()
      defer { lifecycleLock.unlock() }
      guard !disposed, looping != newValue else { return }
      looping = newValue`);

  // Only void, synchronous instance methods. No lock spans an async suspension.
  for (const signature of [
    'func play(at rate: Float)',
    'func setSamplingEnabled(enabled: Bool)',
    'func setActiveForLockScreen(_ active: Bool = true, metadata: Metadata? = nil, options: LockScreenOptions?)',
    'func updateStatus(with dict: [String: Any])',
    'private func setupPublisher()',
    'func replaceWithPreloadedItem(_ item: AVPlayerItem?)',
    'func replaceCurrentSource(source: AudioSource)',
    'func handleMediaServicesReset()',
    'private func replacePlayer(with source: AudioSource, restoreSampling: Bool)',
    'private func onReady(_ completion: @escaping () -> Void)',
    'private func restorePlaybackState(time: Double, shouldResume: Bool, rate: Float)',
    'private func installTap()',
    'private func replacePlayerItem(with item: AVPlayerItem?)',
    'private func enqueueNextLoopItem()',
    'private func addPlaybackEndNotification()',
    'private func registerTimeObserver()',
    'func pause()',
    'func resumePlayback()',
  ]) {
    const anchor = `  ${signature} {\n`;
    source = replaceOnce(source, anchor, anchor + LIVE_GUARD);
  }
  source = replaceOnce(source, '  func currentStatus() -> [String: Any?] {\n', `  func currentStatus() -> [String: Any?] {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
`);
  source = replaceOnce(source, '    set { ref.volume = newValue }', '    set { withLifecycleLock { if !disposed { ref.volume = newValue } } }');
  source = replaceOnce(source, '    get { ref.volume }', '    get { withLifecycleLock { ref.volume } }');

  source = replaceOnce(source, String.raw`    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      ref.seek(to: time, toleranceBefore: toleranceBefore, toleranceAfter: toleranceAfter) { [weak self] _ in
        if let self {
          self.updateStatus(with: [
            "currentTime": self.currentTime
          ])
        }
        continuation.resume()
      }
    }`, String.raw`    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let finish = HY3NRequestAudioSeekCompletion(continuation)
      // Schedule under the lock, then return/unlock BEFORE awaiting completion.
      withLifecycleLock {
        guard !disposed else { finish.resumeOnce(); return }
        let epoch = lifecycleEpoch
        ref.seek(to: time, toleranceBefore: toleranceBefore, toleranceAfter: toleranceAfter) { [weak self] finished in
          // A canceled/stale seek still completes its continuation exactly once.
          defer { finish.resumeOnce() }
          guard let self, finished else { return }
          self.ifCurrent(epoch) {
            self.updateStatus(with: ["currentTime": self.currentTime])
          }
        }
      }
    }`);

  source = replaceOnce(source, '    ref.publisher(for: \\.currentItem?.status)\n      .sink', '    let epoch = lifecycleEpoch\n    ref.publisher(for: \\.currentItem?.status)\n      .sink');
  source = replaceOnce(source, `        guard let self, let status else {
          return
        }
`, `        guard let self, let status else {
          return
        }
${CALLBACK_GUARD}`);
  source = replaceOnce(source, `        guard let self else {
          return
        }
`, `        guard let self else {
          return
        }
${CALLBACK_GUARD}`);

  // Invalidate old observers/ready/seek callbacks BEFORE replacing the item/ref.
  source = replaceOnce(source, `    teardownPlayer()

    ref = AudioUtils.createAVPlayer(from: source)`, `    lifecycleEpoch &+= 1
    teardownPlayer()

    ref = AudioUtils.createAVPlayer(from: source)`);
  source = replaceOnce(source, `    if let queuePlayer = ref as? AVQueuePlayer {
      queuePlayer.removeAllItems()`, `    lifecycleEpoch &+= 1
    teardownPlayer()
    if let queuePlayer = ref as? AVQueuePlayer {
      queuePlayer.removeAllItems()`);
  source = replaceOnce(source, `      ref.replaceCurrentItem(with: item)
    }
  }`, `      ref.replaceCurrentItem(with: item)
    }
    setupPublisher()
  }`);
  source = replaceOnce(source, `  private func teardownPlayer() {
    removeQueuedLoopItems()
    if samplingEnabled {
      uninstallTap()
    }`, `  private func teardownPlayer() {
    // Caller holds lifecycleLock, including terminal cleanup when disposed.
    ref.pause()
    let items = (ref as? AVQueuePlayer)?.items() ?? ref.currentItem.map { [$0] } ?? []
    items.forEach { $0.cancelPendingSeeks() }
    removeQueuedLoopItems()
    uninstallTap()
    audioProcessor?.invalidate()
    audioProcessor = nil`);

  source = replaceOnce(source, String.raw`    ref.publisher(for: \.currentItem?.status)
      .compactMap { $0 }
      .filter { $0 == .readyToPlay }
      .first()
      .sink { _ in completion() }`, String.raw`    let epoch = lifecycleEpoch
    ref.publisher(for: \.currentItem?.status)
      .compactMap { $0 }
      .filter { $0 == .readyToPlay }
      .first()
      .sink { [weak self] _ in self?.ifCurrent(epoch, completion) }`);
  source = replaceOnce(source, `    ref.seek(to: cmTime) { [weak self] _ in
      guard let self, shouldResume else { return }
      self.play(at: rate)
    }`, `    let epoch = lifecycleEpoch
    ref.seek(to: cmTime) { [weak self] finished in
      guard let self, finished, shouldResume else { return }
      self.ifCurrent(epoch) { self.play(at: rate) }
    }`);
  source = replaceOnce(source, `    if success {
      audioProcessor?.sampleBufferCallback`, `    if success {
      let epoch = lifecycleEpoch
      audioProcessor?.sampleBufferCallback`);
  source = replaceOnce(source, `          let data = audioBuffer.mData,
          self.samplingEnabled else {`, `          let data = audioBuffer.mData else {`);
  source = replaceOnce(source, `        let channelCount = Int(audioBuffer.mNumberChannels)`, `${CALLBACK_GUARD}        guard self.samplingEnabled else { return }

        let channelCount = Int(audioBuffer.mNumberChannels)`);
  source = replaceOnce(source, '    endObserver = NotificationCenter.default.addObserver(', '    let epoch = lifecycleEpoch\n    endObserver = NotificationCenter.default.addObserver(');
  source = replaceOnce(source, `      guard let queuePlayer = self.ref as? AVQueuePlayer,`, `      self.lifecycleLock.lock()
      defer { self.lifecycleLock.unlock() }
      guard !self.disposed, self.lifecycleEpoch == epoch else { return }

      guard let queuePlayer = self.ref as? AVQueuePlayer,`);
  source = replaceOnce(source, '    timeToken = ref.addPeriodicTimeObserver(', '    let epoch = lifecycleEpoch\n    timeToken = ref.addPeriodicTimeObserver(');
  source = replaceOnce(source, `      self.updateStatus(with: [
        "currentTime": time.seconds`, `      self.lifecycleLock.lock()
      defer { self.lifecycleLock.unlock() }
      guard !self.disposed, self.lifecycleEpoch == epoch else { return }

      self.updateStatus(with: [
        "currentTime": time.seconds`);

  source = replaceOnce(source, `  public override func sharedObjectWillRelease() {
    ref.currentItem?.cancelPendingSeeks()
    owningRegistry?.remove(self)

    if isActiveForLockScreen {
      MediaController.shared.setActivePlayer(nil)
    }

    teardownPlayer()

    audioProcessor?.invalidate()
    audioProcessor = nil
  }`, `  func hy3nStopRequestAudio() {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    guard !disposed else { return }
    // Terminal FIRST: queued callbacks cannot revive even a registry snapshot.
    disposed = true
    lifecycleEpoch &+= 1
    rememberedWasPlaying = false
    source = nil
    looping = false
    samplingEnabled = false
    shouldInstallAudioTap = false
    onPlaybackComplete = nil
    ref.pause()
    ref.isMuted = true
    ref.volume = 0
    teardownPlayer()
    if let queuePlayer = ref as? AVQueuePlayer {
      queuePlayer.removeAllItems()
    } else {
      ref.replaceCurrentItem(with: nil)
    }
    owningRegistry?.remove(self)
    owningRegistry = nil
    if isActiveForLockScreen {
      MediaController.shared.setActivePlayer(nil)
    }
    isActiveForLockScreen = false
    metadata = nil
  }

  public override func sharedObjectWillRelease() {
    hy3nStopRequestAudio()
  }`);
  source += `
// This small lock protects only continuation ownership, never AVPlayer callbacks.
private final class HY3NRequestAudioSeekCompletion {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Never>?

  init(_ continuation: CheckedContinuation<Void, Never>) {
    self.continuation = continuation
  }

  func resumeOnce() {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume()
  }
}
`;
  if (hash(source) !== SOURCE_HASHES.player.patched) throw new Error('ExpoAudio player transform output changed; review patch hash');
  return source;
}

const MODULE_STOP = `      // HY3N_DRIVER_REQUEST_AUDIO_TERMINAL: synchronous JSI; no session/SDK teardown.
      Function("hy3nStopRequestAudio") { (player: AudioPlayer) in
        player.hy3nStopRequestAudio()
      }

`;
function transformModule(source) {
  if (reviewed(source, 'module')) return source;
  source = replaceOnce(source, '      Function("pause") { player in\n', MODULE_STOP + '      Function("pause") { player in\n');
  if (hash(source) !== SOURCE_HASHES.module.patched) throw new Error('ExpoAudio module transform output changed; review patch hash');
  return source;
}

function patchAudioPackage(projectRoot) {
  const root = path.dirname(require.resolve('expo-audio/package.json', { paths: [projectRoot] }));
  // Refuse a shared/external dependency symlink: prebuild needs its own install.
  const relative = path.relative(fs.realpathSync(projectRoot), fs.realpathSync(root));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('ExpoAudio request audio patch requires a project-local install, not a shared/external dependency');
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (version !== AUDIO_VERSION) throw new Error(`ExpoAudio request audio patch requires reviewed ${AUDIO_VERSION}, found ${version}`);
  const files = [
    [path.join(root, 'ios', 'AudioPlayer.swift'), transformPlayer],
    [path.join(root, 'ios', 'AudioModule.swift'), transformModule],
  ];
  // Validate BOTH complete inputs/outputs before any write (including temp files).
  const updates = files.map(([file, transform]) => {
    const original = fs.readFileSync(file, 'utf8');
    return { file, original, source: transform(original), mode: fs.statSync(file).mode };
  }).filter(({ original, source }) => original !== source);
  const staged = [];
  try {
    for (const update of updates) {
      const temporary = `${update.file}.hy3n-request-audio-${randomBytes(6).toString('hex')}.tmp`;
      staged.push({ ...update, temporary });
      fs.writeFileSync(temporary, update.source, { flag: 'wx', mode: update.mode });
    }
    // Atomic per-file rename; not a transactional two-file filesystem commit.
    for (const { file, temporary } of staged) fs.renameSync(temporary, file);
  } finally {
    for (const { temporary } of staged) fs.rmSync(temporary, { force: true });
  }
}

function withDriverIosRequestAudioStop(config) {
  return withDangerousMod(config, ['ios', async iosConfig => {
    patchAudioPackage(iosConfig.modRequest.projectRoot);
    return iosConfig;
  }]);
}

const plugin = createRunOncePlugin(withDriverIosRequestAudioStop, PLUGIN_NAME, '1.0.0');
plugin.transformPlayer = transformPlayer;
plugin.transformModule = transformModule;
plugin.patchAudioPackage = patchAudioPackage;
module.exports = plugin;
