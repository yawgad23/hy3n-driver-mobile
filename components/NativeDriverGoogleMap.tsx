import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import {
  AudioGuidance,
  MapColorScheme,
  MapView,
  NavigationUIEnabledPreference,
  NavigationView,
  NavigationProvider,
  NavigationSessionStatus,
  RouteStatus,
  TaskRemovedBehavior,
  TravelMode,
  useNavigation,
  type MapViewController,
  type NavigationViewController,
} from '@googlemaps/react-native-navigation-sdk';
import {
  DRIVER_REROUTE_ROUTE_REDRAW_DELAYS_MS,
  driverMapMotionFrames,
  distanceBetweenPositionsMetres,
  routePointsForMap,
  type DriverMapPosition,
} from '@/lib/driver-map-motion';
import {
  assessDriverOffRoute,
  EMPTY_DRIVER_OFF_ROUTE_MONITOR,
  type DriverRoutePoint,
} from '@/lib/driver-off-route-reroute';
import {
  remainingDriverRoute,
  assessDriverWrongWay,
  EMPTY_DRIVER_WRONG_WAY_MONITOR,
  driverRouteReachesTarget,
  driverRouteStartsAtLocation,
  isSameDriverRoadPlan,
} from '@/lib/driver-route-progress';
import { createDriverNavigationDiagnostics, driverNavigationDiagnosticsEnabled, navigationErrorCode } from '@/lib/driver-navigation-diagnostics';
import { validateDriverNavigationArrival } from '@/lib/driver-navigation-arrival';

type MapTarget = { latitude: number; longitude: number; label: string };
type Props = {
  latitude?: number;
  longitude?: number;
  locationTimestamp?: number | null;
  locationAccuracy?: number | null;
  heading?: number | null;
  target?: MapTarget | null;
  tripStatus?: 'pickup' | 'dropoff' | null;
};

const GREEN = '#008C5A';
const ROUTE_OUTLINE = '#FFFFFF';
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
const DRIVER_VEHICLE_MARKER_ASSET = Platform.select({
  android: 'hy3n_driver_car_marker.png',
  ios: 'HY3NDriverCarMarker',
  default: 'hy3n_driver_car_marker.png',
});
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
 * Prefer the most recent navigation-grade fix, but accept neither source once
 * it is stale or imprecise. Returning null clears the branded overlay rather
 * than leaving an old road visible as if it were current guidance.
 */
function freshestNavigationLocation(
  expo: DriverNavigationLocation | null,
  native: DriverNavigationLocation | null,
) {
  const expoIsFresh = Boolean(expo && hasPoint(expo.latitude, expo.longitude)
    && hasFreshNavigationFix(expo.accuracyMeters, expo.time));
  const nativeIsFresh = Boolean(native && hasPoint(native.latitude, native.longitude)
    && hasFreshNavigationFix(native.accuracyMeters, native.time));
  if (!expoIsFresh && !nativeIsFresh) return null;
  if (!expoIsFresh) return native;
  if (!nativeIsFresh) return expo;
  return Number(native!.time) >= Number(expo!.time) ? native : expo;
}

