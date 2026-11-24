import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const requireHere = createRequire(__filename);
const {
  transformAppDelegate,
  transformAppleRequest,
  transformAppleModule,
  patchAppleAuthentication,
}: {
  transformAppDelegate: (source: string) => string;
  transformAppleRequest: (source: string) => string;
  transformAppleModule: (source: string) => string;
  patchAppleAuthentication: (projectRoot: string) => void;
} = requireHere('../plugins/with-driver-ios-sdk27.js');

// These are source-transformation tests. No UIKit, Swift, Firebase, scene callback,
// or native authentication request is executed by this Node test suite.
// AppDelegate is the SDK57 scene-lifecycle Driver source, with the existing
// Firebase/Maps config-plugin insertions and a deliberately non-secret test key.
const appDelegateFixture = String.raw`internal import Expo
import GoogleMaps
import FirebaseCore
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
// @generated begin @react-native-firebase/app-didFinishLaunchingWithOptions - expo prebuild (DO NOT MODIFY) sync-10e8520570672fd76b2403b7e1e27f5198a6349a
FirebaseApp.configure()
// @generated end @react-native-firebase/app-didFinishLaunchingWithOptions
#endif

        GMSServices.provideAPIKey("hy3n-ios-sdk27-prebuild-test-only")
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
// @generated begin @react-native-firebase/auth-openURL - expo prebuild (DO NOT MODIFY)
    if url.host?.lowercased() == "firebaseauth" {
      // invocations for Firebase Auth are handled elsewhere and should not be forwarded to Expo Router
      return false
    }
// @generated end @react-native-firebase/auth-openURL
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

// Verbatim expo-apple-authentication@57.0.2 ios sources, captured before patching.
// Embedded fixtures stay faithful even if an authorized later prebuild patches
// node_modules. In this suite, patchAppleAuthentication only sees scratch roots.
const appleRequestFixture = String.raw`import AuthenticationServices
import ExpoModulesCore

// A set of pending requests used to retain them until the callback is called
var pendingRequests = Set<AppleAuthenticationRequest>()

final class AppleAuthenticationRequest: NSObject, ASAuthorizationControllerPresentationContextProviding, ASAuthorizationControllerDelegate {
  typealias AuthenticationResponse = [AnyHashable: Any]
  typealias AuthenticationRequestCallback = (AuthenticationResponse?, Exception?) -> Void

  let options: AppleAuthenticationRequestOptions
  var callback: AuthenticationRequestCallback?
  var authController: ASAuthorizationController?

  init(options: AppleAuthenticationRequestOptions) {
    self.options = options
  }

  func performRequest(callback: @escaping AuthenticationRequestCallback) {
    self.callback = callback

    do {
      let appleIdProvider = ASAuthorizationAppleIDProvider()
      let request = appleIdProvider.createRequest()

      request.requestedScopes = try scopesFromInts(options.requestedScopes)
      request.requestedOperation = try operationFromInt(options.requestedOperation)

      request.user = options.user
      request.state = options.state
      request.nonce = options.nonce

      authController = ASAuthorizationController(authorizationRequests: [request])
      authController?.presentationContextProvider = self
      authController?.delegate = self

      // Retain pending request
      pendingRequests.insert(self)

      authController?.performRequests()
    } catch {
      self.callback?(nil, error as? Exception)
      self.callback = nil
    }
  }

  // MARK: - ASAuthorizationControllerDelegate

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    let credential = authorization.credential as? ASAuthorizationAppleIDCredential
    let response: AuthenticationResponse = [
      "fullName": nameComponentsToDict(credential?.fullName),
      "email": credential?.email,
      "user": credential?.user,
      "realUserStatus": realUserStatusToInt(credential?.realUserStatus),
      "state": credential?.state,
      "authorizationCode": dataToString(credential?.authorizationCode),
      "identityToken": dataToString(credential?.identityToken)
    ]

    callback?(response, nil)
    callback = nil

