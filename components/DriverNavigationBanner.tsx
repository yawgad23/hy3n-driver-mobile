import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
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

/** Android uses only verified native maneuver names; unknown states stay neutral. */
function androidManeuverIcon(guidance: DriverGuidance | null): IconName {
  const name = guidance?.nativeManeuverName;
  if (!name || guidance?.navState !== 'enroute') return 'info-outline';
  if (name === 'TURN_LEFT') return 'turn-left';
  if (name === 'TURN_RIGHT') return 'turn-right';
  if (name === 'TURN_SHARP_LEFT') return 'turn-sharp-left';
  if (name === 'TURN_SHARP_RIGHT') return 'turn-sharp-right';
  if (name === 'TURN_SLIGHT_LEFT') return 'turn-slight-left';
  if (name === 'TURN_SLIGHT_RIGHT') return 'turn-slight-right';
  if (name === 'TURN_KEEP_LEFT' || name === 'FORK_LEFT') return 'fork-left';
  if (name === 'TURN_KEEP_RIGHT' || name === 'FORK_RIGHT') return 'fork-right';
  if (name === 'TURN_U_TURN_COUNTERCLOCKWISE') return 'u-turn-left';
  if (name === 'TURN_U_TURN_CLOCKWISE') return 'u-turn-right';
  if (/^ROUNDABOUT_(?:(?:STRAIGHT|LEFT|RIGHT|SLIGHT_LEFT|SLIGHT_RIGHT|SHARP_LEFT|SHARP_RIGHT|U_TURN|EXIT)_)?(?:CLOCKWISE|COUNTERCLOCKWISE)$/.test(name)) {
    return name.endsWith('COUNTERCLOCKWISE') ? 'roundabout-left' : 'roundabout-right';
  }
  const ramp = /^(?:ON|OFF)_RAMP_(UNSPECIFIED|LEFT|RIGHT|KEEP_LEFT|KEEP_RIGHT|SLIGHT_LEFT|SLIGHT_RIGHT|SHARP_LEFT|SHARP_RIGHT|U_TURN_CLOCKWISE|U_TURN_COUNTERCLOCKWISE)$/.exec(name);
  if (ramp) {
    const rampIcons: Record<string, IconName> = {
      UNSPECIFIED: 'alt-route', LEFT: 'turn-left', RIGHT: 'turn-right',
      KEEP_LEFT: 'fork-left', KEEP_RIGHT: 'fork-right',
      SLIGHT_LEFT: 'turn-slight-left', SLIGHT_RIGHT: 'turn-slight-right',
      SHARP_LEFT: 'turn-sharp-left', SHARP_RIGHT: 'turn-sharp-right',
      U_TURN_CLOCKWISE: 'u-turn-right', U_TURN_COUNTERCLOCKWISE: 'u-turn-left',
    };
    return rampIcons[ramp[1]];
  }
  if (name === 'MERGE_LEFT' || name === 'MERGE_RIGHT' || name === 'MERGE_UNSPECIFIED') return 'merge';
  if (name === 'STRAIGHT') return 'straight';
  if (name === 'DESTINATION' || name === 'DESTINATION_LEFT' || name === 'DESTINATION_RIGHT') return 'flag';
  return 'info-outline';
}

function AndroidDriverNavigationBanner({
  guidance, message, remainingDistanceMeters, remainingTimeSeconds,
  targetLabel, targetKind, isDark, onLayout,
}: Props) {
  const instruction = !message && guidance?.navState === 'enroute' ? guidance.instruction : null;
  const distance = instruction ? formatNavigationDistance(guidance?.distanceToManeuverMeters ?? null) : null;
  const icon = instruction ? androidManeuverIcon(guidance) : 'info-outline';
  const duration = formatNavigationDuration(remainingTimeSeconds);
  const remaining = formatNavigationDistance(remainingDistanceMeters);
  const arrival = formatNavigationArrivalTime(remainingTimeSeconds);
  const stateMessage = message || (guidance?.navState === 'rerouting' ? 'Recalculating your route…' : 'Waiting for live turn instructions…');
  const targetType = targetKind === 'pickup' ? 'Pickup' : targetKind === 'stop' ? 'Next stop' : 'Drop-off';
  return (
    <View testID="driver-navigation-banner" onLayout={onLayout} style={androidStyles.container} pointerEvents="none">
      <View style={[androidStyles.instructionPanel, isDark && androidStyles.darkInstructionPanel]} accessibilityLabel={[instruction || stateMessage, distance && `in ${distance}`, guidance?.roadName].filter(Boolean).join('. ')}>
        <View style={androidStyles.iconColumn}>
          <MaterialIcons name={icon} size={44} color="#FFFFFF" />
        </View>
        <View style={androidStyles.instructionColumn}>
          {distance ? <Text style={androidStyles.turnDistance}>{distance}</Text> : null}
          <Text style={androidStyles.instruction}>{instruction || stateMessage}</Text>
          {instruction && guidance?.roadName && guidance.roadName !== instruction ? <Text style={androidStyles.roadName}>{guidance.roadName}</Text> : null}
        </View>
      </View>
      <View style={[androidStyles.summary, { backgroundColor: isDark ? '#17212C' : '#FFFFFF', borderColor: isDark ? '#304151' : '#DBE2E8' }]}>
        <View style={androidStyles.summaryMetrics}>
          <Text style={[androidStyles.summaryPrimary, { color: isDark ? '#65DBAB' : '#087B4C' }]}>{duration || 'ETA updating'}</Text>
          {remaining ? <Text style={[androidStyles.summarySecondary, { color: isDark ? '#ECF1F5' : '#23313F' }]}>{remaining}</Text> : null}
          {arrival ? <Text style={[androidStyles.summarySecondary, { color: isDark ? '#ECF1F5' : '#23313F' }]}>{arrival} arrival</Text> : null}
        </View>
        <Text style={[androidStyles.target, { color: isDark ? '#B9C7D4' : '#526273' }]}>{targetType} · {targetLabel}</Text>
      </View>
    </View>
  );
}

