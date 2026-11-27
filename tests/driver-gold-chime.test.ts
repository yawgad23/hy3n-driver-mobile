import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { INCOMING_TRIP_ALERT_PLAYBACK, INCOMING_TRIP_NOTIFICATION } from '../lib/incoming-trip-alert';

const root = path.join(__dirname, '..');
const baseline = 'afaecc548b9e1f2c51b71f9788a331c5207b60a6';
const build132 = 'cc722a6f16b9c9b17be4752a7e8cd2ed0c44061c';
const assetPath = 'assets/audio/incoming-trip-alert.wav';
const selectedMasterSHA256 = '1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240';
const historicalAssetSHA256 = 'ac1d846ffa152b25729cc97c30144d42219264afd68c642604f71a76dded0886';
const current = (file: string) => fs.readFileSync(path.join(root, file));
const historical = (revision: string, file: string) => execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// RIFF is a chunk container, not a fixed 44-byte WAV header. The approved
// master includes a LIST chunk and its PCM data begins at byte 78.
function parseWave(bytes: Buffer) {
  assert.ok(bytes.length >= 12, 'complete RIFF/WAVE header required');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  const limit = bytes.readUInt32LE(4) + 8;
  assert.equal(limit, bytes.length, 'RIFF size must match complete file');
  const chunks: Array<{ id: string; data: Buffer; offset: number }> = [];
  let offset = 12;
  while (offset < limit) {
    assert.ok(offset + 8 <= limit, 'complete chunk header required');
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    assert.ok(end <= limit, `chunk ${id} payload must be bounded`);
    const next = end + size % 2;
    assert.ok(next <= limit, `chunk ${id} requires its RIFF word padding`);
    chunks.push({ id, data: bytes.subarray(start, end), offset: start });
    offset = next;
  }
  assert.equal(offset, limit);
  const formats = chunks.filter(chunk => chunk.id === 'fmt ');
  const payloads = chunks.filter(chunk => chunk.id === 'data');
  assert.equal(formats.length, 1, 'exactly one PCM format chunk required');
  assert.equal(payloads.length, 1, 'exactly one PCM data chunk required');
  const format = formats[0].data;
  assert.ok(format.length >= 16, 'complete PCM format required');
  return {
    encoding: format.readUInt16LE(0), channels: format.readUInt16LE(2),
    sampleRate: format.readUInt32LE(4), byteRate: format.readUInt32LE(8),
    blockAlign: format.readUInt16LE(12), bitsPerSample: format.readUInt16LE(14),
    pcm: payloads[0].data, dataOffset: payloads[0].offset, chunks,
  };
}