    // Release pending request
    pendingRequests.remove(self)
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    if let error = error as? ASAuthorizationError {
      log.error("Apple authorization failed: \(error.localizedDescription)")
      callback?(nil, exceptionForAuthorizationError(error))
    } else {
      callback?(nil, RequestUnknownException())
    }
    callback = nil

    // Release pending request
    pendingRequests.remove(self)
  }

  // MARK: - ASAuthorizationControllerPresentationContextProviding

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    guard let window = UIApplication.shared.keyWindow else {
      fatalError("Unable to present authentication modal because UIApplication.shared.keyWindow is not available")
    }
    return window
  }
}
`;

const appleModuleFixture = String.raw`import AuthenticationServices
import ExpoModulesCore

let credentialRevokedEventName = "Expo.appleIdCredentialRevoked"

public final class AppleAuthenticationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAppleAuthentication")

    Events(credentialRevokedEventName)

    AsyncFunction("isAvailableAsync") {
      return true
    }

    AsyncFunction("requestAsync") { (options: AppleAuthenticationRequestOptions, promise: Promise) in
      AppleAuthenticationRequest(options: options).performRequest { response, error in
        if let error {
          promise.reject(error)
        } else {
          promise.resolve(response)
        }
      }
    }

    AsyncFunction("getCredentialStateAsync") { (userId: String, promise: Promise) in
      let appleIdProvider = ASAuthorizationAppleIDProvider()

      appleIdProvider.getCredentialState(forUserID: userId) { credentialState, _ in
        // We can ignore the error as the credential state cannot be nil
        // and the error may occur only when the credential state is ${'`'}notFound${'`'}
        promise.resolve(credentialStateToInt(credentialState))
      }
    }

    Function("formatFullName") { (fullName: FullName, formatStyle: FullNameFormatStyle?) -> String in
      let formatStyle = formatStyle?.toFullNameFormatStyle() ?? .default
      var nameComponents = PersonNameComponents()

      nameComponents.namePrefix = fullName.namePrefix
      nameComponents.nameSuffix = fullName.nameSuffix
      nameComponents.givenName = fullName.givenName
      nameComponents.middleName = fullName.middleName
      nameComponents.familyName = fullName.familyName
      nameComponents.nickname = fullName.nickname

      let formatter = PersonNameComponentsFormatter()
      formatter.style = formatStyle

      return formatter.string(from: nameComponents)
    }

    View(AppleAuthenticationButton.self) {
      Events("onButtonPress")

      Prop("buttonType") { (view, type: ButtonType?) in
        let type = type ?? .signIn

        if view.type != type {
          view.type = type
          view.needsUpdate = true
        }
      }

      Prop("buttonStyle") { (view, style: ButtonStyle?) in
        let style = style ?? .white

        if view.style != style {
          view.style = style
          view.needsUpdate = true
        }
      }

      Prop("cornerRadius") { (view, cornerRadius: Double) in
        view.cornerRadius = cornerRadius
      }

      OnViewDidUpdateProps { view in
        view.updateChildIfNeeded()
      }
    }

    OnStartObserving {
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(didRevokeCredential(_:)),
        name: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
        object: nil
      )
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(
        self,
        name: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
        object: nil
      )
    }
  }

  @objc
  func didRevokeCredential(_ notification: Notification) {
    sendEvent(credentialRevokedEventName)
  }
}
`;

const sceneMarker = 'HY3N_DRIVER_FIREBASE_SCENE_FILTER';
const authMarker = 'HY3N_DRIVER_APPLE_AUTH_ACTIVE_SCENE';
const authImport = 'import AuthenticationServices\n';
const requestFields = '  let options: AppleAuthenticationRequestOptions\n';
const requestInitializer = '  init(options: AppleAuthenticationRequestOptions) {\n    self.options = options\n  }';
const legacyWindow = '    guard let window = UIApplication.shared.keyWindow else {\n      fatalError("Unable to present authentication modal because UIApplication.shared.keyWindow is not available")\n    }\n    return window';

function between(source: string, start: string, end: string): string {
  const begin = source.indexOf(start);
  assert.ok(begin >= 0, `Missing source start: ${start}`);
  const finish = source.indexOf(end, begin + start.length);
  assert.ok(finish >= 0, `Missing source end: ${end}`);
  return source.slice(begin, finish);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function replaceOnce(source: string, anchor: string, replacement: string): string {
  assert.equal(count(source, anchor), 1, `Test mutation must target exactly one anchor: ${anchor}`);
  return source.replace(anchor, replacement);
}

const requestBlock = between(appleModuleFixture, '    AsyncFunction("requestAsync")', '\n\n    AsyncFunction("getCredentialStateAsync")');
const patchedApp = transformAppDelegate(appDelegateFixture);
const patchedRequest = transformAppleRequest(appleRequestFixture);
const patchedModule = transformAppleModule(appleModuleFixture);

const installedRoot = path.dirname(requireHere.resolve('expo-apple-authentication/package.json'));
const installedFiles = ['package.json', 'ios/AppleAuthenticationRequest.swift', 'ios/AppleAuthenticationModule.swift'];
const installedBefore = installedFiles.map(file => fs.readFileSync(path.join(installedRoot, file)));
after(() => {
  for (const [index, file] of installedFiles.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(installedRoot, file)), installedBefore[index], `Real installed ${file} was modified`);
  }
});

test('SDK57 fixtures match the reviewed installed Apple authentication source (original or valid patch)', () => {
  assert.equal(JSON.parse(installedBefore[0].toString()).version, '57.0.2');
  for (const [index, original, patched] of [
    [1, appleRequestFixture, patchedRequest],
    [2, appleModuleFixture, patchedModule],
  ] as const) {
    const installed = installedBefore[index].toString();
    assert.ok(installed === original || installed === patched, `Installed ${installedFiles[index]} differs from the reviewed fixture`);
  }
});

test('AppDelegate source preserves Firebase configure, Maps initialization, factory wiring and URL/deep-link methods byte-for-byte', () => {
  const launchStart = '  public override func application(\n    _ application: UIApplication,\n    didFinishLaunchingWithOptions';
  const originalLaunch = between(appDelegateFixture, launchStart, '  // Linking API');
  assert.ok(patchedApp.includes(originalLaunch));
  assert.ok(patchedApp.includes(appDelegateFixture.slice(appDelegateFixture.indexOf('  // Linking API'))));
  assert.equal(count(patchedApp, 'FirebaseApp.configure()'), 1);
  assert.equal(count(patchedApp, 'GMSServices.provideAPIKey("hy3n-ios-sdk27-prebuild-test-only")'), 1);
  assert.match(patchedApp, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
  assert.match(patchedApp, /reactNativeFactory = factory/);
  assert.doesNotMatch(patchedApp, /UIWindow\(frame:|factory\.startReactNative\(/);
});

test('AppDelegate installs one FirebaseAuth import, one scene configuration and one Expo scene subclass, idempotently', () => {
  assert.equal(count(patchedApp, 'import FirebaseAuth\n'), 1);
  assert.equal(count(patchedApp, 'configurationForConnecting connectingSceneSession: UISceneSession'), 1);
  assert.equal(count(patchedApp, 'configuration.delegateClass = HY3NDriverSceneDelegate.self'), 1);
  assert.equal(count(patchedApp, 'class HY3NDriverSceneDelegate: ExpoAppSceneDelegate'), 1);
  assert.equal(count(patchedApp, '@objc(HY3NDriverSceneDelegate)'), 1);
  assert.match(patchedApp, /sessionRole: connectingSceneSession\.role/);
  assert.equal(transformAppDelegate(patchedApp), patchedApp);
  const withAuthImport = replaceOnce(appDelegateFixture, 'import FirebaseCore\n', 'import FirebaseCore\nimport FirebaseAuth\n');
  assert.equal(count(transformAppDelegate(withAuthImport), 'import FirebaseAuth\n'), 1);
  const publicExpo = replaceOnce(appDelegateFixture, 'internal import Expo\n', 'import Expo\n');
  assert.equal(count(transformAppDelegate(publicExpo), 'import FirebaseAuth\n'), 1);
});

test('emitted scene source removes case-insensitive firebaseauth hosts even when canHandle returns false and forwards other contexts once', () => {
  const scene = patchedApp.slice(patchedApp.indexOf('class HY3NDriverSceneDelegate:'));
  // Verify the actual emitted predicate/control flow, not a separately written
  // JavaScript mock of Firebase/Swift. Discarding canHandle's Bool must be explicit.
  assert.match(scene, /let remaining = Set\(URLContexts\.filter \{ context in/);
  const branch = between(scene, 'if context.url.host?.lowercased() == "firebaseauth" {', '\n      return true');
  const uncommentedBranch = branch.replace(/\/\/[^\n]*/g, '');
  assert.match(uncommentedBranch, /\{\s*_ = Auth\.auth\(\)\.canHandle\(context\.url\)\s*return false\s*\}\s*$/);
  assert.equal(count(scene, 'Auth.auth().canHandle(context.url)'), 1);
  assert.match(scene, /\}\s*return true\s*\}\)/);
  assert.match(scene, /if !remaining\.isEmpty \{\s*super\.scene\(scene, openURLContexts: remaining\)\s*\}/);
  assert.equal(count(scene, 'super.scene('), 1);
  assert.equal(count(scene, 'openURLContexts: remaining'), 1);
  assert.doesNotMatch(scene, /openURLContexts: URLContexts|RCTLinkingManager|forwarder\.|return Auth\.auth|if Auth\.auth/);
});

test('scene subclass leaves cold-start, lifecycle, user-activity and quick-action callbacks inherited from Expo', () => {
  const scene = patchedApp.slice(patchedApp.indexOf('class HY3NDriverSceneDelegate:'));
  assert.equal(count(scene, 'override func'), 1);
  assert.match(scene, /public override func scene\(\s*_ scene: UIScene,\s*openURLContexts URLContexts: Set<UIOpenURLContext>/);
  assert.doesNotMatch(scene, /willConnectTo|connectionOptions|startReactNative|sceneDidDisconnect|sceneDidBecomeActive|sceneWillResignActive|sceneWillEnterForeground|sceneDidEnterBackground|userActivity|performActionFor|var window|override init/);
});

test('Apple request retains a nonoptional UIKit UIWindow and returns that exact anchor without global-window lookup or fatalError', () => {
  assert.equal(count(patchedRequest, 'import UIKit\n'), 1);
  assert.match(patchedRequest, /private let presentationWindow: UIWindow\s*\n/);
  assert.match(patchedRequest, /init\(options: AppleAuthenticationRequestOptions, presentationWindow: UIWindow\) \{\s*self\.options = options\s*self\.presentationWindow = presentationWindow\s*super\.init\(\)\s*\}/);
  assert.match(patchedRequest, /func presentationAnchor\(for controller: ASAuthorizationController\) -> ASPresentationAnchor \{\s*return presentationWindow\s*\}/);
  assert.doesNotMatch(patchedRequest, /(?:weak|unowned|var) presentationWindow|presentationWindow: UIWindow[?!]|UIApplication\.shared\.keyWindow|fatalError|Utilities\.keyWindow|connectedScenes/);
  assert.equal(transformAppleRequest(patchedRequest), patchedRequest);
});

test('Apple request preserves all scopes, operation, nonce, callback payloads and pending-request retention/release', () => {
  const start = '  func performRequest(callback:';
  const end = '  // MARK: - ASAuthorizationControllerPresentationContextProviding';
  assert.equal(between(patchedRequest, start, end), between(appleRequestFixture, start, end));
  assert.ok(patchedRequest.includes('var pendingRequests = Set<AppleAuthenticationRequest>()'));
  assert.equal(count(patchedRequest, 'pendingRequests.insert(self)'), 1);
  assert.equal(count(patchedRequest, 'pendingRequests.remove(self)'), 2);
});

test('Apple module emitted request selects only a foregroundActive windowApplication scene with a visible key window on the main queue', () => {
  assert.equal(count(patchedModule, 'import UIKit\n'), 1);
  const block = between(patchedModule, '    AsyncFunction("requestAsync")', '\n\n    AsyncFunction("getCredentialStateAsync")');
  assert.match(block, /UIApplication\.shared\.connectedScenes\s*\.compactMap \{ \$0 as\? UIWindowScene \}\s*\.filter \{\s*\$0\.activationState == \.foregroundActive &&\s*\$0\.session\.role == \.windowApplication\s*\}\s*\.flatMap \{ \$0\.windows \}\s*\.first \{ \$0\.isKeyWindow && !\$0\.isHidden \}/);
  assert.match(block, /\}\s*\}\.runOnQueue\(\.main\)\s*$/);
  assert.equal(count(block, '.runOnQueue(.main)'), 1);
  assert.equal(count(block, 'UIApplication.shared.connectedScenes'), 1);
  assert.doesNotMatch(block, /foregroundInactive|\.first\?\.windows|UIApplication\.shared\.keyWindow|fatalError|Utilities\.keyWindow/);
  assert.equal(transformAppleModule(patchedModule), patchedModule);
});

test('Apple module rejects a missing active presentation window before creating a request and preserves async resolution/rejection', () => {
  const block = between(patchedModule, '    AsyncFunction("requestAsync")', '\n\n    AsyncFunction("getCredentialStateAsync")');
  assert.match(block, /guard let presentationWindow else \{\s*promise\.reject\(RequestNotInteractiveException\(\)\)\s*return\s*\}\s*AppleAuthenticationRequest\(options: options, presentationWindow: presentationWindow\)\.performRequest/);
  assert.match(block, /performRequest \{ response, error in\s*if let error \{\s*promise\.reject\(error\)\s*\} else \{\s*promise\.resolve\(response\)\s*\}/);
  assert.equal(count(block, 'AppleAuthenticationRequest('), 1);
  assert.equal(count(block, 'RequestNotInteractiveException()'), 1);
  assert.doesNotMatch(block, /presentationWindow!|try!|promise\.resolve\(nil\)/);
  const untouchedStart = '    AsyncFunction("getCredentialStateAsync")';
  assert.equal(patchedModule.slice(patchedModule.indexOf(untouchedStart)), appleModuleFixture.slice(appleModuleFixture.indexOf(untouchedStart)));
  assert.ok(patchedModule.includes(between(appleModuleFixture, 'let credentialRevokedEventName', '    AsyncFunction("requestAsync")').trimEnd()));
});

// Fail closed on changed, absent, or ambiguous required anchors. Assertions must
// not be relaxed merely because a plugin happens to accept a corrupted source.
for (const [name, transform, original, anchors] of [
  ['AppDelegate', transformAppDelegate, appDelegateFixture, ['internal import Expo\n', '  // Linking API\n']],
  ['Apple request', transformAppleRequest, appleRequestFixture, [authImport, requestFields, requestInitializer, legacyWindow]],
  ['Apple module', transformAppleModule, appleModuleFixture, [authImport, requestBlock]],
] as const) {
  for (const [index, anchor] of anchors.entries()) {
    test(`${name} fails closed for missing, drifted or duplicate required anchor ${index + 1}`, () => {
      for (const [kind, replacement] of [
        ['missing', ''],
        ['drifted', anchor.replace(/\S/, '!')],
        ['duplicate', anchor + anchor],
      ]) {
        const changed = replaceOnce(original, anchor, replacement);
        assert.throws(() => transform(changed), /source|anchor|import|SDK|patch|scene|changed|review/i, `${name} must reject ${kind} anchor ${index + 1}`);
      }
    });
  }
}

for (const [name, transform, original, marker] of [
  ['AppDelegate', transformAppDelegate, appDelegateFixture, sceneMarker],
  ['Apple request', transformAppleRequest, appleRequestFixture, authMarker],
  ['Apple module', transformAppleModule, appleModuleFixture, authMarker],
] as const) {
  test(`${name} rejects marker-only partial patch instead of treating it as idempotent`, () => {
    assert.throws(() => transform(`// ${marker}\n${original}`), /incomplete|source|anchor|patch|scene|SDK|review/i);
  });
}

