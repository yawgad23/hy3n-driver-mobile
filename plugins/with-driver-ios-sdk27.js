const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  createRunOncePlugin,
  withAppDelegate,
  withDangerousMod,
} = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-driver-ios-sdk27';
const SCENE_MARKER = 'HY3N_DRIVER_FIREBASE_SCENE_FILTER';
const AUTH_MARKER = 'HY3N_DRIVER_APPLE_AUTH_ACTIVE_SCENE';
const APPLE_AUTH_VERSION = '57.0.2';
// SHA-256 of the published 57.0.2 originals and their reviewed exact transforms.
// A marker alone is not proof that an earlier source patch is intact.
const APPLE_SOURCE_HASHES = {
  request: {
    original: '97e44eb0ee52be91312dcd424e0acc23c79bd7f2c45e18957b5f39b527dd92bc',
    patched: '1c24247012e2e3f551a35896dab1804467844f285331eea1e3967375dd49c9e1',
  },
  module: {
    original: 'fe13b0edb16f34b8d9bfce15379b08838ae0b30c365d6ee8531a4308f29e31cb',
    patched: 'b087b3735dcdd93565447ae72b78b9fe1407d9aaa4f28786aab0883460eb40c0',
  },
};

function isReviewedApplePatch(source, kind) {
  const hash = createHash('sha256').update(source).digest('hex');
  const expected = APPLE_SOURCE_HASHES[kind];
  if (hash === expected.patched) return true;
  if (hash !== expected.original) {
    throw new Error(`Apple sign-in ${kind} source changed or patch is incomplete; review SDK 27 patch before building`);
  }
  return false;
}

const SCENE_CONFIGURATION = `  // ${SCENE_MARKER}: keep Firebase verification returns out of Expo Router.
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = HY3NDriverSceneDelegate.self
    return configuration
  }

`;

const SCENE_DELEGATE = `
// ${SCENE_MARKER}
@objc(HY3NDriverSceneDelegate)
class HY3NDriverSceneDelegate: ExpoAppSceneDelegate {
  public override func scene(
    _ scene: UIScene,
    openURLContexts URLContexts: Set<UIOpenURLContext>
  ) {
    let remaining = Set(URLContexts.filter { context in
      if context.url.host?.lowercased() == "firebaseauth" {
        // Firebase's scene swizzler may already have consumed this one-shot URL.
        // Preserve the upstream host guard even if canHandle now returns false.
        _ = Auth.auth().canHandle(context.url)
        return false
      }
      return true
    })
    if !remaining.isEmpty {
      super.scene(scene, openURLContexts: remaining)
    }
  }
}
`;

function transformAppDelegate(source) {
  const count = needle => source.split(needle).length - 1;
  const expoImports = source.match(/^(?:internal )?import Expo\n/gm) || [];
  if (expoImports.length !== 1) throw new Error('Expected one Driver AppDelegate Expo import for SDK 27 scene patch');
  if (count('import FirebaseAuth\n') > 1) throw new Error('Duplicate Driver AppDelegate FirebaseAuth import');
  if (source.includes(SCENE_MARKER)) {
    if (count(SCENE_MARKER) !== 2
      || count(SCENE_CONFIGURATION) !== 1
      || !source.endsWith(SCENE_DELEGATE)
      || count('configurationForConnecting') !== 1
      || count('class HY3NDriverSceneDelegate:') !== 1
      || count('import FirebaseAuth\n') !== 1) {
      throw new Error('Incomplete existing HY3N SDK 27 scene filter');
    }
    const original = source.replace(SCENE_CONFIGURATION, '').slice(0, -SCENE_DELEGATE.length);
    if (transformAppDelegate(original) !== source) throw new Error('SDK 27 scene patch source changed');
    return source;
  }
  if (source.includes('configurationForConnecting') || source.includes('HY3NDriverSceneDelegate')) {
    throw new Error('Existing conflicting Driver scene configuration; review SDK 27 patch');
  }
  const anchor = '  // Linking API\n';
  if (source.split(anchor).length !== 2) {
    throw new Error('Expected one Driver AppDelegate linking anchor for SDK 27 scene configuration');
  }
  if (!source.includes('import FirebaseAuth\n')) {
    const expoImport = /^(?:internal )?import Expo\n/m;
    if (!expoImport.test(source)) throw new Error('Driver AppDelegate Expo import is missing');
    source = source.replace(expoImport, match => `${match}import FirebaseAuth\n`);
  }
  source = source.replace(anchor, `${SCENE_CONFIGURATION}${anchor}`);
  return source + SCENE_DELEGATE;
}

