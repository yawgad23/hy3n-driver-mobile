import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, PixelRatio, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import {
  AudioGuidance,
  MapColorScheme,
  MapView,
  NavigationProvider,
  NavigationSessionStatus,
  RouteStatus,
  TaskRemovedBehavior,
  TravelMode,
  useNavigation,
  type MapViewController,
} from '@googlemaps/react-native-navigation-sdk';
import {
  DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS,
  driverMapMotionFrames,
  driverMapMotionDurationMs,
  distanceBetweenPositionsMetres,
  routePointsForMap,
  validatedDriverCourse,
  type DriverMapPosition,
} from '@/lib/driver-map-motion';
import {
  assessDriverOffRoute,
  EMPTY_DRIVER_OFF_ROUTE_MONITOR,
  type DriverRoutePoint,
} from '@/lib/driver-off-route-reroute';
import {
  projectDriverOnRoute,
  remainingDriverRoute,
  assessDriverWrongWay,
  EMPTY_DRIVER_WRONG_WAY_MONITOR,
  driverRouteReachesTarget,
  driverRouteStartsAtLocation,
  isSameDriverRoadPlan,
} from '@/lib/driver-route-progress';
import { createDriverNavigationDiagnostics, driverNavigationDiagnosticsEnabled, navigationErrorCode } from '@/lib/driver-navigation-diagnostics';
import { validateDriverNavigationArrival } from '@/lib/driver-navigation-arrival';

import { DriverNavigationBanner } from './DriverNavigationBanner';
import { normalizeDriverGuidanceEvents, type DriverGuidance } from '@/lib/driver-navigation-guidance';
import { driverNavigationCamera, driverNavigationMapPadding, type DriverFollowCameraSample, type DriverNavigationCameraOptions } from '@/lib/driver-navigation-camera';
import { driverNavigationFeedMatchesTarget, driverNavigationRemainingMetrics } from '@/lib/driver-navigation-feed';
import { normalizeDriverRouteTraffic } from '@/lib/driver-route-traffic';
import { driverAndroidRouteMatchesTarget } from '@/lib/driver-android-route-target';
import { driverIosRouteMatchesTarget } from '@/lib/driver-ios-route-target';
import { useDriverIosOverlayPalette } from '@/hooks/use-driver-ios-overlay-palette';

type MapTarget = { latitude: number; longitude: number; label: string; kind?: 'pickup' | 'destination' | 'stop' };
type Props = {
  latitude?: number;
  longitude?: number;
  locationTimestamp?: number | null;
  locationAccuracy?: number | null;
  heading?: number | null;
  target?: MapTarget | null;
  tripStatus?: 'pickup' | 'dropoff' | null;
  serviceType?: 'car' | 'car_delivery' | 'okada' | 'delivery' | null;
  navigationId?: string | null;
  navigationTopInset?: number;
  navigationBottomInset?: number;
  isDark?: boolean;
  navigationPaused?: boolean;
};

const GREEN = '#008C5A';
const NAVIGATION_ROUTE = '#387DF3';
const ROUTE_OUTLINE = '#164EAC';
// 0.16.3 codegen accepts zIndex but its public PolylineOptions type omits it.
// The prebuild patch also restores Android create/update handling for it.
const ROUTE_LAYERS = { outline: { zIndex: 1 }, base: { zIndex: 2 }, traffic: { zIndex: 3 } };
const DRIVER_VEHICLE_MARKER_ID = 'hy3n-driver-vehicle';
const DRIVER_ROUTE_OUTLINE_ID = 'hy3n-driver-route-outline';
const DRIVER_ROUTE_ID = 'hy3n-driver-route';
const DRIVER_TARGET_MARKER_ID = 'hy3n-driver-target';
const DRIVER_ACTIVE_NAVIGATION_KEEP_AWAKE_TAG = 'hy3n-driver-active-navigation';
// “Clean” applies only to clutter. It does not force a colour theme: the map
// mirrors the phone’s own light/dark setting just like the rest of HY3N.
const CLEAN_GOOGLE_STYLE = JSON.stringify([
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]);
// These names are installed by plugins/with-google-navigation.js. The Google
// Navigation SDK requires native asset names here, not a Metro asset URI.
const DRIVER_VEHICLE_MARKER_ASSETS = {
  car: Platform.select({ android: 'hy3n_driver_car_marker.png', ios: 'HY3NDriverCarMarker', default: 'hy3n_driver_car_marker.png' }),
  car_delivery: Platform.select({ android: 'hy3n_driver_car_marker.png', ios: 'HY3NDriverCarMarker', default: 'hy3n_driver_car_marker.png' }),
  okada: Platform.select({ android: 'hy3n_driver_motorcycle_marker.png', ios: 'HY3NDriverMotorcycleMarker', default: 'hy3n_driver_motorcycle_marker.png' }),
  delivery: Platform.select({ android: 'hy3n_driver_delivery_marker.png', ios: 'HY3NDriverDeliveryMarker', default: 'hy3n_driver_delivery_marker.png' }),
} as const;

// Older Driver records can use camelCase fields or legacy motorcycle labels.
// Normalize them before choosing a native asset so an Okada account never
// silently falls back to the car marker just because its stored value differs.
function normalizeDriverMapServiceType(value: unknown): keyof typeof DRIVER_VEHICLE_MARKER_ASSETS {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['okada', 'motorcycle', 'motorbike', 'bike', 'two_wheeler'].includes(normalized)) return 'okada';
  if (['delivery', 'express_delivery', 'expressdelivery'].includes(normalized)) return 'delivery';
  if (normalized === 'car_delivery') return 'car_delivery';
  return 'car';
}
// NavigationProvider builds the native routing engine from these options. Keep
// the reference stable across GPS renders so an iPhone never rebuilds a route
// session just because the Driver vehicle moved.
const HY3N_NAVIGATION_TERMS_OPTIONS = {
  title: 'HY3N Driver Navigation',
  companyName: 'HY3N Transport Services',
  showOnlyDisclaimer: false,
  uiParams: {
    acceptButtonTextColor: GREEN,
    cancelButtonTextColor: '#B91C1C',
  },
} as const;

function hasPoint(latitude?: number, longitude?: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(Number(latitude)) <= 90
    && Math.abs(Number(longitude)) <= 180
    && !(Number(latitude) === 0 && Number(longitude) === 0);
}

function hasFreshNavigationFix(accuracy: number | null | undefined, time: number | null | undefined) {
  return accuracy != null && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 50
    && time != null && Number.isFinite(time) && Date.now() - time <= 15_000 && time - Date.now() <= 5_000;
}

function routeDistanceMeters(points: readonly DriverRoutePoint[]) {
  return points.slice(1).reduce((total, point, index) => total + distanceBetweenPositionsMetres(
    { latitude: points[index].lat, longitude: points[index].lng, heading: 0 },
    { latitude: point.lat, longitude: point.lng, heading: 0 },
  ), 0);
}

type DriverNavigationLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  heading?: number | null;
  time?: number | null;
  source: 'expo' | 'ios-navigation';
};

/**
 * On iPhone, Expo and Google Navigation run distinct location providers.
 * A confirmed raw-GPS deviation must not be hidden by a newer old-road snap.
 * Otherwise retain a bounded native preference when the providers agree, so
 * millisecond timestamp jitter does not move the marker between two feeds.
 */
function freshestNavigationLocation(
  expo: DriverNavigationLocation | null,
  native: DriverNavigationLocation | null,
  preferRawGps = false,
  previousSource?: DriverNavigationLocation['source'],
) {
  const expoIsFresh = Boolean(expo && hasPoint(expo.latitude, expo.longitude)
    && hasFreshNavigationFix(expo.accuracyMeters, expo.time));
  const nativeIsFresh = Boolean(native && hasPoint(native.latitude, native.longitude)
    && hasFreshNavigationFix(native.accuracyMeters, native.time));
  if (!expoIsFresh && !nativeIsFresh) return null;
  if (!expoIsFresh) return native;
  if (!nativeIsFresh) return expo;
  const separation = distanceBetweenPositionsMetres({ ...expo!, heading: 0 }, { ...native!, heading: 0 });
  const agreementMetres = Math.max(20, Math.min(35, Number(expo!.accuracyMeters) + Number(native!.accuracyMeters)));
  if (preferRawGps && separation > agreementMetres) return expo;
  if (previousSource === 'ios-navigation' && separation <= agreementMetres
    && Number(expo!.time) - Number(native!.time) < 1_000) return native;
  return Number(native!.time) >= Number(expo!.time) ? native : expo;
}

function readableNavigationFailure(status: NavigationSessionStatus | RouteStatus) {
  switch (status) {
    case NavigationSessionStatus.NOT_AUTHORIZED:
      return 'Embedded navigation is not authorised for this app yet.';
    case NavigationSessionStatus.LOCATION_PERMISSION_MISSING:
    case RouteStatus.LOCATION_DISABLED:
      return 'Turn on precise location to start in-app navigation.';
    case RouteStatus.LOCATION_UNKNOWN:
      return 'Waiting for Google Navigation to acquire your current location.';
    case NavigationSessionStatus.NETWORK_ERROR:
    case RouteStatus.NETWORK_ERROR:
      return 'Navigation needs an internet connection to load this route.';
    case RouteStatus.NO_ROUTE_FOUND:
      return 'A driving route could not be found for this location.';
    default:
      return 'Navigation could not start. Please try again.';
  }
}

/**
 * Mounted only for an active, server-backed pickup/drop-off/approved-stop
 * target. The phone returns to its normal idle-lock behaviour as soon as the
 * target clears or this navigation surface unmounts.
 */
function DriverActiveNavigationKeepAwake() {
  useKeepAwake(DRIVER_ACTIVE_NAVIGATION_KEEP_AWAKE_TAG);
  return null;
}

