'use strict';

/**
 * HY3N Android polyline zIndex bridge for Google Navigation SDK 0.16.3.
 * The native codegen contract and JS option spread already transport zIndex;
 * iOS already applies it. Only Expo's Android dangerous mod writes SDK source.
 * Tests use the pure string transform or isolated temporary SDK fixtures.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SDK_VERSION = '0.16.3';
const SDK_ROOT = path.join('node_modules', '@googlemaps', 'react-native-navigation-sdk');
const SOURCE_FILE = 'android/src/main/java/com/google/android/react/navsdk/MapViewController.java';
const SOURCE_HASH = 'ceeae291cb9417c2cf3ddad370d2f4340f311d9450511d7470ab218522eb4260';
const MARKER = 'HY3N_DRIVER_POLYLINE_Z_INDEX_V1';

// Full, unique context excludes marker, polygon and ground-overlay setters.
// Default 0 preserves the SDK's existing behavior for callers without zIndex.
const CREATE_ANCHOR = `    options.width(width);
    options.clickable(clickable);
    options.visible(visible);

    Polyline polyline = mGoogleMap.addPolyline(options);`;
const UPDATE_ANCHOR = `    polyline.setWidth(width);
    polyline.setClickable(clickable);
    polyline.setVisible(visible);
  }

  public Polygon addPolygon(Map<String, Object> optionsMap) {`;
const CREATE_INSERTION = `    // ${MARKER}: apply the transported layer on creation.
    options.zIndex(Double.valueOf(CollectionUtil.getDouble("zIndex", optionsMap, 0)).floatValue());
`;
const UPDATE_INSERTION = `    // ${MARKER}: custom-ID upserts must update the layer too.
    polyline.setZIndex(Double.valueOf(CollectionUtil.getDouble("zIndex", optionsMap, 0)).floatValue());
`;
const EDITS = [
  { before: CREATE_ANCHOR, after: CREATE_INSERTION + CREATE_ANCHOR },
  { before: UPDATE_ANCHOR, after: UPDATE_INSERTION + UPDATE_ANCHOR },
];

function replaceExactly(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + 1) >= 0) {
    throw new Error(`HY3N navigation polyline patch ${label}: expected exactly one anchor: ${from.slice(0, 100)}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function hash(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function patchSource(source) {
  let pristine = source;
  const patched = source.includes(MARKER);
  if (patched) {
    // Markers alone are NOT evidence of correctness: reverse BOTH exact edits.
    for (const edit of [...EDITS].reverse()) {
      pristine = replaceExactly(pristine, edit.after, edit.before, 'existing-patch validation');
    }
  }
  // Even an apparently complete patch must reverse to the pinned whole source.
  if (hash(pristine) !== SOURCE_HASH) {
    throw new Error(`HY3N navigation polyline patch: SDK ${SDK_VERSION} pinned-source mismatch; review source and anchors before updating the patch.`);
  }
  let result = pristine;
  for (const edit of EDITS) result = replaceExactly(result, edit.before, edit.after, 'application');
  if (patched && result !== source) {
    throw new Error('HY3N navigation polyline patch: inconsistent existing patch');
  }
  return result;
}

function applyDriverNavigationPolylinePatch(projectRoot) {
  const root = path.join(projectRoot, SDK_ROOT);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (version !== SDK_VERSION) {
    throw new Error(`HY3N navigation polyline patch requires SDK ${SDK_VERSION}; found ${version}`);
  }
  const filename = path.join(root, SOURCE_FILE);
  const original = fs.readFileSync(filename, 'utf8');
  // Validate the complete file and both setters BEFORE writing anything.
  const patched = patchSource(original);
  if (patched !== original) fs.writeFileSync(filename, patched);
}

function withDriverNavigationPolylineZIndex(config) {
  const { withDangerousMod } = require('@expo/config-plugins');
  return withDangerousMod(config, ['android', async modConfig => {
    applyDriverNavigationPolylinePatch(modConfig.modRequest.projectRoot);
    return modConfig;
  }]);
}

module.exports = {
  SDK_VERSION, SDK_ROOT, SOURCE_FILE, SOURCE_HASH, MARKER,
  patchSource, applyDriverNavigationPolylinePatch, withDriverNavigationPolylineZIndex,
};