/** Render only provider guidance. A preparation/error message is not a turn. */
function OriginalDriverNavigationBanner({
  guidance, message, remainingDistanceMeters, remainingTimeSeconds,
  targetLabel, targetKind, isDark, onLayout,
}: Props) {
  const instruction = !message && guidance?.navState === 'enroute' ? guidance.instruction : null;
  const distance = instruction ? formatNavigationDistance(guidance?.distanceToManeuverMeters ?? null) : null;
  const isIos = Platform.OS === 'ios';
  // Keep the original known-turn mapper; unavailable iOS guidance is not an arrow.
  const icon = isIos && (!instruction || guidance?.maneuver === 'unknown')
    ? 'info-outline' : instruction ? maneuverIcon(guidance) : 'navigation';
  const duration = formatNavigationDuration(remainingTimeSeconds);
  const remaining = formatNavigationDistance(remainingDistanceMeters);
  const arrival = formatNavigationArrivalTime(remainingTimeSeconds);
  const stateMessage = message || (guidance?.navState === 'rerouting' ? 'Recalculating your route…' : 'Waiting for live turn instructions…');
  const targetType = targetKind === 'pickup' ? 'Pickup' : targetKind === 'stop' ? 'Next stop' : 'Drop-off';

  return (
    <View testID="driver-navigation-banner" onLayout={onLayout} style={styles.container} pointerEvents="none">
      <View style={[styles.instructionPanel, isDark && styles.darkInstructionPanel]} accessibilityLabel={[instruction || stateMessage, distance && `in ${distance}`, guidance?.roadName].filter(Boolean).join('. ')}>
        <View style={isIos ? [styles.iconColumn, iosStyles.iconColumn] : styles.iconColumn}>
          <MaterialIcons name={icon} size={isIos ? 44 : 48} color="#FFFFFF" />
          {!isIos && distance ? <Text style={styles.turnDistance} numberOfLines={1}>{distance}</Text> : null}
        </View>
        <View style={styles.instructionColumn}>
          {isIos && distance ? <Text style={[styles.turnDistance, iosStyles.turnDistance]}>{distance}</Text> : null}
          <Text style={styles.instruction} numberOfLines={isIos ? undefined : 2}>{instruction || stateMessage}</Text>
          {instruction && guidance?.roadName && guidance.roadName !== instruction ? (
            <Text style={styles.roadName} numberOfLines={isIos ? undefined : 1}>{guidance.roadName}</Text>
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

export function DriverNavigationBanner(props: Props) {
  return Platform.OS === 'android' ? <AndroidDriverNavigationBanner {...props} /> : <OriginalDriverNavigationBanner {...props} />;
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

// Override only the iOS hierarchy metrics; web retains the original styles.
const iosStyles = StyleSheet.create({
  iconColumn: { width: 56 },
  turnDistance: { fontSize: 24, lineHeight: 28 },
});

const androidStyles = StyleSheet.create({
  container: { borderRadius: 16, overflow: 'hidden', width: '100%' },
  instructionPanel: { backgroundColor: '#096B47', flexDirection: 'row', alignItems: 'center', minHeight: 76, paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  darkInstructionPanel: { backgroundColor: '#064D36' },
  iconColumn: { width: 56, alignItems: 'center', justifyContent: 'center' },
  turnDistance: { color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '800', includeFontPadding: false },
  instructionColumn: { flex: 1, minWidth: 0, gap: 4 },
  instruction: { color: '#FFFFFF', fontSize: 20, lineHeight: 25, fontWeight: '800', includeFontPadding: false },
  roadName: { color: '#E6F5ED', fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false },
  summary: { paddingHorizontal: 14, paddingVertical: 9, gap: 4, borderWidth: 1, borderTopWidth: 0 },
  summaryMetrics: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 3 },
  summaryPrimary: { fontSize: 18, fontWeight: '800', includeFontPadding: false },
  summarySecondary: { fontSize: 14, fontWeight: '700', includeFontPadding: false },
  target: { fontSize: 12, lineHeight: 17, fontWeight: '600', includeFontPadding: false },
});
