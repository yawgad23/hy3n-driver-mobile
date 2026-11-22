export type DriverNavigationFeedTarget = { latitude: number; longitude: number };

/**
 * A feed event must carry native capture context, not a JS reception timestamp.
 * Missing context is treated as unavailable; an old binary must not invent a
 * fresh instruction simply because a callback arrived after a target switch.
 */
export function driverNavigationFeedMatchesTarget(
  value: unknown,
  target: DriverNavigationFeedTarget | null,
  validAfterMs: number,
  nowMs: number,
  expectedGeneration?: number | null,
) {
  if (!value || typeof value !== 'object' || !target) return false;
  const sample = value as Record<string, unknown>;
  const lat = sample.hy3nTargetLatitude;
  const lng = sample.hy3nTargetLongitude;
  const captured = sample.hy3nCapturedAtMs;
  const generation = sample.hy3nRouteGeneration;
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof captured !== 'number' || typeof generation !== 'number'
    || ![lat, lng, captured, generation, validAfterMs, nowMs].every(Number.isFinite)) return false;
  return Math.abs(lat - target.latitude) < 1e-6 && Math.abs(lng - target.longitude) < 1e-6
    && captured >= validAfterMs && captured <= nowMs + 5_000 && nowMs - captured <= 15_000
    && generation >= 1 && (expectedGeneration == null || generation === expectedGeneration);
}

export function driverNavigationRemainingMetrics(value: unknown): { meters: number | null; seconds: number | null } | null {
  if (!value || typeof value !== 'object') return null;
  const sample = value as Record<string, unknown>;
  const positive = (field: unknown) => typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : null;
  const meters = positive(sample.meters), seconds = positive(sample.seconds);
  return meters !== null || seconds !== null ? { meters, seconds } : null;
}