/**
 * A branded map stays visible for the complete Driver journey. Google
 * Navigation runs as the route and voice engine, while HY3N owns the visual
 * vehicle marker, map camera, and route line. This avoids the NavigationView
 * blue current-location/navigation presentation after a ride is accepted.
 */
function DriverNavigationSurface({
  latitude,
  longitude,
  locationTimestamp,
  locationAccuracy,
  heading,
  target,
  tripStatus,
  serviceType,
  navigationId,
  navigationTopInset = 24,
  navigationBottomInset = 28,
  isDark = false,
  navigationPaused = false,
}: Props) {
  const iosOverlayPalette = useDriverIosOverlayPalette(isDark);
  const {
    navigationController,
    removeAllListeners,
    setOnArrival,
    setOnRouteChanged,
    setOnReroutingRequestedByOffRoute,
    setOnLocationChanged,
    setOnTurnByTurn,
    setOnRemainingTimeOrDistanceChanged,
    setOnTrafficUpdated,
  } = useNavigation();
  const [createdMapViewController, setMapViewController] = useState<MapViewController | null>(null);
  // SDK 0.16.3 creates the JS handle before Android getMapAsync initializes
  // its native controller. Join both independent callbacks before route writes.
  // iOS retains its existing controller-created lifecycle.
  const [androidMapReady, setAndroidMapReady] = useState(false);
  const mapViewController = Platform.OS === 'android' && (!androidMapReady || !hasPoint(latitude, longitude))
    ? null : createdMapViewController;
  const routeMapReadyRef = useRef(Platform.OS !== 'android');
  routeMapReadyRef.current = Platform.OS !== 'android' || (androidMapReady && hasPoint(latitude, longitude));
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState<number | null>(null);
  const [guidance, setGuidance] = useState<{ targetKey: string; data: DriverGuidance; atMs: number } | null>(null);
  const [nativeMetrics, setNativeMetrics] = useState<{ targetKey: string; meters: number | null; seconds: number | null; atMs: number } | null>(null);
  const guidanceReadyRef = useRef(false);
  const guidanceValidAfterRef = useRef(0);
  const expectedNativeGenerationRef = useRef<number | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const followingRef = useRef(true);
  const cameraSampleRef = useRef<DriverFollowCameraSample | null>(null);
  const cameraOptionsRef = useRef<DriverNavigationCameraOptions>({});
  const cameraControllerRef = useRef<MapViewController | null>(null);
  cameraControllerRef.current = mapViewController;
  const pendingCameraRef = useRef<{ sample: DriverFollowCameraSample; controller: MapViewController; targetKey: string; request: number } | null>(null);
  const cameraWritingRef = useRef(false);
  const [bannerHeight, setBannerHeight] = useState(170);
  const [viewportHeight, setViewportHeight] = useState(800);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const diagnostics = useRef(createDriverNavigationDiagnostics()).current;
  const nativeLocationRef = useRef<DriverNavigationLocation | null>(null);
  const expoLocationRef = useRef<DriverNavigationLocation | null>(null);
  const rawDeviationConfirmedRef = useRef(false);
  const nativeOffRouteMonitorRef = useRef(EMPTY_DRIVER_OFF_ROUTE_MONITOR);
  const nativeWrongWayMonitorRef = useRef(EMPTY_DRIVER_WRONG_WAY_MONITOR);
  const lastFallbackRerouteAtMsRef = useRef(0);
  const confirmedRerouteRef = useRef<{ request: number; origin: { latitude: number; longitude: number }; atMs: number } | null>(null);
  const initializedRef = useRef(false);
  const navigationRequestRef = useRef(0);
  const navigationWorkRef = useRef<Promise<void>>(Promise.resolve());
  const lastTargetKeyRef = useRef<string | null>(null);
  const vehiclePositionRef = useRef<DriverMapPosition | null>(null);
  const vehiclePositionTimestampRef = useRef<number | null>(null);
  const vehicleMotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vehicleObservationRef = useRef<{ key: string; source: DriverNavigationLocation['source']; time: number; position: DriverMapPosition } | null>(null);
  const cameraMovementRef = useRef({ metres: 0, untilMs: 0 });
  const animateObservationRef = useRef<(fix: DriverNavigationLocation | null) => void>(() => {});
  const vehicleFrameWriterRef = useRef<(position: DriverMapPosition, followTrip: boolean) => void>(() => {});
  const vehicleMotionRunRef = useRef(0);
  const routeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeRefreshRunRef = useRef(0);
  // Native polyline operations cross an asynchronous bridge. Keep one ordered
  // queue so an older route-change event can never add its green line after a
  // newer reroute or after the destination has changed.
  const routeOverlayWorkRef = useRef<Promise<void>>(Promise.resolve());
  const rerouteMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routePointsRef = useRef<DriverRoutePoint[]>([]);
  const routeTrafficSegmentsRef = useRef<unknown[]>([]);
  const trafficPolylineIdsRef = useRef(new Set<string>());
  const staleRoutePlanRef = useRef<DriverRoutePoint[] | null>(null);
  // A target is considered locally arrived only for display. It is reset only
  // when the server-backed pickup/drop-off/stop target changes; it never
  // changes trip state or advances a stop by itself.
  const arrivedTargetKeyRef = useRef<string | null>(null);
  const offRouteMonitorRef = useRef(EMPTY_DRIVER_OFF_ROUTE_MONITOR);
  const wrongWayMonitorRef = useRef(EMPTY_DRIVER_WRONG_WAY_MONITOR);
  const forcedRerouteInFlightRef = useRef(false);
  const hasDeviceLocation = hasPoint(latitude, longitude);
  const normalizedServiceType = normalizeDriverMapServiceType(serviceType);
  const vehicleMarkerAsset = DRIVER_VEHICLE_MARKER_ASSETS[normalizedServiceType];
  const lastVehicleMarkerAssetRef = useRef<string | null>(null);
  const vehicleMarkerControllerRef = useRef<MapViewController | null>(null);
  const pendingVehicleMarkerRef = useRef<{ controller: MapViewController; marker: any; asset: string } | null>(null);
  const vehicleMarkerWorkerRunningRef = useRef(false);
  const targetLatitude = Number(target?.latitude);
  const targetLongitude = Number(target?.longitude);
  const targetLabel = target?.label?.trim() || (tripStatus === 'dropoff' ? 'Drop-off' : 'Pickup');
  const hasTarget = hasPoint(targetLatitude, targetLongitude);
  const closeDrivingView = Platform.OS === 'ios' && hasTarget && tripStatus === 'dropoff' && !navigationPaused;
  const targetKey = hasTarget
    ? `${navigationId || 'trip'}:${tripStatus || 'target'}:${target?.kind || 'target'}:${targetLatitude.toFixed(6)}:${targetLongitude.toFixed(6)}:${targetLabel}`
    : null;
  const activeTargetRef = useRef<{ key: string; latitude: number; longitude: number } | null>(null);
  activeTargetRef.current = hasTarget && targetKey
    ? { key: targetKey, latitude: targetLatitude, longitude: targetLongitude }
    : null;
  // Async native callbacks must read the latest real GPS fix, not coordinates
  // captured when the destination was first set. Google’s iOS callback is a
  // road-snapped CLLocation, expressed by the bridge in Unix milliseconds.
  const liveLocationRef = useRef<DriverNavigationLocation | null>(null);
  expoLocationRef.current = hasDeviceLocation
    ? {
      latitude: Number(latitude), longitude: Number(longitude), accuracyMeters: locationAccuracy,
      heading, time: locationTimestamp, source: 'expo',
    }
    : null;
  // This correction is intentionally iOS-only. Android keeps its established
  // Expo path; no Android Navigation SDK behavior is inferred from the iPhone
  // bridge investigation.
  const currentNavigationLocation = useCallback(() => {
    const current = Platform.OS === 'ios'
      ? freshestNavigationLocation(expoLocationRef.current, nativeLocationRef.current, rawDeviationConfirmedRef.current, liveLocationRef.current?.source)
      : expoLocationRef.current;
    liveLocationRef.current = current;
    return current;
  }, []);

  useEffect(() => {
    currentNavigationLocation();
  }, [currentNavigationLocation, latitude, locationAccuracy, locationTimestamp, longitude]);

  useEffect(() => {
    if (Platform.OS !== 'android' || hasDeviceLocation) return;
    // The location gate unmounts MapView. Its replacement has a new nativeID;
    // old readiness and the old JS controller cannot authorize new route work.
    setAndroidMapReady(false);
    setMapViewController(null);
    trafficPolylineIdsRef.current.clear();
  }, [hasDeviceLocation]);

  const clearGuidance = useCallback(() => {
    guidanceReadyRef.current = false;
    guidanceValidAfterRef.current = Date.now();
    setGuidance(null);
    setRemainingDistanceMeters(null);
    setNativeMetrics(null);
  }, []);

  const updateFollowingCamera = useCallback((position: DriverMapPosition, force = false) => {
    if (!mapViewController || !activeTargetRef.current || !followingRef.current) return;
    const now = Date.now();
    const options = Platform.OS === 'ios' ? { ...cameraOptionsRef.current,
      acceptedMovementMeters: now <= cameraMovementRef.current.untilMs ? cameraMovementRef.current.metres : 0,
    } : cameraOptionsRef.current;
    const next = driverNavigationCamera(position, cameraSampleRef.current, now, force, options);
    if (!next) return;
    cameraSampleRef.current = next;
    pendingCameraRef.current = { sample: next, controller: mapViewController, targetKey: activeTargetRef.current.key, request: navigationRequestRef.current };
    if (cameraWritingRef.current) return;
    cameraWritingRef.current = true;
    void (async () => {
      try {
        while (pendingCameraRef.current && followingRef.current && activeTargetRef.current) {
          const pending = pendingCameraRef.current;
          pendingCameraRef.current = null;
          if (pending.controller !== cameraControllerRef.current || pending.targetKey !== activeTargetRef.current.key
            || pending.request !== navigationRequestRef.current) continue;
          await Promise.resolve(pending.controller.moveCamera(pending.sample.camera));
        }
      } catch (error) {
        diagnostics('polyline.failed', { reason: 'camera', code: navigationErrorCode(error) });
      } finally {
        cameraWritingRef.current = false;
      }
    })();
  }, [diagnostics, mapViewController]);

  const pauseFollowing = useCallback(() => {
    followingRef.current = false;
    pendingCameraRef.current = null;
    setIsFollowing(false);
  }, []);
  const recenter = useCallback(() => {
    followingRef.current = true;
    setIsFollowing(true);
    if (Platform.OS !== 'ios') cameraSampleRef.current = null;
    if (vehiclePositionRef.current) updateFollowingCamera(vehiclePositionRef.current, true);
  }, [updateFollowingCamera]);
  const mapPadding = useMemo(() => driverNavigationMapPadding(
    hasTarget ? navigationTopInset + bannerHeight + 12 : navigationTopInset,
    navigationBottomInset, viewportHeight, Platform.OS === 'android' ? (PixelRatio?.get?.() ?? 1) : 1,
  ), [bannerHeight, hasTarget, navigationBottomInset, navigationTopInset, viewportHeight]);
  // Read the latest framing through a ref: layout/GPS renders must not change
  // the camera callback's identity and cancel an in-flight destination setup.
  cameraOptionsRef.current = {
    closeDrivingView,
    usableViewportHeight: Math.max(0, viewportHeight - mapPadding.top - mapPadding.bottom),
  };

  const runNavigationWork = useCallback((operation: () => Promise<void>) => {
    const work = navigationWorkRef.current.then(operation);
    navigationWorkRef.current = work.catch(() => {});
    return work;
  }, []);

  const clearVehicleMotion = useCallback(() => {
    vehicleMotionRunRef.current += 1;
    if (vehicleMotionTimerRef.current) clearTimeout(vehicleMotionTimerRef.current);
    vehicleMotionTimerRef.current = null;
  }, []);

  const clearRouteRefresh = useCallback(() => {
    routeRefreshRunRef.current += 1;
    if (routeRefreshTimerRef.current) clearTimeout(routeRefreshTimerRef.current);
    if (rerouteMessageTimerRef.current) clearTimeout(rerouteMessageTimerRef.current);
    routeRefreshTimerRef.current = null;
    rerouteMessageTimerRef.current = null;
  }, []);

  const applyVehiclePosition = useCallback((position: DriverMapPosition, followTrip: boolean) => {
    if (!mapViewController) return;
    if (followTrip) updateFollowingCamera(position);
    const marker = {
      id: DRIVER_VEHICLE_MARKER_ID,
      position: { lat: position.latitude, lng: position.longitude },
      imgPath: vehicleMarkerAsset,
      title: normalizedServiceType === 'okada' ? 'Your HY3N motorcycle' : normalizedServiceType === 'delivery' ? 'Your HY3N delivery motorcycle' : 'Your HY3N vehicle',
      rotation: position.heading,
      flat: true,
      anchor: { u: 0.5, v: 0.5 },
      visible: true,
    };
    // Vehicle updates are ultimately applied through mapViewController.addMarker
    // so the branded marker remains the only live navigation indicator.
    // The Navigation SDK does not reliably replace the image of an existing
    // marker when addMarker is called again with the same ID. Remove it once
    // when the service asset changes, then recreate it with the correct image.
    if (vehicleMarkerControllerRef.current !== mapViewController) {
      vehicleMarkerControllerRef.current = mapViewController;
      lastVehicleMarkerAssetRef.current = null;
    }
    // The native bridge can take longer than one animation frame. Keep only
    // the newest marker position instead of chaining every obsolete GPS frame
    // into a Promise queue. One native marker write runs at a time.
    pendingVehicleMarkerRef.current = { controller: mapViewController, marker, asset: vehicleMarkerAsset };
    if (!vehicleMarkerWorkerRunningRef.current) {
      vehicleMarkerWorkerRunningRef.current = true;
      void (async () => {
        try {
          while (pendingVehicleMarkerRef.current) {
            const pending = pendingVehicleMarkerRef.current;
            pendingVehicleMarkerRef.current = null;
            if (vehicleMarkerControllerRef.current !== pending.controller) continue;
            if (lastVehicleMarkerAssetRef.current !== pending.asset) {
              await Promise.resolve(pending.controller.removeMarker(DRIVER_VEHICLE_MARKER_ID)).catch(() => undefined);
              if (vehicleMarkerControllerRef.current !== pending.controller) continue;
              lastVehicleMarkerAssetRef.current = pending.asset;
            }
            // A newer frame may have arrived during removeMarker. Prefer it
            // before writing an already-outdated native marker position.
            const newerPending = pendingVehicleMarkerRef.current as { controller: MapViewController; marker: any; asset: string } | null;
            if (newerPending && newerPending.controller === pending.controller) continue;
            try {
              await pending.controller.addMarker(pending.marker);
            } catch (error) {
              // Some Android Navigation SDK builds fail to resolve an app asset
              // from the native assets directory. Keep the live Driver visible
              // with Google's standard marker rather than dropping it entirely.
              diagnostics('marker.failed', { code: navigationErrorCode(error), asset: pending.asset });
              const fallbackMarker = { ...pending.marker };
              delete fallbackMarker.imgPath;
              await pending.controller.addMarker(fallbackMarker);
            }
          }
        } catch (error) {
          console.warn('[HY3N] Could not update the live vehicle marker.', error);
        } finally {
          vehicleMarkerWorkerRunningRef.current = false;
          // Close the race where a frame arrives as the worker is finishing.
          if (pendingVehicleMarkerRef.current) {
            const latest = pendingVehicleMarkerRef.current;
            pendingVehicleMarkerRef.current = null;
            applyVehiclePosition(
              { latitude: latest.marker.position.lat, longitude: latest.marker.position.lng, heading: latest.marker.rotation },
              followTrip,
            );
          }
        }
      })();
    }

  }, [diagnostics, mapViewController, normalizedServiceType, updateFollowingCamera, vehicleMarkerAsset]);
  useLayoutEffect(() => {
    vehicleFrameWriterRef.current = applyVehiclePosition;
  }, [applyVehiclePosition]);

  // Both iPhone providers enter the same animator. Course/accuracy-only renders
  // must not cancel an in-flight movement or restart its cadence clock.
  const animateVehicleObservation = useCallback((fix: DriverNavigationLocation | null) => {
    if (!mapViewController || !fix || !hasPoint(fix.latitude, fix.longitude)
      || !hasFreshNavigationFix(fix.accuracyMeters, fix.time)) return;
    const timestamp = Number(fix.time);
    const key = `${fix.source}:${timestamp}:${fix.latitude}:${fix.longitude}`;
    const previousObservation = vehicleObservationRef.current;
    if (previousObservation?.key === key) return;
    if (previousObservation && timestamp <= previousObservation.time && fix.source === previousObservation.source) return;
    // Provider clocks do not establish spatial authority. The selected fresh
    // raw fix must take over after confirmed deviation, even if its timestamp
    // trails an obsolete snapped point. Reset cadence for a backward handoff;
    // never replay an older sample within the SAME provider.
    const backwardHandoff = previousObservation && fix.source !== previousObservation.source
      && timestamp <= previousObservation.time;
    const incoming = { latitude: fix.latitude, longitude: fix.longitude,
      heading: validatedDriverCourse(fix.heading) ?? Number.NaN };
    const durationMs = driverMapMotionDurationMs(backwardHandoff ? null : vehiclePositionTimestampRef.current, timestamp);
    // Never animate a known deviation along the old route. The helper also
    // validates endpoint proximity, direction and path length before bends.
    const frames = driverMapMotionFrames(vehiclePositionRef.current, incoming, durationMs, {
      alignHeadingToMovement: true,
      routePoints: staleRoutePlanRef.current ? [] : routePointsRef.current,
    });
    if (!frames.length) return;
    const movement = previousObservation
      ? distanceBetweenPositionsMetres(previousObservation.position, incoming) : 0;
    vehicleObservationRef.current = { key, source: fix.source, time: timestamp, position: incoming };
    vehiclePositionTimestampRef.current = timestamp;
    cameraMovementRef.current = { metres: movement, untilMs: Date.now() + durationMs + 100 };
    clearVehicleMotion();
    const run = vehicleMotionRunRef.current;
    const controller = mapViewController;
    let index = 0;
    const frameIntervalMs = durationMs / frames.length;
    const showFrame = () => {
      if (vehicleMotionRunRef.current !== run || cameraControllerRef.current !== controller) return;
      const frame = frames[index++];
      if (!frame) return;
      vehiclePositionRef.current = frame;
      vehicleFrameWriterRef.current(frame, Boolean(activeTargetRef.current));
      if (index < frames.length) vehicleMotionTimerRef.current = setTimeout(showFrame, frameIntervalMs);
      else {
        vehicleMotionTimerRef.current = null;
        updateFollowingCamera(frame, true);
        cameraMovementRef.current = { metres: 0, untilMs: 0 };
      }
    };
    showFrame();
  }, [clearVehicleMotion, mapViewController, updateFollowingCamera]);
  useLayoutEffect(() => {
    animateObservationRef.current = animateVehicleObservation;
  }, [animateVehicleObservation]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    vehicleObservationRef.current = null;
    vehiclePositionTimestampRef.current = null;
    return clearVehicleMotion;
  }, [clearVehicleMotion, mapViewController]);

  useEffect(() => {
    if (Platform.OS === 'ios' && vehiclePositionRef.current) {
      applyVehiclePosition(vehiclePositionRef.current, Boolean(activeTargetRef.current));
    }
  }, [applyVehiclePosition, vehicleMarkerAsset]);

  // Interpolate each real GPS observation into small native-map updates. The
  // car uses the device heading where available and only follows positions the
  // Driver app has received; this display layer has no effect on fare or meter.
  useEffect(() => {
    if (Platform.OS === 'ios') {
      animateVehicleObservation(currentNavigationLocation());
      return;
    }
    if (!mapViewController || !hasDeviceLocation) return;
    // Preserve the released Android Expo interpolation and road projection.
    const reportedHeading = heading === null || heading === undefined ? Number.NaN : Number(heading);
    const next = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      // Preserve unavailable course as NaN for the legacy displacement fallback.
      // A negative heading means "no valid course" (for example when the car
      // is stopped); treating it as 359 degrees made the car and camera spin.
      heading: reportedHeading < 0 ? Number.NaN : reportedHeading,
    };
    // iOS already receives Google's road-snapped fix. On Android the car used
    // the raw GPS point and could drift beside the green route line. While the
    // Driver is genuinely on the route (within 20 m), draw the car on the road
    // and face it along the road. Beyond that it shows the real GPS position,
    // so a missed turn is still visible and still triggers the reroute checks.
    if (routePointsRef.current.length >= 2) {
      const onRoad = projectDriverOnRoute(
        { latitude: next.latitude, longitude: next.longitude },
        routePointsRef.current,
      );
      if (onRoad && onRoad.distanceMeters <= 20) {
        next.latitude = onRoad.point.lat;
        next.longitude = onRoad.point.lng;
        if (!Number.isFinite(next.heading)) next.heading = onRoad.bearing;
      }
    }
    const sampleTimestamp = locationTimestamp ?? null;
    const currentTimestamp = typeof sampleTimestamp === 'number' && Number.isFinite(sampleTimestamp)
      ? sampleTimestamp
      : null;
    const durationMs = driverMapMotionDurationMs(vehiclePositionTimestampRef.current, currentTimestamp);
    const frames = driverMapMotionFrames(vehiclePositionRef.current, next, durationMs);
    if (currentTimestamp !== null) vehiclePositionTimestampRef.current = currentTimestamp;
    const run = vehicleMotionRunRef.current + 1;
    clearVehicleMotion();
    vehicleMotionRunRef.current = run;
    let index = 0;
    const frameIntervalMs = frames.length > 0 ? durationMs / frames.length : 110;

    const showFrame = () => {
      if (vehicleMotionRunRef.current !== run) return;
      const frame = frames[index++];
      if (!frame) return;
      vehiclePositionRef.current = frame;
      applyVehiclePosition(frame, hasTarget);
      if (index < frames.length) vehicleMotionTimerRef.current = setTimeout(showFrame, frameIntervalMs);
    };
    showFrame();
    return clearVehicleMotion;
  }, [animateVehicleObservation, applyVehiclePosition, clearVehicleMotion, currentNavigationLocation, hasDeviceLocation, hasTarget, heading, latitude, locationAccuracy, locationTimestamp, longitude, mapViewController]);

  const clearRouteLines = useCallback(async () => {
    if (!mapViewController || !routeMapReadyRef.current) return;

    // Unlike the native navigation engine, these two branded polylines are
    // HY3N-owned overlays. Remove them as one awaited operation before drawing
    // replacement geometry, otherwise an off-route Driver can see the road
    // they have already left until the map's asynchronous bridge catches up.
    const results = await Promise.allSettled([
      Promise.resolve(mapViewController.removePolyline(DRIVER_ROUTE_OUTLINE_ID)),
      Promise.resolve(mapViewController.removePolyline(DRIVER_ROUTE_ID)),
      ...Array.from(trafficPolylineIdsRef.current, (id) => Promise.resolve(mapViewController.removePolyline(id))),
    ]);
    trafficPolylineIdsRef.current.clear();
    for (const result of results) if (result.status === 'rejected') diagnostics('polyline.failed', { reason: 'remove', code: navigationErrorCode(result.reason) });
  }, [diagnostics, mapViewController]);

  // Called only inside the ordered overlay queue, using the exact accepted
  // snapshot. The installed iOS bridge supplies no route-stretch traffic;
  // retain its genuine native road traffic layer without inventing red roads.
  const drawRouteTraffic = useCallback(async (isCurrent: () => boolean) => {
    if (!mapViewController || !routeMapReadyRef.current || !isCurrent()) return;
    const location = currentNavigationLocation();
    const remaining = remainingDriverRoute(location, routePointsRef.current);
    const projection = location && remaining.length >= 2 ? projectDriverOnRoute(location, routePointsRef.current) : null;
    const intervals = Platform.OS === 'android' ? normalizeDriverRouteTraffic(
      routeTrafficSegmentsRef.current, { progressMeters: projection?.progressMeters ?? 0 },
    ) : [];
    const keepIds = new Set<string>();
    for (const [index, interval] of intervals.entries()) {
      if (!isCurrent()) return;
      const id = `hy3n-driver-traffic-${index}`;
      keepIds.add(id);
      trafficPolylineIdsRef.current.add(id);
      await mapViewController.addPolyline({ id, points: interval.points, color: interval.color, width: 8, visible: true, ...ROUTE_LAYERS.traffic });
    }
    for (const id of Array.from(trafficPolylineIdsRef.current)) {
      if (!isCurrent()) return;
      if (!keepIds.has(id)) {
        await mapViewController.removePolyline(id);
        trafficPolylineIdsRef.current.delete(id);
      }
    }
  }, [currentNavigationLocation, mapViewController]);

  const clearRoute = useCallback(() => {
    const request = navigationRequestRef.current;
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || navigationRequestRef.current !== request) return;
      await clearRouteLines();
      if (navigationRequestRef.current !== request) return;
      await Promise.allSettled([Promise.resolve(mapViewController.removeMarker(DRIVER_TARGET_MARKER_ID))]);
    });
    routeOverlayWorkRef.current = work.catch(() => {});
    setRemainingDistanceMeters(null);
    return work;
  }, [clearRouteLines, mapViewController]);

  const updateRemainingRoute = useCallback(() => {
    if (arrivedTargetKeyRef.current && arrivedTargetKeyRef.current === activeTargetRef.current?.key) return;
    const request = navigationRequestRef.current;
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || !routeMapReadyRef.current || navigationRequestRef.current !== request) return;
      const currentLocation = currentNavigationLocation();
      const points = staleRoutePlanRef.current && isSameDriverRoadPlan(routePointsRef.current, staleRoutePlanRef.current)
        ? [] : remainingDriverRoute(currentLocation, routePointsRef.current);
      // Keep the last verified road visible during a brief stale/invalid GPS
      // window. Clear it only after valid replacement geometry is available.
      if (points.length < 2) return;
      setRemainingDistanceMeters(routeDistanceMeters(points));
      // Both native bridges update an existing custom ID in place. Progress
      // must not remove and recreate healthy route lines on every GPS fix.
      if (navigationRequestRef.current !== request) return;
      await mapViewController.addPolyline({
        id: DRIVER_ROUTE_OUTLINE_ID, points, color: ROUTE_OUTLINE, width: 14, visible: true,
        ...ROUTE_LAYERS.outline,
      });
      if (navigationRequestRef.current !== request) { await clearRouteLines(); return; }
      await mapViewController.addPolyline({
        id: DRIVER_ROUTE_ID, points, color: NAVIGATION_ROUTE, width: 8, visible: true,
        ...ROUTE_LAYERS.base,
      });
      if (navigationRequestRef.current === request) await drawRouteTraffic(() => navigationRequestRef.current === request);
      if (navigationRequestRef.current !== request) await clearRouteLines();
    });
    routeOverlayWorkRef.current = work.catch((error) => {
      diagnostics('polyline.failed', { request, reason: 'gps_progress', code: navigationErrorCode(error) });
    });
  }, [clearRouteLines, currentNavigationLocation, diagnostics, drawRouteTraffic, mapViewController]);

  const drawNavigationRoute = useCallback((isCurrent: () => boolean = () => true) => {
    const request = navigationRequestRef.current;
    const key = activeTargetRef.current?.key;
    const requestIsCurrent = isCurrent;
    isCurrent = () => requestIsCurrent() && (!['android', 'ios'].includes(Platform.OS)
      || (navigationRequestRef.current === request && activeTargetRef.current?.key === key
        && cameraControllerRef.current === mapViewController && routeMapReadyRef.current));
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || !routeMapReadyRef.current || !hasTarget || !isCurrent() || arrivedTargetKeyRef.current === activeTargetRef.current?.key) return false;
      let stage: 'geometry' | 'polyline' = 'geometry';
      try {
        // Android and iOS can expose different route snapshots immediately
        // after setDestination. Read both native sources and choose the route
        // that actually reaches the active pickup/drop-off target, preferring
        // the complete route when the current segment is only a prefix.
        const [currentSegmentResult, completeSegmentsResult] = await Promise.allSettled([
          navigationController.getCurrentRouteSegment(),
          navigationController.getRouteSegments(),
        ]);
        if (currentSegmentResult.status === 'rejected'
          && (Platform.OS === 'ios' || completeSegmentsResult.status === 'rejected')) {
          // Preserve the native error contract when neither source can provide
          // geometry. If only one source fails, the other remains usable on
          // Android and the route can still be rendered.
          throw currentSegmentResult.reason;
        }
        const currentSegment = currentSegmentResult.status === 'fulfilled' ? currentSegmentResult.value : null;
        const completeSegments = completeSegmentsResult.status === 'fulfilled' ? completeSegmentsResult.value : [];
        const routeCandidates = [
          { points: routePointsForMap([currentSegment]), segments: [currentSegment] },
          { points: routePointsForMap(completeSegments), segments: completeSegments },
        ].filter((candidate) => candidate.points.length >= 2);
        const iosCurrentLeg = Platform.OS === 'ios';
        const candidateMatchesTarget = (candidate: typeof routeCandidates[number]) => Platform.OS === 'android'
          ? driverAndroidRouteMatchesTarget(candidate.segments, candidate.points, { lat: targetLatitude, lng: targetLongitude })
          : Platform.OS === 'ios'
            ? driverIosRouteMatchesTarget(candidate.segments, candidate.points, { lat: targetLatitude, lng: targetLongitude })
            : driverRouteReachesTarget(candidate.points, { lat: targetLatitude, lng: targetLongitude });
        const locationAtRead = iosCurrentLeg ? currentNavigationLocation() : null;
        const connectedCandidate = iosCurrentLeg && locationAtRead
          ? routeCandidates.find(candidate => candidateMatchesTarget(candidate)
            && remainingDriverRoute(locationAtRead, candidate.points).length >= 2) : null;
        const selected = connectedCandidate ?? routeCandidates.find(candidateMatchesTarget)
          ?? routeCandidates.sort((a, b) => b.points.length - a.points.length)[0];
        const points = selected?.points ?? [];
        const targetMatches = Boolean(selected && candidateMatchesTarget(selected));
        diagnostics('geometry.received', { request: navigationRequestRef.current, points: points.length, targetMatches, source: iosCurrentLeg ? 'ios-current-and-complete' : 'android-current-and-complete' });
        if (!isCurrent() || points.length < 2 || !targetMatches) {
          diagnostics('geometry.rejected', { reason: !isCurrent() ? 'stale_request' : points.length < 2 ? 'invalid_points' : 'wrong_target' });
          return false;
        }
        stage = 'polyline';
        // Native path prefixes can change on progress/traffic reads without a
        // genuine new direction. Never erase distinct real-GPS evidence because
        // JSON geometry changed. The next GPS assessment recalculates against
        // this geometry; only a real target change resets the monitors.
        const currentLocation = currentNavigationLocation();
        const remaining = remainingDriverRoute(currentLocation, points);
        if (iosCurrentLeg && currentLocation && remaining.length < 2) {
          diagnostics('geometry.rejected', { reason: 'not_on_current_road' });
          return false;
        }
        // Google can still return the old leg while a reroute is pending.
        // Confirm continuity against the GPS at ACCEPTANCE, not only the frozen
        // request origin: the car may travel while setDestination is pending.
        const confirmation = confirmedRerouteRef.current;
        const confirmedFreshStart = iosCurrentLeg && confirmation?.request === navigationRequestRef.current
          && Date.now() - confirmation.atMs <= 30_000
          && remaining.length >= 2
          && (driverRouteStartsAtLocation(points, currentLocation)
            || driverRouteStartsAtLocation(points, confirmation.origin));
        const replacementIsUnconfirmed = staleRoutePlanRef.current
          && isSameDriverRoadPlan(points, staleRoutePlanRef.current)
          && !confirmedFreshStart;
        if (replacementIsUnconfirmed) {
          diagnostics('geometry.rejected', { reason: remaining.length < 2 ? 'not_on_current_road' : 'unconfirmed_shared_road' });
          return false;
        }
        // Quarantine unknown-location replacements, but keep a previously
        // verified route during a temporary loss of BOTH location feeds.
        if (iosCurrentLeg && !currentLocation && (staleRoutePlanRef.current || !routePointsRef.current.length
          || !isSameDriverRoadPlan(points, routePointsRef.current))) return false;
        routePointsRef.current = points;
        // A valid Google route is still the best visual guidance available if
        // the native location callback is momentarily stale. Do not erase the
        // last visible route just because trimming it to the latest fix is not
        // possible yet. Once a fresh fix arrives, updateRemainingRoute trims
        // the line back to the Driver's actual road position.
        const displayPoints = remaining.length >= 2 ? remaining : points;
        setRemainingDistanceMeters(routeDistanceMeters(displayPoints));
        staleRoutePlanRef.current = null;
        confirmedRerouteRef.current = null;
        routeTrafficSegmentsRef.current = selected?.segments ?? [];
        // Complete-route geometry has no envelope in this SDK. Validate the
        // independent CURRENT snapshot even when complete geometry is selected;
        // a geometry fallback may never weaken generation matching for turns.
        const contextMatches = driverNavigationFeedMatchesTarget(currentSegment, activeTargetRef.current,
          guidanceValidAfterRef.current, Date.now());
        expectedNativeGenerationRef.current = contextMatches ? (currentSegment as any).hy3nRouteGeneration : null;
        guidanceReadyRef.current = contextMatches;
        if (!contextMatches) {
          setGuidance(null);
          setNativeMetrics(null);
        }

        // Only replace the old overlay after valid geometry has been accepted.
        // This prevents a transient native bridge/GPS failure from leaving the
        // Driver with a blank map while voice guidance continues.
        if (!isCurrent()) return false;
        await mapViewController.addPolyline({
          id: DRIVER_ROUTE_OUTLINE_ID,
          points: displayPoints,
          color: ROUTE_OUTLINE,
          width: 14,
          visible: true,
          ...ROUTE_LAYERS.outline,
        });
        if (!isCurrent()) {
          await clearRouteLines();
          return false;
        }
        await mapViewController.addPolyline({
          id: DRIVER_ROUTE_ID,
          points: displayPoints,
          color: NAVIGATION_ROUTE,
          width: 8,
          visible: true,
          ...ROUTE_LAYERS.base,
        });
        if (isCurrent()) await drawRouteTraffic(isCurrent);
        if (!isCurrent()) {
          await clearRouteLines();
          return false;
        }
        diagnostics('polyline.applied', { request: navigationRequestRef.current, points: displayPoints.length });
        if (driverNavigationDiagnosticsEnabled()) {
          try {
            const nativeLines = await mapViewController.getPolylines();
            const nativePath = nativeLines.find((line) => line.id === DRIVER_ROUTE_ID)?.points;
            const nativePathMatches = Boolean(nativePath && nativePath.length === remaining.length
              && nativePath.every((point, index) => Math.abs(point.lat - remaining[index].lat) < 1e-7 && Math.abs(point.lng - remaining[index].lng) < 1e-7));
            diagnostics('polyline.verified', { request: navigationRequestRef.current, nativePathMatches, points: nativePath?.length ?? 0 });
          } catch (error) {
            diagnostics('polyline.failed', { reason: 'readback', code: navigationErrorCode(error) });
          }
        }
        return true;
      } catch (error) {
        diagnostics(stage === 'geometry' ? 'geometry.failed' : 'polyline.failed', { request: navigationRequestRef.current, code: navigationErrorCode(error) });
        // Navigation voice guidance continues if native route geometry is
        // temporarily unavailable. A later route-change event retries drawing.
        return false;
      }
    });
    // Preserve the ordering queue even after a native bridge failure. The
    // caller gets the real result while the next reroute can still continue.
    routeOverlayWorkRef.current = work.then(() => undefined, () => undefined);
    return work;
  }, [clearRouteLines, currentNavigationLocation, diagnostics, drawRouteTraffic, hasTarget, mapViewController, navigationController, targetLatitude, targetLongitude]);

  /**
   * Google owns off-route detection and route choice. HY3N owns the clean map
   * presentation, so it re-reads the native route after the SDK says a route
   * changed. A short retry window handles the native callback/geometry race on
   * iPhone without resetting a destination or disrupting spoken guidance.
   */
  const refreshBrandedRouteAfterNativeChange = useCallback((offRoute: boolean) => {
    if (arrivedTargetKeyRef.current && arrivedTargetKeyRef.current === activeTargetRef.current?.key) return;
    clearRouteRefresh();
    const run = routeRefreshRunRef.current + 1;
    routeRefreshRunRef.current = run;

    if (offRoute) {
      clearGuidance();
      setNavigationMessage('Re-routing from your current road…');
    }

    const redraw = (attempt: number) => {
      if (routeRefreshRunRef.current !== run) return;

      const drawReplacement = () => {
        if (routeRefreshRunRef.current !== run) return;
        void drawNavigationRoute(() => routeRefreshRunRef.current === run).then((painted) => {
          if (routeRefreshRunRef.current !== run) return;
          const nextDelay = DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS[attempt + 1];
          if (nextDelay !== undefined) {
            routeRefreshTimerRef.current = setTimeout(() => redraw(attempt + 1), nextDelay);
            return;
          }
          routeRefreshTimerRef.current = null;
          if (offRoute && painted) {
            rerouteMessageTimerRef.current = setTimeout(() => {
              if (routeRefreshRunRef.current === run) {
                setNavigationMessage((message) => message === 'Re-routing from your current road…' ? null : message);
              }
            }, 900);
          }
        });
      };

      // Every attempt is serialized with the prior map operation. This matters
      // on iOS where route-changed events can arrive before the old overlay's
      // removal has crossed the native bridge.
      drawReplacement();
    };

    redraw(0);
  }, [clearGuidance, clearRouteRefresh, drawNavigationRoute]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !androidMapReady || !mapViewController
      || !hasDeviceLocation || navigationPaused || !targetKey
      || lastTargetKeyRef.current !== targetKey || !initializedRef.current) return;
    // A ready replacement map needs the existing accepted route immediately.
    // Recover overlays only; the native destination/guidance engine stays live.
    refreshBrandedRouteAfterNativeChange(false);
  }, [androidMapReady, hasDeviceLocation, mapViewController, navigationPaused, refreshBrandedRouteAfterNativeChange, targetKey]);

  /**
   * The iOS bridge forwards route-change events, but a real road test showed
   * that it can miss the separate off-route request. Protect Drivers from a
   * frozen line by checking their actual navigation-grade GPS point against
   * the route we drew. Two distinct off-route samples are required before this
   * asks Google to calculate a replacement to the unchanged destination.
   */
  const requestGpsFallbackReroute = useCallback(() => {
    if (
      forcedRerouteInFlightRef.current
      || !initializedRef.current
      || !hasTarget
      || !targetKey
      || lastTargetKeyRef.current !== targetKey
      || arrivedTargetKeyRef.current === targetKey
      || (Platform.OS === 'ios' && Date.now() - lastFallbackRerouteAtMsRef.current < 12_000)
    ) return;

    const request = navigationRequestRef.current;
    const stillCurrent = () => navigationRequestRef.current === request && lastTargetKeyRef.current === targetKey;
    forcedRerouteInFlightRef.current = true;
    if (Platform.OS === 'ios') lastFallbackRerouteAtMsRef.current = Date.now();
    // Invalidate delayed redraws of the old road immediately. Queue removal
    // ahead of all future branded-route writes so a late callback cannot put
    // the obsolete green line back on the map while Google recalculates.
    clearRouteRefresh();
    const clearOldRoute = routeOverlayWorkRef.current.then(() => clearRouteLines());
    routeOverlayWorkRef.current = clearOldRoute.catch(() => {});
    confirmedRerouteRef.current = null;
    staleRoutePlanRef.current = routePointsRef.current.slice();
    clearGuidance();
    setNavigationMessage('Re-routing from your current road…');
    void runNavigationWork(async () => {
      try {
        if (!stillCurrent()) return;
        const currentLocation = currentNavigationLocation();
        const observedOrigin = currentLocation && { ...currentLocation };
        if (!observedOrigin || (Platform.OS === 'ios' && !hasFreshNavigationFix(observedOrigin.accuracyMeters, observedOrigin.time))) {
          diagnostics('route.assessment', { shouldReroute: false, reason: 'stale_or_imprecise_gps' });
          return;
        }
        diagnostics('route.request', { request, accuracyMeters: observedOrigin.accuracyMeters,
          ageMs: observedOrigin.time != null ? Math.max(0, Date.now() - observedOrigin.time) : null });
        if (Platform.OS === 'ios') {
          // Expo GPS does not initialize Google's independent origin provider.
          navigationController.setBackgroundLocationUpdatesEnabled(true);
          navigationController.startUpdatingLocation();
        }
        // Keep the destination server-owned. This only asks Google Navigation
        // to replace its route from the Driver's verified current GPS position.
        const routeStatus = await navigationController.setDestination(
          {
            title: targetLabel,
            position: { lat: targetLatitude, lng: targetLongitude },
            preferSameSideOfRoad: true,
          },
          {
            routingOptions: { travelMode: TravelMode.DRIVING },
            displayOptions: {
              showDestinationMarkers: false,
              showStopSigns: true,
              showTrafficLights: true,
            },
          },
        );
        if (!stillCurrent()) return;
        diagnostics('route.response', { request, status: routeStatus });
        if (routeStatus !== RouteStatus.OK) {
          setNavigationMessage(readableNavigationFailure(routeStatus));
          return;
        }
        confirmedRerouteRef.current = { request, origin: observedOrigin, atMs: Date.now() };
        await navigationController.startGuidance();
        if (!stillCurrent()) return;
        navigationController.setTurnByTurnLoggingEnabled(true);
        refreshBrandedRouteAfterNativeChange(true);
      } catch (error) {
        diagnostics('route.response', { request, status: 'exception', code: navigationErrorCode(error) });
        if (stillCurrent()) setNavigationMessage('Navigation could not re-route. Please check location and connection.');
      } finally {
        forcedRerouteInFlightRef.current = false;
      }
    });
  }, [
    clearGuidance,
    clearRouteLines,
    clearRouteRefresh,
    diagnostics,
    currentNavigationLocation,
    hasTarget,
    navigationController,
    refreshBrandedRouteAfterNativeChange,
    runNavigationWork,
    routeOverlayWorkRef,
    targetKey,
    targetLabel,
    targetLatitude,
    targetLongitude,
  ]);

  const assessNavigationLocation = useCallback((observedLocation: DriverNavigationLocation | null) => {
    if (
      !hasTarget
      || !targetKey
      || !initializedRef.current
      || lastTargetKeyRef.current !== targetKey
      || arrivedTargetKeyRef.current === targetKey
      || routePointsRef.current.length < 2
    ) return;

    const usableFix = Boolean(observedLocation
      && hasFreshNavigationFix(observedLocation.accuracyMeters, observedLocation.time));
    // Native on-road samples cannot reset independent raw-GPS deviation proof.
    const nativeEvidence = Platform.OS === 'ios' && observedLocation?.source === 'ios-navigation';
    const offRouteRef = nativeEvidence ? nativeOffRouteMonitorRef : offRouteMonitorRef;
    const wrongWayRef = nativeEvidence ? nativeWrongWayMonitorRef : wrongWayMonitorRef;
    diagnostics('gps.sample', {
      valid: usableFix,
      accuracyMeters: observedLocation?.accuracyMeters ?? null,
      ageMs: observedLocation?.time != null ? Math.max(0, Date.now() - observedLocation.time) : null,
    });
    if (!observedLocation || (Platform.OS === 'ios' && !usableFix)) {
      offRouteRef.current = { ...offRouteRef.current, consecutiveOffRouteSamples: 0 };
      wrongWayRef.current = { ...wrongWayRef.current, previousLocation: null, consecutiveSamples: 0 };
      diagnostics('route.assessment', { shouldReroute: false, reason: 'stale_or_imprecise_gps' });
      // Keep the last verified route visible while the native provider catches
      // up; replacement geometry is drawn only from a fresh trusted sample.
      return;
    }

    const sampleKey = `${observedLocation.source}:${observedLocation.time != null && Number.isFinite(Number(observedLocation.time))
      ? `timestamp:${Number(observedLocation.time)}`
      : `coordinate:${observedLocation.latitude.toFixed(6)}:${observedLocation.longitude.toFixed(6)}`}`;
    const assessment = assessDriverOffRoute(
      offRouteRef.current,
      observedLocation,
      routePointsRef.current,
      sampleKey,
      Date.now(),
    );
    offRouteRef.current = assessment.next;
    const wrongWay = assessDriverWrongWay(
      wrongWayRef.current,
      observedLocation,
      routePointsRef.current,
      sampleKey,
      Date.now(),
    );
    wrongWayRef.current = wrongWay.next;
    if (Platform.OS === 'ios' && observedLocation.source === 'expo'
      && (assessment.shouldReroute || assessment.next.consecutiveOffRouteSamples >= 2 || wrongWay.shouldReroute)) {
      rawDeviationConfirmedRef.current = true;
      animateObservationRef.current(currentNavigationLocation());
    }
    diagnostics('route.assessment', { distanceMeters: assessment.distanceMeters, thresholdMeters: assessment.thresholdMeters,
      offRoute: assessment.offRoute, wrongWay: wrongWay.shouldReroute, shouldReroute: assessment.shouldReroute || wrongWay.shouldReroute });
    if (assessment.shouldReroute || wrongWay.shouldReroute) requestGpsFallbackReroute();
    updateRemainingRoute();
  }, [
    currentNavigationLocation,
    diagnostics,
    hasTarget,
    requestGpsFallbackReroute,
    targetKey,
    updateRemainingRoute,
  ]);

  const acceptRemainingMetrics = useCallback((value: unknown) => {
    const active = activeTargetRef.current;
    if (!guidanceReadyRef.current || !active || arrivedTargetKeyRef.current === active.key
      || !driverNavigationFeedMatchesTarget(value, active, guidanceValidAfterRef.current, Date.now(), expectedNativeGenerationRef.current)) return;
    const metrics = driverNavigationRemainingMetrics(value);
    if (!metrics) return;
    setNativeMetrics({ targetKey: active.key, ...metrics, atMs: (value as any).hy3nCapturedAtMs });
  }, []);
  const refreshRemainingMetrics = useCallback(async () => {
    const request = navigationRequestRef.current;
    const key = activeTargetRef.current?.key;
    if (!key || !guidanceReadyRef.current || !navigationController.getCurrentTimeAndDistance) return;
    try {
      const value = await navigationController.getCurrentTimeAndDistance();
      if (navigationRequestRef.current === request && activeTargetRef.current?.key === key) acceptRemainingMetrics(value);
    } catch {
      // Missing native ETA is shown as updating, never inferred from car speed.
    }
  }, [acceptRemainingMetrics, navigationController]);

  useEffect(() => {
    setOnTurnByTurn?.((events) => {
      const active = activeTargetRef.current;
      if (!guidanceReadyRef.current || !active || arrivedTargetKeyRef.current === active.key) return;
      const event = Array.isArray(events) ? events.at(-1) : null;
      if (!driverNavigationFeedMatchesTarget(event, active, guidanceValidAfterRef.current, Date.now(), expectedNativeGenerationRef.current)) return;
      const next = normalizeDriverGuidanceEvents([event], Platform.OS === 'ios' ? 'ios' : 'android');
      if (!next) { setGuidance(null); return; }
      if (next.navState !== 'enroute') {
        clearGuidance();
        if (next.navState === 'rerouting') setNavigationMessage('Re-routing from your current road…');
        return;
      }
      const capturedAtMs = (event as any).hy3nCapturedAtMs;
      setGuidance({ targetKey: active.key, data: next, atMs: capturedAtMs });
      if (next.remainingDistanceMeters !== null || next.remainingTimeSeconds !== null) {
        setNativeMetrics({ targetKey: active.key, meters: next.remainingDistanceMeters, seconds: next.remainingTimeSeconds, atMs: capturedAtMs });
      }
    });
    setOnRemainingTimeOrDistanceChanged?.(acceptRemainingMetrics);
    setOnTrafficUpdated?.(() => {
      refreshBrandedRouteAfterNativeChange(false);
      void refreshRemainingMetrics();
    });
    setOnLocationChanged((location) => {
      const valid = hasPoint(location.lat, location.lng);
      const previous = nativeLocationRef.current;
      const point = valid
        ? {
          latitude: location.lat, longitude: location.lng, accuracyMeters: location.accuracy ?? null,
          heading: location.bearing ?? null, time: location.time, source: 'ios-navigation' as const,
        }
        : null;
      const expo = liveLocationRef.current;
      diagnostics('native.gps', {
        valid, accuracyMeters: location.accuracy ?? null,
        ageMs: Number.isFinite(location.time) ? Math.max(0, Date.now() - location.time) : null,
        movementMeters: point && previous ? distanceBetweenPositionsMetres({ ...previous, heading: 0 }, { ...point, heading: 0 }) : null,
        nativeDeltaMeters: point && expo ? distanceBetweenPositionsMetres({ ...point, heading: 0 }, { ...expo, heading: 0 }) : null,
      });
      if (Platform.OS === 'ios' && point && hasFreshNavigationFix(point.accuracyMeters, point.time)
        && (!previous || Number(point.time) > Number(previous.time))) {
        nativeLocationRef.current = point;
        const current = currentNavigationLocation();
        // `onLocationChanged` is iOS's road-snapped provider. It remains a
        // display-only fallback: it is never used for server presence, trip
        // meter, fares, or trip state. When Expo is unavailable or older, the
        // custom HY3N car must nevertheless match the route we draw.
        if (current?.source === 'ios-navigation' && Number(current.time) === Number(point.time)) {
          animateVehicleObservation(current);
          assessNavigationLocation(point);
        }
      }
    });
    setOnArrival((arrivalEvent) => {
      // A native arrival can be queued from an earlier destination after a
      // reroute or stop transition. It is never a HY3N trip-state transition:
      // only show a local prompt when its exact waypoint and a fresh phone fix
      // independently match the active server-owned target.
      const arrival = validateDriverNavigationArrival({
        target: activeTargetRef.current,
        arrival: arrivalEvent,
        deviceFix: currentNavigationLocation(),
      });
      if (!arrival.accepted) {
        diagnostics('arrival.ignored', {
          reason: arrival.reason,
          distanceMeters: arrival.waypointDistanceMeters ?? arrival.locationDistanceMeters,
        });
        return;
      }
      diagnostics('arrival.confirmed', {
        distanceMeters: arrival.locationDistanceMeters,
      });
      arrivedTargetKeyRef.current = activeTargetRef.current?.key || null;
      clearGuidance();
      navigationController.setTurnByTurnLoggingEnabled?.(false);
      setNavigationMessage('You have reached this stop. Confirm your HY3N trip action below.');
      const request = navigationRequestRef.current;
      const work = routeOverlayWorkRef.current.then(async () => {
        if (navigationRequestRef.current !== request) return;
        await clearRouteLines();
      });
      routeOverlayWorkRef.current = work.catch((error) => {
        diagnostics('polyline.failed', { request, reason: 'arrival_clear', code: navigationErrorCode(error) });
      });
    });
    setOnRouteChanged(() => {
      diagnostics('route.native-change', { request: navigationRequestRef.current });
      clearGuidance();
      refreshBrandedRouteAfterNativeChange(false);
      void refreshRemainingMetrics();
    });
    setOnReroutingRequestedByOffRoute(() => {
      staleRoutePlanRef.current = routePointsRef.current.slice();
      refreshBrandedRouteAfterNativeChange(true);
    });
    return () => {
      clearRouteRefresh();
      removeAllListeners();
    };
  }, [acceptRemainingMetrics, animateVehicleObservation, assessNavigationLocation, clearGuidance, clearRouteLines, clearRouteRefresh, currentNavigationLocation, diagnostics, navigationController, refreshBrandedRouteAfterNativeChange, refreshRemainingMetrics, removeAllListeners, setOnArrival, setOnLocationChanged, setOnRouteChanged, setOnReroutingRequestedByOffRoute, setOnTurnByTurn, setOnRemainingTimeOrDistanceChanged, setOnTrafficUpdated]);

  // The branded overlay is not a NavigationView: Google does not update it for
  // us. A low-frequency single-flight read recovers a dropped native callback;
  // it never resets the destination or changes trip/fare state.
  useEffect(() => {
    if (!hasTarget || !targetKey || navigationPaused) return;
    let cancelled = false;
    let reading = false;
    const timer = setInterval(() => {
      if (reading || !initializedRef.current || lastTargetKeyRef.current !== targetKey) return;
      reading = true;
      const request = navigationRequestRef.current;
      void drawNavigationRoute(() => !cancelled && navigationRequestRef.current === request)
        .then((painted) => {
          if (painted && !cancelled) setNavigationMessage((message) =>
            message === 'Re-routing from your current road…' ? null : message);
        })
        .then(() => !cancelled ? refreshRemainingMetrics() : undefined)
        .finally(() => { reading = false; });
    }, 3_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [drawNavigationRoute, hasTarget, navigationPaused, refreshRemainingMetrics, targetKey]);

  useEffect(() => {
    if (!hasTarget || navigationPaused) return;
    const timer = setInterval(() => {
      const staleBefore = Date.now() - 15_000;
      setGuidance((value) => value && value.atMs < staleBefore ? null : value);
      setNativeMetrics((value) => value && value.atMs < staleBefore ? null : value);
    }, 1_000);
    return () => clearInterval(timer);
  }, [hasTarget, navigationPaused, targetKey]);

  // Expo's vehicle/publisher watcher and Google's road-snapped location
  // provider are different engines. A moving car does not prove that Google's
  // provider continued after switching to Rider or returning from the lock screen.
  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      const returning = state === 'active' && previousState !== 'active';
      previousState = state;
      if (!returning || !initializedRef.current || !targetKey || lastTargetKeyRef.current !== targetKey) return;
      navigationController.setBackgroundLocationUpdatesEnabled(true);
      navigationController.startUpdatingLocation();
      if (!navigationPaused && arrivedTargetKeyRef.current !== targetKey) navigationController.setTurnByTurnLoggingEnabled(true);
      refreshBrandedRouteAfterNativeChange(false);
      void refreshRemainingMetrics();
    });
    return () => subscription.remove();
  }, [navigationController, navigationPaused, refreshBrandedRouteAfterNativeChange, refreshRemainingMetrics, targetKey]);

  useEffect(() => {
    assessNavigationLocation(Platform.OS === 'ios' ? expoLocationRef.current : currentNavigationLocation());
  }, [
    assessNavigationLocation,
    currentNavigationLocation,
    latitude,
    locationAccuracy,
    locationTimestamp,
    longitude,
  ]);

  useEffect(() => () => {
    clearVehicleMotion();
    clearRouteRefresh();
    guidanceReadyRef.current = false;
    pendingCameraRef.current = null;
    cameraControllerRef.current = null;
    followingRef.current = false;
    navigationController.setTurnByTurnLoggingEnabled(false);
    pendingVehicleMarkerRef.current = null;
    vehicleMarkerControllerRef.current = null;
    navigationRequestRef.current += 1;
    routePointsRef.current = [];
    routeTrafficSegmentsRef.current = [];
    staleRoutePlanRef.current = null;
    confirmedRerouteRef.current = null;
    offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    nativeOffRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    nativeWrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    rawDeviationConfirmedRef.current = false;
    lastFallbackRerouteAtMsRef.current = 0;
    forcedRerouteInFlightRef.current = false;
    if (initializedRef.current) void navigationController.cleanup().catch(() => {});
  }, [clearRouteRefresh, clearVehicleMotion, navigationController]);

  useEffect(() => {
    if (Platform.OS === 'android' && hasTarget && !navigationPaused
      && (!androidMapReady || !mapViewController)) return;
    if (hasTarget && targetKey && !navigationPaused && lastTargetKeyRef.current === targetKey) return;
    const request = ++navigationRequestRef.current;
    confirmedRerouteRef.current = null;
    nativeOffRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    nativeWrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    rawDeviationConfirmedRef.current = false;
    lastFallbackRerouteAtMsRef.current = 0;
    clearGuidance();
    expectedNativeGenerationRef.current = null;
    pendingCameraRef.current = null;
    navigationController.setTurnByTurnLoggingEnabled(false);
    // A pickup/drop-off target replacement must also invalidate an older
    // route-change retry that captured the previous marker target.
    clearRouteRefresh();

    if (!hasTarget || !targetKey || navigationPaused) {
      lastTargetKeyRef.current = null;
      arrivedTargetKeyRef.current = null;
      routePointsRef.current = [];
      routeTrafficSegmentsRef.current = [];
      staleRoutePlanRef.current = null;
      offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
      wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
      clearRouteRefresh();
      clearRoute();
      if (initializedRef.current) {
        void runNavigationWork(async () => {
          try {
            if (navigationRequestRef.current !== request) return;
            navigationController.setBackgroundLocationUpdatesEnabled(false);
            navigationController.stopUpdatingLocation();
            await navigationController.stopGuidance();
            await navigationController.clearDestinations();
          } catch {
            // The routing session may already have been released.
          }
        });
      }
      setNavigationMessage(navigationPaused ? 'At pickup — waiting for the rider. Start Trip when ready.' : null);
      return;
    }

    if (!hasDeviceLocation) {
      setNavigationMessage('Getting your live location before guidance starts.');
      return;
    }

    if (lastTargetKeyRef.current === targetKey) return;

    followingRef.current = true;
    setIsFollowing(true);
    cameraSampleRef.current = null;
    if (vehiclePositionRef.current) updateFollowingCamera(vehiclePositionRef.current, true);
    arrivedTargetKeyRef.current = null;
    routePointsRef.current = [];
    routeTrafficSegmentsRef.current = [];
    staleRoutePlanRef.current = null;
    offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    void clearRoute();
    let cancelled = false;
    setNavigationMessage('Preparing HY3N navigation…');

    void runNavigationWork(async () => {
      try {
        if (cancelled || navigationRequestRef.current !== request) return;
        const accepted = await navigationController.showTermsAndConditionsDialog();
        if (cancelled || navigationRequestRef.current !== request) return;
        if (!accepted) {
          setNavigationMessage('Accept Google Navigation terms to receive turn-by-turn guidance.');
          return;
        }

        if (!initializedRef.current) {
          const sessionStatus = await navigationController.init();
          diagnostics('session.response', { request, status: sessionStatus });
          if (cancelled || navigationRequestRef.current !== request) return;
          if (sessionStatus !== NavigationSessionStatus.OK) {
            setNavigationMessage(readableNavigationFailure(sessionStatus));
            return;
          }
          initializedRef.current = true;
          navigationController.setAudioGuidanceType(
            AudioGuidance.VOICE_ALERTS_AND_GUIDANCE | AudioGuidance.BLUETOOTH_AUDIO,
          );
        }

        // The app already requests Always location for online Driver trips.
        // Explicitly keep Google's provider alive too; Expo background GPS
        // alone cannot make the independent native navigator reroute. Restart
        // this even for a reused session after the previous trip ended.
        navigationController.setBackgroundLocationUpdatesEnabled(true);
        navigationController.startUpdatingLocation();

        diagnostics('route.request', { request, reason: 'initial' });
        const routeStatus = await navigationController.setDestination(
          {
            title: targetLabel,
            position: { lat: targetLatitude, lng: targetLongitude },
            preferSameSideOfRoad: true,
          },
          {
            routingOptions: { travelMode: TravelMode.DRIVING },
            displayOptions: {
              showDestinationMarkers: false,
              showStopSigns: true,
              showTrafficLights: true,
            },
          },
        );
        if (cancelled || navigationRequestRef.current !== request) return;
        diagnostics('route.response', { request, status: routeStatus });
        if (routeStatus !== RouteStatus.OK) {
          setNavigationMessage(readableNavigationFailure(routeStatus));
          return;
        }

        await navigationController.startGuidance();
        if (cancelled || navigationRequestRef.current !== request) return;
        const painted = await drawNavigationRoute(() => !cancelled && navigationRequestRef.current === request);
        if (cancelled || navigationRequestRef.current !== request) return;
        lastTargetKeyRef.current = targetKey;
        navigationController.setTurnByTurnLoggingEnabled(true);
        await refreshRemainingMetrics();
        if (cancelled || navigationRequestRef.current !== request) return;
        setNavigationMessage(painted ? null : 'Re-routing from your current road…');
      } catch (error) {
        diagnostics('route.response', { request, status: 'exception', code: navigationErrorCode(error) });
        if (!cancelled && navigationRequestRef.current === request) {
          setNavigationMessage('Navigation could not start. Please check location and connection.');
        }
      }
    });

    return () => { cancelled = true; };
  }, [androidMapReady, clearGuidance, clearRoute, clearRouteRefresh, diagnostics, drawNavigationRoute, hasDeviceLocation, hasTarget, mapViewController, navigationController, navigationPaused, refreshRemainingMetrics, runNavigationWork, targetKey, targetLabel, targetLatitude, targetLongitude, updateFollowingCamera]);

  // Start/resume already restores following in the target lifecycle above.
  // This camera-only refresh also adapts stationary framing after a banner or
  // dock resize; it never resets destinations or overrides Explore map.
  useEffect(() => {
    if (!closeDrivingView || !followingRef.current || !vehiclePositionRef.current) return;
    pendingCameraRef.current = null;
    updateFollowingCamera(vehiclePositionRef.current, true);
  }, [closeDrivingView, mapPadding.top, mapPadding.bottom, updateFollowingCamera, viewportHeight]);

  const visibleGuidance = !navigationPaused && guidance?.targetKey === targetKey ? guidance.data : null;
  const visibleMetrics = !navigationPaused && nativeMetrics?.targetKey === targetKey ? nativeMetrics : null;
  const visibleDistance = visibleMetrics?.meters ?? (lastTargetKeyRef.current === targetKey && !navigationPaused ? remainingDistanceMeters : null);

  return (
    <View style={styles.container}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      onTouchStart={(event) => {
        const touches = event.nativeEvent.touches;
        touchStartRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        if (touches?.length > 1) pauseFollowing();
      }}
      onTouchMove={(event) => {
        const start = touchStartRef.current;
        if (event.nativeEvent.touches?.length > 1 || (start && Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 8)) pauseFollowing();
      }}
      onTouchEnd={() => { touchStartRef.current = null; }}
    >
      {hasTarget ? <DriverActiveNavigationKeepAwake /> : null}
      {hasDeviceLocation ? (
        <MapView
          style={StyleSheet.absoluteFill}
          initialCameraPosition={{
            target: { lat: Number(latitude), lng: Number(longitude) },
            zoom: closeDrivingView ? 18 : hasTarget ? 17 : 16,
            bearing: Number(heading) || 0,
            tilt: hasTarget ? 45 : 0,
          }}
          // The branded MapView never switches at acceptance. The HY3N car is
          // its only live vehicle marker; the Google blue location arrow stays
          // disabled while the Navigation SDK remains the voice/route engine.
          // FOLLOW_SYSTEM supplies a genuinely dark Google basemap in dark mode
          // and the normal light Google basemap in light mode.
          mapColorScheme={MapColorScheme.FOLLOW_SYSTEM}
          mapStyle={CLEAN_GOOGLE_STYLE}
          mapPadding={mapPadding}
          trafficEnabled
          myLocationEnabled={false}
          myLocationButtonEnabled={false}
          compassEnabled
          indoorEnabled={false}
          indoorLevelPickerEnabled={false}
          buildingsEnabled={false}
          mapToolbarEnabled={false}
          onMapClick={pauseFollowing}
          onMapViewControllerCreated={setMapViewController}
          onMapReady={Platform.OS === 'android' ? () => setAndroidMapReady(true) : undefined}
        />
      ) : (
        <View style={styles.locationGate}>
          <Text style={styles.locationGateTitle}>Getting your live location</Text>
          <Text style={styles.locationGateText}>HY3N does not use a fallback place for Driver navigation.</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.settingsButton} accessibilityRole="button">
            <Text style={styles.settingsButtonText}>Check Location Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {hasTarget && hasDeviceLocation && (
        <View style={[styles.navigationOverlay, { top: navigationTopInset }]} pointerEvents="box-none"
          onLayout={(event) => setBannerHeight(event.nativeEvent.layout.height)}>
          <DriverNavigationBanner
            guidance={visibleGuidance}
            message={navigationMessage}
            remainingDistanceMeters={visibleDistance}
            remainingTimeSeconds={visibleMetrics?.seconds ?? null}
            targetLabel={targetLabel}
            targetKind={target?.kind ?? (tripStatus === 'dropoff' ? 'destination' : 'pickup')}
            isDark={isDark}
            {...(Platform.OS === 'ios' ? { reduceTransparencyEnabled: iosOverlayPalette.reduceTransparency } : {})}
          />
          <TouchableOpacity style={[styles.followControl, { backgroundColor: isDark ? '#17212C' : '#FFFFFF' }, Platform.OS === 'ios' && { backgroundColor: iosOverlayPalette.panel }]}
            {...(Platform.OS === 'ios' ? { activeOpacity: 1 } : {})}
            onPress={isFollowing ? pauseFollowing : recenter} accessibilityRole="button"
            accessibilityLabel={isFollowing ? 'Explore map' : 'Recenter navigation'}>
            <Text style={[styles.followControlText, { color: isDark ? '#FFFFFF' : '#17212C' }, Platform.OS === 'ios' && { color: iosOverlayPalette.foreground }]}>{isFollowing ? (Platform.OS === 'ios' ? 'Explore' : 'Explore map') : 'Recenter'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function NativeDriverGoogleMap(props: Props) {
  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={HY3N_NAVIGATION_TERMS_OPTIONS}
      taskRemovedBehavior={TaskRemovedBehavior.CONTINUE_SERVICE}
    >
      <DriverNavigationSurface {...props} />
    </NavigationProvider>
  );
}

// Incoming-offer countdown state belongs to Home. Memoizing this native
// provider keeps its map surface stable when only the request timer/card
// changes, while real GPS, heading and navigation-target prop changes still
// update normally.
export default React.memo(NativeDriverGoogleMap);

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill },
  locationGate: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    padding: 28,
  },
  locationGateTitle: { color: '#0F172A', fontSize: 19, fontWeight: '900', textAlign: 'center' },
  locationGateText: { color: '#475569', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  settingsButton: { backgroundColor: GREEN, borderRadius: 14, marginTop: 18, paddingHorizontal: 18, paddingVertical: 12 },
  settingsButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  navigationOverlay: {
    alignSelf: 'center',
    maxWidth: 680,
    left: 16,
    position: 'absolute',
    right: 16,
    zIndex: 10,
  },
  followControl: { alignSelf: 'flex-end', borderRadius: 22, marginTop: 10, minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', elevation: 3 },
  followControlText: { fontSize: 14, fontWeight: '800', includeFontPadding: false },
});