function chunk(id: string, data: Buffer) {
  const header = Buffer.alloc(8); header.write(id, 0, 'ascii'); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
}
function riff(chunks: Buffer[]) {
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
  const header = Buffer.alloc(8); header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const approved = current(assetPath);

test('current request WAV is the exact selected, preprocessed louder Gold Chime master', () => {
  // Never derive the expected digest from the current file or a mutable preview.
  assert.equal(sha256(approved), selectedMasterSHA256);
});

test('Gold Chime RIFF chunks describe PCM 1, signed 16-bit mono 44100 Hz for exactly eight seconds', () => {
  const wave = parseWave(approved);
  assert.equal(wave.encoding, 1);
  assert.equal(wave.channels, 1);
  assert.equal(wave.bitsPerSample, 16);
  assert.equal(wave.sampleRate, 44100);
  assert.equal(wave.blockAlign, wave.channels * wave.bitsPerSample / 8);
  assert.equal(wave.byteRate, wave.sampleRate * wave.blockAlign);
  assert.equal(wave.pcm.length % wave.blockAlign, 0);
  assert.equal(wave.pcm.length / wave.byteRate, 8);
  assert.equal(wave.pcm.length / wave.blockAlign, 352800);
  assert.ok(wave.dataOffset + wave.pcm.length <= approved.length);
  assert.ok(wave.chunks.some(item => item.id === 'LIST'), 'master metadata is preserved');
  assert.notEqual(wave.dataOffset, 44, 'do not assume PCM begins at a fixed WAV header offset');
});

test('RIFF parser handles unknown odd-length padded chunks before and after the PCM payload', () => {
  const expected = parseWave(approved);
  const format = expected.chunks.find(item => item.id === 'fmt ')!.data;
  const reordered = riff([
    chunk('JUNK', Buffer.from([1, 2, 3])), chunk('fmt ', format),
    chunk('LIST', Buffer.from([5])), chunk('data', expected.pcm), chunk('JUNK', Buffer.from([7])),
  ]);
  const parsed = parseWave(reordered);
  assert.deepEqual(parsed.pcm, expected.pcm);
  assert.equal(parsed.sampleRate, 44100);
  assert.deepEqual(parsed.chunks.map(item => item.id), ['JUNK', 'fmt ', 'LIST', 'data', 'JUNK']);
  assert.notEqual(parsed.dataOffset, expected.dataOffset);
});

test('RIFF parser rejects truncated headers, out-of-bounds payloads, and missing word padding', () => {
  assert.throws(() => parseWave(approved.subarray(0, 11)));
  assert.throws(() => parseWave(approved.subarray(0, approved.length - 1)));
  const oversized = Buffer.from(approved);
  oversized.writeUInt32LE(approved.length, parseWave(approved).dataOffset - 4);
  assert.throws(() => parseWave(oversized), /payload must be bounded/);
  const partialHeader = riff([Buffer.from('JUNK')]);
  assert.throws(() => parseWave(partialHeader), /complete chunk header/);
  const missingPad = riff([chunk('JUNK', Buffer.from([1])).subarray(0, 9)]);
  assert.throws(() => parseWave(missingPad), /word padding/);
});

test('Gold Chime contains audible bounded PCM, no clipped samples, and a sample peak below -1 dBFS', () => {
  const { pcm, sampleRate } = parseWave(approved);
  let peak = 0, energy = 0, sum = 0, nonzero = 0, clipped = 0;
  const secondsEnergy = new Array<number>(8).fill(0);
  const count = pcm.length / 2;
  for (let i = 0; i < count; i++) {
    const signed = pcm.readInt16LE(i * 2);
    const sample = signed / 32768;
    assert.ok(Number.isFinite(sample) && sample >= -1 && sample < 1);
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample; sum += sample;
    secondsEnergy[Math.floor(i / sampleRate)] += sample * sample;
    if (signed !== 0) nonzero++;
    if (signed === -32768 || signed === 32767) clipped++;
  }
  const rms = Math.sqrt(energy / count);
  const rmsDbFS = 20 * Math.log10(rms);
  const peakDbFS = 20 * Math.log10(peak);
  assert.ok(peak > 0.1, 'nonzero musical signal, not a silent WAV');
  assert.ok(peakDbFS <= -1 + 0.01, `sample peak ${peakDbFS} exceeds the -1 dBFS ceiling (0.01 dB tolerance)`);
  assert.equal(clipped, 0);
  assert.ok(nonzero / count > 0.9, 'substantial audible content throughout the approved sample');
  assert.ok(Math.abs(rmsDbFS - (-15.404224390299746)) < 0.02, `unexpected RMS ${rmsDbFS}`);
  assert.ok(Math.abs(sum / count) < 0.01, 'not a DC-only signal');
  for (const [second, value] of secondsEnergy.entries()) {
    assert.ok(Math.sqrt(value / sampleRate) > 0.005, `second ${second + 1} must contain audible chime content`);
  }
});

test('selected foreground volume is 1.0 in native range; only that exact setting differs from baseline', () => {
  assert.deepEqual(INCOMING_TRIP_ALERT_PLAYBACK, { loop: true, volume: 1.0 });
  assert.ok(INCOMING_TRIP_ALERT_PLAYBACK.volume >= 0 && INCOMING_TRIP_ALERT_PLAYBACK.volume <= 1);
  assert.deepEqual(INCOMING_TRIP_NOTIFICATION, { sound: 'default' });
  const file = 'lib/incoming-trip-alert.ts';
  const oldSource = historical(baseline, file).toString('utf8');
  assert.equal(oldSource.split('  volume: 0.92,').length - 1, 1);
  assert.equal(current(file).toString('utf8'), oldSource.replace('  volume: 0.92,', '  volume: 1.0,'));
});

test('actual Home continues to reference the same bundled asset in its unchanged native player factory', () => {
  const source = current('app/(tabs)/home.tsx').toString('utf8');
  assert.ok(source.includes("createPlayer: () => createAudioPlayer(\n      require('@/assets/audio/incoming-trip-alert.wav'),\n      { keepAudioSessionActive: false },\n    ),"));
  assert.deepEqual(current('app/(tabs)/home.tsx'), historical(baseline, 'app/(tabs)/home.tsx'));
  assert.deepEqual(current('lib/driver-request-audio.ts'), historical(baseline, 'lib/driver-request-audio.ts'));
});

test('Gold Chime leaves native configuration, notifications, registration, approved selfie, auth, and map/camera source byte-exact', () => {
  for (const file of [
    'app.config.ts', 'eas.json', 'package.json', 'pnpm-lock.yaml',
    'plugins/with-driver-ios-sdk27.js', 'plugins/with-google-navigation.js',
    'plugins/driver-navigation-feed-patch.js', 'plugins/driver-navigation-polyline-patch.js',
    'lib/notifications.ts', 'lib/driver-auth-context.tsx', 'lib/firebase.ts',
    'lib/driver-photo-native.ts', 'lib/driver-photo-preparation.ts', 'lib/driver-profile-photo.ts',
    'app/driver/register.tsx', 'app/register.tsx', 'app/(tabs)/profile.tsx', 'hooks/use-auth.ts',
    'components/NativeDriverGoogleMap.tsx', 'lib/driver-map-motion.ts',
    'lib/driver-navigation-camera.ts', 'lib/native-map-camera.ts',
  ]) assert.deepEqual(current(file), historical(baseline, file), `${file}: unrelated production/native change`);
  // All tracked production files are protected, including Home's Call handler,
  // push payloads and prices, not merely the explicitly named examples above.
  const changed = execFileSync('git', ['diff', '--name-only', baseline, '--', '.', ':!tests/**', ':!docs/**'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(changed.trim().split('\n').filter(Boolean).sort(), [assetPath, 'lib/incoming-trip-alert.ts'].sort());
});

test('immutable build 132 release asset audit stays exact; the current selected asset has its separate fixed digest', () => {
  // Historical release metadata must inspect immutable git history, not
  // constrain today's intentionally replaced request sound to an old asset.
  assert.equal(sha256(historical(build132, assetPath)), historicalAssetSHA256);
  assert.equal(sha256(historical(baseline, assetPath)), historicalAssetSHA256);
  assert.equal(sha256(approved), selectedMasterSHA256);
  assert.notEqual(selectedMasterSHA256, historicalAssetSHA256);
});
