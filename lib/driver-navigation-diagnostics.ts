export type DriverNavigationStage =
  | 'gps.sample' | 'native.gps' | 'route.assessment' | 'route.request' | 'route.response'
  | 'geometry.received' | 'geometry.rejected' | 'geometry.failed' | 'polyline.applied'
  | 'polyline.verified' | 'polyline.failed' | 'session.response' | 'route.native-change' | 'route.retry'
  | 'arrival.ignored' | 'arrival.confirmed';

type DiagnosticFields = {
  request?: number; valid?: boolean; accuracyMeters?: number | null; ageMs?: number | null;
  movementMeters?: number | null; nativeDeltaMeters?: number | null; distanceMeters?: number | null;
  thresholdMeters?: number; offRoute?: boolean; wrongWay?: boolean; shouldReroute?: boolean;
  points?: number; targetMatches?: boolean; nativePathMatches?: boolean; source?: 'ios-current-leg' | 'route-legs';
  status?: string | number; reason?: string; code?: string;
};
const ALLOWED = new Set(['request','valid','accuracyMeters','ageMs','movementMeters','nativeDeltaMeters',
  'distanceMeters','thresholdMeters','offRoute','wrongWay','shouldReroute','points','targetMatches','nativePathMatches','source','status','reason','code']);

/** Temporary local diagnostics only. Never log native error messages or raw coordinates. */
export function driverNavigationDiagnosticsEnabled() {
  return (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_DRIVER_NAV_DIAGNOSTICS === '1';
}

export function createDriverNavigationDiagnostics(
  enabled = driverNavigationDiagnosticsEnabled(),
  sink: (stage: string, fields: Record<string, unknown>) => void = (stage, fields) => console.info('[HY3N NAV]', stage, fields),
) {
  let count = 0;
  return (stage: DriverNavigationStage, fields: DiagnosticFields = {}) => {
    if (!enabled) return;
    // Preserve a fresh diagnostic window for the actual reroute, even when the
    // initial journey's periodic geometry reads used the earlier window.
    if (stage === 'route.request' || stage === 'route.native-change') count = 0;
    if (count >= 240) return;
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED.has(key)) continue;
      if (typeof value === 'number') { if (Number.isFinite(value)) safe[key] = Math.round(value); }
      else if (typeof value === 'boolean' || value === null) safe[key] = value;
      else if (typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(value)) safe[key] = value;
    }
    count++;
    try { sink(stage, safe); } catch { /* Diagnostics cannot interrupt navigation. */ }
  };
}

export function navigationErrorCode(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'native_error';
  return new Set(['NO_VIEW_CONTROLLER', 'NO_NAVIGATOR_ERROR_CODE', 'NO_DESTINATIONS', 'route_not_available',
    'notAuthorized', 'termsNotAccepted', 'networkError', 'locationPermissionMissing', 'initializationFailed',
    'internal_error', 'NETWORK_ERROR', 'NO_ROUTE_FOUND', 'LOCATION_UNKNOWN', 'LOCATION_DISABLED'])
    .has(code) ? code : 'native_error';
}
