export interface DriverPhotoDependencies {
  getDimensions(uri: string): Promise<{ width: number; height: number }>;
  /** Must write a new file containing actual JPEG bytes, never just rename the source. */
  encodeJpeg(
    uri: string,
    options: { resize?: { width?: number; height?: number }; compress: number },
  ): Promise<{ uri: string }>;
  readBlob(uri: string): Promise<Blob>;
  cleanup(uri: string): Promise<void>;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const JPEG_ATTEMPTS = [
  { longSide: 2400, compress: 0.9 },
  { longSide: 2200, compress: 0.85 },
  { longSide: 2000, compress: 0.8 },
  { longSide: 1800, compress: 0.75 },
] as const;

function preparationError(): Error {
  // Never attach a native/provider error, source URI, or account information.
  return new Error('We couldn’t prepare this photo. Please select a clear photo and try again.');
}

/**
 * Prepare every source through a real JPEG encoder, including already-small JPEGs.
 * The encoder owns conversion; its new-file JPEG contract, not a fetched MIME
 * header, establishes the returned content type. Blob.size is the byte limit.
 */
export async function prepareDriverPhoto(
  uri: string,
  deps: DriverPhotoDependencies,
  options?: { assertCurrent?: () => void },
): Promise<{
  uri: string;
  blob: Blob;
  contentType: 'image/jpeg';
  dispose: () => Promise<void>;
}> {
  const assertCurrent = () => options?.assertCurrent?.();
  const temporaryUris = new Set<string>();

  // Cleanup is unconditional, including after cancellation. It deliberately does
  // not check current account state, and may never delete the caller's source.
  const cleanupTemporary = async (temporaryUri: string): Promise<void> => {
    if (temporaryUri === uri || !temporaryUris.delete(temporaryUri)) return;
    try {
      await deps.cleanup(temporaryUri);
    } catch {
      // A cleanup failure must not replace a preparation/cancellation outcome.
    }
  };

  // Check both successful and rejected asynchronous work. Assertions are outside
  // the provider catch so their original error objects always propagate intact.
  const stage = async <T>(work: () => Promise<T>): Promise<T> => {
    assertCurrent();
    let result: T;
    try {
      result = await work();
    } catch {
      assertCurrent();
      throw preparationError();
    }
    assertCurrent();
    return result;
  };

  try {
    assertCurrent();
    if (typeof uri !== 'string' || !uri.trim()) throw preparationError();

    const dimensions = await stage(() => deps.getDimensions(uri));
    if (
      !dimensions ||
      !Number.isFinite(dimensions.width) ||
      !Number.isFinite(dimensions.height) ||
      dimensions.width <= 0 ||
      dimensions.height <= 0
    ) {
      throw preparationError();
    }

    for (const attempt of JPEG_ATTEMPTS) {
      // Specify only the long-side dimension so the encoder preserves aspect
      // ratio. Re-encode the original for each attempt, without cumulative loss.
      const resize =
        Math.max(dimensions.width, dimensions.height) <= attempt.longSide
          ? undefined
          : dimensions.width >= dimensions.height
            ? { width: attempt.longSide }
            : { height: attempt.longSide };
      const encoded = await stage(async () => {
        const result = await deps.encodeJpeg(uri, {
          ...(resize ? { resize } : {}),
          compress: attempt.compress,
        });
        // Register ownership before the post-await assertion, so cancellation
        // immediately after encoding still cleans the newly generated file.
        if (result && typeof result.uri === 'string' && result.uri.trim() && result.uri !== uri) {
          temporaryUris.add(result.uri);
        }
        return result;
      });
      if (!encoded || typeof encoded.uri !== 'string' || !encoded.uri.trim() || encoded.uri === uri) {
        // Same-source output is an unsafe encoder contract, not a JPEG conversion.
        throw preparationError();
      }

      const blob = await stage(() => deps.readBlob(encoded.uri));
      if (!blob || !Number.isSafeInteger(blob.size) || blob.size <= 0) {
        throw preparationError();
      }
      if (blob.size > MAX_UPLOAD_BYTES) {
        // Release discarded attempts before producing another JPEG. Checks around
        // this await stop further work if the account changes during cleanup.
        await stage(() => cleanupTemporary(encoded.uri));
        continue;
      }

      let disposal: Promise<void> | undefined;
      const acceptedUri = encoded.uri;
      // Transfer this one file's ownership to dispose; finally only cleans failures.
      temporaryUris.delete(acceptedUri);
      return {
        uri: acceptedUri,
        blob,
        contentType: 'image/jpeg' as const,
        dispose: (): Promise<void> => {
          if (!disposal) {
            temporaryUris.add(acceptedUri);
            disposal = cleanupTemporary(acceptedUri);
          }
          return disposal;
        },
      };
    }
    throw preparationError();
  } finally {
    // No assertions here: cancellation must never prevent best-effort cleanup,
    // and cleanup must never override the original cancellation/error object.
    for (const temporaryUri of [...temporaryUris]) await cleanupTemporary(temporaryUri);
  }
}

const DOCUMENT_LABEL_WORDS = new Set([
  'driver', 'drivers', 'driving', 'licence', 'license', 'vehicle', 'registration',
  'insurance', 'certificate', 'policy', 'profile', 'photo', 'photograph', 'selfie',
  'document', 'front', 'back', 'rear', 'side', 'reverse', 'id', 'identity',
  'identification', 'card', 'passport', 'national', 'proof', 'of', 'address',
  'residence', 'permit', 'operator', 'professional', 'work', 'ownership',
  'inspection', 'roadworthiness', 'logbook', 'log', 'book', 'tax', 'disc', 'copy',
  'ghana', 'roadworthy', 'your', 'the', 's',
]);

function safeDocumentLabel(label: string): string {
  if (typeof label !== 'string') return 'this document';
  const trimmed = label.trim();
  const words = trimmed.toLowerCase().match(/[a-z]+/g);
  // Accept document-slot vocabulary only, never arbitrary identity/provider text.
  if (
    !trimmed ||
    trimmed.length > 80 ||
    !/^[a-zA-Z\s'’()-]+$/.test(trimmed) ||
    !words?.length ||
    !words.every((word) => DOCUMENT_LABEL_WORDS.has(word))
  ) {
    return 'this document';
  }
  return trimmed;
}

function errorClassificationText(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 2048).toLowerCase();
  if (!error || typeof error !== 'object') return '';
  // Read only for classification, never interpolate any of these values in UI.
  const values: string[] = [];
  for (const key of ['code', 'name', 'message'] as const) {
    try {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === 'string') values.push(value.slice(0, 2048));
    } catch {
      // Unknown errors may expose getters which themselves throw.
    }
  }
  return values.join(' ').toLowerCase();
}

