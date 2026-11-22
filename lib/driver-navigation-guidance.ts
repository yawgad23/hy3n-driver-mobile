export type DriverManeuver =
  | 'left' | 'right' | 'slight-left' | 'slight-right' | 'keep-left' | 'keep-right'
  | 'u-turn' | 'roundabout' | 'straight' | 'ramp' | 'merge' | 'arrival' | 'unknown';

export type DriverNavigationPosition = { lat: number; lng: number };
export type DriverGuidance = {
  /** Semantic icon key. Unknown must use a neutral/unavailable icon, not an arrow. */
  maneuver: DriverManeuver;
  instruction: string | null;
  roadName: string | null;
  distanceToManeuverMeters: number | null;
  remainingDistanceMeters: number | null;
  remainingTimeSeconds: number | null;
  maneuverPosition?: DriverNavigationPosition | null;
  destinationPosition?: DriverNavigationPosition | null;
  navState: 'enroute' | 'rerouting' | 'arrived' | 'stopped' | 'unknown';
  rawManeuver?: number | null;
  rawNavState?: number;
  nativeManeuverName?: string | null;
  routeChanged?: boolean;
};

type NativeManeuver = readonly [name: string, icon: DriverManeuver, instruction: string | null];

/**
 * Verified Android Maneuver constants and iOS GMSNavigationManeuver values agree.
 * Both 0.16.3 native NavModule serializers emit the integer (NOT Directions API
 * string maneuvers), currentStep.instruction and currentStep.fullRoadName.
 * Android ObjectTranslationUtil.java:getMapFromStepInfo; iOS NavModule.mm:getStepInfo.
 * NativeNavModule.ts's position/distanceMeters/maneuver:string spec is not the
 * runtime StepInfo shape. Do not derive turns from that spec or from road bearings.
 * Sources (numeric values verified in the Android HTML and iOS declarations):
 * https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/mapsplatform/turnbyturn/model/Maneuver
 * https://developers.google.com/maps/documentation/navigation/ios-sdk/reference/objc/Enums/GMSNavigationManeuver
 */
