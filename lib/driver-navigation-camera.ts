import { distanceBetweenPositionsMetres, normalisedHeading, type DriverMapPosition } from './driver-map-motion';

export type DriverFollowCamera = {
  target: { lat: number; lng: number };
  bearing: number;
  tilt: number;
  zoom: number;
};
export type DriverFollowCameraSample = { position: DriverMapPosition; atMs: number; camera: DriverFollowCamera };

export type DriverNavigationCameraOptions = {
  closeDrivingView?: boolean;
  usableViewportHeight?: number;
};

/** Keep the car below center, with useful road detail and no speed-based zoom pumping. */
export function driverNavigationCamera(position: DriverMapPosition, previous: DriverFollowCameraSample | null, nowMs: number, force = false, options: DriverNavigationCameraOptions = {}): DriverFollowCameraSample | null {
  if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)
    || Math.abs(position.latitude) > 90 || Math.abs(position.longitude) > 180 || !Number.isFinite(nowMs)) return null;
  const heading = Number.isFinite(position.heading) && position.heading >= 0
    ? normalisedHeading(position.heading) : previous?.camera.bearing ?? 0;
  const movement = previous ? distanceBetweenPositionsMetres(previous.position, position) : Infinity;
  // Compass drift while parked must not make the map rotate under the Driver.
  const bearing = previous && movement < 1.5 ? previous.camera.bearing : heading;
  const turn = previous ? Math.abs(((bearing - previous.camera.bearing + 540) % 360) - 180) : 180;
  if (!force && previous && (nowMs - previous.atMs < 100 || (movement < 0.6 && turn < 2))) return null;
  const radians = bearing * Math.PI / 180;
  const closeDrivingView = options.closeDrivingView === true;
  const zoom = closeDrivingView ? 18 : 17.2;
  // A close view must not shift the car below a short usable viewport. Limit
  // forward framing by the actual overlay-free map height and map latitude,
  // instead of fitting the entire city-spanning destination into the camera.
  const usableHeight = Number.isFinite(options.usableViewportHeight) && options.usableViewportHeight! >= 0
    ? options.usableViewportHeight! : 360;
  const mercatorLatitude = Math.max(-85.05112878, Math.min(85.05112878, position.latitude));
  const metersPerPoint = 156543.03392 * Math.cos(mercatorLatitude * Math.PI / 180) / 2 ** zoom;
  const lookAheadMeters = closeDrivingView ? Math.min(35, usableHeight * 0.18 * metersPerPoint) : 55;
  const latitude = position.latitude + Math.cos(radians) * lookAheadMeters / 111_320;
  const longitude = position.longitude + Math.sin(radians) * lookAheadMeters / (111_320 * Math.max(0.05, Math.cos(position.latitude * Math.PI / 180)));
  const camera = { target: { lat: Math.max(-90, Math.min(90, latitude)), lng: ((longitude + 540) % 360) - 180 }, bearing, tilt: 45, zoom };
  return { position: { ...position, heading: bearing }, atMs: nowMs, camera };
}

/** Keep native controls/Google attribution in the usable viewport, never under HY3N cards. */
export function driverNavigationMapPadding(top: number, bottom: number, viewportHeight: number, pixelScale = 1) {
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  const safeTop = Number.isFinite(top) ? Math.max(0, top) : 0;
  const safeBottom = Number.isFinite(bottom) ? Math.max(0, bottom) : 0;
  const space = Math.max(0, height - 160);
  const total = safeTop + safeBottom;
  const ratio = total > space && total > 0 ? space / total : 1;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  return { top: Math.round(safeTop * ratio * scale), bottom: Math.round(safeBottom * ratio * scale), left: Math.round(12 * scale), right: Math.round(12 * scale) };
}
