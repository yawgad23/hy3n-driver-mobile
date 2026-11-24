/** Standalone HY3N design tokens. No app state, navigation or trip logic. */
export type OverlayScheme = 'light' | 'dark';
export type ButtonTone = 'blue' | 'slate' | 'danger' | 'success' | 'gold' | 'neutral';

export const OVERLAY_RGB = {
  navy: [6, 23, 42],
  blue: [17, 65, 170],
  slate: [38, 58, 83],
  danger: [159, 25, 42],
  success: [7, 97, 63],
  gold: [209, 163, 56],
} as const;

export function rgba(rgb: readonly number[], alpha: number): string {
  return `rgba(${rgb.join(', ')}, ${Math.min(1, Math.max(0, alpha))})`;
}

export function createTranslucentPalette(scheme: OverlayScheme, reduceTransparency = false) {
  const dark = scheme === 'dark';
  const fill = (rgb: readonly number[], alpha: number) => rgba(rgb, reduceTransparency ? 1 : alpha);
  const foreground = dark ? '#FFFFFF' : '#0B1726';
  const panel = dark ? fill(OVERLAY_RGB.navy, 0.70) : fill([255, 255, 255], 0.94);
  return {
    scheme,
    reduceTransparency,
    foreground,
    secondary: dark ? '#E2E8F0' : '#334155',
    panel,
    // Apply ONCE to a parent containing instruction AND summary.
    banner: fill(OVERLAY_RGB.navy, dark ? 0.70 : 0.90),
    bannerForeground: '#FFFFFF',
    bannerSecondary: '#E2E8F0',
    metric: '#88F2C3',
    border: dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 23, 42, 0.22)',
    focus: dark ? '#F5CE71' : '#075985',
    dot: dark ? '#4ADE80' : '#087B4C',
    tabBar: dark ? '#07111D' : '#FFFFFF',
    disabled: dark ? '#334155' : '#DEE5F0',
    disabledForeground: dark ? '#E2E8F0' : '#334155',
    button: {
      blue: { backgroundColor: fill(OVERLAY_RGB.blue, 0.80), color: '#FFFFFF' },
      slate: { backgroundColor: fill(OVERLAY_RGB.slate, 0.85), color: '#FFFFFF' },
      danger: { backgroundColor: fill(OVERLAY_RGB.danger, 0.85), color: '#FFFFFF' },
      success: { backgroundColor: fill(OVERLAY_RGB.success, 0.85), color: '#FFFFFF' },
      gold: { backgroundColor: fill(OVERLAY_RGB.gold, 0.90), color: '#07111D' },
      neutral: { backgroundColor: panel, color: foreground },
    },
  };
}

export type TranslucentPalette = ReturnType<typeof createTranslucentPalette>;

export function buttonColours(palette: TranslucentPalette, tone: ButtonTone, disabled = false, pressed = false) {
  if (disabled) return { backgroundColor: palette.disabled, color: palette.disabledForeground };
  if (pressed) {
    const solid = createTranslucentPalette(palette.scheme, true);
    return solid.button[tone];
  }
  return palette.button[tone];
}
