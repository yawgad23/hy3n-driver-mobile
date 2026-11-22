import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const requireHere = createRequire(__filename);
const {
  SDK_VERSION, SDK_ROOT, SOURCE_FILE, SOURCE_HASH, MARKER,
  patchSource, applyDriverNavigationPolylinePatch, withDriverNavigationPolylineZIndex,
} = requireHere('../plugins/driver-navigation-polyline-patch.js');
const projectRoot = path.resolve(__dirname, '..');
const sdkRoot = path.join(projectRoot, SDK_ROOT);
const sourcePath = path.join(sdkRoot, SOURCE_FILE);
const original = fs.readFileSync(sourcePath, 'utf8');
const transformed: string = patchSource(original);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const createSetter = '    options.zIndex(Double.valueOf(CollectionUtil.getDouble("zIndex", optionsMap, 0)).floatValue());\n';
const updateSetter = '    polyline.setZIndex(Double.valueOf(CollectionUtil.getDouble("zIndex", optionsMap, 0)).floatValue());\n';
const createComment = `    // ${MARKER}: apply the transported layer on creation.\n`;
const updateComment = `    // ${MARKER}: custom-ID upserts must update the layer too.\n`;
const protectedFiles = [
  sourcePath,
  path.join(sdkRoot, 'package.json'),
  path.join(sdkRoot, 'src/native/NativeNavViewModule.ts'),
  path.join(sdkRoot, 'src/maps/mapView/mapViewController.ts'),
  path.join(sdkRoot, 'src/maps/types.ts'),
  path.join(sdkRoot, 'src/maps/mapView/types.ts'),
  path.join(sdkRoot, 'ios/react-native-navigation-sdk/ObjectTranslationUtil.mm'),
  path.join(projectRoot, 'plugins/driver-navigation-feed-patch.js'),
];
const protectedHashes = new Map(protectedFiles.map(file => [file, sha(fs.readFileSync(file, 'utf8'))]));

function between(text: string, start: string, end: string): string {
  const begin = text.indexOf(start);
  assert.ok(begin >= 0, `Missing start ${start}`);
  const finish = text.indexOf(end, begin + start.length);
  assert.ok(finish >= 0, `Missing end ${end}`);
  return text.slice(begin, finish);
}

function isolatedSdk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hy3n-polyline-patch-'));
  const sdk = path.join(root, SDK_ROOT);
  const filename = path.join(sdk, SOURCE_FILE);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version: SDK_VERSION }));
  fs.writeFileSync(filename, original);
  // Sentinels demonstrate that no marker/assets, feed, JS, or iOS source is touched.
  const sentinels = [
    'android/src/main/java/com/google/android/react/navsdk/NavModule.java',
    'android/src/main/assets/vehicle.png',
    'src/native/NativeNavViewModule.ts',
    'src/maps/mapView/mapViewController.ts',
    'ios/react-native-navigation-sdk/ObjectTranslationUtil.mm',
  ].map(file => path.join(sdk, file));
  for (const file of sentinels) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'unchanged fixture sentinel\n');
  }
  return { root, sdk, filename, sentinels };
}

function withFixture(run: (fixture: ReturnType<typeof isolatedSdk>) => void) {
  const fixture = isolatedSdk();
  try { run(fixture); } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
}

test('Actual SDK 0.16.3 pristine source is pinned; the in-memory patch is idempotent', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8')).version, SDK_VERSION);
  assert.equal(sha(original), SOURCE_HASH);
  assert.equal(patchSource(transformed), transformed);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), original);
});

test('Only two polyline setters and their comments are added; every other byte is preserved', () => {
  const expected = original
    .replace('    options.width(width);\n', createComment + createSetter + '    options.width(width);\n')
    .replace('    polyline.setWidth(width);\n', updateComment + updateSetter + '    polyline.setWidth(width);\n');
  assert.equal(transformed, expected);
  const reversed = transformed
    .replace(createComment + createSetter, '')
    .replace(updateComment + updateSetter, '');
  assert.equal(reversed, original);
  assert.equal(sha(reversed), SOURCE_HASH);
  assert.equal(transformed.split(MARKER).length - 1, 2);
  assert.equal(transformed.split(createSetter).length - 1, 1);
  assert.equal(transformed.split(updateSetter).length - 1, 1);
});