for (const [name, original, anchor, replacement] of [
  ['AppDelegate host filter', patchedApp, 'if context.url.host?.lowercased() == "firebaseauth" {', 'if context.url.host == "firebaseauth" {'],
  ['AppDelegate unconditional Firebase exclusion', patchedApp, '_ = Auth.auth().canHandle(context.url)', 'if !Auth.auth().canHandle(context.url) { return true }'],
  ['AppDelegate single forwarding', patchedApp, 'super.scene(scene, openURLContexts: remaining)', 'super.scene(scene, openURLContexts: remaining)\n      super.scene(scene, openURLContexts: remaining)'],
  ['AppDelegate scene delegate selection', patchedApp, 'configuration.delegateClass = HY3NDriverSceneDelegate.self', 'configuration.delegateClass = ExpoAppSceneDelegate.self'],
] as const) {
  test(`${name}: marked but safety-tampered source fails closed`, () => {
    assert.throws(() => transformAppDelegate(replaceOnce(original, anchor, replacement)), /incomplete|source|anchor|patch|scene|SDK|review/i);
  });
}

for (const [name, transform, source, anchor, replacement] of [
  ['Apple request retained window', transformAppleRequest, patchedRequest, 'private let presentationWindow: UIWindow', 'private var presentationWindow: UIWindow?'],
  ['Apple request presentation anchor', transformAppleRequest, patchedRequest, 'return presentationWindow', 'return UIApplication.shared.keyWindow!'],
  ['Apple module main queue', transformAppleModule, patchedModule, '.runOnQueue(.main)', '.runOnQueue(.global())'],
  ['Apple module foreground guard', transformAppleModule, patchedModule, '$0.activationState == .foregroundActive', '$0.activationState == .foregroundInactive'],
  ['Apple module visible window guard', transformAppleModule, patchedModule, '$0.isKeyWindow && !$0.isHidden', '$0.isKeyWindow'],
  ['Apple module rejection', transformAppleModule, patchedModule, 'promise.reject(RequestNotInteractiveException())', 'promise.resolve(nil)'],
] as const) {
  test(`${name}: marked but safety-tampered source fails closed`, () => {
    assert.throws(() => transform(replaceOnce(source, anchor, replacement)), /incomplete|source|anchor|patch|scene|SDK|review/i);
  });
}

