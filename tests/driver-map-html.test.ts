import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildDriverMapHtml } from '../lib/driver-map-html';

const exampleHtml = buildDriverMapHtml('#1f2937', 'data:image/png;base64,eA==', 3);

test('the complete Leaflet renderer is bundled locally and both page scripts parse', () => {
  assert.equal(exampleHtml.includes('https://unpkg.com'), false);
  assert.equal(exampleHtml.includes('<link rel="stylesheet"'), false);
  assert.match(exampleHtml, /Leaflet 1\.9\.4/);
  const scripts = [...exampleHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.match(readFileSync(path.join(__dirname, '../components/vendor/leaflet-1.9.4.LICENSE'), 'utf8'), /BSD 2-Clause License/);
});

test('the page waits for Leaflet initialization before reporting ready', () => {
  assert.match(exampleHtml, /if\(typeof L==='undefined'\)throw/);
  assert.match(exampleHtml, /window\.__HY3N_UPDATE__=function/);
  assert.match(exampleHtml, /function announceReady\(\)/);
  assert.match(exampleHtml, /container\.clientWidth<2/);
  assert.match(exampleHtml, /notify\('ready'\)/);
  assert.match(exampleHtml, /notify\('init-error'\)/);
  assert.match(exampleHtml, /generation=3/);
});

test('the page reports tile failure separately from a dead WebView, with a retry source', () => {
  assert.match(exampleHtml, /https:\/\/tile\.openstreetmap\.org/);
  assert.match(exampleHtml, /fallbackTileUrl='https:\/\/tile\.openstreetmap\.fr/);
  assert.match(exampleHtml, /notify\('tiles-unavailable'\)/);
  assert.match(exampleHtml, /notify\('tiles-recovered'\)/);
  assert.match(exampleHtml, /OpenStreetMap contributors/);
});

test('the map theme, current marker and active route remain in the HTML', () => {
  assert.match(exampleHtml, /background:#1f2937/);
  assert.match(exampleHtml, /data:image\/png;base64,eA==/);
  assert.match(exampleHtml, /carMarker\.setLatLng\(current\)/);
  assert.match(exampleHtml, /map\.fitBounds/);
  assert.match(exampleHtml, /map\.invalidateSize/);
  assert.match(exampleHtml, /window\.__HY3N_HEALTH__=function/);
  assert.match(exampleHtml, /window\.__HY3N_LAYOUT__=function/);
  assert.match(exampleHtml, /document\.addEventListener\('visibilitychange'/);
});
