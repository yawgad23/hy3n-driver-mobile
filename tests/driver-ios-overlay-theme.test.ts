import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OVERLAY_RGB,
  buttonColours,
  createTranslucentPalette,
  rgba,
  type ButtonTone,
} from '../lib/driver-ios-overlay-theme';

function colour(value: string): number[] {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  }
  assert.match(value, /^rgba\(/, `Expected hex or RGBA colour: ${value}`);
  const values = value.match(/[\d.]+/g)?.map(Number);
  assert.ok(values && values.length === 4, `Expected RGBA: ${value}`);
  return values;
}

function composite(value: string, backdrop: readonly number[]): number[] {
  const [r, g, b, alpha = 1] = colour(value);
  return [r, g, b].map((channel, index) => channel * alpha + backdrop[index] * (1 - alpha));
}

function luminance(rgb: readonly number[]): number {
  const linear = rgb.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground: string, background: readonly number[]): number {
  const a = luminance(colour(foreground));
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function assertReadable(foreground: string, background: readonly number[], context: string) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 4.5, `${context}: ${foreground} contrast ${ratio.toFixed(2)} must be >= 4.5:1`);
}

// Representative map samples, not a claim about every possible native map pixel.
const backdrops = [[0, 0, 0], [255, 255, 255], [18, 42, 69], [44, 108, 196]] as const;
const tones: ButtonTone[] = ['blue', 'slate', 'danger', 'success', 'gold', 'neutral'];
const buttonTokens = {
  blue: { rgb: [17, 65, 170], alpha: 0.80, color: '#FFFFFF' },
  slate: { rgb: [38, 58, 83], alpha: 0.85, color: '#FFFFFF' },
  danger: { rgb: [159, 25, 42], alpha: 0.85, color: '#FFFFFF' },
  success: { rgb: [7, 97, 63], alpha: 0.85, color: '#FFFFFF' },
  gold: { rgb: [209, 163, 56], alpha: 0.90, color: '#07111D' },
} as const;

