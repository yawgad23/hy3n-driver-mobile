import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createDriverRequestAudio } from '../lib/driver-request-audio';
import { INCOMING_TRIP_ALERT_PLAYBACK, INCOMING_TRIP_NOTIFICATION } from '../lib/incoming-trip-alert';

const root = path.join(__dirname, '..');
const baseline = 'fb9d29c9099e3561039bfbce5ab756b981e50730';
const feature = 'ddc51e85fd38bac97b416103678aa4eaaf61b9a6';
const assetPath = 'assets/audio/incoming-trip-alert.wav';
const assetRequirePath = '@/assets/audio/incoming-trip-alert.wav';
const approvedMasterSha256 = '1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240';
const current = (file: string) => fs.readFileSync(path.join(root, file));
const previous = (file: string) => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const featureSource = (file: string) => execFileSync('git', ['show', `${feature}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });

// RIFF chunks may include metadata and odd-byte padding. Never assume data
// begins at byte 44 (the approved master has a LIST chunk before its data).
function parseWave(bytes: Buffer) {
  assert.ok(bytes.length >= 12, 'complete RIFF header required');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  const end = bytes.readUInt32LE(4) + 8;
  assert.equal(end, bytes.length, 'RIFF size must match the complete file');
  const chunks: Array<{ id: string; payload: Buffer }> = [];
  for (let offset = 12; offset < end;) {
    assert.ok(offset + 8 <= end, 'complete chunk header required');
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const next = payloadStart + size + (size % 2);
    assert.ok(next <= end, 'chunk payload and padding must fit the RIFF container');
    chunks.push({ id, payload: bytes.subarray(payloadStart, payloadStart + size) });
    offset = next;
  }
  const formats = chunks.filter(chunk => chunk.id === 'fmt ');
  const dataChunks = chunks.filter(chunk => chunk.id === 'data');
  assert.equal(formats.length, 1, 'one format chunk required');
  assert.equal(dataChunks.length, 1, 'one PCM data chunk required');
  const fmt = formats[0].payload;
  assert.ok(fmt.length >= 16, 'complete PCM format required');
  return {
    chunks, data: dataChunks[0].payload,
    format: fmt.readUInt16LE(0), channels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4), byteRate: fmt.readUInt32LE(8),
    blockAlign: fmt.readUInt16LE(12), bitsPerSample: fmt.readUInt16LE(14),
  };
}
function pcmLevels(data: Buffer) {
  assert.equal(data.length % 2, 0, '16-bit samples must be complete');
  let peak = 0; let squares = 0; let nonzero = 0; let clipped = 0;
  for (let offset = 0; offset < data.length; offset += 2) {
    const sample = data.readInt16LE(offset);
    peak = Math.max(peak, Math.abs(sample));
    squares += sample * sample;
    if (sample !== 0) nonzero++;
    if (sample === -32768 || sample === 32767) clipped++;
  }
  const samples = data.length / 2;
  return { samples, nonzero, clipped, peak: peak / 32768, rms: Math.sqrt(squares / samples) / 32768 };
}

test('Gold Chime bundled WAV is the exact selected louder master, not a replacement track', () => {
  assert.equal(createHash('sha256').update(current(assetPath)).digest('hex'), approvedMasterSha256);
  assert.equal(createHash('sha256').update(featureSource(assetPath)).digest('hex'), approvedMasterSha256);
});

test('Gold Chime RIFF/WAVE is PCM1 s16le mono 44100Hz, with exactly eight seconds of data', () => {
  const wave = parseWave(current(assetPath));
  assert.equal(wave.format, 1); assert.equal(wave.channels, 1); assert.equal(wave.bitsPerSample, 16);
  assert.equal(wave.sampleRate, 44100); assert.equal(wave.byteRate, 88200); assert.equal(wave.blockAlign, 2);
  assert.equal(wave.data.length, 8 * wave.sampleRate * wave.blockAlign);
  assert.equal(wave.data.length / wave.byteRate, 8);
  assert.ok(wave.chunks.some(chunk => chunk.id === 'LIST'), 'master metadata must not be interpreted as PCM');
});

test('RIFF parser honors unknown odd-sized padded chunks and rejects malformed/truncated containers', () => {
  const bytes = current(assetPath);
  const oddChunk = Buffer.alloc(12);
  oddChunk.write('JUNK', 0, 'ascii'); oddChunk.writeUInt32LE(3, 4); oddChunk.write('abc', 8, 'ascii');
  const padded = Buffer.concat([bytes.subarray(0, 12), oddChunk, bytes.subarray(12)]);
  padded.writeUInt32LE(padded.length - 8, 4);
  assert.deepEqual(parseWave(padded).data, parseWave(bytes).data);
  assert.throws(() => parseWave(bytes.subarray(0, bytes.length - 1)), /RIFF size/);
  const invalidChunk = Buffer.from(bytes);
  invalidChunk.writeUInt32LE(bytes.length, 16);
  assert.throws(() => parseWave(invalidChunk), /chunk payload/);
  assert.throws(() => parseWave(Buffer.alloc(11)), /complete RIFF/);
});

test('Gold Chime has audible non-silent PCM content with a -1dBFS sample ceiling and no clipped samples', () => {
  const levels = pcmLevels(parseWave(current(assetPath)).data);
  assert.equal(levels.samples, 352800);
  assert.equal(levels.clipped, 0);
  // One 16-bit quantization step of tolerance; this tests sample, not true, peak.
  assert.ok(levels.peak <= Math.pow(10, -1 / 20) + 1 / 32768, 'sample peak must stay at or below -1dBFS');
  assert.ok(levels.peak > Math.pow(10, -6 / 20), 'chosen chime must have a substantial audible peak');
  assert.ok(levels.nonzero > levels.samples * 0.9, 'not a silent or almost-empty asset');
  assert.ok(levels.rms > Math.pow(10, -30 / 20), 'meaningful non-silent PCM energy required');
  assert.ok(Math.abs(20 * Math.log10(levels.rms) - (-15.4042243903)) < 0.02, 'approved mono master RMS must remain stable');
});

test('Gold Chime playback is normalized volume 1, still looping, with default background notification sound', () => {
  assert.deepEqual(INCOMING_TRIP_ALERT_PLAYBACK, { loop: true, volume: 1 });
  assert.ok(INCOMING_TRIP_ALERT_PLAYBACK.volume >= 0 && INCOMING_TRIP_ALERT_PLAYBACK.volume <= 1);
  assert.deepEqual(INCOMING_TRIP_NOTIFICATION, { sound: 'default' });
});

test('incoming-trip-alert production diff is ONLY the exact approved volume literal', () => {
  const before = previous('lib/incoming-trip-alert.ts').toString('utf8');
  const oldVolume = '  volume: 0.92,\n';
  assert.equal(before.split(oldVolume).length - 1, 1, 'baseline volume must occur exactly once');
  assert.equal(featureSource('lib/incoming-trip-alert.ts').toString('utf8'), before.replace(oldVolume, '  volume: 1.0,\n'));
  assert.equal(current('lib/incoming-trip-alert.ts').toString('utf8'), before.replace(oldVolume, '  volume: 1.0,\n'));
});

function homeExpression(name: string) {
  const source = current('app/(tabs)/home.tsx').toString('utf8');
  const tree = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(expression, `actual Home ${name} initializer must exist`);
  return expression.getText(tree);
}
function evaluate(code: string, env: Record<string, any>) {
  const js = ts.transpileModule(`const value = ${code};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('env', `with (env) { ${js}; return value; }`)(env);
}

test('actual Android Home native factory loads the same existing WAV path and unchanged session options', async () => {
  const calls: Array<{ asset: string; options: any }> = [];
  const p = { isLoaded: true, playing: false, muted: true, volume: 0, loop: false,
    pause() { this.playing = false; }, play() { this.playing = true; }, seekTo: async () => {},
    addListener: () => ({ remove() {} }), remove() {}, release() { this.playing = false; } };
  const env = {
    Platform: { OS: 'android' }, useRef: (value: any) => ({ current: value }), createDriverRequestAudio,
    require(asset: string) { assert.equal(asset, assetRequirePath); return asset; },
    createAudioPlayer(asset: string, options: any) { calls.push({ asset, options }); return p; },
    useAudioPlayer(asset: unknown, options: any) {
      assert.equal(asset, null, 'native empty hook must remain source-less');
      assert.deepEqual(options, { keepAudioSessionActive: false }); return p;
    },
  };
  const hookPlayer = evaluate(homeExpression('incomingTripAlertPlayer'), env);
  const runtime = evaluate(homeExpression('incomingTripAudioRuntimeRef'), env).current as ReturnType<typeof createDriverRequestAudio>;
  assert.equal(await runtime.play('gold-chime-offer', hookPlayer, async () => {}), true);
  assert.deepEqual(calls, [{ asset: assetRequirePath, options: { keepAudioSessionActive: false } }]);
  assert.equal(p.volume, 1); assert.equal(p.loop, true); assert.equal(p.muted, false);
  runtime.stop(hookPlayer, { force: true });
  assert.equal(p.playing, false); assert.equal(p.loop, false); assert.equal(p.muted, true); assert.equal(p.volume, 0);
});

test('immutable Gold Chime feature changes exactly its approved asset, volume, test and documentation paths', () => {
  const allowed = new Set([
    assetPath, 'lib/incoming-trip-alert.ts', 'docs/driver-gold-chime-20261127.md',
    'tests/driver-android-datastore-16kb.test.ts', 'tests/driver-android-release-metadata.test.ts',
    'tests/driver-gold-chime.test.ts', 'tests/driver-request-audio-home-lifecycle.test.ts',
    'tests/driver-request-audio-native-retirement.test.ts', 'tests/driver-request-audio-runtime.test.ts',
    'tests/driver-request-audio-start-boundary.test.ts',
  ]);
  const changed = execFileSync('git', ['diff', '--name-only', baseline, feature, '--'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(new Set(changed.split('\n').filter(Boolean)), allowed);
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', baseline], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    if (allowed.has(file)) continue;
    assert.deepEqual(featureSource(file), previous(file), `${file} must remain byte-exact in the immutable Gold Chime feature`);
  }
  // Current release-source preservation, including every historical test/doc,
  // is separately enforced against this feature by the exact 57028 path guard.
});
