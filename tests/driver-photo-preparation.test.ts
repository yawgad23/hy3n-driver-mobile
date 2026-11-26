import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDriverDocumentUploadError,
  prepareDriverPhoto,
  type DriverPhotoDependencies,
} from '../lib/driver-photo-preparation';

const MAX_BYTES = 8 * 1024 * 1024;
const SOURCE = 'file:///private/driver-uid-source.heic?token=private-source-token';
const PRIVATE_ERROR = 'Firebase uid=private-uid token=private-token raw-server-secret';
type EncodeOptions = Parameters<DriverPhotoDependencies['encodeJpeg']>[1];

function fixture(options: {
  source?: string;
  dimensions?: { width: number; height: number };
  sizes?: number[];
  mime?: string;
} = {}) {
  const source = options.source ?? SOURCE;
  const events: string[] = [];
  const encodings: Array<{ uri: string; options: EncodeOptions }> = [];
  const cleaned: string[] = [];
  let blobIndex = 0;
  const deps: DriverPhotoDependencies = {
    async getDimensions(uri) {
      events.push('dimensions');
      assert.equal(uri, source);
      return options.dimensions ?? { width: 4000, height: 3000 };
    },
    async encodeJpeg(uri, encodeOptions) {
      events.push('encode');
      encodings.push({ uri, options: encodeOptions });
      return { uri: `file:///temporary/jpeg-${encodings.length}.jpg` };
    },
    async readBlob(uri) {
      events.push('read');
      assert.notEqual(uri, source);
      const size = options.sizes?.[blobIndex++] ?? 123;
      return new Blob([new Uint8Array(size)], { type: options.mime ?? 'image/jpeg' });
    },
    async cleanup(uri) {
      events.push('cleanup');
      assert.notEqual(uri, source, 'The caller source must never be deleted');
      cleaned.push(uri);
    },
  };
  return { source, deps, events, encodings, cleaned };
}

function safePreparationError(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'We couldn’t prepare this photo. Please select a clear photo and try again.');
  for (const secret of [SOURCE, 'private-uid', 'private-token', 'raw-server-secret', 'Firebase']) {
    assert.ok(!String(error).includes(secret));
  }
  assert.equal((error as Error & { cause?: unknown }).cause, undefined);
  return true;
}

for (const [name, dimensions, resize] of [
  ['landscape', { width: 6000, height: 4000 }, { width: 2400 }],
  ['portrait', { width: 4000, height: 6000 }, { height: 2400 }],
  ['square', { width: 4000, height: 4000 }, { width: 2400 }],
] as const) {
  test(`automatically downsizes high-resolution ${name}, preserving aspect ratio`, async () => {
    const f = fixture({ dimensions });
    const result = await prepareDriverPhoto(f.source, f.deps);
    assert.deepEqual(f.encodings, [{ uri: f.source, options: { resize, compress: 0.9 } }]);
    // Exactly one target dimension leaves the other proportional in the adapter.
    assert.equal(Object.keys(f.encodings[0].options.resize!).length, 1);
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(result.blob.size, 123);
    assert.deepEqual(f.cleaned, []);
    await result.dispose();
  });
}

for (const dimensions of [{ width: 1200, height: 800 }, { width: 2400, height: 1600 }, { width: 1, height: 1 }]) {
  test(`never upscales a ${dimensions.width}x${dimensions.height} source, but still encodes`, async () => {
    const f = fixture({ dimensions });
    const result = await prepareDriverPhoto(f.source, f.deps);
    assert.deepEqual(f.encodings[0].options, { compress: 0.9 });
    await result.dispose();
  });
}

for (const extension of ['heic', 'HEIC', 'png', 'jpeg', 'unknown', '']) {
  test(`always performs real conversion for a small ${extension || 'missing-type'} source`, async () => {
    const f = fixture({ source: `file:///original${extension ? `.${extension}` : ''}`, dimensions: { width: 800, height: 600 } });
    const result = await prepareDriverPhoto(f.source, f.deps);
    assert.equal(f.encodings.length, 1);
    assert.equal(f.encodings[0].uri, f.source);
    assert.notEqual(result.uri, f.source);
    assert.deepEqual(f.events, ['dimensions', 'encode', 'read']);
    await result.dispose();
  });
}

for (const mime of ['', 'application/octet-stream', 'image/jpeg']) {
  test(`converted bytes are declared JPEG when fetched MIME is ${mime || 'empty'}`, async () => {
    const f = fixture({ mime });
    const result = await prepareDriverPhoto(f.source, f.deps);
    assert.equal(result.blob.type, mime);
    assert.equal(result.contentType, 'image/jpeg');
    await result.dispose();
  });
}

