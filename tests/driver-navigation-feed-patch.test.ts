import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const requireHere = createRequire(__filename);
const {
  SDK_VERSION, SDK_ROOT, FILES, SOURCE_HASHES, CONTEXT_FIELDS, MARKER,
  patchSource, applyDriverNavigationFeedPatch,
} = requireHere('../plugins/driver-navigation-feed-patch.js');
const { TypeScriptParser } = requireHere('@react-native/codegen/lib/parsers/typescript/parser');
const projectRoot = path.resolve(__dirname, '..');
const originals: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([kind, filename]) => [kind,
    fs.readFileSync(path.join(projectRoot, SDK_ROOT, filename as string), 'utf8')]),
);
const patched: Record<string, string> = Object.fromEntries(
  Object.entries(originals).map(([kind, source]) => [kind, patchSource(kind, source)]),
);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function between(text: string, start: string, end: string): string {
  const begin = text.indexOf(start);
  assert.ok(begin >= 0, `Missing start ${start}`);
  const finish = text.indexOf(end, begin + start.length);
  assert.ok(finish >= 0, `Missing end ${end}`);
  return text.slice(begin, finish);
}

for (const kind of Object.keys(FILES)) {
  test(`${kind}: actual pinned source transforms idempotently and never modifies installed SDK`, () => {
    assert.equal(sha(originals[kind]), SOURCE_HASHES[kind]);
    assert.ok(patched[kind].includes(MARKER));
    assert.equal(patchSource(kind, patched[kind]), patched[kind]);
    assert.equal(fs.readFileSync(path.join(projectRoot, SDK_ROOT, FILES[kind]), 'utf8'), originals[kind]);
  });
  test(`${kind}: drift, missing anchors, partial patches and edited guards fail loudly`, () => {
    assert.throws(() => patchSource(kind, originals[kind] + '\n// drift\n'), /pinned-source mismatch/);
    assert.throws(() => patchSource(kind, originals[kind].slice(100)), /pinned-source mismatch/);
    assert.throws(() => patchSource(kind, `${MARKER}\n` + originals[kind]), /expected exactly one anchor/);
    const corrupted = patched[kind].replace(MARKER, `${MARKER}_CORRUPTED`);
    assert.throws(() => patchSource(kind, corrupted), /anchor|pinned-source mismatch/);
  });
}

test('Pinned patch validation rejects removed guards even with the original marker intact', () => {
  const tamperedAndroid = patched.androidModule.replace('if (token != hy3nMutationToken) return;', 'if (false) return;');
  const tamperedIos = patched.iosModule.replace('if (token != _hy3nMutationToken) return;', 'if (NO) return;');
  const tamperedService = patched.androidService.replace('if (context != null && navInfo != null)', 'if (navInfo != null)');
  assert.throws(() => patchSource('androidModule', tamperedAndroid), /anchor/);
  assert.throws(() => patchSource('iosModule', tamperedIos), /anchor/);
  assert.throws(() => patchSource('androidService', tamperedService), /anchor/);
});

test('Android service captures context at receipt BEFORE decode and preserves it through LiveData', () => {
  const text = patched.androidService;
  assert.match(text, /MutableLiveData<Hy3nCapturedNavInfo>/);
  assert.match(text, /final NavInfo navInfo;[\s\S]*final NavModule\.Hy3nFeedContext context;/);
  const handler = between(text, 'public void handleMessage(Message msg)', '@Nullable');
  assert.ok(handler.indexOf('captureHy3nNavInfoContext()') < handler.indexOf('readNavInfoFromBundle'));
  assert.match(handler, /context != null && navInfo != null/);
  assert.match(handler, /postValue\(new Hy3nCapturedNavInfo\(navInfo, context\)\)/);
  assert.match(text, /clearHy3nCachedNavInfo\(\)[\s\S]*postValue\(null\)/);
});

