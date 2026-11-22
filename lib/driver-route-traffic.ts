export type DriverTrafficPoint = { lat: number; lng: number };
export type DriverTrafficStyle = 'slower-traffic' | 'traffic-jam';
export type DriverRouteTrafficInterval = {
  /** Index in the exact supplied getRouteSegments() snapshot. */
  segmentIndex: number;
  style: DriverTrafficStyle;
  color: string;
  /** Metres from the beginning of that complete supplied snapshot, not trimmed geometry. */
  startMeters: number;
  endMeters: number;
  /** Only provider road geometry, with interpolated interval boundaries. */
  points: DriverTrafficPoint[];
};
export const DRIVER_ROUTE_BASE_COLOR = '#2563EB';
export const DRIVER_SLOWER_TRAFFIC_COLOR = '#F59E0B';
export const DRIVER_TRAFFIC_JAM_COLOR = '#DC2626';
export type DriverRouteTrafficOptions = {
  /**
   * Already-travelled metres from the start of these EXACT supplied segments.
   * Defaults to 0 when the SDK returns a current-location-prefixed snapshot.
   * Do not apply old-route progress to a refreshed/current SDK snapshot, and do
   * not combine getCurrentRouteSegment() with getRouteSegments() (duplicates).
   */
  progressMeters?: number;
};

type MeasuredPath = { points: DriverTrafficPoint[]; offsets: number[]; length: number };
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}
function point(value: unknown): DriverTrafficPoint | null {
  const object = record(value);
  if (!object) return null;
  const lat = object.lat ?? object.latitude;
  const lng = object.lng ?? object.longitude;
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}
function longitudeDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}
function distanceMeters(a: DriverTrafficPoint, b: DriverTrafficPoint): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = longitudeDelta(a.lng, b.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians)
    * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
function measurePath(value: unknown): MeasuredPath | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points: DriverTrafficPoint[] = [];
  const offsets: number[] = [];
  let length = 0;
  for (const raw of value) {
    const next = point(raw);
    // Never skip an invalid vertex and invent a connector across the gap.
    if (!next) return null;
    const previous = points.at(-1);
    const distance = previous ? distanceMeters(previous, next) : 0;
    if (previous && distance < 0.001) continue;
    length += distance;
    points.push(next);
    offsets.push(length);
  }
  return points.length >= 2 && Number.isFinite(length) && length > 0
    ? { points, offsets, length } : null;
}
function pointAt(path: MeasuredPath, meters: number): DriverTrafficPoint {
  if (meters <= 0) return { ...path.points[0] };
  if (meters >= path.length) return { ...path.points[path.points.length - 1] };
  const index = path.offsets.findIndex(offset => offset >= meters);
  const start = path.points[index - 1];
  const end = path.points[index];
  const fraction = (meters - path.offsets[index - 1]) / (path.offsets[index] - path.offsets[index - 1]);
  const lng = start.lng + longitudeDelta(start.lng, end.lng) * fraction;
  return { lat: start.lat + (end.lat - start.lat) * fraction, lng: ((lng + 540) % 360) - 180 };
}
function slicePath(path: MeasuredPath, start: number, end: number): DriverTrafficPoint[] {
  const points = [pointAt(path, start)];
  for (let index = 1; index < path.points.length - 1; index++) {
    if (path.offsets[index] > start && path.offsets[index] < end) points.push({ ...path.points[index] });
  }
  points.push(pointAt(path, end));
  return points;
}
function style(value: unknown): DriverTrafficStyle | null {
  // ObjectTranslationUtil.java emits enum.name(), while public TS defines 1/2.
  if (value === 'SLOWER_TRAFFIC' || value === 1) return 'slower-traffic';
  if (value === 'TRAFFIC_JAM' || value === 2) return 'traffic-jam';
  return null;
}

/**
 * Android 0.16.3: segment.navigationTrafficData={status:'OK',
 * roadStretchRenderingDataList:[{style:'SLOWER_TRAFFIC'|'TRAFFIC_JAM',
 * offsetMeters:number,lengthMeters:number}]}. Public Status.OK=0, Style=1/2
 * are also accepted, without coercing null/strings/booleans into numbers.
 * iOS ObjectTranslationUtil.mm:transformRouteSegmentToDictionary omits traffic
 * data entirely; no-data returns [] and must NOT be presented as free flow.
 *
 * Offsets are local to each segment's segmentLatLngList, so measure/slice before
 * adding previous-leg lengths. A stretch crossing several polyline edges works;
 * a stretch beyond its leg is clamped to that leg, never painted on another.
 * No GPS speed, duration or DelaySeverity can fabricate congestion geometry.
 * Render a blue base route first and only these provider-returned overlays.
 * Clear overlays on no data, target/session changes and stale route results at
 * the integration layer. This helper cannot detect a stale SDK snapshot itself.
 * Source: https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/NavigationRoadStretchRenderingData
 */
export function normalizeDriverRouteTraffic(
  segments: unknown, options: DriverRouteTrafficOptions = {},
): DriverRouteTrafficInterval[] {
  const settings = record(options);
  if (!settings) return [];
  const progressMeters = 'progressMeters' in settings ? settings.progressMeters : 0;
  if (!nonnegative(progressMeters) || !Array.isArray(segments)) return [];
  const measured: { segment: Record<string, unknown>; path: MeasuredPath }[] = [];
  for (const raw of segments) {
    const segment = record(raw);
    const path = measurePath(segment?.segmentLatLngList);
    // Unknown preceding leg length would shift all later traffic incorrectly.
    if (!segment || !path) return [];
    measured.push({ segment, path });
  }
  const intervals: DriverRouteTrafficInterval[] = [];
  let segmentStartMeters = 0;
  for (const [segmentIndex, { segment, path }] of measured.entries()) {
    const traffic = record(segment.navigationTrafficData);
    const stretches = traffic?.roadStretchRenderingDataList;
    if ((traffic?.status === 'OK' || traffic?.status === 0) && Array.isArray(stretches)) {
      for (const raw of stretches) {
        const stretch = record(raw);
        const trafficStyle = style(stretch?.style);
        const offset = stretch?.offsetMeters;
        const length = stretch?.lengthMeters;
        if (!trafficStyle || !nonnegative(offset) || !nonnegative(length) || length <= 0) continue;
        const requestedEnd = offset + length;
        if (!Number.isFinite(requestedEnd) || requestedEnd > Number.MAX_SAFE_INTEGER) continue;
        const start = Math.max(offset, progressMeters - segmentStartMeters, 0);
        const end = Math.min(requestedEnd, path.length);
        if (end <= start) continue;
        intervals.push({
          segmentIndex, style: trafficStyle,
          color: trafficStyle === 'slower-traffic' ? DRIVER_SLOWER_TRAFFIC_COLOR : DRIVER_TRAFFIC_JAM_COLOR,
          startMeters: segmentStartMeters + start, endMeters: segmentStartMeters + end,
          points: slicePath(path, start, end),
        });
      }
    }
    segmentStartMeters += path.length;
  }
  return intervals.sort((a, b) => a.startMeters - b.startMeters || a.endMeters - b.endMeters);
}