test('Creation applies optional zIndex as a float before addPolyline with native default 0', () => {
  const creation = between(transformed, 'private Polyline createPolyline(', 'private void updatePolyline(');
  assert.ok(creation.includes(createSetter));
  assert.ok(creation.indexOf(createSetter.trim()) < creation.indexOf('mGoogleMap.addPolyline(options)'));
  assert.match(creation, /if \(latLngArr == null\) \{\s*return null;/);
  for (const unchanged of ['options.add(latLng)', 'options.color(color)', 'options.width(width)', 'options.clickable(clickable)', 'options.visible(visible)', 'polylineMap.put(effectiveId, polyline)', 'polylineNativeIdToEffectiveId.put(polyline.getId(), effectiveId)']) {
    assert.ok(creation.includes(unchanged), unchanged);
  }
});

test('Custom-ID upsert sets zIndex on the existing polyline, preserving its identity and options', () => {
  assert.equal(
    between(transformed, 'public Polyline addPolyline(', 'private Polyline createPolyline('),
    between(original, 'public Polyline addPolyline(', 'private Polyline createPolyline('),
  );
  const update = between(transformed, 'private void updatePolyline(', 'public Polygon addPolygon(');
  assert.ok(update.includes(updateSetter));
  for (const unchanged of ['polyline.setPoints(points)', 'polyline.setColor(color)', 'polyline.setWidth(width)', 'polyline.setClickable(clickable)', 'polyline.setVisible(visible)']) {
    assert.ok(update.includes(unchanged), unchanged);
  }
  assert.doesNotMatch(update, /addPolyline|\.remove\(|setId/);
});

test('Markers, assets, other shapes, clicks, removals, camera, and all code outside the two methods remain byte-identical', () => {
  const start = '  private Polyline createPolyline(';
  const end = '  public Polygon addPolygon(';
  assert.equal(transformed.slice(0, transformed.indexOf(start)), original.slice(0, original.indexOf(start)));
  assert.equal(transformed.slice(transformed.indexOf(end)), original.slice(original.indexOf(end)));
  assert.match(original, /BitmapDescriptorFactory\.fromAsset\(imagePath\)/);
});

test('Pristine full-file drift, missing/duplicate anchors, and line-ending changes fail loudly', () => {
  for (const drift of [
    original + '\n// drift\n',
    original.slice(100),
    original.replace('    options.width(width);', '    options.width(0);'),
    original.replace('    options.width(width);', '    options.width(width);\n    options.width(width);'),
    original.replace(/\n/g, '\r\n'),
    original.replace('MapViewController', 'UnexpectedController'),
  ]) assert.throws(() => patchSource(drift), /pinned-source mismatch/);
});

test('Either one-sided create/update patch is rejected rather than accepted or repaired', () => {
  for (const partial of [
    transformed.replace(createComment + createSetter, ''),
    transformed.replace(updateComment + updateSetter, ''),
    original.replace('    options.width(width);\n', createSetter + '    options.width(width);\n'),
    original.replace('    polyline.setWidth(width);\n', updateSetter + '    polyline.setWidth(width);\n'),
  ]) assert.throws(() => patchSource(partial), /anchor|pinned-source mismatch/);
});

test('Tampered setter/default/conversion/comments and marker-only/markerless patches fail loudly', () => {
  for (const tampered of [
    transformed.replace(createSetter, ''),
    transformed.replace(updateSetter, ''),
    transformed.replace('getDouble("zIndex", optionsMap, 0)', 'getDouble("zIndex", optionsMap, 1)'),
    transformed.replace(createSetter, createSetter.replace('floatValue()', 'intValue()')),
    transformed.replace(updateSetter, updateSetter.replace('setZIndex', 'setWidth')),
    transformed.replace(createComment, createComment.replace('creation', 'tampered')),
    transformed.replaceAll(MARKER, `${MARKER}_TAMPERED`),
    transformed.replaceAll(MARKER, 'REMOVED_MARKER'),
    `// ${MARKER}\n` + original,
  ]) assert.throws(() => patchSource(tampered), /anchor|pinned-source mismatch/);
});

test('Complete patches must still reverse to the pristine hash; unrelated tampering is rejected', () => {
  for (const tampered of [
    transformed + '\n// unrelated drift\n',
    transformed.replace('options.icon(icon)', 'options.icon(null)'),
    transformed.replace('polyline.setColor(color)', 'polyline.setColor(0)'),
    transformed.replace('return existingPolyline;', 'return null;'),
    transformed + `\n// ${MARKER}\n`,
  ]) assert.throws(() => patchSource(tampered), /pinned-source mismatch/);
});

test('Duplicated complete edit anchors are rejected before any idempotent acceptance', () => {
  const anchor = between(transformed, createComment, '    String effectiveId');
  assert.throws(() => patchSource(transformed + anchor), /expected exactly one anchor/);
  assert.throws(() => patchSource(transformed + transformed), /expected exactly one anchor/);
});

test('Isolated prebuild patches reproducibly, skips an already-patched write, and preserves other files', () => {
  withFixture(({ root, sdk, filename, sentinels }) => {
    const manifest = fs.readFileSync(path.join(sdk, 'package.json'), 'utf8');
    applyDriverNavigationPolylinePatch(root);
    assert.equal(fs.readFileSync(filename, 'utf8'), transformed);
    // A stable old timestamp proves the second application performs no write.
    fs.utimesSync(filename, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
    const before = fs.statSync(filename).mtimeMs;
    applyDriverNavigationPolylinePatch(root);
    assert.equal(fs.statSync(filename).mtimeMs, before);
    assert.equal(fs.readFileSync(filename, 'utf8'), transformed);
    assert.equal(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8'), manifest);
    for (const file of sentinels) assert.equal(fs.readFileSync(file, 'utf8'), 'unchanged fixture sentinel\n');
  });
});

test('Unsupported/missing version and malformed metadata fail before writing any source', () => {
  withFixture(({ root, sdk, filename }) => {
    for (const version of ['0.16.2', '0.17.0', undefined]) {
      fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ version }));
      assert.throws(() => applyDriverNavigationPolylinePatch(root), /requires SDK 0\.16\.3/);
      assert.equal(fs.readFileSync(filename, 'utf8'), original);
    }
    fs.writeFileSync(path.join(sdk, 'package.json'), '{');
    assert.throws(() => applyDriverNavigationPolylinePatch(root), SyntaxError);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
    fs.rmSync(path.join(sdk, 'package.json'));
    assert.throws(() => applyDriverNavigationPolylinePatch(root), /ENOENT/);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
  });
});

test('Missing source and unsupported/partial/tampered source fail before any fixture write', () => {
  withFixture(({ root, filename, sentinels }) => {
    for (const bad of [
      original + '\n// drift\n',
      transformed.replace(updateComment + updateSetter, ''),
      transformed.replace(updateSetter, updateSetter.replace('optionsMap, 0', 'optionsMap, 99')),
      transformed + '\n// drift\n',
    ]) {
      fs.writeFileSync(filename, bad);
      fs.utimesSync(filename, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
      const before = fs.statSync(filename).mtimeMs;
      assert.throws(() => applyDriverNavigationPolylinePatch(root), /anchor|pinned-source mismatch/);
      assert.equal(fs.readFileSync(filename, 'utf8'), bad);
      assert.equal(fs.statSync(filename).mtimeMs, before);
    }
    fs.rmSync(filename);
    assert.throws(() => applyDriverNavigationPolylinePatch(root), /ENOENT/);
    assert.equal(fs.existsSync(filename), false);
    for (const file of sentinels) assert.equal(fs.readFileSync(file, 'utf8'), 'unchanged fixture sentinel\n');
  });
});

test('Expo registers only an Android dangerous mod; registration/import does not patch installed SDK', () => {
  const config = withDriverNavigationPolylineZIndex({ name: 'fixture', slug: 'fixture' });
  assert.equal(typeof config.mods?.android?.dangerous, 'function');
  assert.equal(config.mods?.ios, undefined);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), original);
});