test('Android TBT uses original receipt envelope, checks activation and rechecks before emit', () => {
  const text = patched.androidModule;
  const callback = between(text, 'private void showNavInfo(', '@Override\n  public void logDebugInfo');
  assert.match(callback, /hy3nContextIsCurrent\(receipt\.context, true\)/);
  assert.match(callback, /receipt\.context\.appendTo\(map\)/);
  assert.doesNotMatch(callback, /hy3nCaptureContext|currentTimeMillis/);
  assert.ok(callback.indexOf('appendTo(map)') < callback.indexOf('turnByTurnEvents.pushMap(map)'));
  assert.match(callback, /if \(!hy3nContextIsCurrent\(receipt\.context, true\)\) return;\n    emitOnTurnByTurn\(params\)/);
  const guard = between(text, 'private boolean hy3nContextIsCurrent', 'private void hy3nInvalidateFeed');
  assert.match(guard, /context\.generation == hy3nRouteGeneration/);
  assert.match(guard, /context\.capturedElapsedMs > hy3nActivatedElapsedMs/);
  assert.match(guard, /context\.capturedElapsedMs > hy3nFeedEnabledElapsedMs/);
  assert.match(text, /this\.capturedAtMs = System\.currentTimeMillis\(\)/);
  assert.match(text, /this\.capturedElapsedMs = android\.os\.SystemClock\.elapsedRealtime\(\)/);
  for (const field of CONTEXT_FIELDS) assert.match(text, new RegExp(`putDouble\\("${field}"`));
});

test('Android destination mutation, clear, stop and cleanup suppress unbound/replaced feed', () => {
  const text = patched.androidModule;
  const set = between(text, 'public void setDestinations(', '@Override\n  public void clearDestinations');
  assert.ok(set.indexOf('hy3nBeginDestinationMutation(waypoints)') < set.indexOf('mNavigator.setDestinations'));
  assert.match(set, /hy3nCompleteDestinationMutation\(hy3nMutation, code == Navigator\.RouteStatus\.OK\)/);
  assert.match(set, /promise\.resolve\(EnumTranslationUtil\.getRouteStatusStringValue\(code\)\)/);
  assert.match(text, /if \(token != hy3nMutationToken\) return/);
  assert.match(text, /\+\+hy3nMutationToken;[\s\S]*hy3nRouteActive = false;/);
  assert.match(text, /waypoints\.size\(\) == 1/);
  assert.match(text, /position\.getDouble\("lat"\)/);
  assert.match(text, /position\.getDouble\("lng"\)/);
  assert.match(between(text, 'public void clearDestinations(', 'public void continueToNextDestination'), /hy3nInvalidateFeed\(\)/);
  assert.match(between(text, 'public void stopGuidance(', 'public void simulateLocations'), /hy3nInvalidateFeed\(\)/);
  assert.match(between(text, 'public void cleanup(', 'public void showTermsAndConditionsDialog'), /hy3nInvalidateFeed\(\)/);
  assert.match(between(text, 'public void continueToNextDestination(', 'public void startGuidance'), /hy3nInvalidateFeed\(\)/);
});

test('Android enabling, observing, and host reactivation clear cached receipt window', () => {
  const text = patched.androidModule;
  assert.match(between(text, 'public void setTurnByTurnLoggingEnabled(', 'public void setBackgroundLocation'), /hy3nResetReceiptWindow\(isEnabled\)/);
  assert.match(between(text, 'private void hy3nResetReceiptWindow(', 'public interface ModuleReadyListener'), /clearHy3nCachedNavInfo\(\)/);
  assert.match(text, /hy3nResetReceiptWindow\(false\);\n          mNavInfoObserver = this::showNavInfo/);
  assert.match(between(text, 'public void onHostResume()', 'public void onHostPause'), /hy3nResetReceiptWindow\(hy3nLoggingEnabled\)/);
});