test('oversized attempts use exact bounded high-resolution fallbacks and clean promptly', async () => {
  const f = fixture({ sizes: [MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES] });
  const result = await prepareDriverPhoto(f.source, f.deps);
  assert.deepEqual(f.encodings.map(({ options }) => options), [
    { resize: { width: 2400 }, compress: 0.9 },
    { resize: { width: 2200 }, compress: 0.85 },
    { resize: { width: 2000 }, compress: 0.8 },
    { resize: { width: 1800 }, compress: 0.75 },
  ]);
  assert.ok(f.encodings.every(({ uri }) => uri === f.source), 'Retry from the original, not a lossy previous attempt');
  assert.deepEqual(f.events, [
    'dimensions', 'encode', 'read', 'cleanup', 'encode', 'read', 'cleanup',
    'encode', 'read', 'cleanup', 'encode', 'read',
  ]);
  assert.equal(result.blob.size, MAX_BYTES);
  assert.equal(f.cleaned.length, 3);
  await result.dispose();
  assert.equal(f.cleaned.length, 4);
});

test('portrait fallback uses proportional height-only resizing and never thumbnail dimensions', async () => {
  const f = fixture({ dimensions: { width: 3000, height: 5000 }, sizes: [MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES + 1, 1] });
  const result = await prepareDriverPhoto(f.source, f.deps);
  assert.deepEqual(f.encodings.map(({ options }) => options.resize), [
    { height: 2400 }, { height: 2200 }, { height: 2000 }, { height: 1800 },
  ]);
  await result.dispose();
});

test('fallback never upscales sources smaller than each limit', async () => {
  const f = fixture({ dimensions: { width: 2100, height: 1400 }, sizes: [MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES + 1, 1] });
  const result = await prepareDriverPhoto(f.source, f.deps);
  assert.deepEqual(f.encodings.map(({ options }) => options), [
    { compress: 0.9 }, { compress: 0.85 },
    { resize: { width: 2000 }, compress: 0.8 },
    { resize: { width: 1800 }, compress: 0.75 },
  ]);
  await result.dispose();
});

test('exhaustion rejects after exactly four attempts and cleans all generated files', async () => {
  const f = fixture({ sizes: Array(4).fill(MAX_BYTES + 1) });
  await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
  assert.equal(f.encodings.length, 4);
  assert.equal(f.cleaned.length, 4);
  assert.equal(f.events.at(-1), 'cleanup');
});

for (const size of [1, MAX_BYTES]) {
  test(`accepts positive actual blob byte size ${size}`, async () => {
    const f = fixture({ sizes: [size] });
    const result = await prepareDriverPhoto(f.source, f.deps);
    assert.equal(result.blob.size, size);
    assert.equal(f.encodings.length, 1);
    await result.dispose();
  });
}

for (const size of [0, -1, NaN, Infinity, 1.5, undefined]) {
  test(`rejects invalid blob size ${String(size)} and cleans the generated file`, async () => {
    const f = fixture();
    f.deps.readBlob = async () => size === 0 ? new Blob([]) : ({ size } as Blob);
    await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
    assert.equal(f.encodings.length, 1);
    assert.deepEqual(f.cleaned, ['file:///temporary/jpeg-1.jpg']);
  });
}

for (const stage of ['getDimensions', 'encodeJpeg', 'readBlob'] as const) {
  test(`${stage} failures return only a safe error and clean only generated output`, async () => {
    const f = fixture();
    f.deps[stage] = async () => { throw new Error(`${PRIVATE_ERROR} ${f.source}`); };
    await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
    assert.equal(f.cleaned.length, stage === 'readBlob' ? 1 : 0);
    assert.ok(!f.cleaned.includes(f.source));
  });
}

test('synchronous provider throws are sanitized too', async () => {
  const f = fixture();
  f.deps.encodeJpeg = () => { throw new Error(PRIVATE_ERROR); };
  await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
  assert.deepEqual(f.cleaned, []);
});

for (const dimensions of [
  { width: 0, height: 100 }, { width: 100, height: -1 },
  { width: NaN, height: 100 }, { width: 100, height: Infinity },
  undefined, null,
]) {
  test(`rejects invalid dimensions ${JSON.stringify(dimensions)} without encoding`, async () => {
    const f = fixture();
    f.deps.getDimensions = async () => dimensions as { width: number; height: number };
    await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
    assert.deepEqual(f.encodings, []);
    assert.deepEqual(f.cleaned, []);
  });
}

for (const output of [SOURCE, '', '   ', undefined, null]) {
  test(`rejects unsafe encoder output ${String(output)} without reading or deleting the source`, async () => {
    const f = fixture();
    f.deps.encodeJpeg = async () => output == null ? output as never : { uri: output };
    await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
    assert.ok(!f.events.includes('read'));
    assert.deepEqual(f.cleaned, []);
  });
}

