import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  AudioGuidance,
  CameraPerspective,
  MapColorScheme,
  MapView,
  NavigationNightMode,
  NavigationProvider,
  NavigationSessionStatus,
  NavigationUIEnabledPreference,
  NavigationView,
  RouteStatus,
  TaskRemovedBehavior,
  TravelMode,
  useNavigation,
  type MapViewController,
  type NavigationViewController,
} from '@googlemaps/react-native-navigation-sdk';

type MapTarget = { latitude: number; longitude: number; label: string };
type Props = {
  latitude?: number;
  longitude?: number;
  locationTimestamp?: number | null;
  heading?: number | null;
  target?: MapTarget | null;
  tripStatus?: 'pickup' | 'dropoff' | null;
};

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const DRIVER_VEHICLE_MARKER_ID = 'hy3n-driver-vehicle';
// “Clean” applies only to clutter. It does not force a colour theme: the map
// must mirror the phone’s own light/dark setting just like the rest of HY3N.
// Keep roads, route and traffic while hiding distracting place/transit labels.
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
// NavigationProvider builds its native controller from these options. Keep the
// object reference stable across live GPS re-renders: a fresh object causes a
// new controller and can dispose the active native Navigation view on iPhone.
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
 * The Driver map is an embedded Google Navigation SDK surface. It stays inside
 * HY3N while Google supplies the live route, maneuver banner, automatic
 * rerouting, and spoken left/right guidance.
 */