const NATIVE_MANEUVERS: Readonly<Record<number, NativeManeuver>> = {
  0: ['UNKNOWN', 'unknown', null],
  1: ['DEPART', 'unknown', 'Start navigation'],
  2: ['DESTINATION', 'arrival', 'Arrive at the destination'],
  3: ['DESTINATION_LEFT', 'arrival', 'The destination is on the left'],
  4: ['DESTINATION_RIGHT', 'arrival', 'The destination is on the right'],
  5: ['STRAIGHT', 'straight', 'Continue straight'],
  6: ['TURN_LEFT', 'left', 'Turn left'],
  7: ['TURN_RIGHT', 'right', 'Turn right'],
  8: ['TURN_KEEP_LEFT', 'keep-left', 'Keep left'],
  9: ['TURN_KEEP_RIGHT', 'keep-right', 'Keep right'],
  10: ['TURN_SLIGHT_LEFT', 'slight-left', 'Turn slightly left'],
  11: ['TURN_SLIGHT_RIGHT', 'slight-right', 'Turn slightly right'],
  12: ['TURN_SHARP_LEFT', 'left', 'Turn sharply left'],
  13: ['TURN_SHARP_RIGHT', 'right', 'Turn sharply right'],
  14: ['TURN_U_TURN_CLOCKWISE', 'u-turn', 'Make a clockwise U-turn'],
  15: ['TURN_U_TURN_COUNTERCLOCKWISE', 'u-turn', 'Make a counterclockwise U-turn'],
  16: ['MERGE_UNSPECIFIED', 'merge', 'Merge'],
  17: ['MERGE_LEFT', 'merge', 'Merge left'],
  18: ['MERGE_RIGHT', 'merge', 'Merge right'],
  19: ['FORK_LEFT', 'keep-left', 'Keep left at the fork'],
  20: ['FORK_RIGHT', 'keep-right', 'Keep right at the fork'],
  21: ['ON_RAMP_UNSPECIFIED', 'ramp', 'Take the entrance ramp'],
  22: ['ON_RAMP_LEFT', 'ramp', 'Turn left onto the entrance ramp'],
  23: ['ON_RAMP_RIGHT', 'ramp', 'Turn right onto the entrance ramp'],
  24: ['ON_RAMP_KEEP_LEFT', 'ramp', 'Keep left onto the entrance ramp'],
  25: ['ON_RAMP_KEEP_RIGHT', 'ramp', 'Keep right onto the entrance ramp'],
  26: ['ON_RAMP_SLIGHT_LEFT', 'ramp', 'Turn slightly left onto the entrance ramp'],
  27: ['ON_RAMP_SLIGHT_RIGHT', 'ramp', 'Turn slightly right onto the entrance ramp'],
  28: ['ON_RAMP_SHARP_LEFT', 'ramp', 'Turn sharply left onto the entrance ramp'],
  29: ['ON_RAMP_SHARP_RIGHT', 'ramp', 'Turn sharply right onto the entrance ramp'],
  30: ['ON_RAMP_U_TURN_CLOCKWISE', 'ramp', 'Make a clockwise U-turn onto the entrance ramp'],
  31: ['ON_RAMP_U_TURN_COUNTERCLOCKWISE', 'ramp', 'Make a counterclockwise U-turn onto the entrance ramp'],
  32: ['OFF_RAMP_UNSPECIFIED', 'ramp', 'Take the exit ramp'],
  33: ['OFF_RAMP_LEFT', 'ramp', 'Turn left onto the exit ramp'],
  34: ['OFF_RAMP_RIGHT', 'ramp', 'Turn right onto the exit ramp'],
  35: ['OFF_RAMP_KEEP_LEFT', 'ramp', 'Keep left onto the exit ramp'],
  36: ['OFF_RAMP_KEEP_RIGHT', 'ramp', 'Keep right onto the exit ramp'],
  37: ['OFF_RAMP_SLIGHT_LEFT', 'ramp', 'Turn slightly left onto the exit ramp'],
  38: ['OFF_RAMP_SLIGHT_RIGHT', 'ramp', 'Turn slightly right onto the exit ramp'],
  39: ['OFF_RAMP_SHARP_LEFT', 'ramp', 'Turn sharply left onto the exit ramp'],
  40: ['OFF_RAMP_SHARP_RIGHT', 'ramp', 'Turn sharply right onto the exit ramp'],
  41: ['OFF_RAMP_U_TURN_CLOCKWISE', 'ramp', 'Make a clockwise U-turn onto the exit ramp'],
  42: ['OFF_RAMP_U_TURN_COUNTERCLOCKWISE', 'ramp', 'Make a counterclockwise U-turn onto the exit ramp'],
  43: ['ROUNDABOUT_CLOCKWISE', 'roundabout', 'Enter the roundabout clockwise'],
  44: ['ROUNDABOUT_COUNTERCLOCKWISE', 'roundabout', 'Enter the roundabout counterclockwise'],
  45: ['ROUNDABOUT_STRAIGHT_CLOCKWISE', 'roundabout', 'Continue straight through the clockwise roundabout'],
  46: ['ROUNDABOUT_STRAIGHT_COUNTERCLOCKWISE', 'roundabout', 'Continue straight through the counterclockwise roundabout'],
  47: ['ROUNDABOUT_LEFT_CLOCKWISE', 'roundabout', 'Turn left at the clockwise roundabout'],
  48: ['ROUNDABOUT_LEFT_COUNTERCLOCKWISE', 'roundabout', 'Turn left at the counterclockwise roundabout'],
  49: ['ROUNDABOUT_RIGHT_CLOCKWISE', 'roundabout', 'Turn right at the clockwise roundabout'],
  50: ['ROUNDABOUT_RIGHT_COUNTERCLOCKWISE', 'roundabout', 'Turn right at the counterclockwise roundabout'],
  51: ['ROUNDABOUT_SLIGHT_LEFT_CLOCKWISE', 'roundabout', 'Turn slightly left at the clockwise roundabout'],
  52: ['ROUNDABOUT_SLIGHT_LEFT_COUNTERCLOCKWISE', 'roundabout', 'Turn slightly left at the counterclockwise roundabout'],
  53: ['ROUNDABOUT_SLIGHT_RIGHT_CLOCKWISE', 'roundabout', 'Turn slightly right at the clockwise roundabout'],
  54: ['ROUNDABOUT_SLIGHT_RIGHT_COUNTERCLOCKWISE', 'roundabout', 'Turn slightly right at the counterclockwise roundabout'],
  55: ['ROUNDABOUT_SHARP_LEFT_CLOCKWISE', 'roundabout', 'Turn sharply left at the clockwise roundabout'],
  56: ['ROUNDABOUT_SHARP_LEFT_COUNTERCLOCKWISE', 'roundabout', 'Turn sharply left at the counterclockwise roundabout'],
  57: ['ROUNDABOUT_SHARP_RIGHT_CLOCKWISE', 'roundabout', 'Turn sharply right at the clockwise roundabout'],
  58: ['ROUNDABOUT_SHARP_RIGHT_COUNTERCLOCKWISE', 'roundabout', 'Turn sharply right at the counterclockwise roundabout'],
  59: ['ROUNDABOUT_U_TURN_CLOCKWISE', 'roundabout', 'Make a U-turn at the clockwise roundabout'],
  60: ['ROUNDABOUT_U_TURN_COUNTERCLOCKWISE', 'roundabout', 'Make a U-turn at the counterclockwise roundabout'],
  61: ['ROUNDABOUT_EXIT_CLOCKWISE', 'roundabout', 'Exit the clockwise roundabout'],
  62: ['ROUNDABOUT_EXIT_COUNTERCLOCKWISE', 'roundabout', 'Exit the counterclockwise roundabout'],
  63: ['FERRY_BOAT', 'unknown', 'Take the boat ferry'],
  64: ['FERRY_TRAIN', 'unknown', 'Take the train ferry'],
  65: ['NAME_CHANGE', 'unknown', 'The road name changes'],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && value <= Number.MAX_SAFE_INTEGER ? value : null;
}

