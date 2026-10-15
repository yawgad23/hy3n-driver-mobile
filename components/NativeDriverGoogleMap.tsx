import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  AudioGuidance,
  CameraPerspective,
  MapColorScheme,
  NavigationNightMode,
  NavigationProvider,
  NavigationSessionStatus,
  NavigationUIEnabledPreference,
  NavigationView,
  RouteStatus,
  TaskRemovedBehavior,
  TravelMode,
  useNavigation,
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
  dark?: boolean;
};

const GOLD = '#D4AF37';
const GREEN = '#22C55E';

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
function DriverNavigationSurface({ latitude, longitude, target, tripStatus, dark = false }: Props) {
  const { navigationController, removeAllListeners, setOnArrival, setOnLocationChanged } = useNavigation();
  const [navigationViewController, setNavigationViewController] = useState<NavigationViewController | null>(null);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const [navigationLocationReady, setNavigationLocationReady] = useState(false);
  const initializedRef = useRef(false);
  const navigationRequestRef = useRef(0);
  const lastTargetKeyRef = useRef<string | null>(null);
  const hasDeviceLocation = hasPoint(latitude, longitude);
  const hasTarget = target ? hasPoint(target.latitude, target.longitude) : false;
  const targetKey = hasTarget && target
    ? `${tripStatus || 'target'}:${target.latitude.toFixed(6)}:${target.longitude.toFixed(6)}:${target.label}`
    : null;

  const followDriver = useCallback(() => {
    if (!navigationViewController) return;
    void navigationViewController.setFollowingPerspective(CameraPerspective.TILTED).catch(() => {});
  }, [navigationViewController]);

  useEffect(() => {
    setOnArrival(() => {
      setNavigationMessage('You have reached this stop. Confirm your HY3N trip action below.');
    });
    // The Navigation SDK road-snaps its own position. Do not request a route
    // until that SDK has supplied its first live location fix.
    setOnLocationChanged(() => setNavigationLocationReady(true));
    return () => removeAllListeners();
  }, [removeAllListeners, setOnArrival, setOnLocationChanged]);

  useEffect(() => () => {
    navigationRequestRef.current += 1;
    // Navigation sessions are heavyweight. Release the native guidance engine
    // when the Driver goes offline or leaves this screen.
    if (initializedRef.current) void navigationController.cleanup().catch(() => {});
  }, [navigationController]);

  useEffect(() => {
    const request = ++navigationRequestRef.current;

    if (!hasTarget || !targetKey || !target) {
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

        if (!navigationLocationReady) {
          setNavigationMessage('Finding your position for turn-by-turn guidance…');
          return;
        }

        const routeStatus = await navigationController.setDestination(
          {
            title: target.label || (tripStatus === 'dropoff' ? 'Drop-off' : 'Pickup'),
            position: { lat: target.latitude, lng: target.longitude },
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
  }, [followDriver, hasDeviceLocation, hasTarget, navigationController, navigationLocationReady, navigationViewController, target, targetKey, tripStatus]);

  return (
    <View style={styles.container}>
      {hasDeviceLocation ? (
        <NavigationView
          style={StyleSheet.absoluteFill}
          initialCameraPosition={{
            target: { lat: Number(latitude), lng: Number(longitude) },
            zoom: 16,
            bearing: 0,
            tilt: 0,
          }}
          mapColorScheme={dark ? MapColorScheme.DARK : MapColorScheme.LIGHT}
          navigationNightMode={dark ? NavigationNightMode.FORCE_NIGHT : NavigationNightMode.FORCE_DAY}
          navigationUIEnabledPreference={NavigationUIEnabledPreference.DISABLED}
          headerEnabled={hasTarget}
          footerEnabled={hasTarget}
          trafficEnabled
          trafficPromptsEnabled
          trafficIncidentCardsEnabled
          speedometerEnabled
          speedLimitIconEnabled
          recenterButtonEnabled
          reportIncidentButtonEnabled
          myLocationEnabled
          myLocationButtonEnabled
          compassEnabled
          mapToolbarEnabled={false}
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
      ) : (
        <View style={[styles.locationGate, dark && styles.locationGateDark]}>
          <Text style={[styles.locationGateTitle, dark && styles.locationGateTextDark]}>Getting your live location</Text>
          <Text style={[styles.locationGateText, dark && styles.locationGateTextDark]}>HY3N does not use a fallback place for Driver navigation.</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.settingsButton} accessibilityRole="button">
            <Text style={styles.settingsButtonText}>Check Location Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {navigationMessage && hasDeviceLocation && (
        <View style={[styles.navigationMessage, dark && styles.navigationMessageDark]} pointerEvents="box-none">
          <Text style={styles.navigationMessageText}>{navigationMessage}</Text>
        </View>
      )}
    </View>
  );
}

export default function NativeDriverGoogleMap(props: Props) {
  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={{
        title: 'HY3N Driver Navigation',
        companyName: 'HY3N Transport Services',
        showOnlyDisclaimer: false,
        uiParams: {
          acceptButtonTextColor: GREEN,
          cancelButtonTextColor: '#B91C1C',
        },
      }}
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
  locationGateDark: { backgroundColor: '#111827' },
  locationGateTitle: { color: '#0F172A', fontSize: 19, fontWeight: '900', textAlign: 'center' },
  locationGateText: { color: '#475569', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  locationGateTextDark: { color: '#E2E8F0' },
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
  navigationMessageDark: { backgroundColor: 'rgba(2, 6, 23, 0.96)' },
  navigationMessageText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', lineHeight: 18, textAlign: 'center' },
});
