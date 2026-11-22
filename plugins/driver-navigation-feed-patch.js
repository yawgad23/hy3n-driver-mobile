'use strict';

/**
 * HY3N feed safeguards for @googlemaps/react-native-navigation-sdk 0.16.3.
 * Only Expo prebuild writes dependency sources. Tests transform strings in memory.
 * This envelope identifies the native mutation lifecycle, NOT an SDK-internal
 * route ID: SDK NavInfo has no provenance token. In-flight SDK messages received
 * after activation can still originate from an older SDK route. Fail closed for
 * place-ID/multi-waypoint routes; the driver uses one coordinate waypoint.
 * Never infer native generation by counting JS requests: read the contextual
 * getCurrentRouteSegment snapshot after OK and match feeds to that generation.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SDK_VERSION = '0.16.3';
const SDK_ROOT = path.join('node_modules', '@googlemaps', 'react-native-navigation-sdk');
const MARKER = 'HY3N_DRIVER_NAV_FEED_V1';
const CONTEXT_FIELDS = [
  'hy3nTargetLatitude', 'hy3nTargetLongitude', 'hy3nRouteGeneration', 'hy3nCapturedAtMs',
];
const FILES = {
  androidModule: 'android/src/main/java/com/google/android/react/navsdk/NavModule.java',
  androidService: 'android/src/main/java/com/google/android/react/navsdk/NavInfoReceivingService.java',
  iosModule: 'ios/react-native-navigation-sdk/NavModule.mm',
  nativeContract: 'src/native/NativeNavModule.ts',
  publicMetrics: 'src/navigation/types.ts',
  publicTurnByTurn: 'src/navigation/navigation/types.ts',
};
const SOURCE_HASHES = {
  androidModule: '422f4ff9e7d41615b453e99767ccfcdedd099bd1c538c4601eee17befa05a6e1',
  androidService: '7f7f8c5e510d18c6242aeb40c59d8af8fc108024b4f8245459ae3d7ee13b07d8',
  iosModule: '800916750ca637dc68d2c1eae62cb74f8a249c80861f7926fa5b1b55a814b647',
  nativeContract: 'cefdab4600599d5f198025c9122fb0e3ea2903410f51ec93e34dc2fe28c79a78',
  publicMetrics: '7fbc8399794b29b7743e2aca0b31af3d48580ada8064b0a676af3c5b98bcf193',
  publicTurnByTurn: 'c43c9d45a62bab34604fba98765b9cb048775ea142fb7db6b84ff0080421d3d9',
};

const androidState = `  // ${MARKER}: immutable native receipt context; never retag LiveData replay.
  private final Object hy3nFeedLock = new Object();
  private long hy3nRouteGeneration = 0;
  private long hy3nMutationToken = 0;
  private boolean hy3nRouteActive = false;
  private boolean hy3nLoggingEnabled = false;
  private double hy3nTargetLatitude;
  private double hy3nTargetLongitude;
  private long hy3nActivatedElapsedMs = Long.MAX_VALUE;
  private long hy3nFeedEnabledElapsedMs = Long.MAX_VALUE;

  static final class Hy3nFeedContext {
    final long generation;
    final double latitude;
    final double longitude;
    final long capturedAtMs;
    final long capturedElapsedMs;

    Hy3nFeedContext(long generation, double latitude, double longitude) {
      this.generation = generation;
      this.latitude = latitude;
      this.longitude = longitude;
      this.capturedAtMs = System.currentTimeMillis();
      this.capturedElapsedMs = android.os.SystemClock.elapsedRealtime();
    }

    void appendTo(WritableMap map) {
      map.putDouble("hy3nTargetLatitude", latitude);
      map.putDouble("hy3nTargetLongitude", longitude);
      map.putDouble("hy3nRouteGeneration", generation);
      map.putDouble("hy3nCapturedAtMs", capturedAtMs);
    }
  }

  // Called on the receiving service's Handler thread BEFORE LiveData.postValue.
  static synchronized Hy3nFeedContext captureHy3nNavInfoContext() {
    return instance == null ? null : instance.hy3nCaptureContext(true);
  }

  private Hy3nFeedContext hy3nCaptureContext(boolean turnByTurn) {
    synchronized (hy3nFeedLock) {
      if (!hy3nRouteActive || (turnByTurn && !hy3nLoggingEnabled)) return null;
      return new Hy3nFeedContext(hy3nRouteGeneration, hy3nTargetLatitude, hy3nTargetLongitude);
    }
  }

  private boolean hy3nContextIsCurrent(Hy3nFeedContext context, boolean turnByTurn) {
    synchronized (hy3nFeedLock) {
      return context != null && hy3nRouteActive
          && context.generation == hy3nRouteGeneration
          && (!turnByTurn || (hy3nLoggingEnabled
              && context.capturedElapsedMs > hy3nActivatedElapsedMs
              && context.capturedElapsedMs > hy3nFeedEnabledElapsedMs));
    }
  }

  private void hy3nInvalidateFeed() {
    synchronized (hy3nFeedLock) {
      ++hy3nMutationToken; // Also invalidates pending callbacks on clear/stop/cleanup.
      hy3nRouteActive = false;
      hy3nActivatedElapsedMs = Long.MAX_VALUE;
      NavInfoReceivingService.clearHy3nCachedNavInfo();
    }
  }

  private long hy3nBeginDestinationMutation(ReadableArray waypoints) {
    synchronized (hy3nFeedLock) {
      hy3nInvalidateFeed();
      ++hy3nRouteGeneration; // Native setDestinations invocation, not JS reception.
      hy3nTargetLatitude = Double.NaN;
      hy3nTargetLongitude = Double.NaN;
      if (waypoints.size() == 1) {
        ReadableMap waypoint = waypoints.getMap(0);
        if (waypoint != null && waypoint.hasKey("position") && !waypoint.isNull("position")
            && (!waypoint.hasKey("placeId") || waypoint.isNull("placeId")
                || waypoint.getString("placeId").isEmpty())) {
          ReadableMap position = waypoint.getMap("position");
          if (position != null && position.hasKey("lat") && !position.isNull("lat")
              && position.hasKey("lng") && !position.isNull("lng")) {
            hy3nTargetLatitude = position.getDouble("lat");
            hy3nTargetLongitude = position.getDouble("lng");
          }
        }
      }
      return hy3nMutationToken;
    }
  }

  private void hy3nCompleteDestinationMutation(long token, boolean ok) {
    synchronized (hy3nFeedLock) {
      if (token != hy3nMutationToken) return; // An earlier mutation cannot reactivate this feed.
      hy3nRouteActive = ok && !Double.isNaN(hy3nTargetLatitude)
          && !Double.isInfinite(hy3nTargetLatitude) && Math.abs(hy3nTargetLatitude) <= 90
          && !Double.isNaN(hy3nTargetLongitude) && !Double.isInfinite(hy3nTargetLongitude)
          && Math.abs(hy3nTargetLongitude) <= 180;
      hy3nActivatedElapsedMs = android.os.SystemClock.elapsedRealtime();
      NavInfoReceivingService.clearHy3nCachedNavInfo();
    }
  }

  private void hy3nResetReceiptWindow(boolean enabled) {
    synchronized (hy3nFeedLock) {
      hy3nLoggingEnabled = enabled;
      hy3nFeedEnabledElapsedMs = android.os.SystemClock.elapsedRealtime();
      NavInfoReceivingService.clearHy3nCachedNavInfo();
    }
  }

`;

const iosState = `  // ${MARKER}: main-queue destination lifecycle, not an SDK raw-event route ID.
  NSUInteger _hy3nRouteGeneration;
  NSUInteger _hy3nMutationToken;
  BOOL _hy3nRouteActive;
  double _hy3nTargetLatitude;
  double _hy3nTargetLongitude;
`;
const iosMethods = `// ${MARKER}: capture the context in native callbacks/polls, never in JS.
- (void)hy3nInvalidateFeed {
  ++_hy3nMutationToken;
  _hy3nRouteActive = NO;
}

- (NSUInteger)hy3nBeginDestinationMutation:(NSArray *)waypoints {
  [self hy3nInvalidateFeed];
  ++_hy3nRouteGeneration;
  _hy3nTargetLatitude = NAN;
  _hy3nTargetLongitude = NAN;
  if (waypoints.count == 1) {
    NSDictionary *waypoint = waypoints.firstObject;
    NSDictionary *position = waypoint[@"position"];
    NSString *placeId = waypoint[@"placeId"];
    if ((!placeId || [placeId isEqual:@""]) && [position isKindOfClass:[NSDictionary class]]
        && [position[@"lat"] isKindOfClass:[NSNumber class]]
        && [position[@"lng"] isKindOfClass:[NSNumber class]]) {
      _hy3nTargetLatitude = [position[@"lat"] doubleValue];
      _hy3nTargetLongitude = [position[@"lng"] doubleValue];
    }
  }
  return _hy3nMutationToken;
}

- (void)hy3nCompleteDestinationMutation:(NSUInteger)token ok:(BOOL)ok {
  if (token != _hy3nMutationToken) return;
  _hy3nRouteActive = ok && std::isfinite(_hy3nTargetLatitude)
      && std::isfinite(_hy3nTargetLongitude) && std::abs(_hy3nTargetLatitude) <= 90
      && std::abs(_hy3nTargetLongitude) <= 180;
}

- (NSDictionary *)hy3nCaptureContext {
  // All patched mutations and polls run on main; do not bind an off-main callback.
  if (![NSThread isMainThread] || !_hy3nRouteActive) return nil;
  return @{@"hy3nTargetLatitude" : @(_hy3nTargetLatitude),
           @"hy3nTargetLongitude" : @(_hy3nTargetLongitude),
           @"hy3nRouteGeneration" : @(_hy3nRouteGeneration),
           @"hy3nCapturedAtMs" : @([NSDate date].timeIntervalSince1970 * 1000.0)};
}

`;

// Each edit is exact and reversible. An already-patched file must reverse to
// the pinned pristine hash, then regenerate byte-for-byte, not merely contain
// a marker. This detects partial patches, edited guards, and source drift.
function editsFor(kind) {
  const edits = [];
  const add = (before, after) => edits.push({ before, after });
  if (kind === 'androidService') {
    add('  private static final MutableLiveData<NavInfo> mNavInfoMutableLiveData = new MutableLiveData<>();',
      `  // ${MARKER}: receipt and immutable lifecycle context travel together.
  static final class Hy3nCapturedNavInfo {
    final NavInfo navInfo;
    final NavModule.Hy3nFeedContext context;
    Hy3nCapturedNavInfo(NavInfo navInfo, NavModule.Hy3nFeedContext context) {
      this.navInfo = navInfo;
      this.context = context;
    }
  }

  private static final MutableLiveData<Hy3nCapturedNavInfo> mNavInfoMutableLiveData = new MutableLiveData<>();

  public static void clearHy3nCachedNavInfo() {
    // postValue is safe from bridge/Handler threads; a queued older value still
    // carries its original generation/time and cannot pass the module's guard.
    mNavInfoMutableLiveData.postValue(null);
  }`);
    add('        // Read the nav info from the message data.',
      '        NavModule.Hy3nFeedContext context = NavModule.captureHy3nNavInfoContext();\n        // Read the nav info from the message data.');
    add('        mNavInfoMutableLiveData.postValue(navInfo);',
      `        if (context != null && navInfo != null) {
          mNavInfoMutableLiveData.postValue(new Hy3nCapturedNavInfo(navInfo, context));
        }`);
    add('  public static LiveData<NavInfo> getNavInfoLiveData() {',
      '  public static LiveData<Hy3nCapturedNavInfo> getNavInfoLiveData() {');
  } else if (kind === 'androidModule') {
    add('  private Observer<NavInfo> mNavInfoObserver;',
      '  private Observer<NavInfoReceivingService.Hy3nCapturedNavInfo> mNavInfoObserver;');
    add('  private Promise pendingInitPromise;\n', '  private Promise pendingInitPromise;\n\n' + androidState);
    add('    mIsListeningRoadSnappedLocation = false;\n    mWaypoints.clear();',
      '    hy3nInvalidateFeed();\n    hy3nResetReceiptWindow(false);\n    mIsListeningRoadSnappedLocation = false;\n    mWaypoints.clear();');
    add('          mNavInfoObserver = this::showNavInfo;',
      '          hy3nResetReceiptWindow(false);\n          mNavInfoObserver = this::showNavInfo;');
    add('    if (isEnabled) {\n      NavForwardingManager.startNavForwarding',
      '    hy3nResetReceiptWindow(isEnabled);\n    if (isEnabled) {\n      NavForwardingManager.startNavForwarding');
    add('            TimeAndDistance timeAndDistance = mNavigator.getCurrentTimeAndDistance();',
      '            Hy3nFeedContext context = hy3nCaptureContext(false);\n            if (context == null) return;\n            TimeAndDistance timeAndDistance = mNavigator.getCurrentTimeAndDistance();');
    add('              WritableMap params = Arguments.createMap();\n              params.putMap("timeAndDistance", timeAndDistanceMap);',
      '              if (!hy3nContextIsCurrent(context, false)) return;\n              context.appendTo(timeAndDistanceMap);\n              WritableMap params = Arguments.createMap();\n              params.putMap("timeAndDistance", timeAndDistanceMap);');
    add('    pendingRoute = null; // reset pendingRoute.',
      '    final long hy3nMutation = hy3nBeginDestinationMutation(waypoints);\n    pendingRoute = null; // reset pendingRoute.');
    add('            // Convert RouteStatus to string matching codegen RouteStatusSpec',
      '            hy3nCompleteDestinationMutation(hy3nMutation, code == Navigator.RouteStatus.OK);\n            // Convert RouteStatus to string matching codegen RouteStatusSpec');
    add('      // If no pending route, resolve with OK status',
      '      hy3nCompleteDestinationMutation(hy3nMutation, true);\n      // If no pending route, resolve with OK status');
    add('    mWaypoints.clear(); // reset waypoints\n    mNavigator.clearDestinations();',
      '    hy3nInvalidateFeed();\n    mWaypoints.clear(); // reset waypoints\n    mNavigator.clearDestinations();');
    add('    Waypoint nextWaypoint = mNavigator.continueToNextDestination();',
      '    hy3nInvalidateFeed(); // Multi-waypoint continuation is deliberately unbound.\n    Waypoint nextWaypoint = mNavigator.continueToNextDestination();');
    add('    mNavigator.stopGuidance();\n    promise.resolve(true);',
      '    hy3nInvalidateFeed();\n    mNavigator.stopGuidance();\n    promise.resolve(true);');
    add('\n\n    TimeAndDistance timeAndDistance = mNavigator.getCurrentTimeAndDistance();',
      '\n\n    Hy3nFeedContext context = hy3nCaptureContext(false);\n    if (context == null) { promise.resolve(null); return; }\n    TimeAndDistance timeAndDistance = mNavigator.getCurrentTimeAndDistance();');
    add('    map.putInt("seconds", timeAndDistance.getSeconds());\n    promise.resolve(map);',
      '    map.putInt("seconds", timeAndDistance.getSeconds());\n    if (!hy3nContextIsCurrent(context, false)) { promise.resolve(null); return; }\n    context.appendTo(map);\n    promise.resolve(map);');
    add('    RouteSegment routeSegment = mNavigator.getCurrentRouteSegment();',
      '    Hy3nFeedContext context = hy3nCaptureContext(false);\n    if (context == null) { promise.resolve(null); return; }\n    RouteSegment routeSegment = mNavigator.getCurrentRouteSegment();');
    add('    promise.resolve(ObjectTranslationUtil.getMapFromRouteSegment(routeSegment));',
      '    WritableMap snapshot = ObjectTranslationUtil.getMapFromRouteSegment(routeSegment);\n    if (!hy3nContextIsCurrent(context, false)) { promise.resolve(null); return; }\n    context.appendTo(snapshot);\n    promise.resolve(snapshot);');
    add('  private void showNavInfo(NavInfo navInfo) {\n    if (navInfo == null || reactContext == null) {\n      return;\n    }\n    WritableMap map = Arguments.createMap();',
      `  private void showNavInfo(NavInfoReceivingService.Hy3nCapturedNavInfo receipt) {
    if (receipt == null || receipt.navInfo == null || reactContext == null
        || !hy3nContextIsCurrent(receipt.context, true)) return;
    NavInfo navInfo = receipt.navInfo;
    WritableMap map = Arguments.createMap();
    receipt.context.appendTo(map);`);
    add('    emitOnTurnByTurn(params);',
      '    if (!hy3nContextIsCurrent(receipt.context, true)) return;\n    emitOnTurnByTurn(params);');
    add('    // Re-register listeners on resume.',
      '    synchronized (hy3nFeedLock) { hy3nResetReceiptWindow(hy3nLoggingEnabled); }\n    // Re-register listeners on resume.');
    add('  public void onHostDestroy() {\n    UiThreadUtil.runOnUiThread',
      '  public void onHostDestroy() {\n    hy3nInvalidateFeed();\n    hy3nResetReceiptWindow(false);\n    UiThreadUtil.runOnUiThread');
  } else if (kind === 'iosModule') {
    add('#import "SdkVersion.h"', '#import "SdkVersion.h"\n#include <cmath>');
    add('  RCTPromiseRejectBlock _pendingInitReject;\n', '  RCTPromiseRejectBlock _pendingInitReject;\n' + iosState);
    add('- (BOOL)hasSession {', iosMethods + '- (BOOL)hasSession {');
    add('    if (self->_session.locationSimulator != nil) {',
      '    [self hy3nInvalidateFeed];\n    if (self->_session.locationSimulator != nil) {');
    add('    GMSNavigationDelayCategory severity = navigator.delayCategoryToNextDestination;',
      `    NSDictionary *context = [self hy3nCaptureContext];
    if (!context) { reject(@"route_not_available", @"No bound current route available", nil); return; }
    GMSNavigationDelayCategory severity = navigator.delayCategoryToNextDestination;`);
    add('    resolve(@{@"delaySeverity" : @(severity), @"meters" : @(distance), @"seconds" : @(time)});',
      `    NSMutableDictionary *snapshot = [@{@"delaySeverity" : @(severity), @"meters" : @(distance),
                                         @"seconds" : @(time)} mutableCopy];
    [snapshot addEntriesFromDictionary:context];
    resolve(snapshot);`);
    add('    navigator.guidanceActive = NO;\n    resolve(@(YES));',
      '    [self hy3nInvalidateFeed];\n    navigator.guidanceActive = NO;\n    resolve(@(YES));');
    add('    [navigator clearDestinations];\n    self->_destinations = NULL;',
      '    [self hy3nInvalidateFeed];\n    [navigator clearDestinations];\n    self->_destinations = NULL;');
    add('    [navigator continueToNextDestinationWithCompletion:',
      '    [self hy3nInvalidateFeed]; // Multi-waypoint continuation stays unbound.\n    [navigator continueToNextDestinationWithCompletion:');
    add('    strongSelf->_destinations = [[NSMutableArray alloc] init];',
      '    const NSUInteger hy3nMutation = [strongSelf hy3nBeginDestinationMutation:waypointsCopy];\n    strongSelf->_destinations = [[NSMutableArray alloc] init];');
    add('      // Return the route status string to match codegen RouteStatusSpec enum\n      NSString *status = [NavModule routeStatusToString:routeStatus];\n      resolve(status);',
      `      dispatch_async(dispatch_get_main_queue(), ^{
        [innerStrongSelf hy3nCompleteDestinationMutation:hy3nMutation ok:routeStatus == GMSRouteStatusOK];
        // Preserve SDK status even for superseded calls; never activate their context.
        NSString *status = [NavModule routeStatusToString:routeStatus];
        resolve(status);
      });`);
    add('    GMSRouteLeg *currentSegment = navigator.currentRouteLeg;',
      `    NSDictionary *context = [self hy3nCaptureContext];
    if (!context) { reject(@"route_not_available", @"No bound current route available", nil); return; }
    GMSRouteLeg *currentSegment = navigator.currentRouteLeg;`);
    add('    resolve(@{\n      @"destinationLatLng"',
      '    NSMutableDictionary *snapshot = [@{\n      @"destinationLatLng"');
    add('      @"segmentLatLngList" : [ObjectTranslationUtil transformGMSPathToArray:currentSegment.path]\n    });',
      '      @"segmentLatLngList" : [ObjectTranslationUtil transformGMSPathToArray:currentSegment.path]\n    } mutableCopy];\n    [snapshot addEntriesFromDictionary:context];\n    resolve(snapshot);');
    add('  if (self.enableUpdateInfo == TRUE && navInfo.navState == GMSNavigationNavStateEnroute) {',
      '  if (navigator != _session.navigator) return;\n  if (self.enableUpdateInfo == TRUE && navInfo.navState == GMSNavigationNavStateEnroute) {');
    add('  if (!navigator.currentRouteLeg) {\n    return;\n  }\n\n  GMSNavigationDelayCategory',
      '  NSDictionary *context = [self hy3nCaptureContext];\n  if (!context || navigator != _session.navigator || !navigator.currentRouteLeg) return;\n\n  GMSNavigationDelayCategory');
    add('  NSDictionary *timeAndDistance =\n      @{@"delaySeverity" : @(severity), @"meters" : @(distance), @"seconds" : @(time)};',
      '  NSMutableDictionary *timeAndDistance =\n      [@{@"delaySeverity" : @(severity), @"meters" : @(distance), @"seconds" : @(time)} mutableCopy];\n  [timeAndDistance addEntriesFromDictionary:context];');
    add('       timeToNextDestinationSeconds:(double)timeToNextDestinationSeconds {\n  NSMutableDictionary *obj = [[NSMutableDictionary alloc] init];',
      '       timeToNextDestinationSeconds:(double)timeToNextDestinationSeconds {\n  NSDictionary *context = [self hy3nCaptureContext];\n  if (!context || !self.enableUpdateInfo) return;\n  NSMutableDictionary *obj = [context mutableCopy];');
  } else if (kind === 'nativeContract') {
    for (const type of ['TimeAndDistanceSpec', 'TurnByTurnEventSpec']) {
      add(`type ${type} = Readonly<{`, `type ${type} = Readonly<{\n  // ${MARKER}: optional native mutation-lifecycle envelope.\n` +
        CONTEXT_FIELDS.map(field => `  ${field}?: Double;`).join('\n'));
    }
  } else if (kind === 'publicMetrics') {
    for (const type of ['RouteSegment', 'TimeAndDistance']) {
      add(`export interface ${type} {`, `export interface ${type} {\n  // ${MARKER}: optional; absent on unpatched builds/unsupported routes.\n` +
        CONTEXT_FIELDS.map(field => `  ${field}?: number;`).join('\n'));
    }
  } else if (kind === 'publicTurnByTurn') {
    add('export interface TurnByTurnEvent {}', `export interface TurnByTurnEvent {\n  // ${MARKER}: only the envelope is typed here; preserve native step shapes.\n` +
      CONTEXT_FIELDS.map(field => `  ${field}?: number;`).join('\n') + '\n}');
  } else {
    throw new Error(`Unknown HY3N navigation source kind: ${kind}`);
  }
  return edits;
}

function replaceExactly(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`HY3N navigation feed patch ${label}: expected exactly one anchor: ${from.slice(0, 100)}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}
function hash(source) { return crypto.createHash('sha256').update(source).digest('hex'); }
function patchSource(kind, source) {
  const edits = editsFor(kind);
  let pristine = source;
  const patched = source.includes(MARKER);
  if (patched) {
    for (const edit of [...edits].reverse()) {
      pristine = replaceExactly(pristine, edit.after, edit.before, `${kind} validation`);
    }
  }
  if (hash(pristine) !== SOURCE_HASHES[kind]) {
    throw new Error(`HY3N navigation feed patch ${kind}: SDK ${SDK_VERSION} pinned-source mismatch; review anchors before updating the patch.`);
  }
  let result = pristine;
  for (const edit of edits) result = replaceExactly(result, edit.before, edit.after, kind);
  if (patched && result !== source) throw new Error(`HY3N navigation feed patch ${kind}: inconsistent existing patch`);
  return result;
}

function applyDriverNavigationFeedPatch(projectRoot, platform) {
  if (!['android', 'ios'].includes(platform)) throw new Error(`Unsupported feed patch platform: ${platform}`);
  const root = path.join(projectRoot, SDK_ROOT);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (version !== SDK_VERSION) throw new Error(`HY3N navigation feed requires SDK ${SDK_VERSION}; found ${version}`);
  const kinds = platform === 'android' ? ['androidModule', 'androidService'] : ['iosModule'];
  kinds.push('nativeContract', 'publicMetrics', 'publicTurnByTurn');
  // Validate the entire platform batch before writing any source.
  const outputs = kinds.map(kind => {
    const filename = path.join(root, FILES[kind]);
    const original = fs.readFileSync(filename, 'utf8');
    return { filename, original, patched: patchSource(kind, original) };
  });
  for (const output of outputs) {
    if (output.original !== output.patched) fs.writeFileSync(output.filename, output.patched);
  }
}

function withDriverNavigationFeedSafeguards(config) {
  const { withDangerousMod } = require('@expo/config-plugins');
  for (const platform of ['android', 'ios']) {
    config = withDangerousMod(config, [platform, async modConfig => {
      applyDriverNavigationFeedPatch(modConfig.modRequest.projectRoot, platform);
      return modConfig;
    }]);
  }
  return config;
}

module.exports = {
  SDK_VERSION, SDK_ROOT, FILES, SOURCE_HASHES, CONTEXT_FIELDS, MARKER,
  patchSource, applyDriverNavigationFeedPatch, withDriverNavigationFeedSafeguards,
};