/** Slot-specific UI text with no raw Firebase, account, URI, or token details. */
export function formatDriverDocumentUploadError(
  error: unknown,
  label: string,
  stage: 'prepare' | 'upload' | 'confirm',
): string {
  const document = safeDocumentLabel(label);
  if (stage === 'prepare') {
    return `We couldn’t prepare ${document}. Please select a clear photo and try again.`;
  }

  const classification = errorClassificationText(error);
  if (
    /unauthori[sz]ed|unauthenticated|auth\/|authentication|authorization|permission[-_/\s]?denied|access[-_/\s]?denied|credential|token[-_/\s]?(?:expired|invalid)|(?:expired|invalid)[-_/\s]?token/.test(classification)
  ) {
    return `We couldn’t securely upload ${document}. Please retry. If this continues, sign out and sign in again.`;
  }
  const action = stage === 'confirm' ? 'confirm the upload for' : 'upload';
  if (
    /network|connection|offline|internet|timeout|timed out|failed to fetch|fetch failed|unavailable|deadline[-_]exceeded|retry[-_]limit[-_]exceeded/.test(classification)
  ) {
    return `We couldn’t ${action} ${document} because the connection was interrupted. Please retry; your selected photos are retained.`;
  }
  return `We couldn’t ${action} ${document}. Please retry; your selected photos are retained.`;
}