test('Android metric event, metric poll, and current-route snapshot append same native envelope', () => {
  const text = patched.androidModule;
  const listener = between(text, 'public void onRemainingTimeOrDistanceChanged()', 'mNavigator.addRemainingTimeOrDistanceChangedListener');
  assert.match(listener, /context = hy3nCaptureContext\(false\)/);
  assert.match(listener, /context\.appendTo\(timeAndDistanceMap\)/);
  assert.match(listener, /params\.putMap\("timeAndDistance", timeAndDistanceMap\)/);
  for (const [start, end, result] of [
    ['public void getCurrentTimeAndDistance(', 'public void getCurrentRouteSegment(', 'map'],
    ['public void getCurrentRouteSegment(', 'public void getRouteSegments(', 'snapshot'],
  ]) {
    const body = between(text, start, end);
    assert.match(body, /context = hy3nCaptureContext\(false\)/);
    assert.match(body, /hy3nContextIsCurrent\(context, false\)/);
    assert.match(body, new RegExp(`context\\.appendTo\\(${result}\\)`));
    assert.match(body, /context == null\) \{ promise\.resolve\(null\); return; \}/);
  }
});

test('iOS binds coordinate target at mutation and stale completions cannot reactivate', () => {
  const text = patched.iosModule;
  const set = between(text, '- (void)setDestinations:', '- (void)applyNavigationUISettings');
  assert.ok(set.indexOf('hy3nBeginDestinationMutation:waypointsCopy') < set.indexOf('[navigator setDestinations:'));
  assert.match(set, /hy3nCompleteDestinationMutation:hy3nMutation ok:routeStatus == GMSRouteStatusOK/);
  assert.match(set, /dispatch_async\(dispatch_get_main_queue\(\), \^\{[\s\S]*resolve\(status\)/);
  assert.match(text, /if \(token != _hy3nMutationToken\) return/);
  assert.match(text, /waypoints\.count == 1/);
  assert.match(text, /waypoint\[@"position"\]/);
  assert.match(text, /position\[@"lat"\] doubleValue/);
  assert.match(text, /position\[@"lng"\] doubleValue/);
  assert.match(text, /if \(!\[NSThread isMainThread\] \|\| !_hy3nRouteActive\) return nil/);
  assert.match(text, /\[NSDate date\]\.timeIntervalSince1970 \* 1000\.0/);
  for (const [start, end] of [
    ['- (void)cleanup:', '- (void)setTurnByTurnLoggingEnabled:'],
    ['- (void)clearDestinations:', '- (void)continueToNextDestination:'],
    ['- (void)stopGuidance:', '- (void)simulateLocationsAlongExistingRoute:'],
    ['- (void)continueToNextDestination:', '- (void)setDestinations:'],
  ]) assert.match(between(text, start, end), /hy3nInvalidateFeed/);
});

test('iOS TBT, metric event/poll, and current-route snapshot preserve payloads with context', () => {
  const text = patched.iosModule;
  const turn = between(text, '- (void)onTurnByTurn:(GMSNavigationNavInfo *)navInfo', '- (NSDictionary *)getStepInfo:');
  assert.match(turn, /if \(!context \|\| !self\.enableUpdateInfo\) return/);
  assert.match(turn, /NSMutableDictionary \*obj = \[context mutableCopy\]/);
  assert.match(turn, /emitOnTurnByTurn:@\{@"turnByTurnEvents" : params\}/);
  assert.match(turn, /forKey:@"getRemainingSteps"/);
  assert.match(text, /navInfo\.navState == GMSNavigationNavStateEnroute/);
  const event = between(text, '- (void)onRemainingTimeOrDistanceChangedWithNavigator:', '- (void)onRouteChanged');
  assert.match(event, /!context \|\| navigator != _session\.navigator/);
  assert.match(event, /\[timeAndDistance addEntriesFromDictionary:context\]/);
  assert.match(event, /emitOnRemainingTimeOrDistanceChanged:@\{@"timeAndDistance" : timeAndDistance\}/);
  for (const [start, end] of [
    ['- (void)getCurrentTimeAndDistance:', '- (void)setAudioGuidanceType:'],
    ['- (void)getCurrentRouteSegment:', '- (void)getRouteSegments:'],
  ]) {
    const body = between(text, start, end);
    assert.match(body, /context = \[self hy3nCaptureContext\]/);
    assert.match(body, /reject\(@"route_not_available"/);
    assert.match(body, /\[snapshot addEntriesFromDictionary:context\]/);
    assert.match(body, /resolve\(snapshot\)/);
  }
});

test('Codegen accepts optional Double fields without changing original methods/listener shapes', () => {
  const parser = new TypeScriptParser();
  const originalSchema = parser.parseString(originals.nativeContract, FILES.nativeContract);
  const newSchema = parser.parseString(patched.nativeContract, FILES.nativeContract);
  const module = newSchema.modules.NativeNavModule;
  for (const type of ['TimeAndDistanceSpec', 'TurnByTurnEventSpec']) {
    for (const field of CONTEXT_FIELDS) {
      const property = module.aliasMap[type].properties.find((value: any) => value.name === field);
      assert.ok(property);
      assert.equal(property.optional, true);
      assert.equal(property.typeAnnotation.type, 'DoubleTypeAnnotation');
    }
    module.aliasMap[type].properties = module.aliasMap[type].properties.filter((value: any) => !CONTEXT_FIELDS.includes(value.name));
  }
  // Event emitters carry resolved object properties too; remove ONLY the new fields.
  const stripEnvelope = (value: any): any => {
    if (Array.isArray(value)) return value.filter(item => !CONTEXT_FIELDS.includes(item?.name)).map(stripEnvelope);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripEnvelope(item)]));
    return value;
  };
  assert.deepEqual(stripEnvelope(newSchema), originalSchema);
  for (const field of CONTEXT_FIELDS) {
    assert.match(patched.publicMetrics, new RegExp(`${field}\\?: number;`));
    assert.match(patched.publicTurnByTurn, new RegExp(`${field}\\?: number;`));
  }
});

