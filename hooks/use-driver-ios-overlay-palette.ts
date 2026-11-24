import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { createTranslucentPalette } from '@/lib/driver-ios-overlay-theme';

/** Colour-only iPhone overlays. The caller supplies the app's OS-following theme. */
export function useDriverIosOverlayPalette(isDark: boolean) {
  // Keep iOS solid until its accessibility preference is known.
  const [reduceTransparencyEnabled, setReduceTransparencyEnabled] = useState(Platform.OS === 'ios');
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    // Defensive fallback also permits native-boundary tests without this API.
    if (!AccessibilityInfo?.isReduceTransparencyEnabled || !AccessibilityInfo?.addEventListener) return;
    let mounted = true;
    let preferenceChangedDuringRead = false;
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => {
      preferenceChangedDuringRead = true;
      if (mounted) setReduceTransparencyEnabled(value);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => {
      if (mounted && !preferenceChangedDuringRead) setReduceTransparencyEnabled(value);
    }).catch(() => { /* Retain readable solid fills if the preference is unavailable. */ });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return useMemo(() => createTranslucentPalette(isDark ? 'dark' : 'light', reduceTransparencyEnabled), [isDark, reduceTransparencyEnabled]);
}