test('empty caller URI fails safely before any dependency operation', async () => {
  const f = fixture();
  await assert.rejects(prepareDriverPhoto('', f.deps), safePreparationError);
  assert.deepEqual(f.events, []);
});

// The initial assertion plus before/after each dependency await. Throwing at
// each checkpoint must preserve error identity and stop all non-cleanup work.
for (const [checkpoint, expectedEvents] of [
  [1, []],
  [2, []],
  [3, ['dimensions']],
  [4, ['dimensions']],
  [5, ['dimensions', 'encode', 'cleanup']],
  [6, ['dimensions', 'encode', 'cleanup']],
  [7, ['dimensions', 'encode', 'read', 'cleanup']],
] as const) {
  test(`cancellation at async checkpoint ${checkpoint} propagates unchanged and stops further stages`, async () => {
    const f = fixture();
    const cancellation = new Error('account changed: private-user');
    let calls = 0;
    await assert.rejects(prepareDriverPhoto(f.source, f.deps, {
      assertCurrent() { if (++calls === checkpoint) throw cancellation; },
    }), (error) => error === cancellation);
    assert.deepEqual(f.events, expectedEvents);
    assert.ok(!f.cleaned.includes(f.source));
  });
}

for (const stage of ['getDimensions', 'encodeJpeg', 'readBlob'] as const) {
  test(`account changes during rejected ${stage} work are not disguised as preparation failures`, async () => {
    const f = fixture();
    const cancellation = new Error('account changed');
    let cancelled = false;
    f.deps[stage] = async () => {
      cancelled = true;
      throw new Error(PRIVATE_ERROR);
    };
    await assert.rejects(prepareDriverPhoto(f.source, f.deps, {
      assertCurrent() { if (cancelled) throw cancellation; },
    }), (error) => error === cancellation);
    assert.equal(f.cleaned.length, stage === 'readBlob' ? 1 : 0);
  });
}

test('cancellation after encoding cleans returned JPEG even if cleanup fails', async () => {
  const f = fixture();
  const cancellation = Object.freeze({ reason: 'account-changed' });
  let cancelled = false;
  f.deps.encodeJpeg = async () => {
    cancelled = true;
    return { uri: 'file:///cancelled-output.jpg' };
  };
  f.deps.cleanup = async (uri) => {
    f.cleaned.push(uri);
    throw new Error(PRIVATE_ERROR);
  };
  await assert.rejects(prepareDriverPhoto(f.source, f.deps, {
    assertCurrent() { if (cancelled) throw cancellation; },
  }), (error) => error === cancellation);
  assert.deepEqual(f.cleaned, ['file:///cancelled-output.jpg']);
  assert.ok(!f.events.includes('read'));
});

test('account change during discarded-attempt cleanup stops the next encode', async () => {
  const f = fixture({ sizes: [MAX_BYTES + 1, 1] });
  const cancellation = new Error('account changed');
  let cancelled = false;
  f.deps.cleanup = async (uri) => {
    assert.notEqual(uri, f.source);
    f.cleaned.push(uri);
    cancelled = true;
  };
  await assert.rejects(prepareDriverPhoto(f.source, f.deps, {
    assertCurrent() { if (cancelled) throw cancellation; },
  }), (error) => error === cancellation);
  assert.equal(f.encodings.length, 1);
  assert.equal(f.cleaned.length, 1);
});

test('accepted JPEG cleanup is deferred to idempotent concurrent dispose', async () => {
  const f = fixture();
  const result = await prepareDriverPhoto(f.source, f.deps);
  assert.equal(f.cleaned.length, 0);
  const first = result.dispose();
  const second = result.dispose();
  assert.equal(first, second);
  await Promise.all([first, second, result.dispose()]);
  assert.deepEqual(f.cleaned, [result.uri]);
  assert.ok(!f.cleaned.includes(f.source));
});

test('dispose still works after cancellation and swallows cleanup failure', async () => {
  const f = fixture();
  let cancelled = false;
  const result = await prepareDriverPhoto(f.source, f.deps, {
    assertCurrent() { if (cancelled) throw new Error('account changed'); },
  });
  f.deps.cleanup = async (uri) => {
    f.cleaned.push(uri);
    throw new Error(PRIVATE_ERROR);
  };
  cancelled = true;
  await Promise.all([result.dispose(), result.dispose()]);
  assert.deepEqual(f.cleaned, [result.uri]);
});

test('discard cleanup failure does not prevent successful fallback or change metadata', async () => {
  const f = fixture({ sizes: [MAX_BYTES + 1, 123] });
  f.deps.cleanup = async (uri) => {
    f.cleaned.push(uri);
    throw new Error(PRIVATE_ERROR);
  };
  const result = await prepareDriverPhoto(f.source, f.deps);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(f.encodings.length, 2);
  await result.dispose();
  assert.equal(f.cleaned.length, 2);
});

