export type DriverVehicleServiceType = 'car' | 'okada' | 'delivery';
export type DriverVehicleMarkerPlatform = 'android' | 'ios';

export const DRIVER_VEHICLE_MARKER_ASSETS = {
  android: {
    car: 'hy3n_driver_car_marker.png',
    okada: 'hy3n_driver_okada_marker.png',
    delivery: 'hy3n_driver_delivery_marker.png',
  },
  ios: {
    car: 'HY3NDriverCarMarker',
    okada: 'HY3NDriverOkadaMarker',
    delivery: 'HY3NDriverDeliveryMarker',
  },
} as const;

export function normalizeDriverServiceType(value: unknown): DriverVehicleServiceType {
  const serviceType = String(value ?? '').trim().toLowerCase();
  if (serviceType === 'okada' || serviceType === 'motorcycle' || serviceType === 'motorbike') return 'okada';
  if (serviceType === 'delivery' || serviceType === 'express_delivery') return 'delivery';
  return 'car';
}

export function driverVehicleMarkerAsset(
  serviceType: unknown,
  platform: DriverVehicleMarkerPlatform,
): string {
  return DRIVER_VEHICLE_MARKER_ASSETS[platform][normalizeDriverServiceType(serviceType)];
}