function isolatedSdk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hy3n-feed-patch-'));
  const sdk = path.join(root, SDK_ROOT);
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version: SDK_VERSION }));
  for (const [kind, file] of Object.entries(FILES)) {
    const filename = path.join(sdk, file as string);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, originals[kind]);
  }
  return { root, sdk };
}

test('Prebuild validates/writes isolated platform batches reproducibly in either order', () => {
  for (const platforms of [['android', 'ios'], ['ios', 'android']]) {
    const { root, sdk } = isolatedSdk();
    try {
      for (const platform of [...platforms, ...platforms]) applyDriverNavigationFeedPatch(root, platform);
      for (const [kind, file] of Object.entries(FILES)) assert.equal(fs.readFileSync(path.join(sdk, file as string), 'utf8'), patched[kind]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('Prebuild refuses version drift and partial source batches before any writes', () => {
  const { root, sdk } = isolatedSdk();
  try {
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version: '0.17.0' }));
    assert.throws(() => applyDriverNavigationFeedPatch(root, 'android'), /requires SDK 0\.16\.3/);
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version: SDK_VERSION }));
    fs.appendFileSync(path.join(sdk, FILES.nativeContract), '\n// drift\n');
    assert.throws(() => applyDriverNavigationFeedPatch(root, 'android'), /pinned-source mismatch/);
    assert.equal(fs.readFileSync(path.join(sdk, FILES.androidModule), 'utf8'), originals.androidModule);
    assert.equal(fs.readFileSync(path.join(sdk, FILES.androidService), 'utf8'), originals.androidService);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Existing Expo plugin wires safeguards without replacing existing marker/key plugin', () => {
  const text = fs.readFileSync(path.join(projectRoot, 'plugins/with-google-navigation.js'), 'utf8');
  assert.match(text, /require\('\.\/driver-navigation-feed-patch'\)/);
  assert.match(text, /config = withDriverNavigationFeedSafeguards\(config\)/);
  assert.match(text, /config = addDriverCarMarkerAssets\(config\)/);
  assert.match(text, /config = addAndroidNavigationApiKey/);
  assert.match(text, /config = addIosNavigationApiKey/);
  assert.match(text, /config = disableIosDefaultLocationIndicator\(config\)/);
});