test('read and cleanup failure together still return a safe preparation error', async () => {
  const f = fixture();
  f.deps.readBlob = async () => { throw new Error(PRIVATE_ERROR); };
  f.deps.cleanup = async (uri) => {
    f.cleaned.push(uri);
    throw new Error('cleanup raw-secret');
  };
  await assert.rejects(prepareDriverPhoto(f.source, f.deps), safePreparationError);
  assert.equal(f.cleaned.length, 1);
});

for (const stage of ['prepare', 'upload', 'confirm'] as const) {
  test(`${stage} friendly error is slot-specific and never interpolates raw provider or identity data`, () => {
    const message = formatDriverDocumentUploadError({
      code: 'storage/unknown',
      message: `${PRIVATE_ERROR} ${SOURCE}`,
      serverResponse: 'private-server-response',
      uid: 'private-uid',
    }, 'Driver license (front)', stage);
    assert.ok(message.includes('Driver license (front)'));
    for (const secret of ['Firebase', 'private-', SOURCE, 'storage/', 'serverResponse', 'uid=']) {
      assert.ok(!message.includes(secret), message);
    }
    if (stage === 'prepare') assert.ok(message.includes('select a clear photo'));
    if (stage === 'confirm') assert.ok(message.includes('confirm the upload'));
  });
}

for (const code of ['storage/unauthorized', 'storage/unauthenticated', 'auth/user-token-expired', 'permission-denied', 'UNAUTHORIZED', 'invalid_token']) {
  test(`auth error ${code} gives secure-upload retry/sign-in guidance`, () => {
    for (const stage of ['upload', 'confirm'] as const) {
      const message = formatDriverDocumentUploadError({ code, message: PRIVATE_ERROR }, 'Vehicle registration', stage);
      assert.ok(message.includes('couldn’t securely upload Vehicle registration'));
      assert.ok(message.includes('retry'));
      assert.ok(message.includes('sign out and sign in again'));
      assert.ok(!message.includes(code));
      assert.ok(!message.includes('private-'));
    }
  });
}

for (const error of [
  { code: 'storage/retry-limit-exceeded' },
  new Error(`Network request failed ${PRIVATE_ERROR}`),
  { code: 'unavailable' },
  'connection timed out private-token',
  { message: 'Failed to fetch' },
]) {
  test(`connection error ${typeof error === 'object' ? String((error as { code?: string }).code ?? 'network') : 'string'} keeps selections and encourages retry`, () => {
    for (const stage of ['upload', 'confirm'] as const) {
      const message = formatDriverDocumentUploadError(error, 'Insurance certificate', stage);
      assert.ok(message.includes('Insurance certificate'));
      assert.ok(message.includes('connection was interrupted'));
      assert.ok(message.includes('retry; your selected photos are retained'));
      assert.ok(!message.includes('private-'));
    }
  });
}

test('preparation errors are generic even for auth/network failures', () => {
  const ordinary = formatDriverDocumentUploadError(new Error(PRIVATE_ERROR), 'Profile photo', 'prepare');
  assert.equal(formatDriverDocumentUploadError({ code: 'auth/invalid-user-token' }, 'Profile photo', 'prepare'), ordinary);
  assert.equal(formatDriverDocumentUploadError({ code: 'network-request-failed' }, 'Profile photo', 'prepare'), ordinary);
  assert.ok(!ordinary.includes('sign in'));
});

for (const label of [SOURCE, 'Driver license uid-private-123', 'Alice Smith', 'Firebase token secret', 'Driver license\nprivate-token', '']) {
  test(`does not leak untrusted label ${JSON.stringify(label)}`, () => {
    const message = formatDriverDocumentUploadError(new Error(PRIVATE_ERROR), label, 'upload');
    assert.ok(message.includes('this document'));
    assert.ok(!message.includes('private-'));
    assert.ok(!message.includes('Alice'));
    assert.ok(!message.includes('Firebase'));
    if (label) assert.ok(!message.includes(label));
  });
}

test('unknown, null, primitive, and throwing-getter errors produce safe friendly messages', () => {
  const throwingGetters = Object.defineProperties({}, {
    code: { get() { throw new Error(PRIVATE_ERROR); } },
    message: { get() { throw new Error(PRIVATE_ERROR); } },
  });
  for (const error of [null, undefined, 42, Symbol('private-token'), throwingGetters]) {
    assert.equal(
      formatDriverDocumentUploadError(error, 'Vehicle registration', 'upload'),
      'We couldn’t upload Vehicle registration. Please retry; your selected photos are retained.',
    );
  }
});