function transformAppleRequest(source) {
  if (isReviewedApplePatch(source, 'request')) return source;
  const fields = '  let options: AppleAuthenticationRequestOptions\n';
  const initializer = '  init(options: AppleAuthenticationRequestOptions) {\n    self.options = options\n  }';
  const legacyAnchor = '    guard let window = UIApplication.shared.keyWindow else {\n      fatalError("Unable to present authentication modal because UIApplication.shared.keyWindow is not available")\n    }\n    return window';
  for (const anchor of [fields, initializer, legacyAnchor]) {
    if (source.split(anchor).length !== 2) throw new Error('Apple sign-in request source changed; review SDK 27 patch before building');
  }
  source = source.replace('import AuthenticationServices\n', 'import AuthenticationServices\nimport UIKit\n');
  source = source.replace(fields, `${fields}  // ${AUTH_MARKER}: retain the active scene window selected on the main queue.\n  private let presentationWindow: UIWindow\n`);
  source = source.replace(initializer, '  init(options: AppleAuthenticationRequestOptions, presentationWindow: UIWindow) {\n    self.options = options\n    self.presentationWindow = presentationWindow\n    super.init()\n  }');
  return source.replace(legacyAnchor, '    return presentationWindow');
}

function transformAppleModule(source) {
  if (isReviewedApplePatch(source, 'module')) return source;
  const request = `    AsyncFunction("requestAsync") { (options: AppleAuthenticationRequestOptions, promise: Promise) in
      AppleAuthenticationRequest(options: options).performRequest { response, error in
        if let error {
          promise.reject(error)
        } else {
          promise.resolve(response)
        }
      }
    }`;
  if (source.split(request).length !== 2) throw new Error('Apple sign-in module source changed; review SDK 27 patch before building');
  const replacement = `    // ${AUTH_MARKER}
    AsyncFunction("requestAsync") { (options: AppleAuthenticationRequestOptions, promise: Promise) in
      let presentationWindow = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .filter {
          $0.activationState == .foregroundActive &&
          $0.session.role == .windowApplication
        }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow && !$0.isHidden }
      guard let presentationWindow else {
        promise.reject(RequestNotInteractiveException())
        return
      }
      AppleAuthenticationRequest(options: options, presentationWindow: presentationWindow).performRequest { response, error in
        if let error {
          promise.reject(error)
        } else {
          promise.resolve(response)
        }
      }
    }.runOnQueue(.main)`;
  source = source.replace('import AuthenticationServices\n', 'import AuthenticationServices\nimport UIKit\n');
  return source.replace(request, replacement);
}

function patchAppleAuthentication(projectRoot) {
  const root = path.dirname(require.resolve('expo-apple-authentication/package.json', { paths: [projectRoot] }));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (version !== APPLE_AUTH_VERSION) throw new Error(`SDK 27 Apple sign-in patch requires reviewed ${APPLE_AUTH_VERSION}, found ${version}`);
  const files = [
    [path.join(root, 'ios', 'AppleAuthenticationRequest.swift'), transformAppleRequest],
    [path.join(root, 'ios', 'AppleAuthenticationModule.swift'), transformAppleModule],
  ];
  // Validate both transformations before writing either file.
  const updates = files.map(([file, transform]) => ({ file, source: transform(fs.readFileSync(file, 'utf8')) }));
  for (const { file, source } of updates) {
    const temporary = `${file}.hy3n-sdk27.tmp`;
    fs.writeFileSync(temporary, source);
    fs.renameSync(temporary, file);
  }
}

function withDriverIosSdk27(config) {
  config = withAppDelegate(config, iosConfig => {
    if (iosConfig.modResults.language !== 'swift') throw new Error('SDK 27 preparation expects the Swift Driver AppDelegate');
    iosConfig.modResults.contents = transformAppDelegate(iosConfig.modResults.contents);
    return iosConfig;
  });
  return withDangerousMod(config, ['ios', async iosConfig => {
    patchAppleAuthentication(iosConfig.modRequest.projectRoot);
    return iosConfig;
  }]);
}

const plugin = createRunOncePlugin(withDriverIosSdk27, PLUGIN_NAME, '1.0.0');
plugin.transformAppDelegate = transformAppDelegate;
plugin.transformAppleRequest = transformAppleRequest;
plugin.transformAppleModule = transformAppleModule;
plugin.patchAppleAuthentication = patchAppleAuthentication;
module.exports = plugin;