test('Existing Expo plugin retains feed, marker, key, and iOS safeguards alongside polyline patch', () => {
  const text = fs.readFileSync(path.join(projectRoot, 'plugins/with-google-navigation.js'), 'utf8');
  assert.equal(text.split("require('./driver-navigation-polyline-patch')").length - 1, 1);
  assert.equal(text.split('config = withDriverNavigationPolylineZIndex(config);').length - 1, 1);
  assert.match(text, /require\('\.\/driver-navigation-feed-patch'\)/);
  for (const call of ['withDriverNavigationFeedSafeguards', 'addDriverCarMarkerAssets', 'disableIosDefaultLocationIndicator', 'pinAndroidNdkVersion']) {
    assert.ok(text.includes(`config = ${call}(config);`));
  }
  assert.match(text, /config = addAndroidNavigationApiKey/);
  assert.match(text, /config = addIosNavigationApiKey/);
  assert.match(text, /ANDROID_DRIVER_CAR_MARKER/);
  assert.match(text, /ANDROID_DRIVER_MOTORCYCLE_MARKER/);
  assert.match(text, /ANDROID_DRIVER_DELIVERY_MARKER/);
});

test('Actual codegen carries optional Double zIndex and JS spreads it without modifying public types', () => {
  const native = fs.readFileSync(path.join(sdkRoot, 'src/native/NativeNavViewModule.ts'), 'utf8');
  assert.match(between(native, 'type PolylineOptionsSpec =', 'type GroundOverlayOptionsSpec ='), /zIndex\?: WithDefault<Double, null>;/);
  const { TypeScriptParser } = requireHere('@react-native/codegen/lib/parsers/typescript/parser');
  const schema = new TypeScriptParser().parseString(native, 'NativeNavViewModule.ts');
  const property = schema.modules.NativeNavViewModule.aliasMap.PolylineOptionsSpec.properties.find((value: { name: string }) => value.name === 'zIndex');
  assert.ok(property);
  assert.equal(property.optional, true);
  assert.equal(property.typeAnnotation.type, 'NullableTypeAnnotation');
  assert.equal(property.typeAnnotation.typeAnnotation.type, 'DoubleTypeAnnotation');
  const controller = fs.readFileSync(path.join(sdkRoot, 'src/maps/mapView/mapViewController.ts'), 'utf8');
  assert.match(between(controller, '    addPolyline: async', '    addPolygon: async'), /NavViewModule\.addPolyline\(nativeID, \{\s*\.\.\.polylineOptions,/);
  const publicTypes = fs.readFileSync(path.join(sdkRoot, 'src/maps/mapView/types.ts'), 'utf8');
  assert.doesNotMatch(between(publicTypes, 'export interface PolylineOptions {', 'interface GroundOverlayBaseOptions {'), /zIndex/);
});

test('Actual iOS create and update already apply zIndex and remain untouched', () => {
  const ios = fs.readFileSync(path.join(sdkRoot, 'ios/react-native-navigation-sdk/ObjectTranslationUtil.mm'), 'utf8');
  for (const [start, end] of [
    ['+ (GMSPolyline *)createPolyline:', '+ (GMSPolygon *)createPolygon:'],
    ['+ (void)updatePolyline:', '+ (void)updatePolygon:'],
  ]) assert.match(between(ios, start, end), /if \(zIndex\) \{\s*polyline\.zIndex = \[zIndex intValue\];/);
});

test('All installed sources and the existing feed patch retain their original full-file hashes', () => {
  for (const [file, hash] of protectedHashes) assert.equal(sha(fs.readFileSync(file, 'utf8')), hash, file);
  assert.equal(sha(fs.readFileSync(sourcePath, 'utf8')), SOURCE_HASH);
});
