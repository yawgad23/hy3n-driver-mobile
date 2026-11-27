import assert from 'node:assert/strict';
export const ANDROID_REQUEST_STOP_FIX = 'cad528cdc8c03490755f0dcb6156637c836862fc';
export const RELEASE_57029_PATHS = new Set([
  'app.config.ts',
  'tests/driver-android-57028-release-metadata.test.ts',
  'tests/driver-android-request-stop-preservation.test.ts',
  'tests/helpers/driver-android-57029-metadata.ts',
  'tests/driver-android-57029-release-metadata.test.ts',
  'docs/driver-android-1.0.9-57029-request-stop-20261127.md',
]);
// Exact Android version/code/comment replacements only, with no optional fallback.
const changes: Array<[string, string]> = [
  ['buildPlatform === "android"\n    ? "1.0.8"', 'buildPlatform === "android"\n    ? "1.0.9"'],
  [
    '    // 1.0.8 (57028) tentatively packages the reviewed Gold Chime and approved selfie;\n    // preserve DataStore 16 KB and all other config; confirm Play counter before build.\n    versionCode: buildPlatform === "android" ? 57028 : 57023,',
    '    // 1.0.9 (57029) adds session-wide request-audio stop safeguards;\n    // retain Gold Chime, approved selfie, DataStore 16 KB and all other config.\n    versionCode: buildPlatform === "android" ? 57029 : 57023,',
  ],
];
export function with57029Metadata(source: string) {
  let result = source;
  for (const [before, after] of changes) {
    assert.equal(result.split(before).length - 1, 1, 'exact 57028 metadata must occur once');
    result = result.replace(before, after);
  }
  return result;
}
export function without57029Metadata(source: string) {
  let result = source;
  for (const [before, after] of changes) {
    assert.equal(result.split(after).length - 1, 1, 'exact 57029 metadata must occur once');
    result = result.replace(after, before);
  }
  return result;
}
