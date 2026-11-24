import React, { type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';

const BOTTOM_GAP = 8;
const PANEL_GAP = 6;
// A dp map-first budget, not a camera inset or an assumed banner measurement.
// Real camera occlusion still comes from Home's rendered panel onLayout and
// the map component's own measured banner. Large text can use scroll fallback.
const MAP_CLEARANCE = 224;
const AUXILIARY_MIN_VIEWPORT = 96;

function finiteSize(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value!) : 0;
}

export function getDriverAndroidHomeLayout({
  homeHeight,
  headerInset,
  dockHeight,
  leftInset = 0,
  rightInset = 0,
}: {
  homeHeight: number;
  headerInset: number;
  dockHeight: number;
  leftInset?: number;
  rightInset?: number;
}) {
  const height = finiteSize(homeHeight);
  // Home is already above the non-absolute Tabs bar. Its measured height
  // excludes that bar AND its gesture/three-button safe area: never add them.
  const maxHeight = height > 0 ? Math.max(0, height - finiteSize(headerInset)) : undefined;
  const contentBudget = maxHeight === undefined ? undefined : Math.max(0, maxHeight - BOTTOM_GAP - PANEL_GAP);
  const auxiliaryFloor = contentBudget === undefined ? undefined : Math.min(AUXILIARY_MIN_VIEWPORT, contentBudget);
  const dockCap = contentBudget === undefined ? undefined : Math.max(0, contentBudget - auxiliaryFloor!);
  const auxiliaryMaxHeight = contentBudget === undefined ? undefined : Math.max(
    auxiliaryFloor!,
    contentBudget - Math.min(finiteSize(dockHeight), dockCap!) - MAP_CLEARANCE,
  );
  const dockMaxHeight = contentBudget === undefined ? undefined : contentBudget - auxiliaryMaxHeight!;

  return {
    bottomStyle: {
      gap: PANEL_GAP,
      paddingBottom: BOTTOM_GAP,
      paddingLeft: Math.max(12, finiteSize(leftInset) + BOTTOM_GAP),
      paddingRight: Math.max(12, finiteSize(rightInset) + BOTTOM_GAP),
      maxHeight,
    },
    dockMaxHeight,
    auxiliaryMaxHeight,
  };
}

export function DriverHomeLayoutRegion({
  children,
  maxHeight,
  onContentSizeChange,
}: {
  children: ReactNode;
  maxHeight?: number;
  onContentSizeChange?: (width: number, height: number) => void;
}) {
  // No added native View, changed styles, scrolling, or measurements on iOS.
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <ScrollView
      style={[styles.region, { maxHeight }]}
      contentContainerStyle={styles.content}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onContentSizeChange={onContentSizeChange}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  region: { flexGrow: 0, flexShrink: 1 },
  content: { gap: PANEL_GAP },
});