function readableNavigationFailure(status: NavigationSessionStatus | RouteStatus) {
  switch (status) {
    case NavigationSessionStatus.NOT_AUTHORIZED:
      return 'Embedded navigation is not authorised for this app yet.';
    case NavigationSessionStatus.LOCATION_PERMISSION_MISSING:
    case RouteStatus.LOCATION_DISABLED:
    case RouteStatus.LOCATION_UNKNOWN:
      return 'Turn on precise location to start in-app navigation.';
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
 * The idle map remains HY3N-branded. During an iPhone trip, Google
 * NavigationView owns the live route and navigation vehicle indicator. Google owns route replacement and rerouting. HY3N
 * does not redraw a second copy of that route through the React Native bridge.
 * Android retains its established MapView route presentation.
 */
function DriverNavigationSurface({
  latitude,
  longitude,
  locationTimestamp,
  locationAccuracy,
  heading,
  target,
  tripStatus,
}: Props) {
  const systemColorScheme = useColorScheme();
  const nativeMapColorScheme = systemColorScheme === 'dark' ? MapColorScheme.DARK : MapColorScheme.LIGHT;
  const {
    navigationController,
    removeAllListeners,
    setOnArrival,
    setOnRouteChanged,
    setOnReroutingRequestedByOffRoute,
    setOnLocationChanged,
  } = useNavigation();
  const [mapViewController, setMapViewController] = useState<MapViewController | null>(null);
  const handleMapViewControllerCreated = useCallback((controller: MapViewController) => {
    setMapViewController(controller);
  }, []);
  const [navigationViewIsReady, setNavigationViewIsReady] = useState(false);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const diagnostics = useRef(createDriverNavigationDiagnostics()).current;
  const navigationViewControllerRef = useRef<NavigationViewController | null>(null);
  const nativeLocationRef = useRef<DriverNavigationLocation | null>(null);
  const expoLocationRef = useRef<DriverNavigationLocation | null>(null);
  const confirmedRerouteRef = useRef<{ request: number; origin: { latitude: number; longitude: number }; atMs: number } | null>(null);
  const initializedRef = useRef(false);
  const navigationRequestRef = useRef(0);
  const navigationWorkRef = useRef<Promise<void>>(Promise.resolve());
  const lastTargetKeyRef = useRef<string | null>(null);
  const vehiclePositionRef = useRef<DriverMapPosition | null>(null);
  const vehicleMotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vehicleMotionRunRef = useRef(0);
  const routeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeRefreshRunRef = useRef(0);
  // Native polyline operations cross an asynchronous bridge. Keep one ordered
  // queue so an older route-change event can never add its green line after a
  // newer reroute or after the destination has changed.
  const routeOverlayWorkRef = useRef<Promise<void>>(Promise.resolve());
  const rerouteMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routePointsRef = useRef<DriverRoutePoint[]>([]);
  const staleRoutePlanRef = useRef<DriverRoutePoint[] | null>(null);
  // A target is considered locally arrived only for display. It is reset only
  // when the server-backed pickup/drop-off/stop target changes; it never
  // changes trip state or advances a stop by itself.
  const arrivedTargetKeyRef = useRef<string | null>(null);
  const offRouteMonitorRef = useRef(EMPTY_DRIVER_OFF_ROUTE_MONITOR);
  const wrongWayMonitorRef = useRef(EMPTY_DRIVER_WRONG_WAY_MONITOR);
  const forcedRerouteInFlightRef = useRef(false);
  const handleNavigationViewControllerCreated = useCallback((controller: NavigationViewController) => {
    navigationViewControllerRef.current = controller;
    setNavigationViewIsReady(true);
  }, []);
  const hasDeviceLocation = hasPoint(latitude, longitude);
  const targetLatitude = Number(target?.latitude);
  const targetLongitude = Number(target?.longitude);
  const targetLabel = target?.label?.trim() || (tripStatus === 'dropoff' ? 'Drop-off' : 'Pickup');
  const hasTarget = hasPoint(targetLatitude, targetLongitude);
  const usesNativeIPhoneRouteRenderer = Platform.OS === 'ios' && hasTarget;
  const targetKey = hasTarget
    ? `${tripStatus || 'target'}:${targetLatitude.toFixed(6)}:${targetLongitude.toFixed(6)}:${targetLabel}`
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
      time: locationTimestamp, source: 'expo',
    }
    : null;
  // This correction is intentionally iOS-only. Android keeps its established
  // Expo path; no Android Navigation SDK behavior is inferred from the iPhone
  // bridge investigation.
  liveLocationRef.current = Platform.OS === 'ios'
    ? freshestNavigationLocation(expoLocationRef.current, nativeLocationRef.current)
    : expoLocationRef.current;
  const currentNavigationLocation = useCallback(() => {
    const current = Platform.OS === 'ios'
      ? freshestNavigationLocation(expoLocationRef.current, nativeLocationRef.current)
      : expoLocationRef.current;
    liveLocationRef.current = current;
    return current;
  }, []);

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
    // NavigationView exposes the same Google map controller as MapView. Keep
    // Google's route/camera/rerouting engine, but draw the HY3N car at the
    // latest road-snapped position instead of leaving the blue arrow visible.
    void mapViewController.addMarker({
      id: DRIVER_VEHICLE_MARKER_ID,
      position: { lat: position.latitude, lng: position.longitude },
      imgPath: DRIVER_VEHICLE_MARKER_ASSET,
      title: 'Your HY3N vehicle',
      rotation: position.heading,
      flat: true,
      anchor: { u: 0.5, v: 0.5 },
      visible: true,
    }).catch(() => {
      // A route remains usable even if a device cannot load the optional art.
    });
    // The native SDK animates this camera update; keeping its target aligned
    // with each interpolated vehicle point makes the car follow the road rather
    // than jump to a stale screen position.
    mapViewController.moveCamera({
      target: { lat: position.latitude, lng: position.longitude },
      bearing: followTrip ? position.heading : 0,
      tilt: followTrip ? 42 : 0,
      zoom: followTrip ? 17 : 16,
    });
  }, [mapViewController]);

  // Interpolate each real GPS observation into small native-map updates. The
  // car uses the device heading where available and only follows positions the
  // Driver app has received; this display layer has no effect on fare or meter.
  useEffect(() => {
    if (!mapViewController || !hasDeviceLocation) return;
    const next = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      // Expo reports an unavailable compass heading as null. Preserve that
      // absence so the motion helper can derive direction from movement rather
      // than incorrectly turning the HY3N car to north.
      heading: heading === null || heading === undefined ? Number.NaN : Number(heading),
    };
    const frames = driverMapMotionFrames(vehiclePositionRef.current, next);
    const run = vehicleMotionRunRef.current + 1;
    clearVehicleMotion();
    vehicleMotionRunRef.current = run;
    let index = 0;

    const showFrame = () => {
      if (vehicleMotionRunRef.current !== run) return;
      const frame = frames[index++];
      if (!frame) return;
      vehiclePositionRef.current = frame;
      applyVehiclePosition(frame, hasTarget);
      if (index < frames.length) vehicleMotionTimerRef.current = setTimeout(showFrame, 110);
    };
    showFrame();
    return clearVehicleMotion;
  }, [applyVehiclePosition, clearVehicleMotion, hasDeviceLocation, hasTarget, heading, latitude, longitude, mapViewController, usesNativeIPhoneRouteRenderer]);

  const clearRouteLines = useCallback(async () => {
    if (usesNativeIPhoneRouteRenderer) return;
    if (!mapViewController) return;

    // Unlike the native navigation engine, these two branded polylines are
    // HY3N-owned overlays. Remove them as one awaited operation before drawing
    // replacement geometry, otherwise an off-route Driver can see the road
    // they have already left until the map's asynchronous bridge catches up.
    const results = await Promise.allSettled([
      Promise.resolve(mapViewController.removePolyline(DRIVER_ROUTE_OUTLINE_ID)),
      Promise.resolve(mapViewController.removePolyline(DRIVER_ROUTE_ID)),
    ]);
    for (const result of results) if (result.status === 'rejected') diagnostics('polyline.failed', { reason: 'remove', code: navigationErrorCode(result.reason) });
  }, [diagnostics, mapViewController, usesNativeIPhoneRouteRenderer]);

  const clearRoute = useCallback(() => {
    if (Platform.OS === 'ios') return Promise.resolve();
    const request = navigationRequestRef.current;
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || navigationRequestRef.current !== request) return;
      await clearRouteLines();
      if (navigationRequestRef.current !== request) return;
      await Promise.allSettled([Promise.resolve(mapViewController.removeMarker(DRIVER_TARGET_MARKER_ID))]);
    });
    routeOverlayWorkRef.current = work.catch(() => {});
    return work;
  }, [clearRouteLines, mapViewController]);

  const updateRemainingRoute = useCallback(() => {
    if (Platform.OS === 'ios') return;
    if (arrivedTargetKeyRef.current && arrivedTargetKeyRef.current === activeTargetRef.current?.key) return;
    const request = navigationRequestRef.current;
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || navigationRequestRef.current !== request) return;
      const currentLocation = currentNavigationLocation();
      const points = staleRoutePlanRef.current && isSameDriverRoadPlan(routePointsRef.current, staleRoutePlanRef.current)
        ? [] : remainingDriverRoute(currentLocation, routePointsRef.current);
      await clearRouteLines();
      if (navigationRequestRef.current !== request || points.length < 2) return;
      await mapViewController.addPolyline({
        id: DRIVER_ROUTE_OUTLINE_ID, points, color: ROUTE_OUTLINE, width: 14, visible: true,
      });
      if (navigationRequestRef.current !== request) { await clearRouteLines(); return; }
      await mapViewController.addPolyline({
        id: DRIVER_ROUTE_ID, points, color: GREEN, width: 8, visible: true,
      });
      if (navigationRequestRef.current !== request) await clearRouteLines();
    });
    routeOverlayWorkRef.current = work.catch((error) => {
      diagnostics('polyline.failed', { request, reason: 'gps_progress', code: navigationErrorCode(error) });
    });
  }, [clearRouteLines, currentNavigationLocation, diagnostics, mapViewController]);

  const drawNavigationRoute = useCallback((isCurrent: () => boolean = () => true) => {
    // iPhone NavigationView reads and renders the route inside the native
    // Google session. Never rebuild that line as a JavaScript polyline.
    if (Platform.OS === 'ios') {
      return Promise.resolve(Boolean(hasTarget && isCurrent() && arrivedTargetKeyRef.current !== activeTargetRef.current?.key));
    }
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || !hasTarget || !isCurrent() || arrivedTargetKeyRef.current === activeTargetRef.current?.key) return false;
      let stage: 'geometry' | 'polyline' = 'geometry';
      try {
        // Remove the passed road before reading replacement geometry. A blank
        // line is safer than showing a Driver travelling along the old road.
        await clearRouteLines();
        if (!isCurrent()) return false;

        // iOS currentRouteLeg explicitly starts at the most recent native GPS
        // fix. HY3N sets one active stop at a time, so this is the entire leg we
        // must display. Do not silently substitute cached full legs on failure.
        const iosCurrentLeg = Platform.OS === 'ios';
        const segments = iosCurrentLeg
          ? [await navigationController.getCurrentRouteSegment()]
          : await navigationController.getRouteSegments();
        const points = routePointsForMap(segments);
        const targetMatches = driverRouteReachesTarget(points, { lat: targetLatitude, lng: targetLongitude });
        diagnostics('geometry.received', { request: navigationRequestRef.current, points: points.length, targetMatches, source: iosCurrentLeg ? 'ios-current-leg' : 'route-legs' });
        if (!isCurrent() || points.length < 2 || !targetMatches) {
          diagnostics('geometry.rejected', { reason: !isCurrent() ? 'stale_request' : points.length < 2 ? 'invalid_points' : 'wrong_target' });
          return false;
        }
        stage = 'polyline';
        await mapViewController.addMarker({
          id: DRIVER_TARGET_MARKER_ID,
          position: { lat: targetLatitude, lng: targetLongitude },
          title: targetLabel, anchor: { u: 0.5, v: 1 }, visible: true,
        });
        if (!isCurrent()) return false;

        routePointsRef.current = points;
        // Native path prefixes can change on progress/traffic reads without a
        // genuine new direction. Never erase distinct real-GPS evidence because
        // JSON geometry changed. The next GPS assessment recalculates against
        // this geometry; only a real target change resets the monitors.
        const currentLocation = currentNavigationLocation();
        const remaining = remainingDriverRoute(currentLocation, points);
        // Google can still return the old leg while a reroute is pending.
        // Retain it for deviation checks but do not repaint it after a native
        // route-change signal unless its path begins on the latest valid Driver
        // road. The iOS bridge has no route revision ID, so matching only the
        // target would allow a just-replaced old road to return to the screen.
        const confirmation = confirmedRerouteRef.current;
        const confirmedFreshStart = iosCurrentLeg && confirmation?.request === navigationRequestRef.current
          && Date.now() - confirmation.atMs <= 30_000
          && driverRouteStartsAtLocation(points, confirmation.origin);
        const beginsAtCurrentRoad = iosCurrentLeg && driverRouteStartsAtLocation(points, currentLocation);
        if (remaining.length < 2 || (staleRoutePlanRef.current && isSameDriverRoadPlan(points, staleRoutePlanRef.current) && !confirmedFreshStart && !beginsAtCurrentRoad)) {
          diagnostics('geometry.rejected', { reason: remaining.length < 2 ? 'not_on_current_road' : 'unconfirmed_previous_road' });
          return false;
        }
        staleRoutePlanRef.current = null;
        confirmedRerouteRef.current = null;

        await mapViewController.addPolyline({
          id: DRIVER_ROUTE_OUTLINE_ID,
          points: remaining,
          color: ROUTE_OUTLINE,
          width: 14,
          visible: true,
        });
        if (!isCurrent()) {
          await clearRouteLines();
          return false;
        }
        await mapViewController.addPolyline({
          id: DRIVER_ROUTE_ID,
          points: remaining,
          color: GREEN,
          width: 8,
          visible: true,
        });
        if (!isCurrent()) {
          await clearRouteLines();
          return false;
        }
        diagnostics('polyline.applied', { request: navigationRequestRef.current, points: remaining.length });
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
  }, [clearRouteLines, currentNavigationLocation, diagnostics, hasTarget, mapViewController, navigationController, targetLabel, targetLatitude, targetLongitude]);

  /**
   * On Android, HY3N reads Google geometry and draws the established branded
   * route line. On iPhone, NavigationView renders its own current route, so a
   * native route-change event must never start a second JavaScript redraw.
   */
  const refreshBrandedRouteAfterNativeChange = useCallback((offRoute: boolean) => {
    if (Platform.OS === 'ios') {
      if (offRoute) {
        setNavigationMessage('Re-routing from your current road…');
        if (rerouteMessageTimerRef.current) clearTimeout(rerouteMessageTimerRef.current);
        rerouteMessageTimerRef.current = setTimeout(() => {
          setNavigationMessage((message) => message === 'Re-routing from your current road…' ? null : message);
        }, 900);
      } else {
        setNavigationMessage((message) => message === 'Re-routing from your current road…' ? null : message);
      }
      return;
    }
    if (arrivedTargetKeyRef.current && arrivedTargetKeyRef.current === activeTargetRef.current?.key) return;
    clearRouteRefresh();
    const run = routeRefreshRunRef.current + 1;
    routeRefreshRunRef.current = run;

    if (offRoute) setNavigationMessage('Re-routing from your current road…');

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
  }, [clearRouteRefresh, drawNavigationRoute]);

  /**
   * The iOS bridge forwards route-change events, but a real road test showed
   * that it can miss the separate off-route request. Protect Drivers from a
   * frozen line by checking their actual navigation-grade GPS point against
   * the route we drew. Two distinct off-route samples are required before this
   * asks Google to calculate a replacement to the unchanged destination.
   */
  const requestGpsFallbackReroute = useCallback(() => {
    // NavigationView monitors iPhone off-route movement and replaces its own
    // native route. Calling setDestination again from the JavaScript overlay
    // path would compete with that native reroute and reintroduce a stale race.
    if (Platform.OS === 'ios') return;
    if (
      forcedRerouteInFlightRef.current
      || !initializedRef.current
      || !hasTarget
      || !targetKey
      || lastTargetKeyRef.current !== targetKey
      || arrivedTargetKeyRef.current === targetKey
    ) return;

    const request = navigationRequestRef.current;
    const stillCurrent = () => navigationRequestRef.current === request && lastTargetKeyRef.current === targetKey;
    forcedRerouteInFlightRef.current = true;
    confirmedRerouteRef.current = null;
    staleRoutePlanRef.current = routePointsRef.current.slice();
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
        refreshBrandedRouteAfterNativeChange(true);
      } catch (error) {
        diagnostics('route.response', { request, status: 'exception', code: navigationErrorCode(error) });
        if (stillCurrent()) setNavigationMessage('Navigation could not re-route. Please check location and connection.');
      } finally {
        forcedRerouteInFlightRef.current = false;
      }
    });
  }, [
    diagnostics,
    currentNavigationLocation,
    hasTarget,
    navigationController,
    refreshBrandedRouteAfterNativeChange,
    runNavigationWork,
    targetKey,
    targetLabel,
    targetLatitude,
    targetLongitude,
  ]);

  const assessNavigationLocation = useCallback((observedLocation: DriverNavigationLocation | null) => {
    if (Platform.OS === 'ios') {
      const usableFix = Boolean(observedLocation
        && hasFreshNavigationFix(observedLocation.accuracyMeters, observedLocation.time));
      diagnostics('gps.sample', {
        valid: usableFix,
        accuracyMeters: observedLocation?.accuracyMeters ?? null,
        ageMs: observedLocation?.time != null ? Math.max(0, Date.now() - observedLocation.time) : null,
      });
      return;
    }
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
    diagnostics('gps.sample', {
      valid: usableFix,
      accuracyMeters: observedLocation?.accuracyMeters ?? null,
      ageMs: observedLocation?.time != null ? Math.max(0, Date.now() - observedLocation.time) : null,
    });
    if (!observedLocation) {
      offRouteMonitorRef.current = { ...offRouteMonitorRef.current, consecutiveOffRouteSamples: 0 };
      wrongWayMonitorRef.current = { ...wrongWayMonitorRef.current, previousLocation: null, consecutiveSamples: 0 };
      diagnostics('route.assessment', { shouldReroute: false, reason: 'stale_or_imprecise_gps' });
      // A blank line is safer than guidance from a location source that is no
      // longer trustworthy. The native route engine remains active and can
      // restore the line as soon as a valid current sample arrives.
      updateRemainingRoute();
      return;
    }

    const sampleKey = `${observedLocation.source}:${observedLocation.time != null && Number.isFinite(Number(observedLocation.time))
      ? `timestamp:${Number(observedLocation.time)}`
      : `coordinate:${observedLocation.latitude.toFixed(6)}:${observedLocation.longitude.toFixed(6)}`}`;
    const assessment = assessDriverOffRoute(
      offRouteMonitorRef.current,
      observedLocation,
      routePointsRef.current,
      sampleKey,
      Date.now(),
    );
    offRouteMonitorRef.current = assessment.next;
    const wrongWay = assessDriverWrongWay(
      wrongWayMonitorRef.current,
      observedLocation,
      routePointsRef.current,
      sampleKey,
      Date.now(),
    );
    wrongWayMonitorRef.current = wrongWay.next;
    diagnostics('route.assessment', { distanceMeters: assessment.distanceMeters, thresholdMeters: assessment.thresholdMeters,
      offRoute: assessment.offRoute, wrongWay: wrongWay.shouldReroute, shouldReroute: assessment.shouldReroute || wrongWay.shouldReroute });
    if (assessment.shouldReroute || wrongWay.shouldReroute) requestGpsFallbackReroute();
    updateRemainingRoute();
  }, [
    diagnostics,
    hasTarget,
    requestGpsFallbackReroute,
    targetKey,
    updateRemainingRoute,
  ]);

  useEffect(() => {
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
        && (!previous || Number(point.time) >= Number(previous.time))) {
        nativeLocationRef.current = point;
        const current = currentNavigationLocation();
        // `onLocationChanged` is iOS's road-snapped provider. It remains a
        // display-only fallback: it is never used for server presence, trip
        // meter, fares, or trip state. When Expo is unavailable or older, the
        // custom HY3N car must nevertheless match the route we draw.
        if (current?.source === 'ios-navigation' && Number(current.time) === Number(point.time)) {
          clearVehicleMotion();
          const vehicle = {
            latitude: current.latitude,
            longitude: current.longitude,
            heading: Number.isFinite(Number(current.heading))
              ? Number(current.heading)
              : (vehiclePositionRef.current?.heading ?? 0),
          };
          vehiclePositionRef.current = vehicle;
          applyVehiclePosition(vehicle, hasTarget);
        }
        assessNavigationLocation(current);
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
      setNavigationMessage('You have reached this stop. Confirm your HY3N trip action below.');
      if (Platform.OS === 'ios') {
        void runNavigationWork(async () => {
          try {
            await navigationViewControllerRef.current?.setNavigationUIEnabled(false);
            await navigationController.stopGuidance();
            await navigationController.clearDestinations();
          } catch (error) {
            diagnostics('route.response', { status: 'native_clear_failed', code: navigationErrorCode(error) });
          }
        });
      } else {
        const request = navigationRequestRef.current;
        const work = routeOverlayWorkRef.current.then(async () => {
          if (navigationRequestRef.current !== request) return;
          await clearRouteLines();
        });
        routeOverlayWorkRef.current = work.catch((error) => {
          diagnostics('polyline.failed', { request, reason: 'arrival_clear', code: navigationErrorCode(error) });
        });
      }
    });
    setOnRouteChanged(() => {
      if (Platform.OS === 'ios') {
        diagnostics('route.native-change', { request: navigationRequestRef.current });
        refreshBrandedRouteAfterNativeChange(false);
        return;
      }
      // The native callback supplies neither a route ID nor route geometry. A
      // read immediately after it can still return the previous current leg.
      // Quarantine that previous plan before any redraw so a stale green/white
      // road cannot direct the Driver backwards while the new leg is arriving.
      staleRoutePlanRef.current = routePointsRef.current.slice();
      diagnostics('route.native-change', { request: navigationRequestRef.current });
      refreshBrandedRouteAfterNativeChange(false);
    });
    setOnReroutingRequestedByOffRoute(() => {
      if (Platform.OS === 'ios') {
        diagnostics('route.native-change', { request: navigationRequestRef.current });
        refreshBrandedRouteAfterNativeChange(true);
        return;
      }
      staleRoutePlanRef.current = routePointsRef.current.slice();
      refreshBrandedRouteAfterNativeChange(true);
    });
    return () => {
      clearRouteRefresh();
      removeAllListeners();
    };
  }, [applyVehiclePosition, assessNavigationLocation, clearRouteLines, clearRouteRefresh, clearVehicleMotion, currentNavigationLocation, diagnostics, hasTarget, navigationController, refreshBrandedRouteAfterNativeChange, removeAllListeners, runNavigationWork, setOnArrival, setOnLocationChanged, setOnRouteChanged, setOnReroutingRequestedByOffRoute]);

  // Android retains the established branded overlay recovery read. iPhone
  // NavigationView renders the native Google route directly, so it deliberately
  // has no JavaScript geometry readback or duplicate green/white line.
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    if (!hasTarget || !targetKey) return;
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
        .finally(() => { reading = false; });
    }, 3_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [drawNavigationRoute, hasTarget, targetKey]);

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
      if (Platform.OS !== 'ios') refreshBrandedRouteAfterNativeChange(false);
    });
    return () => subscription.remove();
  }, [navigationController, refreshBrandedRouteAfterNativeChange, targetKey]);

  useEffect(() => {
    assessNavigationLocation(currentNavigationLocation());
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
    navigationRequestRef.current += 1;
    routePointsRef.current = [];
    staleRoutePlanRef.current = null;
    confirmedRerouteRef.current = null;
    offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    forcedRerouteInFlightRef.current = false;
    if (initializedRef.current) void navigationController.cleanup().catch(() => {});
  }, [clearRouteRefresh, clearVehicleMotion, navigationController]);

  useEffect(() => {
    const request = ++navigationRequestRef.current;
    confirmedRerouteRef.current = null;
    // A pickup/drop-off target replacement must also invalidate an older
    // route-change retry that captured the previous marker target.
    clearRouteRefresh();

    if (!hasTarget || !targetKey) {
      setNavigationViewIsReady(false);
      lastTargetKeyRef.current = null;
      arrivedTargetKeyRef.current = null;
      routePointsRef.current = [];
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
            await navigationViewControllerRef.current?.setNavigationUIEnabled(false);
            await navigationController.stopGuidance();
            await navigationController.clearDestinations();
          } catch {
            // The routing session may already have been released.
          }
        });
      }
      setNavigationMessage(null);
      return;
    }

    if (!hasDeviceLocation) {
      setNavigationMessage('Getting your live location before guidance starts.');
      return;
    }

    if (Platform.OS === 'ios' && !navigationViewIsReady) {
      setNavigationMessage('Preparing HY3N navigation…');
      return;
    }

    if (lastTargetKeyRef.current === targetKey) return;

    arrivedTargetKeyRef.current = null;
    routePointsRef.current = [];
    staleRoutePlanRef.current = null;
    offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    void clearRoute();
    let cancelled = false;
    setNavigationMessage('Preparing HY3N navigation…');

    void runNavigationWork(async () => {
      try {
        if (cancelled || navigationRequestRef.current !== request) return;
        // Do not leave a prior pickup/drop-off route visible while the exact
        // server-owned target changes. A short blank native route is safer than
        // a displayed road leading to the previous target.
        if (Platform.OS === 'ios') {
          await navigationViewControllerRef.current?.setNavigationUIEnabled(false);
          // On the first accepted ride the Google session is not initialized
          // yet. Calling these cleanup methods before init() throws on iOS and
          // becomes the generic “Navigation could not start” error.
          if (initializedRef.current) {
            await navigationController.stopGuidance();
            await navigationController.clearDestinations();
          }
          if (cancelled || navigationRequestRef.current !== request) return;
        }
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
        if (Platform.OS === 'ios') {
          await navigationViewControllerRef.current?.setNavigationUIEnabled(true);
          if (cancelled || navigationRequestRef.current !== request) return;
        }
        const painted = await drawNavigationRoute(() => !cancelled && navigationRequestRef.current === request);
        if (cancelled || navigationRequestRef.current !== request) return;
        lastTargetKeyRef.current = targetKey;
        setNavigationMessage(painted || Platform.OS === 'ios' ? null : 'Re-routing from your current road…');
      } catch (error) {
        diagnostics('route.response', { request, status: 'exception', code: navigationErrorCode(error) });
        if (!cancelled && navigationRequestRef.current === request) {
          setNavigationMessage('Navigation could not start. Please check location and connection.');
        }
      }
    });

    return () => { cancelled = true; };
  }, [clearRoute, clearRouteRefresh, diagnostics, drawNavigationRoute, hasDeviceLocation, hasTarget, navigationController, navigationViewIsReady, runNavigationWork, targetKey, targetLabel, targetLatitude, targetLongitude]);

  return (
    <View style={styles.container}>
      {hasTarget ? <DriverActiveNavigationKeepAwake /> : null}
      {hasDeviceLocation ? (
        usesNativeIPhoneRouteRenderer ? (
          <NavigationView
            style={StyleSheet.absoluteFill}
            initialCameraPosition={{
              target: { lat: Number(latitude), lng: Number(longitude) },
              zoom: 17,
              bearing: Number(heading) || 0,
              tilt: 42,
            }}
            // Use Google's native navigation presentation for active trips.
            // The SDK keeps the vehicle centered and heading-forward while it
            // moves the map underneath it, owns the route line, and performs
            // off-route/wrong-direction rerouting. HY3N only supplies the
            // server-owned destination.
            navigationUIEnabledPreference={NavigationUIEnabledPreference.AUTOMATIC}
            onNavigationViewControllerCreated={handleNavigationViewControllerCreated}
                onMapViewControllerCreated={handleMapViewControllerCreated}
                mapColorScheme={nativeMapColorScheme}
                myLocationEnabled={false}
            // Active navigation must look like Google Maps Navigation: retain
            // its roads, labels, POIs, traffic details, and 3D presentation.
            // The HY3N clean style is kept only for the quiet pre-trip map.
            trafficEnabled
            headerEnabled
            footerEnabled
            tripProgressBarEnabled
            recenterButtonEnabled
            speedometerEnabled={false}
            speedLimitIconEnabled={false}
            trafficPromptsEnabled
            trafficIncidentCardsEnabled
            indoorEnabled={false}
            indoorLevelPickerEnabled={false}
            buildingsEnabled={false}
            mapToolbarEnabled={false}
          />
        ) : (
          <MapView
            style={StyleSheet.absoluteFill}
            initialCameraPosition={{
              target: { lat: Number(latitude), lng: Number(longitude) },
              zoom: hasTarget ? 17 : 16,
              bearing: Number(heading) || 0,
              tilt: hasTarget ? 42 : 0,
            }}
            // Before an iPhone trip and throughout the existing Android path,
            // HY3N keeps its own quiet map and car marker.
                mapColorScheme={nativeMapColorScheme}
                mapStyle={CLEAN_GOOGLE_STYLE}
                trafficEnabled
                myLocationEnabled={false}
            myLocationButtonEnabled={false}
            compassEnabled
            indoorEnabled={false}
            indoorLevelPickerEnabled={false}
            buildingsEnabled={false}
            mapToolbarEnabled={false}
                onMapViewControllerCreated={handleMapViewControllerCreated}
          />
        )
      ) : (
        <View style={styles.locationGate}>
          <Text style={styles.locationGateTitle}>Getting your live location</Text>
          <Text style={styles.locationGateText}>HY3N does not use a fallback place for Driver navigation.</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.settingsButton} accessibilityRole="button">
            <Text style={styles.settingsButtonText}>Check Location Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {navigationMessage && hasDeviceLocation && (
        <View style={styles.navigationMessage} pointerEvents="box-none">
          <Text style={styles.navigationMessageText}>{navigationMessage}</Text>
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
  container: { ...StyleSheet.absoluteFillObject },
  locationGate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    padding: 28,
  },
  locationGateTitle: { color: '#0F172A', fontSize: 19, fontWeight: '900', textAlign: 'center' },
  locationGateText: { color: '#475569', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  settingsButton: { backgroundColor: GREEN, borderRadius: 14, marginTop: 18, paddingHorizontal: 18, paddingVertical: 12 },
  settingsButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  navigationMessage: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 14,
    bottom: 122,
    left: 24,
    paddingHorizontal: 15,
    paddingVertical: 11,
    position: 'absolute',
    right: 24,
  },
  navigationMessageText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', lineHeight: 18, textAlign: 'center' },
});
