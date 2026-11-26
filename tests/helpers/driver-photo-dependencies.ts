import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Allow only the two new direct dependencies, at this platform's Expo SDK versions. */
export function addSdkMatchedPhotoDependencies(expected: { dependencies: Record<string, string> }, root: string): void {
  const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/expo/bundledNativeModules.json'), 'utf8'));
  for (const name of ['expo-file-system', 'expo-image-manipulator']) {
    assert.equal(typeof catalogue[name], 'string', `${name} must be in the installed SDK catalogue`);
    expected.dependencies[name] = catalogue[name];
  }
}

/** FileSystem was already locked transitively; preserve its packages and snapshots. */
export function withoutDriverPhotoLockAdditions(source: string): string {
  return source
    .replace(/^      (?:expo-file-system|expo-image-manipulator):\n.*?(?=^      \S|^    \S|^\S|$(?![\s\S]))/gms, '')
    .replace(/^  expo-image-manipulator@[^\n]*:\n.*?(?=^  \S|^\S|$(?![\s\S]))/gms, '');
}