function DriverNavigationSurface({ latitude, longitude, heading, target, tripStatus }: Props) {
  const { navigationController, removeAllListeners, setOnArrival, setOnLocationChanged } = useNavigation();
  const [mapViewController, setMapViewController] = useState<MapViewController | null>(null);
  const [navigationViewController, setNavigationViewController] = useState<NavigationViewController | null>(null);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const navigationRequestRef = useRef(0);
  const lastTargetKeyRef = useRef<string | null>(null);
  const hasDeviceLocation = hasPoint(latitude, longitude);
  const targetLatitude = Number(target?.latitude);
  const targetLongitude = Number(target?.longitude);
  const targetLabel = target?.label?.trim() || (tripStatus === 'dropoff' ? 'Drop-off' : 'Pickup');
  const hasTarget = hasPoint(targetLatitude, targetLongitude);
  const mapMode = hasTarget ? 'navigation' : 'online';
  const targetKey = hasTarget
    ? `${tripStatus || 'target'}:${targetLatitude.toFixed(6)}:${targetLongitude.toFixed(6)}:${targetLabel}`
    : null;

  // The normal online screen deliberately uses a regular Google map rather
  // than a NavigationView. This keeps it as simple as the Driver reference:
  // one heading-aware HY3N car, not the Navigation SDK's blue guidance arrow.
  // NavigationView is reserved for an accepted trip, where Google owns the
  // route, turn banner, live ETA and spoken guidance.
  useEffect(() => {
    if (!mapViewController || !hasDeviceLocation || hasTarget) return;
    void mapViewController.addMarker({
      id: DRIVER_VEHICLE_MARKER_ID,
      position: { lat: Number(latitude), lng: Number(longitude) },
      imgPath: DRIVER_VEHICLE_MARKER_ASSET,
      title: 'Your HY3N vehicle',
      rotation: Number(heading) || 0,
      flat: true,
      anchor: { u: 0.5, v: 0.5 },
      visible: true,
    }).catch(() => {
      // Guidance remains usable if the optional branded marker cannot load.
      // Native-project validation verifies the asset on both platforms.
    });
  }, [hasDeviceLocation, hasTarget, heading, latitude, longitude, mapViewController]);

  useEffect(() => () => {
    mapViewController?.removeMarker(DRIVER_VEHICLE_MARKER_ID);
  }, [mapViewController]);

  useEffect(() => {
    if (hasTarget) mapViewController?.removeMarker(DRIVER_VEHICLE_MARKER_ID);
  }, [hasTarget, mapViewController]);

  const followDriver = useCallback(() => {
    if (!navigationViewController) return;
    const perspective = hasTarget
      ? CameraPerspective.TILTED
      : CameraPerspective.TOP_DOWN_NORTH_UP;
    void navigationViewController.setFollowingPerspective(perspective).catch(() => {});
  }, [hasTarget, navigationViewController]);

  useEffect(() => {
    setOnArrival(() => {
      setNavigationMessage('You have reached this stop. Confirm your HY3N trip action below.');
    });
    // Location updates make the camera return to its road-snapped Driver view.
    // Do not wait for this callback before setting the route: on iOS the
    // Navigation SDK can emit its first callback only after guidance starts.
    setOnLocationChanged(followDriver);
    return () => removeAllListeners();
  }, [followDriver, removeAllListeners, setOnArrival, setOnLocationChanged]);

  useEffect(() => () => {
    navigationRequestRef.current += 1;
    // Navigation sessions are heavyweight. Release the native guidance engine
    // when the Driver goes offline or leaves this screen.
    if (initializedRef.current) void navigationController.cleanup().catch(() => {});
  }, [navigationController]);

  useEffect(() => {
    const request = ++navigationRequestRef.current;

    if (!hasTarget || !targetKey) {
      lastTargetKeyRef.current = null;
      if (initializedRef.current) {
        void (async () => {
          try {
            await navigationController.stopGuidance();
            await navigationController.clearDestinations();
            await navigationViewController?.setNavigationUIEnabled(false);
          } catch {
            // The session may already have been released while a trip changed.
          }
        })();
      }
      setNavigationMessage(null);
      return;
    }

    if (!hasDeviceLocation) {
      setNavigationMessage('Getting your live location before guidance starts.');
      return;
    }

    if (lastTargetKeyRef.current === targetKey) return;

    let cancelled = false;
    setNavigationMessage('Preparing in-app navigation…');

    void (async () => {
      try {
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

        // The supplied device coordinate has already passed validation above.
        // Set the destination immediately, then let Navigation SDK road-snap
        // subsequent GPS updates while live guidance is running.
        const routeStatus = await navigationController.setDestination(
          {
            title: targetLabel,
            position: { lat: targetLatitude, lng: targetLongitude },
            preferSameSideOfRoad: true,
          },
          {
            routingOptions: { travelMode: TravelMode.DRIVING },
            displayOptions: {
              showDestinationMarkers: true,
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
        await navigationViewController?.setNavigationUIEnabled(true);
        followDriver();
        lastTargetKeyRef.current = targetKey;
        setNavigationMessage(null);
      } catch {
        if (!cancelled && navigationRequestRef.current === request) {
          setNavigationMessage('Navigation could not start. Please check location and connection.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [followDriver, hasDeviceLocation, hasTarget, navigationController, navigationViewController, targetKey, targetLabel, targetLatitude, targetLongitude]);

  return (
    <View style={styles.container}>
      {hasDeviceLocation && hasTarget ? (
        <NavigationView
          key={mapMode}
          style={StyleSheet.absoluteFill}
          initialCameraPosition={{
            target: { lat: Number(latitude), lng: Number(longitude) },
            zoom: 16,
            bearing: 0,
            tilt: 0,
          }}
          // Follow the phone's system theme. The clean style only suppresses
          // clutter; it never forces a light map on Drivers using dark mode.
          mapColorScheme={MapColorScheme.FOLLOW_SYSTEM}
          navigationNightMode={NavigationNightMode.AUTO}
          mapStyle={CLEAN_GOOGLE_STYLE}
          // Match the familiar driving-navigation pattern: when a ride has a
          // target, Navigation SDK owns the top maneuver banner and bottom
          // live ETA/distance panel. The separate vertical trip-progress rail
          // is intentionally off because it adds an unexplained blue line to
          // the left side of the driving map.
          navigationUIEnabledPreference={hasTarget
            ? NavigationUIEnabledPreference.AUTOMATIC
            : NavigationUIEnabledPreference.DISABLED}
          headerEnabled={hasTarget}
          footerEnabled={hasTarget}
          tripProgressBarEnabled={false}
          trafficEnabled
          trafficPromptsEnabled={false}
          trafficIncidentCardsEnabled={false}
          speedometerEnabled
          speedLimitIconEnabled
          recenterButtonEnabled
          reportIncidentButtonEnabled={false}
          myLocationEnabled={false}
          myLocationButtonEnabled={false}
          compassEnabled
          indoorEnabled={false}
          indoorLevelPickerEnabled={false}
          buildingsEnabled={false}
          mapToolbarEnabled={false}
          onMapViewControllerCreated={setMapViewController}
          onNavigationViewControllerCreated={setNavigationViewController}
          onRecenterButtonClick={followDriver}
          androidStylingOptions={{
            primaryDayModeThemeColor: GREEN,
            secondaryDayModeThemeColor: GOLD,
            primaryNightModeThemeColor: GREEN,
            secondaryNightModeThemeColor: GOLD,
          }}
          iOSStylingOptions={{
            navigationHeaderPrimaryBackgroundColor: GREEN,
            navigationHeaderSecondaryBackgroundColor: GOLD,
            navigationHeaderPrimaryBackgroundColorNightMode: '#111111',
            navigationHeaderSecondaryBackgroundColorNightMode: '#1D2939',
          }}
        />
      ) : hasDeviceLocation ? (
        <MapView
          key={mapMode}
          style={StyleSheet.absoluteFill}
          initialCameraPosition={{
            target: { lat: Number(latitude), lng: Number(longitude) },
            zoom: 16,
            bearing: Number(heading) || 0,
            tilt: 0,
          }}
          // The online map deliberately has no Navigation SDK guidance UI and
          // no Google current-location layer. The custom HY3N car marker above
          // is therefore the only moving Driver position on screen.
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