function realText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text || null;
}

function position(value: unknown): DriverNavigationPosition | null {
  const point = record(value);
  if (!point) return null;
  const lat = point.lat ?? point.latitude;
  const lng = point.lng ?? point.longitude;
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

/**
 * Callback arrays and native emitter {turnByTurnEvents} envelopes are accepted.
 * The last element is authoritative even if invalid: never resurrect an older
 * turn from the same batch when the newest update clears/stops the guidance.
 * Missing values stay null (not 0); iOS currently omits zero-valued distances.
 * Prefer next-destination totals for the current waypoint, not a later final leg.
 * Neither native serializer supplies positions or a target/session identifier.
 */
export function normalizeDriverGuidanceEvents(
  events: unknown, _platform?: 'android' | 'ios',
): DriverGuidance | null {
  // Platform hint is accepted for integration compatibility. The iOS numeric
  // mapping was independently verified against GMSNavigationManeuver, so it
  // shares this table without guessing from Android or English instruction text.
  const envelope = record(events);
  const batch = Array.isArray(events) ? events : envelope?.turnByTurnEvents;
  const event = record(Array.isArray(batch) ? batch.at(-1) : events);
  if (!event || !Number.isInteger(event.navState) || nonnegative(event.navState) === null) return null;
  const rawNavState = event.navState as number;
  // Both Android NavState and iOS GMSNavigationNavState: 0 unknown, 1 enroute,
  // 2 rerouting, 3 stopped. STOPPED is not proof of arrival.
  const navState = ({ 1: 'enroute', 2: 'rerouting', 3: 'stopped' } as const)[rawNavState as 1 | 2 | 3] ?? 'unknown';
  const guidance: DriverGuidance = {
    navState, rawNavState, maneuver: 'unknown', instruction: null, roadName: null,
    distanceToManeuverMeters: null, remainingDistanceMeters: null, remainingTimeSeconds: null,
    maneuverPosition: null, destinationPosition: null, rawManeuver: null, nativeManeuverName: null,
    ...(typeof event.routeChanged === 'boolean' ? { routeChanged: event.routeChanged } : {}),
  };
  if (navState !== 'enroute') return guidance;
  const step = record(event.currentStep);
  const rawManeuver = step && Number.isInteger(step.maneuver) ? nonnegative(step.maneuver) : null;
  const maneuver = rawManeuver === null ? undefined : NATIVE_MANEUVERS[rawManeuver];
  guidance.rawManeuver = rawManeuver;
  guidance.maneuver = maneuver?.[1] ?? 'unknown';
  guidance.nativeManeuverName = maneuver?.[0] ?? null;
  guidance.instruction = realText(step?.instruction) ?? maneuver?.[2] ?? null;
  guidance.roadName = realText(step?.fullRoadName);
  guidance.distanceToManeuverMeters = nonnegative(event.distanceToCurrentStepMeters);
  guidance.remainingDistanceMeters = nonnegative('distanceToNextDestinationMeters' in event
    ? event.distanceToNextDestinationMeters : event.distanceToFinalDestinationMeters);
  guidance.remainingTimeSeconds = nonnegative('timeToNextDestinationSeconds' in event
    ? event.timeToNextDestinationSeconds : event.timeToFinalDestinationSeconds);
  // Only consume genuinely present coordinates. No bearing-derived turn points
  // or destination inferred from the driver's server target.
  guidance.maneuverPosition = position(step?.position);
  const steps = event.getRemainingSteps;
  const finalStep = Array.isArray(steps) ? record(steps.at(-1)) : null;
  // A final arbitrary step is not necessarily the destination: require its
  // actual DESTINATION/DESTINATION_LEFT/DESTINATION_RIGHT enum as evidence.
  if (finalStep && [2, 3, 4].includes(finalStep.maneuver as number)) {
    guidance.destinationPosition = position(finalStep.position);
  }
  return guidance;
}

export function formatNavigationDistance(meters: number | null): string | null {
  if (nonnegative(meters) === null) return null;
  return meters! < 1000 ? `${Math.round(meters!)} m` : `${(meters! / 1000).toFixed(1).replace(/\.0$/, '')} km`;
}

export function formatNavigationDuration(seconds: number | null): string | null {
  if (nonnegative(seconds) === null) return null;
  const minutes = Math.ceil(seconds! / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} hr ${minutes % 60} min` : `${hours} hr`;
}

/** Uses the device locale/timezone by default; never add a hard-coded UTC offset. */
export function formatNavigationArrivalTime(
  seconds: number | null,
  now: number | Date = Date.now(),
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string | null {
  if (nonnegative(seconds) === null) return null;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  const arrival = new Date(nowMs + seconds! * 1000);
  if (!Number.isFinite(arrival.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locales, { hour: 'numeric', minute: '2-digit', ...options }).format(arrival);
  } catch {
    return null;
  }
}

/**
 * False rejects a malformed target or a known stale endpoint; null means the
 * feed has NO endpoint evidence and must not be treated as target confirmation.
 * 0.16.3 normally returns null here. Integration must separately guard native
 * route snapshots/request generations against the current target and clear
 * guidance on target/session changes. Even a matching point cannot identify
 * two sessions with the same target: these events do not carry a target key.
 */
export function driverGuidanceMatchesTarget(
  guidance: DriverGuidance | null, target: unknown, maxDistanceMeters = 150,
): boolean | null {
  const destination = position(guidance?.destinationPosition);
  const currentTarget = position(target);
  if (!currentTarget || nonnegative(maxDistanceMeters) === null) return false;
  if (!destination) return null;
  const radians = Math.PI / 180;
  const deltaLng = ((destination.lng - currentTarget.lng + 540) % 360 - 180) * radians;
  const deltaLat = (destination.lat - currentTarget.lat) * radians;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(destination.lat * radians)
    * Math.cos(currentTarget.lat * radians) * Math.sin(deltaLng / 2) ** 2;
  const distance = 2 * 6_371_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
  return distance <= maxDistanceMeters;
}
