import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
} from '@/lib/driver-route-progress';

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
 * A branded map stays visible for the complete Driver journey. Google
 * Navigation runs as the route and voice engine, while HY3N owns the visual
 * vehicle marker, map camera, and route line. This deliberately avoids the
 * NavigationView blue current-location arrow after a ride is accepted.
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
  const {
    navigationController,
    removeAllListeners,
    setOnArrival,
    setOnRouteChanged,
    setOnReroutingRequestedByOffRoute,
  } = useNavigation();
  const [mapViewController, setMapViewController] = useState<MapViewController | null>(null);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
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
  const staleRouteSignatureRef = useRef<string | null>(null);
  const offRouteMonitorRef = useRef(EMPTY_DRIVER_OFF_ROUTE_MONITOR);
  const wrongWayMonitorRef = useRef(EMPTY_DRIVER_WRONG_WAY_MONITOR);
  const forcedRerouteInFlightRef = useRef(false);
  const hasDeviceLocation = hasPoint(latitude, longitude);
  const targetLatitude = Number(target?.latitude);
  const targetLongitude = Number(target?.longitude);
  const targetLabel = target?.label?.trim() || (tripStatus === 'dropoff' ? 'Drop-off' : 'Pickup');
  const hasTarget = hasPoint(targetLatitude, targetLongitude);
  const targetKey = hasTarget
    ? `${tripStatus || 'target'}:${targetLatitude.toFixed(6)}:${targetLongitude.toFixed(6)}:${targetLabel}`
    : null;
  // Async native callbacks must read the latest real GPS fix, not coordinates
  // captured when the destination was first set.
  const liveLocationRef = useRef<{
    latitude: number; longitude: number; accuracyMeters?: number | null;
  } | null>(null);
  liveLocationRef.current = hasDeviceLocation
    ? { latitude: Number(latitude), longitude: Number(longitude), accuracyMeters: locationAccuracy }
    : null;

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
  }, [applyVehiclePosition, clearVehicleMotion, hasDeviceLocation, hasTarget, heading, latitude, longitude, mapViewController]);

  const clearRouteLines = useCallback(async () => {
    if (!mapViewController) return;

    // Unlike the native navigation engine, these two branded polylines are
    // HY3N-owned overlays. Remove them as one awaited operation before drawing
    // replacement geometry, otherwise an off-route Driver can see the road
    // they have already left until the map's asynchronous bridge catches up.
    await Promise.allSettled([
      Promise.resolve(mapViewController.removePolyline(DRIVER_ROUTE_OUTLINE_ID)),
      Promise.resolve(mapViewController.removePolyline(DRIVER_ROUTE_ID)),
    ]);
  }, [mapViewController]);

  const clearRoute = useCallback(() => {
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
    const request = navigationRequestRef.current;
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || navigationRequestRef.current !== request) return;
      const points = staleRouteSignatureRef.current === JSON.stringify(routePointsRef.current)
        ? [] : remainingDriverRoute(liveLocationRef.current, routePointsRef.current);
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
    routeOverlayWorkRef.current = work.catch(() => {});
  }, [clearRouteLines, mapViewController]);

  const drawNavigationRoute = useCallback((isCurrent: () => boolean = () => true) => {
    const work = routeOverlayWorkRef.current.then(async () => {
      if (!mapViewController || !hasTarget || !isCurrent()) return false;
      try {
        // Remove the passed road before reading replacement geometry. A blank
        // line is safer than showing a Driver travelling along the old road.
        await clearRouteLines();
        if (!isCurrent()) return false;

        const segments = await navigationController.getRouteSegments();
        const points = routePointsForMap(segments);
        if (!isCurrent() || points.length < 2
          || !driverRouteReachesTarget(points, { lat: targetLatitude, lng: targetLongitude })) return false;
        await mapViewController.addMarker({
          id: DRIVER_TARGET_MARKER_ID,
          position: { lat: targetLatitude, lng: targetLongitude },
          title: targetLabel, anchor: { u: 0.5, v: 1 }, visible: true,
        });
        if (!isCurrent()) return false;

        const changed = JSON.stringify(routePointsRef.current) !== JSON.stringify(points);
        routePointsRef.current = points;
        if (changed) {
          offRouteMonitorRef.current = { ...EMPTY_DRIVER_OFF_ROUTE_MONITOR, lastRerouteAtMs: offRouteMonitorRef.current.lastRerouteAtMs };
          wrongWayMonitorRef.current = { ...EMPTY_DRIVER_WRONG_WAY_MONITOR, lastRequestAtMs: wrongWayMonitorRef.current.lastRequestAtMs };
        }
        const remaining = remainingDriverRoute(liveLocationRef.current, points);
        // Google can still return the old leg while a reroute is pending.
        // Retain it for deviation checks but do not repaint a disconnected line.
        if (remaining.length < 2 || staleRouteSignatureRef.current === JSON.stringify(points)) return false;
        staleRouteSignatureRef.current = null;

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
        return true;
      } catch {
        // Navigation voice guidance continues if native route geometry is
        // temporarily unavailable. A later route-change event retries drawing.
        return false;
      }
    });
    // Preserve the ordering queue even after a native bridge failure. The
    // caller gets the real result while the next reroute can still continue.
    routeOverlayWorkRef.current = work.then(() => undefined, () => undefined);
    return work;
  }, [clearRouteLines, hasTarget, mapViewController, navigationController, targetLabel, targetLatitude, targetLongitude]);

  /**
   * Google owns off-route detection and route choice. HY3N owns the clean map
   * presentation, so it re-reads the native route after the SDK says a route
   * changed. A short retry window handles the native callback/geometry race on
   * iPhone without resetting a destination or disrupting spoken guidance.
   */
  const refreshBrandedRouteAfterNativeChange = useCallback((offRoute: boolean) => {
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
    if (
      forcedRerouteInFlightRef.current
      || !initializedRef.current
      || !hasTarget
      || !targetKey
      || lastTargetKeyRef.current !== targetKey
    ) return;

    const request = navigationRequestRef.current;
    const stillCurrent = () => navigationRequestRef.current === request && lastTargetKeyRef.current === targetKey;
    forcedRerouteInFlightRef.current = true;
    staleRouteSignatureRef.current = JSON.stringify(routePointsRef.current);
    setNavigationMessage('Re-routing from your current road…');
    void runNavigationWork(async () => {
      try {
        if (!stillCurrent()) return;
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
        if (routeStatus !== RouteStatus.OK) {
          setNavigationMessage(readableNavigationFailure(routeStatus));
          return;
        }
        await navigationController.startGuidance();
        if (!stillCurrent()) return;
        refreshBrandedRouteAfterNativeChange(true);
      } catch {
        if (stillCurrent()) setNavigationMessage('Navigation could not re-route. Please check location and connection.');
      } finally {
        forcedRerouteInFlightRef.current = false;
      }
    });
  }, [
    hasTarget,
    navigationController,
    refreshBrandedRouteAfterNativeChange,
    runNavigationWork,
    targetKey,
    targetLabel,
    targetLatitude,
    targetLongitude,
  ]);

  useEffect(() => {
    setOnArrival(() => {
      setNavigationMessage('You have reached this stop. Confirm your HY3N trip action below.');
    });
    setOnRouteChanged(() => refreshBrandedRouteAfterNativeChange(false));
    setOnReroutingRequestedByOffRoute(() => {
      staleRouteSignatureRef.current = JSON.stringify(routePointsRef.current);
      refreshBrandedRouteAfterNativeChange(true);
    });
    return () => {
      clearRouteRefresh();
      removeAllListeners();
    };
  }, [clearRouteRefresh, refreshBrandedRouteAfterNativeChange, removeAllListeners, setOnArrival, setOnRouteChanged, setOnReroutingRequestedByOffRoute]);

  // The branded overlay is not a NavigationView: Google does not update it for
  // us. A low-frequency single-flight read recovers a dropped native callback;
  // it never resets the destination or changes trip/fare state.
  useEffect(() => {
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

  useEffect(() => {
    if (
      !hasDeviceLocation
      || !hasTarget
      || !targetKey
      || !initializedRef.current
      || lastTargetKeyRef.current !== targetKey
      || routePointsRef.current.length < 2
    ) return;

    const sampleKey = locationTimestamp != null && Number.isFinite(Number(locationTimestamp))
      ? `timestamp:${Number(locationTimestamp)}`
      : `coordinate:${Number(latitude).toFixed(6)}:${Number(longitude).toFixed(6)}`;
    const assessment = assessDriverOffRoute(
      offRouteMonitorRef.current,
      {
        latitude: Number(latitude),
        longitude: Number(longitude),
        accuracyMeters: locationAccuracy,
      },
      routePointsRef.current,
      sampleKey,
      Date.now(),
    );
    offRouteMonitorRef.current = assessment.next;
    const wrongWay = assessDriverWrongWay(
      wrongWayMonitorRef.current,
      liveLocationRef.current!, routePointsRef.current, sampleKey, Date.now(),
    );
    wrongWayMonitorRef.current = wrongWay.next;
    if (assessment.shouldReroute || wrongWay.shouldReroute) requestGpsFallbackReroute();
    updateRemainingRoute();
  }, [
    hasDeviceLocation,
    hasTarget,
    latitude,
    locationAccuracy,
    locationTimestamp,
    longitude,
    requestGpsFallbackReroute,
    targetKey,
    updateRemainingRoute,
  ]);

  useEffect(() => () => {
    clearVehicleMotion();
    clearRouteRefresh();
    navigationRequestRef.current += 1;
    routePointsRef.current = [];
    staleRouteSignatureRef.current = null;
    offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
    wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
    forcedRerouteInFlightRef.current = false;
    if (initializedRef.current) void navigationController.cleanup().catch(() => {});
  }, [clearRouteRefresh, clearVehicleMotion, navigationController]);

  useEffect(() => {
    const request = ++navigationRequestRef.current;
    // A pickup/drop-off target replacement must also invalidate an older
    // route-change retry that captured the previous marker target.
    clearRouteRefresh();

    if (!hasTarget || !targetKey) {
      lastTargetKeyRef.current = null;
      routePointsRef.current = [];
      staleRouteSignatureRef.current = null;
      offRouteMonitorRef.current = EMPTY_DRIVER_OFF_ROUTE_MONITOR;
      wrongWayMonitorRef.current = EMPTY_DRIVER_WRONG_WAY_MONITOR;
      clearRouteRefresh();
      clearRoute();
      if (initializedRef.current) {
        void runNavigationWork(async () => {
          try {
            if (navigationRequestRef.current !== request) return;
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

    if (lastTargetKeyRef.current === targetKey) return;

    routePointsRef.current = [];
    staleRouteSignatureRef.current = null;
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
          if (cancelled || navigationRequestRef.current !== request) return;
          if (sessionStatus !== NavigationSessionStatus.OK) {
            setNavigationMessage(readableNavigationFailure(sessionStatus));
            return;
          }
          initializedRef.current = true;
          navigationController.setAudioGuidanceType(
            AudioGuidance.VOICE_ALERTS_AND_GUIDANCE | AudioGuidance.BLUETOOTH_AUDIO,
          );
          navigationController.startUpdatingLocation();
        }

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
        if (routeStatus !== RouteStatus.OK) {
          setNavigationMessage(readableNavigationFailure(routeStatus));
          return;
        }

        await navigationController.startGuidance();
        if (cancelled || navigationRequestRef.current !== request) return;
        const painted = await drawNavigationRoute(() => !cancelled && navigationRequestRef.current === request);
        if (cancelled || navigationRequestRef.current !== request) return;
        lastTargetKeyRef.current = targetKey;
        setNavigationMessage(painted ? null : 'Re-routing from your current road…');
      } catch {
        if (!cancelled && navigationRequestRef.current === request) {
          setNavigationMessage('Navigation could not start. Please check location and connection.');
        }
      }
    });

    return () => { cancelled = true; };
  }, [clearRoute, clearRouteRefresh, drawNavigationRoute, hasDeviceLocation, hasTarget, navigationController, runNavigationWork, targetKey, targetLabel, targetLatitude, targetLongitude]);

  return (
    <View style={styles.container}>
      {hasDeviceLocation ? (
        <MapView
          style={StyleSheet.absoluteFill}
          initialCameraPosition={{
            target: { lat: Number(latitude), lng: Number(longitude) },
            zoom: hasTarget ? 17 : 16,
            bearing: Number(heading) || 0,
            tilt: hasTarget ? 42 : 0,
          }}
          // The branded MapView never switches at acceptance. The HY3N car is
          // its only live vehicle marker; the Google blue location arrow stays
          // disabled while the Navigation SDK remains the voice/route engine.
          mapColorScheme={MapColorScheme.FOLLOW_SYSTEM}
          mapStyle={CLEAN_GOOGLE_STYLE}
          trafficEnabled
          myLocationEnabled={false}
          myLocationButtonEnabled={false}
          compassEnabled
          indoorEnabled={false}
          indoorLevelPickerEnabled={false}
          buildingsEnabled={false}
          mapToolbarEnabled={false}
          onMapViewControllerCreated={setMapViewController}
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

      {navigationMessage && hasDeviceLocation && (
        <View style={styles.navigationMessage} pointerEvents="box-none">
          <Text style={styles.navigationMessageText}>{navigationMessage}</Text>
        </View>
      )}
    </View>
  );
}

export default function NativeDriverGoogleMap(props: Props) {
  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={HY3N_NAVIGATION_TERMS_OPTIONS}
      taskRemovedBehavior={TaskRemovedBehavior.CONTINUE_SERVICE}
    >
      <DriverNavigationSurface {...props} />
    </NavigationProvider>
  );
}

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