for (const [name, transform, source, duplicate] of [
  ['AppDelegate', transformAppDelegate, patchedApp, 'class HY3NDriverSceneDelegate: ExpoAppSceneDelegate {}\n'],
  ['Apple request', transformAppleRequest, patchedRequest, requestInitializer + '\n'],
  ['Apple module', transformAppleModule, patchedModule, requestBlock + '\n'],
] as const) {
  test(`${name} rejects a duplicate implementation/legacy anchor in marked source`, () => {
    assert.throws(() => transform(source + '\n' + duplicate), /duplicate|incomplete|source|anchor|patch|scene|SDK|review/i);
  });
}

test('AppDelegate rejects pre-existing conflicting scene configuration/delegate without a trusted patch marker', () => {
  for (const conflicting of [
    '  public func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration { fatalError() }\n',
    'class HY3NDriverSceneDelegate: ExpoAppSceneDelegate {}\n',
  ]) {
    assert.throws(() => transformAppDelegate(appDelegateFixture + conflicting), /duplicate|existing|source|anchor|patch|scene|SDK|review/i);
  }
});

function scratchApple(version = '57.0.2', request = appleRequestFixture, module = appleModuleFixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hy3n-driver-ios-sdk27-test-'));
  const packageRoot = path.join(root, 'node_modules', 'expo-apple-authentication');
  const iosRoot = path.join(packageRoot, 'ios');
  fs.mkdirSync(iosRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'expo-apple-authentication', version }));
  fs.writeFileSync(path.join(iosRoot, 'AppleAuthenticationRequest.swift'), request);
  fs.writeFileSync(path.join(iosRoot, 'AppleAuthenticationModule.swift'), module);
  fs.writeFileSync(path.join(iosRoot, 'untouched.swift'), '// scratch sentinel\n');
  // Ensure package resolution cannot accidentally fall through to real sources.
  assert.equal(requireHere.resolve('expo-apple-authentication/package.json', { paths: [root] }), path.join(packageRoot, 'package.json'));
  return { root, packageRoot, iosRoot };
}