for (const scheme of ['dark', 'light'] as const) {
  for (const reduced of [false, true]) {
    const palette = createTranslucentPalette(scheme, reduced);
    const label = `${scheme}, Reduce Transparency=${reduced}`;

    test(`${label}: exact integrated fill and solid foreground tokens`, () => {
      const dark = scheme === 'dark';
      assert.equal(palette.scheme, scheme);
      assert.equal(palette.reduceTransparency, reduced);
      assert.equal(palette.banner, `rgba(6, 23, 42, ${reduced ? 1 : dark ? 0.70 : 0.90})`);
      assert.equal(palette.panel, dark
        ? `rgba(6, 23, 42, ${reduced ? 1 : 0.70})`
        : `rgba(255, 255, 255, ${reduced ? 1 : 0.94})`);
      assert.equal(palette.foreground, dark ? '#FFFFFF' : '#0B1726');
      assert.equal(palette.secondary, dark ? '#E2E8F0' : '#334155');
      assert.equal(palette.bannerForeground, '#FFFFFF');
      assert.equal(palette.bannerSecondary, '#E2E8F0');
      assert.equal(palette.metric, '#88F2C3');
      assert.equal(palette.border, dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 23, 42, 0.22)');
      assert.equal(palette.focus, dark ? '#F5CE71' : '#075985');
      assert.equal(palette.dot, dark ? '#4ADE80' : '#087B4C');
      assert.equal(palette.tabBar, dark ? '#07111D' : '#FFFFFF');
      assert.equal(palette.disabled, dark ? '#334155' : '#DEE5F0');
      assert.equal(palette.disabledForeground, dark ? '#E2E8F0' : '#334155');
      for (const tone of tones) {
        const expected: { backgroundColor: string; color: string } = tone === 'neutral'
          ? { backgroundColor: palette.panel, color: palette.foreground }
          : {
            backgroundColor: `rgba(${buttonTokens[tone].rgb.join(', ')}, ${reduced ? 1 : buttonTokens[tone].alpha})`,
            color: buttonTokens[tone].color,
          };
        assert.deepEqual(palette.button[tone], expected, `${tone} must retain its RGB, alpha, and foreground`);
      }
      for (const foreground of [
        palette.foreground, palette.secondary, palette.bannerForeground, palette.bannerSecondary,
        palette.metric, palette.focus, palette.dot, palette.disabledForeground,
        ...tones.map(tone => palette.button[tone].color),
      ]) {
        assert.match(foreground, /^#[0-9A-F]{6}$/i, 'foregrounds stay opaque; only fills are translucent');
      }
      assert.equal((palette as unknown as Record<string, unknown>).opacity, undefined);
    });

    test(`${label}: banner labels and metrics meet 4.5:1 over sampled map backdrops`, () => {
      for (const backdrop of backdrops) {
        const background = composite(palette.banner, backdrop);
        for (const text of [palette.bannerForeground, palette.bannerSecondary, palette.metric]) {
          assertReadable(text, background, `${label}, banner over ${backdrop.join(',')}`);
        }
      }
    });

    test(`${label}: primary and secondary panel text meet 4.5:1 over sampled map backdrops`, () => {
      for (const backdrop of backdrops) {
        const background = composite(palette.panel, backdrop);
        for (const text of [palette.foreground, palette.secondary]) {
          assertReadable(text, background, `${label}, panel over ${backdrop.join(',')}`);
        }
      }
    });

    for (const tone of tones) {
      test(`${label}: ${tone} normal/pressed/disabled colours remain readable and preserve state priority`, () => {
        const normal = buttonColours(palette, tone);
        const pressed = buttonColours(palette, tone, false, true);
        const disabled = buttonColours(palette, tone, true);
        assert.deepEqual(normal, palette.button[tone]);
        assert.deepEqual(pressed, createTranslucentPalette(scheme, true).button[tone]);
        assert.equal(colour(pressed.backgroundColor)[3], 1, 'pressed fill is opaque');
        assert.deepEqual(disabled, { backgroundColor: palette.disabled, color: palette.disabledForeground });
        assert.deepEqual(buttonColours(palette, tone, true, true), disabled, 'disabled wins over pressed');
        for (const backdrop of backdrops) {
          const panel = composite(palette.panel, backdrop);
          for (const [state, colours] of [['normal', normal], ['pressed', pressed], ['disabled', disabled]] as const) {
            for (const [placement, background] of [
              ['direct', composite(colours.backgroundColor, backdrop)],
              ['nested', composite(colours.backgroundColor, panel)],
            ] as const) {
              assertReadable(colours.color, background, `${label}, ${tone}, ${state}, ${placement} over ${backdrop.join(',')}`);
            }
          }
        }
        assert.deepEqual(buttonColours(palette, tone), normal, 'state helpers do not mutate the normal palette');
      });
    }
  }
}

test('Integrated RGB constants retain the intended navy and semantic-button colours', () => {
  assert.deepEqual(OVERLAY_RGB, {
    navy: [6, 23, 42], blue: [17, 65, 170], slate: [38, 58, 83],
    danger: [159, 25, 42], success: [7, 97, 63], gold: [209, 163, 56],
  });
});

test('Palette defaults to normal translucency for both app-theme inputs', () => {
  for (const scheme of ['dark', 'light'] as const) {
    assert.deepEqual(createTranslucentPalette(scheme), createTranslucentPalette(scheme, false));
  }
});

test('RGBA clamps out-of-range alpha and preserves valid RGB and alpha values', () => {
  assert.equal(rgba([6, 23, 42], 4), 'rgba(6, 23, 42, 1)');
  assert.equal(rgba([6, 23, 42], -1), 'rgba(6, 23, 42, 0)');
  assert.equal(rgba([17, 65, 170], 0), 'rgba(17, 65, 170, 0)');
  assert.equal(rgba([209, 163, 56], 0.9), 'rgba(209, 163, 56, 0.9)');
  assert.equal(rgba([255, 255, 255], 1), 'rgba(255, 255, 255, 1)');
});
