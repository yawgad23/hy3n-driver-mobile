import assert from 'node:assert/strict';

// Historical 133 audits retain their original assertions. The separate 134
// release suite reads raw app.config.ts and tests the real configuration.
export function withoutDriverIos134Counter(source: string): string {
  const release = '    buildNumber: buildPlatform === "ios" ? "134" : "124",';
  const previous = '    buildNumber: buildPlatform === "ios" ? "133" : "124",';
  assert.equal(source.split(release).length - 1, 1, 'exactly one reviewed iPhone 134 counter literal');
  return source.replace(release, previous);
}