function snapshotScratch(packageRoot: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else result[path.relative(packageRoot, file)] = fs.readFileSync(file).toString('base64');
    }
  }
  visit(packageRoot);
  return result;
}

test('patchAppleAuthentication transforms only scratch SDK57 files idempotently without changing manifest or unrelated source', () => {
  const scratch = scratchApple();
  try {
    const manifest = fs.readFileSync(path.join(scratch.packageRoot, 'package.json'), 'utf8');
    patchAppleAuthentication(scratch.root);
    assert.equal(fs.readFileSync(path.join(scratch.iosRoot, 'AppleAuthenticationRequest.swift'), 'utf8'), patchedRequest);
    assert.equal(fs.readFileSync(path.join(scratch.iosRoot, 'AppleAuthenticationModule.swift'), 'utf8'), patchedModule);
    const once = snapshotScratch(scratch.packageRoot);
    patchAppleAuthentication(scratch.root);
    assert.deepEqual(snapshotScratch(scratch.packageRoot), once);
    assert.equal(fs.readFileSync(path.join(scratch.packageRoot, 'package.json'), 'utf8'), manifest);
    assert.equal(fs.readFileSync(path.join(scratch.iosRoot, 'untouched.swift'), 'utf8'), '// scratch sentinel\n');
    assert.deepEqual(fs.readdirSync(scratch.iosRoot).sort(), ['AppleAuthenticationModule.swift', 'AppleAuthenticationRequest.swift', 'untouched.swift']);
  } finally {
    fs.rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('patchAppleAuthentication rejects unsupported versions before any scratch writes', () => {
  for (const version of ['8.0.8', '57.0.1', '57.0.3', '58.0.0']) {
    const scratch = scratchApple(version);
    try {
      const before = snapshotScratch(scratch.packageRoot);
      assert.throws(() => patchAppleAuthentication(scratch.root), /57\.0\.2/);
      assert.deepEqual(snapshotScratch(scratch.packageRoot), before, `Version ${version} must not write either file or a temporary file`);
    } finally {
      fs.rmSync(scratch.root, { recursive: true, force: true });
    }
  }
});

for (const brokenFile of ['request', 'module'] as const) {
  test(`patchAppleAuthentication validates both sources before writing when scratch ${brokenFile} source has drifted`, () => {
    const scratch = scratchApple(
      '57.0.2',
      brokenFile === 'request' ? replaceOnce(appleRequestFixture, requestInitializer, '  init(options: ChangedOptions) {}') : appleRequestFixture,
      brokenFile === 'module' ? replaceOnce(appleModuleFixture, requestBlock, '    AsyncFunction("requestAsync") { /* drift */ }') : appleModuleFixture,
    );
    try {
      const before = snapshotScratch(scratch.packageRoot);
      assert.throws(() => patchAppleAuthentication(scratch.root), /source|anchor|changed|review|patch/i);
      assert.deepEqual(snapshotScratch(scratch.packageRoot), before, 'Both files and directory entries must remain unchanged, including no leftover .tmp files');
    } finally {
      fs.rmSync(scratch.root, { recursive: true, force: true });
    }
  });
}

test('patchAppleAuthentication rejects a missing second scratch source without partially writing the first', () => {
  const scratch = scratchApple();
  try {
    fs.unlinkSync(path.join(scratch.iosRoot, 'AppleAuthenticationModule.swift'));
    const before = snapshotScratch(scratch.packageRoot);
    assert.throws(() => patchAppleAuthentication(scratch.root), /ENOENT|source|missing/i);
    assert.deepEqual(snapshotScratch(scratch.packageRoot), before);
  } finally {
    fs.rmSync(scratch.root, { recursive: true, force: true });
  }
});
