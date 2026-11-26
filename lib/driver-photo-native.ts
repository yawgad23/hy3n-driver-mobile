import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { prepareDriverPhoto, type DriverPhotoDependencies } from './driver-photo-preparation';

const nativePhotoDependencies: DriverPhotoDependencies = {
  getDimensions: uri => new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  }),
  encodeJpeg: async (uri, options) => {
    const context = ImageManipulator.manipulate(uri);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      if (options.resize) context.resize(options.resize);
      rendered = await context.renderAsync();
      return await rendered.saveAsync({ format: SaveFormat.JPEG, compress: options.compress });
    } finally {
      // Release native image buffers between bounded compression attempts.
      rendered?.release();
      context.release();
    }
  },
  readBlob: async uri => {
    const response = await fetch(uri);
    if (response.ok === false) throw new Error('The prepared photo could not be read.');
    return response.blob();
  },
  cleanup: async uri => {
    // Only generated app-cache files are eligible for deletion. Never touch a
    // driver's gallery original, camera selection, or saved document reference.
    const cache = FileSystem.cacheDirectory;
    if (cache && uri.startsWith(cache)) await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};

let preparationTail: Promise<void> = Promise.resolve();

/** Converts and resizes locally; no image bytes are sent before this completes. */
export function prepareDriverDocumentPhoto(uri: string, assertCurrent?: () => void) {
  // Decode only one original at a time: eight parallel high-resolution gallery
  // decodes can otherwise exhaust a lower-memory phone during registration.
  const pending = preparationTail.then(() => prepareDriverPhoto(uri, nativePhotoDependencies, { assertCurrent }));
  preparationTail = pending.then(() => undefined, () => undefined);
  return pending;
}
