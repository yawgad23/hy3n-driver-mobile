import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  formatNavigationDistance,
  formatNavigationDuration,
  formatNavigationArrivalTime,
  type DriverGuidance,
} from '@/lib/driver-navigation-guidance';

type Props = {
  guidance: DriverGuidance | null;
  message: string | null;
  remainingDistanceMeters: number | null;
  remainingTimeSeconds: number | null;
  targetLabel: string;
  targetKind: 'pickup' | 'destination' | 'stop';
  isDark: boolean;
  onLayout?: (event: any) => void;
};

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];
const MANEUVER_ICONS: Record<string, IconName> = {
  left: 'turn-left', right: 'turn-right',
  'slight-left': 'turn-slight-left', 'slight-right': 'turn-slight-right',
  'sharp-left': 'turn-sharp-left', 'sharp-right': 'turn-sharp-right',
  'keep-left': 'fork-left', 'keep-right': 'fork-right',
  'u-turn-left': 'u-turn-left', 'u-turn-right': 'u-turn-right',
  'roundabout-left': 'roundabout-left', 'roundabout-right': 'roundabout-right',
  roundabout: 'roundabout-right', merge: 'merge',
  'ramp-left': 'turn-slight-left', 'ramp-right': 'turn-slight-right',
  'u-turn': 'u-turn-left', ramp: 'alt-route',
  straight: 'straight', arrival: 'flag', unknown: 'navigation',
};

function maneuverIcon(guidance: DriverGuidance | null): IconName {
  const nativeName = guidance?.nativeManeuverName;
  if (nativeName?.includes('U_TURN')) return nativeName.includes('COUNTERCLOCKWISE') ? 'u-turn-left' : 'u-turn-right';
  if (guidance?.maneuver === 'roundabout') return nativeName?.includes('COUNTERCLOCKWISE') ? 'roundabout-left' : 'roundabout-right';
  if (guidance?.maneuver === 'ramp') {
    if (nativeName?.includes('LEFT')) return 'turn-slight-left';
    if (nativeName?.includes('RIGHT')) return 'turn-slight-right';
  }
  return MANEUVER_ICONS[guidance?.maneuver ?? 'unknown'] ?? 'navigation';
}

/** Render only provider guidance. A preparation/error message is not a turn. */
export function DriverNavigationBanner({
  guidance, message, remainingDistanceMeters, remainingTimeSeconds,
  targetLabel, targetKind, isDark, onLayout,
}: Props) {
  const instruction = !message && guidance?.navState === 'enroute' ? guidance.instruction : null;
  const distance = instruction ? formatNavigationDistance(guidance?.distanceToManeuverMeters ?? null) : null;
  const icon = instruction ? maneuverIcon(guidance) : 'navigation';
  const duration = formatNavigationDuration(remainingTimeSeconds);
  const remaining = formatNavigationDistance(remainingDistanceMeters);
  const arrival = formatNavigationArrivalTime(remainingTimeSeconds);
  const stateMessage = message || (guidance?.navState === 'rerouting' ? 'Recalculating your route…' : 'Waiting for live turn instructions…');
  const targetType = targetKind === 'pickup' ? 'Pickup' : targetKind === 'stop' ? 'Next stop' : 'Drop-off';

  return (
    <View testID="driver-navigation-banner" onLayout={onLayout} style={styles.container} pointerEvents="none">
      <View style={[styles.instructionPanel, isDark && styles.darkInstructionPanel]} accessibilityLabel={[instruction || stateMessage, distance && `in ${distance}`, guidance?.roadName].filter(Boolean).join('. ')}>
        <View style={styles.iconColumn}>
          <MaterialIcons name={icon} size={48} color="#FFFFFF" />
          {distance ? <Text style={styles.turnDistance} numberOfLines={1}>{distance}</Text> : null}
        </View>
        <View style={styles.instructionColumn}>
          <Text style={styles.instruction} numberOfLines={2}>{instruction || stateMessage}</Text>
          {instruction && guidance?.roadName && guidance.roadName !== instruction ? (
            <Text style={styles.roadName} numberOfLines={1}>{guidance.roadName}</Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.summary, { backgroundColor: isDark ? '#17212C' : '#FFFFFF', borderColor: isDark ? '#304151' : '#DBE2E8' }]}>
        <View style={styles.summaryMetrics}>
          <Text style={[styles.summaryPrimary, { color: isDark ? '#65DBAB' : '#087B4C' }]}>{duration || 'ETA updating'}</Text>
          {remaining ? <Text style={[styles.summarySecondary, { color: isDark ? '#ECF1F5' : '#23313F' }]}>{remaining}</Text> : null}
          {arrival ? <Text style={[styles.summarySecondary, { color: isDark ? '#ECF1F5' : '#23313F' }]}>{arrival} arrival</Text> : null}
        </View>
        <Text style={[styles.target, { color: isDark ? '#B9C7D4' : '#526273' }]} numberOfLines={1}>{targetType} · {targetLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 18, overflow: 'hidden', width: '100%' },
  instructionPanel: { backgroundColor: '#096B47', flexDirection: 'row', alignItems: 'center', minHeight: 100, padding: 14, gap: 12 },
  darkInstructionPanel: { backgroundColor: '#064D36' },
  iconColumn: { width: 78, alignItems: 'center', justifyContent: 'center', gap: 4 },
  turnDistance: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', includeFontPadding: false },
  instructionColumn: { flex: 1, minWidth: 0, gap: 5 },
  instruction: { color: '#FFFFFF', fontSize: 22, lineHeight: 27, fontWeight: '800', includeFontPadding: false },
  roadName: { color: '#E6F5ED', fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false },
  summary: { paddingHorizontal: 16, paddingVertical: 11, gap: 5, borderWidth: 1, borderTopWidth: 0 },
  summaryMetrics: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: 3 },
  summaryPrimary: { fontSize: 19, fontWeight: '800', includeFontPadding: false },
  summarySecondary: { fontSize: 14, fontWeight: '700', includeFontPadding: false },
  target: { fontSize: 12, lineHeight: 17, fontWeight: '600', includeFontPadding: false },
});
