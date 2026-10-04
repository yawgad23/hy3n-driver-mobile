import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES, FREE_WAITING_MINUTES, POPULAR_DESTINATIONS } from '@/constants/rides';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView,
  Dimensions, Alert, ActivityIndicator, Animated, Image, Platform, PanResponder,
  Modal, TextInput, StatusBar
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { trpc } from '@/lib/trpc';
import { driverLocationPublisher } from '@/lib/driver-location-publisher';
import { shouldPublishDriverTripMeter } from '@/lib/driver-trip-meter-publisher';
import { subscribeDriverRideOffer } from '@/lib/ride-offer-signal';
import { submitDriverSos } from '@/lib/safety';
import { Linking } from 'react-native';
import { RideChatModal } from '@/components/ride-chat-modal';
import NativeDriverGoogleMap from '@/components/NativeDriverGoogleMap';
import { Colors } from '@/constants/theme';
import { buildVehicleFields } from '@/lib/vehicle';
import { useThemeContext } from '@/lib/theme-provider';
import { startDriverBackgroundLocationUpdates, stopDriverBackgroundLocationUpdates } from '@/lib/driver-background-location';
import {
  DRIVER_FOREGROUND_LOCATION_POLICY,
  DRIVER_FOREGROUND_PRESENCE_HEARTBEAT_MS,
  shouldTrackDriverLocation,
} from '@/lib/driver-location-policy';
import {
  driverAvailabilityLabel,
  hasRecentUsableDriverLocation,
  hasUsableDriverLocation,
} from '@/lib/driver-location-readiness';
import {
  INCOMING_TRIP_ALERT_PLAYBACK,
  INCOMING_TRIP_NOTIFICATION,
  shouldPlayIncomingTripAlert,
} from '@/lib/incoming-trip-alert';
import { deliveryContactForDriver, isDeliveryRide } from '@/lib/delivery-contact';
import {
  DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS,
  DRIVER_OFFER_POLL_INTERVAL_MS,
  DRIVER_OFFER_REVIEW_SECONDS,
  driverOfferAcceptedByServer,
  nextDriverOfferCountdown,
} from '@/lib/driver-offer-lifecycle';
import { driverTripTerminalStatus } from '@/lib/driver-trip-lifecycle';

const INCOMING_TRIP_ALERT = require('../../assets/audio/incoming-trip-alert.wav');
const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#3B82F6';

// Match HY3N's whole-cedi rule: .50 and below rounds down; above .50 rounds up.
function formatPassengerFare(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'GH₵0';
  const whole = Math.floor(amount);
  return `GH₵${whole + (amount - whole > 0.5 ? 1 : 0)}`;
}

function calculateNavigationEtaMinutes(latitude: number, longitude: number, targetLatitude: number, targetLongitude: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(targetLatitude - latitude);
  const dLng = toRadians(targetLongitude - longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(latitude)) * Math.cos(toRadians(targetLatitude)) * Math.sin(dLng / 2) ** 2;
  const straightLineKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Conservative road-distance and urban driving-speed factors update with each GPS point.
  return Math.max(1, Math.ceil((straightLineKm * 1.25 / 24) * 60));
}

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1b1f24' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d2d7de' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1b1f24' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#4b5563' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#242b33' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1d3a2a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#303841' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#3b4652' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#6b5725' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#26313a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#102b46' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9fc5e8' }] },
];

const { height } = Dimensions.get('window');

// These service cues describe the category the Rider actually booked. They
// do not change matching, fare, or eligibility; those remain server-owned.
const AC_INCLUDED_CATEGORIES = new Set(['comfort', 'kantanka', 'executive']);

function rideCategoryName(category: unknown) {
  const id = String(category || '').trim().toLowerCase();
  return RIDE_CATEGORIES.find((item) => item.id === id)?.name || 'Standard';
}

function hasIncludedAirConditioning(category: unknown) {
  return AC_INCLUDED_CATEGORIES.has(String(category || '').trim().toLowerCase());
}

function airConditioningReminder(category: unknown, phase: 'pickup' | 'trip') {
  if (!hasIncludedAirConditioning(category)) return null;
  const action = phase === 'pickup'
    ? 'Turn on the air conditioning before pickup.'
    : 'Keep the air conditioning on for the rider.';
  return `${rideCategoryName(category)} includes AC. ${action}`;
}

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === 'dark';
  const themeColors = Colors[isDark ? 'dark' : 'light'];

  const { user, driverProfile } = useDriverAuth();
  const { prefs, toggle: togglePref, setPrefs } = useDriverPreferences();
  const incomingTripPlayer = useAudioPlayer(INCOMING_TRIP_ALERT, {
    downloadFirst: true,
    keepAudioSessionActive: true,
  });
  const setAvailability = trpc.driverOperations.setAvailability.useMutation();
  const respondToOffer = trpc.driverTrips.respondToOffer.useMutation();
  const arriveAtPickup = trpc.driverTrips.arrive.useMutation();
  const verifyPickup = trpc.driverTrips.verifyPickup.useMutation();
  const verifyAndStart = (trpc.driverTrips as any).verifyAndStart.useMutation();
  // The deployed backend accepts a startLocation for the server trip meter;
  // the published package declaration is updated independently of the API.
  const startTrip = (trpc.driverTrips.start as any).useMutation();
  const recordTripLocation = (trpc.driverTrips as any).recordTripLocation.useMutation();
  const completeTrip = trpc.driverTrips.complete.useMutation();
  const rateRider = (trpc.driverTrips as any).rateRider.useMutation();
  const cancelTrip = trpc.driverTrips.cancel.useMutation();
  const activateQueuedTrip = trpc.driverTrips.activateQueued.useMutation();
  const recordDrivingEvent = trpc.driverSafety.recordDrivingEvent.useMutation();

  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<ExpoLocation.LocationObject | null>(null);
  const hasCurrentLocation = hasUsableDriverLocation(location);
  const driverStatusLabel = driverAvailabilityLabel(isOnline, hasCurrentLocation);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [incomingRide, setIncomingRide] = useState<any>(null);
  const [completedRide, setCompletedRide] = useState<any>(null);
  const [showRating, setShowRating] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [tripActionPending, setTripActionPending] = useState(false);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [eta, setEta] = useState<number | null>(null);
  const [nextRide, setNextRide] = useState<any>(null);
  const [queuedRideToActivate, setQueuedRideToActivate] = useState<any>(null);
  const [rideOfferSeconds, setRideOfferSeconds] = useState(DRIVER_OFFER_REVIEW_SECONDS);
  const [showOtp, setShowOtp] = useState(false);
  const [pickupCode, setPickupCode] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showFareScreen, setShowFareScreen] = useState(false);
  const [showTripSummary, setShowTripSummary] = useState(false);
  const [foundItem, setFoundItem] = useState('');
  const [safetyReport, setSafetyReport] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [tripDistanceKm, setTripDistanceKm] = useState(0);
  const [tripStartedAt, setTripStartedAt] = useState<string | null>(null);
  const lastTripLocationRef = useRef<ExpoLocation.LocationObject | null>(null);
  const lastTripMeterPublishedAtRef = useRef(0);
  const lastSpeedRef = useRef<number | null>(null);
  const lastSafetyEventAtRef = useRef(0);
  const offerSwipeX = useRef(new Animated.Value(0)).current;
  const incomingAlertRunRef = useRef(0);
  const seenChatMessageIdsRef = useRef<Set<string> | null>(null);
  const tripActionInFlightRef = useRef(false);
  const ratingSubmitInFlightRef = useRef(false);

  const applyServerTerminalRide = useCallback((serverRide: any) => {
    const terminalStatus = driverTripTerminalStatus(serverRide);
    if (!terminalStatus) return false;

    // The ride document is authoritative. A completion can commit while its
    // HTTP response is delayed/lost; do not leave the Driver on a spinner or
    // attempt a second completion, receipt, or settlement from the client.
    tripActionInFlightRef.current = false;
    setTripActionPending(false);
    setActiveTrip((current: any) => current?.id === serverRide.id ? null : current);
    setArrivedAt(null);
    setTripStartedAt(null);
    lastTripLocationRef.current = null;

    if (terminalStatus === 'completed') {
      setCompletedRide(serverRide);
      setShowFareScreen(true);
    }
    return true;
  }, []);

  const stopIncomingTripAlert = (resetPosition = true, skipNativeCommand = false) => {
    // Invalidate any pending seek/play chain before pausing. Without this,
    // an async seek can finish after acceptance and restart the alert.
    incomingAlertRunRef.current += 1;
    // `useAudioPlayer` releases its native SharedObject when this screen
    // unmounts. Do not issue a pause/seek after that release has started: on
    // iOS this turns the released native-object error into a Hermes crash.
    if (skipNativeCommand) return;
    incomingTripPlayer.pause();
    // Expo SDK 54's iOS AudioPlayer seek path has a native AVPlayer lifetime
    // race. The looped alert does not need a seek on iOS; pause/play is enough.
    if (resetPosition && Platform.OS !== 'ios') incomingTripPlayer.seekTo(0).catch(() => {});
  };

  // Navigation Switcher Logic
  const openNavigation = (lat: number, lng: number, label: string) => {
    const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
    const latLng = `${lat},${lng}`;
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`
    });

    Alert.alert(
      "Navigate with",
      "Choose your preferred navigation app",
      [
        { text: "Google Maps", onPress: () => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latLng}`) },
        { text: "Waze", onPress: () => Linking.openURL(`https://waze.com/ul?ll=${latLng}&navigate=yes`) },
        { text: Platform.OS === 'ios' ? "Apple Maps" : "Cancel", onPress: () => url && Linking.openURL(url) },
        { text: "Cancel", style: "cancel" }
      ]
    );
  };

  // The previous demand-zone circles obscured the map and were not real cars.
  // Keep the control state only for backwards-compatible layout, but do not
  // render artificial circles over the driver's location map.
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Waiting Time Logic
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const [waitTime, setWaitTime] = useState(0);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDriverAtPickup = activeTrip?.status === 'driver_arrived';
  const waitingStartedAt = isDriverAtPickup
    ? (activeTrip?.driver_arrived_at || arrivedAt)
    : null;

  const [notifOpen, setNotifOpen] = useState(false);
  const [destModalVisible, setDestModalVisible] = useState(false);
  const [destInput, setDestInput] = useState('');
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingFeedback, setRatingFeedback] = useState('');

  // Offers are read from the backend rather than from a pre-assigned Firestore
  // document. A Driver must be signed in, online, and explicitly accept before
  // the Rider is ever told who the Driver is.
  // The app's published GitHub backend package is one revision behind the
  // deployed Railway router; use the live procedure until its declaration is
  // synchronized, while keeping the endpoint fully server-validated.
  const availableOffers = (trpc.driverTrips as any).availableOffers.useQuery(
    { driverId: user?.uid || '' },
    { enabled: Boolean(user?.uid && isOnline && hasCurrentLocation), refetchInterval: DRIVER_OFFER_POLL_INTERVAL_MS },
  );

  // A server ride-offer push makes foreground delivery immediate instead of
  // waiting for the next polling tick. Polling remains the safe fallback.
  useEffect(() => subscribeDriverRideOffer(() => {
    if (user?.uid && isOnline && hasCurrentLocation) void availableOffers.refetch();
  }), [availableOffers, hasCurrentLocation, isOnline, user?.uid]);
  // A query may refetch several times while the same offer is outstanding.
  // Keep a session-level record so one ride request produces one device alert.
  const notifiedOfferIds = useRef<Set<string>>(new Set());

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const deliveryContact = deliveryContactForDriver(activeTrip);
  const isActiveDelivery = isDeliveryRide(activeTrip);
  const riderPhone = activeTrip?.rider_phone || activeTrip?.passenger_phone || activeTrip?.phone || '';
  const contactPhone = deliveryContact?.phone || riderPhone;
  const startMobileNetworkCall = () => {
    if (!contactPhone) {
      Alert.alert('Call unavailable', 'This contact has no mobile number yet.');
      return;
    }
    Linking.openURL(`tel:${contactPhone}`).catch(() => {
      Alert.alert('Unable to call', 'This phone cannot open the mobile-network dialer.');
    });
  };
  const paymentLabel = (method?: string) => {
    if (method === 'mobile_money') return 'MoMo';
    if (method === 'wallet') return 'Wallet';
    if (method === 'cash') return 'Cash';
    if (method === 'card') return 'Card';
    return 'Payment pending';
  };
  const isHighRiskArea = (address?: string) => /nima|mamobi|agbogbloshie|circle|darkuman|kasoa/i.test(address || '');

  useEffect(() => {
    if (isOnline) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isOnline]);

  // Incoming-ride alert: retain HY3N's existing local tone, but play it once
  // per outstanding offer rather than repeating it until the offer ends.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});

    return () => {
      stopIncomingTripAlert(false, true);
    };
  }, [incomingTripPlayer]);

  useEffect(() => {
    const shouldAlert = shouldPlayIncomingTripAlert({
      isOnline,
      incomingRideId: incomingRide?.id,
      activeTripId: activeTrip?.id,
      soundAlerts: prefs.soundAlerts,
    });
    if (!shouldAlert) {
      stopIncomingTripAlert();
      return;
    }

    const alertRun = ++incomingAlertRunRef.current;
    incomingTripPlayer.loop = INCOMING_TRIP_ALERT_PLAYBACK.loop;
    incomingTripPlayer.volume = INCOMING_TRIP_ALERT_PLAYBACK.volume;
    if (Platform.OS === 'ios') {
      incomingTripPlayer.play();
    } else {
      incomingTripPlayer.seekTo(0).then(() => {
        if (incomingAlertRunRef.current === alertRun) incomingTripPlayer.play();
      }).catch(() => {});
    }

    return () => {
      if (incomingAlertRunRef.current === alertRun) stopIncomingTripAlert(true, true);
    };
  }, [incomingRide?.id, activeTrip?.id, isOnline, prefs.soundAlerts, incomingTripPlayer]);

  // Waiting time counter
  useEffect(() => {
    if (waitingStartedAt && !activeTrip?.trip_started_at) {
      const updateWaitTime = () => {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(waitingStartedAt).getTime()) / 1000));
        setWaitTime(elapsed);
      };
      updateWaitTime();
      waitTimerRef.current = setInterval(updateWaitTime, 1000);
    } else {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      setWaitTime(0);
    }
    return () => { if (waitTimerRef.current) clearInterval(waitTimerRef.current); };
  }, [waitingStartedAt, activeTrip?.trip_started_at]);

  useEffect(() => {
    let subscription: any;
    let disposed = false;
    const shouldTrack = shouldTrackDriverLocation(isOnline, Boolean(activeTrip?.id));
    if (!shouldTrack) return;
    const beginLocationWatch = async () => {
      let { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let loc = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.BestForNavigation });
      if (disposed) return;
      setLocation(loc);
      const watch = await ExpoLocation.watchPositionAsync(
        {
          accuracy: ExpoLocation.Accuracy.BestForNavigation,
          timeInterval: DRIVER_FOREGROUND_LOCATION_POLICY.timeIntervalMs,
          distanceInterval: DRIVER_FOREGROUND_LOCATION_POLICY.distanceIntervalMeters,
        },
        (newLoc) => {
          if (!disposed) setLocation(newLoc);
        },
      );
      if (disposed) {
        watch.remove();
      } else {
        subscription = watch;
      }
    };
    void beginLocationWatch().catch(() => {});
    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [isOnline, activeTrip?.id]);

  // iOS may remain quiet for a stationary foreground watch. Refresh the
  // current position while this app remains online so Riders do not lose a
  // legitimately available Driver after the server freshness window expires.
  useEffect(() => {
    if (!user?.uid || !shouldTrackDriverLocation(isOnline, Boolean(activeTrip?.id))) return;
    let disposed = false;
    const refreshPresence = async () => {
      try {
        const freshLocation = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
        if (!disposed && hasUsableDriverLocation(freshLocation)) setLocation(freshLocation);
      } catch {
        // The normal watch and background task keep running independently.
      }
    };
    const interval = setInterval(() => { void refreshPresence(); }, DRIVER_FOREGROUND_PRESENCE_HEARTBEAT_MS);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [user?.uid, isOnline, activeTrip?.id]);

  useEffect(() => {
    if (driverProfile) setIsOnline(driverProfile.is_online || false);
  }, [driverProfile]);

  // Keep the live vehicle marker updating for Riders when a Driver backgrounds
  // the app. iOS displays its standard location indicator and the Driver can
  // stop tracking at any time by going offline.
  useEffect(() => {
    const shouldTrack = shouldTrackDriverLocation(isOnline, Boolean(activeTrip?.id));
    if (!shouldTrack || !user?.uid) {
      stopDriverBackgroundLocationUpdates().catch(() => {});
      return;
    }

    let cancelled = false;
    startDriverBackgroundLocationUpdates().then((result) => {
      if (cancelled || result.started || result.reason === 'unsupported') return;
      if (result.reason === 'background_denied') {
        Alert.alert('Background location needed', 'Allow “Always” location so Riders can see your vehicle moving after you leave HY3N Driver. You can still drive while the app is open.');
      } else {
        Alert.alert('Location needed', 'Allow location to go online and receive rides.');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isOnline, activeTrip?.id, user?.uid]);

  // Receive only server-filtered, unassigned offers. The backend verifies that
  // the Driver is online and atomically assigns the ride only after Accept.
  useEffect(() => {
    if (!user?.uid || !isOnline || !hasCurrentLocation) {
      stopIncomingTripAlert();
      setIncomingRide(null);
      return;
    }

    const offers: any[] = availableOffers.data?.offers || [];
    const offeredRide = offers.find((ride: any) => {
      const estimatedDistance = Number(ride.distance_km || ride.estimated_distance_km || 0);
      const eligibleForLongTrip = !prefs.longTripsOnly || estimatedDistance >= 8;
      const eligibleForRating = !prefs.preferHighRated || Number(ride.rider_rating || 5) >= 4.5;
      return eligibleForLongTrip && eligibleForRating;
    });

    if (!offeredRide) {
      if (incomingRide) {
        stopIncomingTripAlert();
        setIncomingRide(null);
      }
      return;
    }

    if (activeTrip) {
      // Back-to-back trips are offered only after the rider is on board and
      // the driver may hold exactly one next ride. Never replace a queued
      // offer with another request while the current trip is in progress.
      if (activeTrip.status !== 'in_progress') return;
      setNextRide((current: any) => current || offeredRide);
      return;
    }

    setIncomingRide((current: any) => {
      if (current?.id === offeredRide.id) return current;
      setRideOfferSeconds(DRIVER_OFFER_REVIEW_SECONDS);
      const offerId = String(offeredRide.id);
      if (!notifiedOfferIds.current.has(offerId)) {
        if (notifiedOfferIds.current.size >= 100) notifiedOfferIds.current.clear();
        notifiedOfferIds.current.add(offerId);
        Notifications.scheduleNotificationAsync({
          content: {
            title: `New ${rideCategoryName(offeredRide.category)} Ride`,
            // Keep fares inside the protected in-app offer only; device push
            // previews must not disclose an amount on the lock screen.
            body: airConditioningReminder(offeredRide.category, 'pickup')
              || `Ride request from ${offeredRide.rider_name || 'a rider'}. Open HY3N Driver to review the trip.`,
            sound: INCOMING_TRIP_NOTIFICATION.sound,
            priority: Notifications.AndroidNotificationPriority.MAX,
          },
          trigger: null,
        }).catch(() => {});
      }
      return offeredRide;
    });
  }, [user?.uid, isOnline, hasCurrentLocation, activeTrip, incomingRide, availableOffers.data?.offers, prefs.longTripsOnly, prefs.preferHighRated]);

  // Recover a trip if the app is reopened while the driver is already assigned.
  useEffect(() => {
    if (!user?.uid) return;
    firestoreDB.list(COLLECTIONS.RIDES, { driver_id: user.uid }, null).then((rides) => {
      const current = rides.find((ride: any) => ['driver_arriving', 'driver_arrived', 'in_progress'].includes(ride.status));
      if (current) {
        setActiveTrip(current);
        setTripStartedAt(current.trip_started_at || null);
        setArrivedAt(current.driver_arrived_at || null);
      }
    }).catch(() => {});
  }, [user?.uid]);

  // The server writes traffic-aware ETA and road geometry after each GPS
  // refresh. Subscribe to the active ride so the Driver sees those same live
  // values rather than only the local straight-line fallback.
  useEffect(() => {
    if (!activeTrip?.id) return;
    return firestoreDB.subscribeDoc(COLLECTIONS.RIDES, activeTrip.id, (serverRide: any) => {
      if (!serverRide?.id) return;
      if (applyServerTerminalRide(serverRide)) return;
      setActiveTrip((current: any) => current?.id === serverRide.id ? { ...current, ...serverRide } : current);
    });
  }, [activeTrip?.id, applyServerTerminalRide]);

  // Show a review timer without silently declining the Rider's request. The
  // server owns search expiry; the Driver must make an explicit decline.
  useEffect(() => {
    if (!incomingRide || activeTrip) return;
    const timer = setInterval(() => setRideOfferSeconds(nextDriverOfferCountdown), 1000);
    return () => clearInterval(timer);
  }, [incomingRide?.id, activeTrip?.id]);

  useEffect(() => {
    if (!incomingRide || activeTrip || !prefs.autoAccept) return;
    const timer = setTimeout(() => handleAcceptRide(), 2500);
    return () => clearTimeout(timer);
  }, [incomingRide, activeTrip, prefs.autoAccept]);

  // Server-backed notification center. Local notifications remain enabled for
  // foreground alerts while this feed retains operational notifications.
  useEffect(() => {
    if (!user?.uid) return;
    return firestoreDB.subscribe(COLLECTIONS.DRIVER_NOTIFICATIONS, { driver_id: user.uid }, (items) => {
      setNotifications(items.sort((a: any, b: any) => String(b.created_date || '').localeCompare(String(a.created_date || ''))));
    });
  }, [user?.uid]);

  // Unread message counter
  useEffect(() => {
    if (!activeTrip?.id || !user?.uid) {
      setUnreadCount(0);
      seenChatMessageIdsRef.current = null;
      return;
    }

    seenChatMessageIdsRef.current = null;

    // firestoreDB.subscribe returns message documents, not Firestore
    // document-change objects. Count unread rider messages so the in-app
    // badge works alongside the device notification.
    const unsubscribe = firestoreDB.subscribe(
      COLLECTIONS.RIDE_MESSAGES,
      { ride_id: activeTrip.id },
      (messages: any[]) => {
        messages
          .filter((message) => message.sender_id !== user.uid && message.sender_role === 'rider' && !message.delivered_to_driver)
          .forEach((message) => {
            firestoreDB.update(COLLECTIONS.RIDE_MESSAGES, message.id, { delivered_to_driver: true }).catch(() => {});
          });
        // The backend Firestore trigger now sends one remote notification to
        // every registered Driver device. A local scheduled alert here would
        // duplicate that notification while the app is foregrounded.
        seenChatMessageIdsRef.current = new Set(messages.map((message) => String(message.id)));
        const unread = messages.filter((message) =>
          message.sender_id !== user.uid &&
          message.sender_role === 'rider' &&
          !message.read_by_driver,
        ).length;
        setUnreadCount(showChat ? 0 : unread);
      },
    );

    return () => unsubscribe?.();
  }, [activeTrip?.id, user?.uid, showChat]);

  const openChat = () => { setShowChat(true); setUnreadCount(0); };

  const haversineKm = (from: ExpoLocation.LocationObject, to: ExpoLocation.LocationObject) => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const radiusKm = 6371;
    const dLat = toRad(to.coords.latitude - from.coords.latitude);
    const dLng = toRad(to.coords.longitude - from.coords.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.coords.latitude)) * Math.cos(toRad(to.coords.latitude)) * Math.sin(dLng / 2) ** 2;
    return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Publish foreground GPS through the same authenticated ingress as the iOS
  // background task. Keeping one ordered writer prevents older network calls
  // from replacing a fresher presence point and makes the Rider's car glide in
  // the same direction as the Driver's own map marker.
  useEffect(() => {
    if (!location || !user?.uid || !shouldTrackDriverLocation(isOnline, Boolean(activeTrip?.id))) return;
    void driverLocationPublisher.publish({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      heading: location.coords.heading === null ? undefined : location.coords.heading,
      speedKmh: location.coords.speed === null || location.coords.speed === undefined ? undefined : Math.max(0, Number((location.coords.speed * 3.6).toFixed(1))),
      recordedAt: new Date(location.timestamp || Date.now()).toISOString(),
    }).catch((error) => {
      console.warn('[HY3N] Foreground Driver location publish failed:', error?.message || 'unknown error');
    });
  }, [location, user?.uid, isOnline, activeTrip?.id]);

  // Fare mileage is server-metered only after Start Trip. Each point is kept
  // independent from the driver-presence update so the Rider can still see
  // movement before pickup without any of that approach distance being billed.
  useEffect(() => {
    if (!location || !user?.uid || activeTrip?.status !== 'in_progress' || !activeTrip?.trip_started_at) return;
    const recordedAtMs = Number(location.timestamp || Date.now());
    if (!shouldPublishDriverTripMeter(lastTripMeterPublishedAtRef.current, recordedAtMs)) return;
    lastTripMeterPublishedAtRef.current = recordedAtMs;
    recordTripLocation.mutate({
      driverId: user.uid,
      rideId: activeTrip.id,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      recordedAt: new Date(recordedAtMs).toISOString(),
    });
  }, [location, user?.uid, activeTrip?.id, activeTrip?.status, activeTrip?.trip_started_at]);

  // Track locally calculated trip distance and send meaningful safety events through the protected driver API.
  useEffect(() => {
    if (!location || !activeTrip || activeTrip.status !== 'in_progress') return;
    const previous = lastTripLocationRef.current;
    lastTripLocationRef.current = location;
    if (!previous) return;

    const increment = haversineKm(previous, location);
    if (increment > 0 && increment < 2) setTripDistanceKm((distance) => distance + increment);
    const speed = Math.max(0, Number(location.coords.speed || 0) * 3.6);
    const priorSpeed = lastSpeedRef.current;
    lastSpeedRef.current = speed;
    const now = Date.now();

    if (priorSpeed !== null && priorSpeed - speed >= 28 && now - lastSafetyEventAtRef.current > 60000 && user?.uid) {
      lastSafetyEventAtRef.current = now;
      recordDrivingEvent.mutate({
        driverId: user.uid,
        rideId: activeTrip.id,
        type: 'hard_braking',
        previousSpeedKmh: Number(priorSpeed.toFixed(1)),
        currentSpeedKmh: Number(speed.toFixed(1)),
        location: { latitude: location.coords.latitude, longitude: location.coords.longitude },
      });
    }
  }, [location, activeTrip?.id, activeTrip?.status, user?.uid]);

  const handleToggleOnline = async () => {
    if (!user?.uid) return;
    setTogglingOnline(true);
    try {
      const newStatus = !isOnline;
      if (newStatus) {
        // A fresh point from the existing foreground watcher is already a real
        // device coordinate. Reusing it makes an off/on switch responsive
        // instead of waiting for Core Location to obtain a second fix.
        let freshLocation = hasRecentUsableDriverLocation(location) ? location : null;
        if (!freshLocation) {
          const permission = await ExpoLocation.requestForegroundPermissionsAsync();
          if (permission.status !== 'granted') {
            Alert.alert('Location needed', 'Allow location before going online so Riders receive your real position.');
            return;
          }
          freshLocation = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.BestForNavigation });
        }
        if (!freshLocation || !hasUsableDriverLocation(freshLocation)) {
          Alert.alert('Location unavailable', 'HY3N Driver could not get a valid current position. Please try again outside or check Location Services.');
          return;
        }
        // Publish before setting availability. Dispatch intentionally excludes
        // online profiles without a fresh GPS point, so this prevents an
        // apparently online Driver from receiving no requests.
        await driverLocationPublisher.publish({
          latitude: freshLocation.coords.latitude,
          longitude: freshLocation.coords.longitude,
          heading: freshLocation.coords.heading === null ? undefined : freshLocation.coords.heading,
          speedKmh: freshLocation.coords.speed === null || freshLocation.coords.speed === undefined
            ? undefined
            : Math.max(0, Number((freshLocation.coords.speed * 3.6).toFixed(1))),
          recordedAt: new Date(freshLocation.timestamp || Date.now()).toISOString(),
        });
        setLocation(freshLocation);
      }
      await setAvailability.mutateAsync({
        driverId: user.uid,
        status: newStatus ? 'online' : 'offline',
      });
      if (!newStatus) {
        stopIncomingTripAlert();
        setIncomingRide(null);
        setNextRide(null);
      }
      setIsOnline(newStatus);
    } catch (err: any) {
      Alert.alert('Location or availability error', err?.message || 'HY3N Driver could not verify your current location. Please try again.');
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleAcceptRide = async () => {
    if (!incomingRide || !user?.uid || tripActionInFlightRef.current) return;
    const rideId = String(incomingRide.id);
    let serverConfirmed = false;
    const showAcceptedRide = (ride: any) => {
      serverConfirmed = true;
      setActiveTrip(ride);
      setIncomingRide(null);
      setRideOfferSeconds(DRIVER_OFFER_REVIEW_SECONDS);
      // Do not leave the Accept button spinning when Firestore confirms the
      // server-owned assignment but a mobile network response is delayed.
      tripActionInFlightRef.current = false;
      setTripActionPending(false);
    };
    const reconcileAcceptedRide = async () => {
      try {
        const serverRide = await firestoreDB.get(COLLECTIONS.RIDES, rideId);
        if (!driverOfferAcceptedByServer(serverRide, user.uid)) return false;
        showAcceptedRide(serverRide);
        return true;
      } catch {
        return false;
      }
    };
    tripActionInFlightRef.current = true;
    setTripActionPending(true);
    stopIncomingTripAlert();
    const reconciliationTimers = DRIVER_ACCEPT_RECONCILIATION_DELAYS_MS.map((delay) => setTimeout(() => {
      if (!serverConfirmed) void reconcileAcceptedRide();
    }, delay));
    try {
      const result = await respondToOffer.mutateAsync({
        driverId: user.uid,
        rideId,
        decision: 'accept',
        driverName: driverProfile?.full_name || undefined,
        ...buildVehicleFields({
          make: driverProfile?.vehicle_make,
          model: driverProfile?.vehicle_model,
          plate: driverProfile?.vehicle_plate || driverProfile?.license_plate,
          colour: driverProfile?.vehicle_colour || driverProfile?.vehicle_color,
          year: (driverProfile as any)?.vehicle_full_model,
        }),
      });
      showAcceptedRide(result.ride);
    } catch (err: any) {
      if (!await reconcileAcceptedRide()) {
        Alert.alert('Unable to accept ride', err?.message || 'Please check your connection and try again.');
      }
    } finally {
      reconciliationTimers.forEach((timer) => clearTimeout(timer));
      tripActionInFlightRef.current = false;
      setTripActionPending(false);
    }
  };

  const handleAcceptQueuedRide = async () => {
    if (!nextRide || !activeTrip || !user?.uid) return;
    try {
      const result = await respondToOffer.mutateAsync({
        driverId: user.uid,
        rideId: nextRide.id,
        decision: 'accept',
        driverName: driverProfile?.full_name || undefined,
        ...buildVehicleFields({
          make: driverProfile?.vehicle_make,
          model: driverProfile?.vehicle_model,
          plate: driverProfile?.vehicle_plate || driverProfile?.license_plate,
          colour: driverProfile?.vehicle_colour || driverProfile?.vehicle_color,
          year: (driverProfile as any)?.vehicle_full_model,
        }),
        queueAfterRideId: activeTrip.id,
      });
      setNextRide(result.ride);
      Alert.alert('Next ride queued', `You will be connected to ${nextRide.rider_name || 'your next rider'} after this trip.`);
    } catch {
      Alert.alert('Unable to queue ride', 'Please try again.');
    }
  };

  const handleDeclineRide = async () => {
    if (!incomingRide || !user?.uid) return;
    stopIncomingTripAlert();
    try {
      await respondToOffer.mutateAsync({ driverId: user.uid, rideId: incomingRide.id, decision: 'decline' });
      setIncomingRide(null);
      setRideOfferSeconds(DRIVER_OFFER_REVIEW_SECONDS);
    } catch (err) {
      Alert.alert('Error', 'Failed to decline ride');
    }
  };

  const offerPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !!incomingRide && Math.abs(gesture.dx) > 8,
    onPanResponderMove: Animated.event([null, { dx: offerSwipeX }], { useNativeDriver: false }),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx > 110) handleAcceptRide();
      else if (gesture.dx < -110) handleDeclineRide();
      Animated.spring(offerSwipeX, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [incomingRide, offerSwipeX, handleAcceptRide, handleDeclineRide]);

  const handleCancelTrip = async (reason: string) => {
    if (!activeTrip || !user?.uid) return;
    try {
      await cancelTrip.mutateAsync({ driverId: user.uid, rideId: activeTrip.id, reason });
      setActiveTrip(null);
      setArrivedAt(null);
      setShowCancel(false);
      Alert.alert('Trip cancelled', 'The rider has been notified.');
    } catch {
      Alert.alert('Unable to cancel trip', 'Please try again.');
    }
  };

  const triggerSOS = () => {
    Alert.alert('Send emergency alert?', 'Your current location and active trip details will be recorded for HY3N Safety. You can also open WhatsApp to alert support immediately.', [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Send SOS', style: 'destructive', onPress: async () => {
          try {
            if (!user?.uid) throw new Error('Sign in required');
            let sosLocation = location;
            if (!sosLocation) {
              try {
                sosLocation = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
              } catch {
                // An SOS remains valid even when the device cannot obtain a fresh location.
              }
            }
            const result = await submitDriverSos({
              rideId: activeTrip?.id || undefined,
              message: 'Emergency alert initiated from the Driver app.',
              ...(sosLocation ? { location: { latitude: sosLocation.coords.latitude, longitude: sosLocation.coords.longitude } } : {}),
            });
            const locationLink = sosLocation
              ? `https://www.google.com/maps?q=${sosLocation.coords.latitude},${sosLocation.coords.longitude}`
              : 'Location unavailable';
            const whatsappText = [
              'HY3N DRIVER SOS',
              `Reference: ${result.incidentId.slice(0, 8)}`,
              `Trip: ${activeTrip?.id || 'No active trip'}`,
              `Location: ${locationLink}`,
              'Please treat this as an urgent safety request.',
            ].join('\n');
            Alert.alert(
              'SOS received',
              `Your emergency alert was recorded in the HY3N Safety queue (reference ${result.incidentId.slice(0, 8)}). Open WhatsApp to reach HY3N Support immediately. If you are in immediate danger, call emergency services now.`,
              [
                { text: 'Not now', style: 'cancel' },
                {
                  text: 'Open WhatsApp',
                  // Verified HY3N Support WhatsApp: 055 727 8990.
                  onPress: () => Linking.openURL(`https://wa.me/233557278990?text=${encodeURIComponent(whatsappText)}`).catch(() => {
                    Alert.alert('WhatsApp unavailable', 'This device could not open WhatsApp. Please call support or emergency services.');
                  }),
                },
              ],
            );
          } catch (error: any) {
            Alert.alert('SOS not sent', error?.message || 'HY3N Safety could not confirm your SOS report. Please call emergency services.');
          }
        },
      },
    ]);
  };

  // Driver arrival at pickup
  const handleArrivedAtPickup = async () => {
    if (!activeTrip || !user?.uid || tripActionInFlightRef.current) return;
    tripActionInFlightRef.current = true;
    setTripActionPending(true);
    try {
      const result = await arriveAtPickup.mutateAsync({ driverId: user.uid, rideId: activeTrip.id });
      const updatedRide: any = result.ride;
      const arrivedAtTime = updatedRide.driver_arrived_at || new Date().toISOString();
      setArrivedAt(arrivedAtTime);
      setActiveTrip(updatedRide);
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Arrived at Pickup',
          body: 'Waiting timer started. Rider has been notified.',
        },
        trigger: null,
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to mark arrival');
    } finally {
      tripActionInFlightRef.current = false;
      setTripActionPending(false);
    }
  };

  const beginTrip = async (ride = activeTrip) => {
    if (!ride || !user?.uid || tripActionInFlightRef.current) return;
    tripActionInFlightRef.current = true;
    setTripActionPending(true);
    try {
      const result = await startTrip.mutateAsync({
        driverId: user.uid,
        rideId: ride.id,
        startLocation: location
          ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
          : undefined,
      });
      const updatedRide: any = result.ride;
      const startedAt = updatedRide.trip_started_at || new Date().toISOString();
      setActiveTrip(updatedRide);
      setTripStartedAt(startedAt);
      setTripDistanceKm(0);
      lastTripLocationRef.current = location;
      lastTripMeterPublishedAtRef.current = 0;
      setArrivedAt(null);
    } catch {
      Alert.alert('Error', 'Failed to start trip');
    } finally {
      tripActionInFlightRef.current = false;
      setTripActionPending(false);
    }
  };

  // Verify the rider's pickup code before the trip begins when a code was issued.
  const handleStartTrip = async () => {
    if (!activeTrip) return;
    if (activeTrip.status !== 'driver_arrived') {
      Alert.alert('Arrive first', 'Mark that you have arrived at the pickup point before starting the trip.');
      return;
    }
    if (activeTrip.pickup_code && !activeTrip.pickup_verified_at) {
      setShowOtp(true);
      return;
    }
    await beginTrip();
  };

  const handleVerifyPickupCode = async () => {
    if (!activeTrip || !user?.uid || !pickupCode.trim() || tripActionInFlightRef.current) return;
    tripActionInFlightRef.current = true;
    setTripActionPending(true);
    try {
      const result = await verifyAndStart.mutateAsync({
        driverId: user.uid,
        rideId: activeTrip.id,
        pickupCode: pickupCode.trim(),
        startLocation: location
          ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
          : undefined,
      });
      setPickupCode('');
      setShowOtp(false);
      const updatedRide: any = result.ride;
      const startedAt = updatedRide.trip_started_at || new Date().toISOString();
      setActiveTrip(updatedRide);
      setTripStartedAt(startedAt);
      setTripDistanceKm(0);
      lastTripLocationRef.current = location;
      lastTripMeterPublishedAtRef.current = 0;
      setArrivedAt(null);
    } catch (error: any) {
      Alert.alert('Unable to verify code', error?.message || 'Please ask the rider for the code shown in their app.');
    } finally {
      tripActionInFlightRef.current = false;
      setTripActionPending(false);
    }
  };

  // The backend calculates the final fare from the server trip meter and booked
  // rate snapshot. Drivers submit only travel telemetry; the amount is shown
  // after completion, not while an offer or trip is active.
  const handleEndTrip = async () => {
    if (!activeTrip || tripActionInFlightRef.current) return;
    if (activeTrip.status !== 'in_progress' || !activeTrip.trip_started_at) {
      Alert.alert('Trip not started', 'A trip cannot be completed or charged until the rider is onboard and Start Trip has been confirmed.');
      return;
    }
    tripActionInFlightRef.current = true;
    setTripActionPending(true);
    try {
      const durationMinutes = tripStartedAt ? Math.max(1, (Date.now() - new Date(tripStartedAt).getTime()) / 60000) : Number(activeTrip.duration_minutes || 0);

      if (!user?.uid) throw new Error('Sign in required');
      // Combine the last GPS observation with the completion request. The
      // server applies its same meter validation in one transaction, avoiding
      // a second serial network round trip when the Driver taps End.
      const result = await (completeTrip as any).mutateAsync({
        driverId: user.uid,
        rideId: activeTrip.id,
        actualDistanceKm: Number(tripDistanceKm.toFixed(2)),
        actualDurationMinutes: Number(durationMinutes.toFixed(1)),
        ...(location ? {
          finalLocation: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            recordedAt: new Date(location.timestamp || Date.now()).toISOString(),
          },
        } : {}),
      });

      const completed = { ...result.ride };
      if (nextRide?.status === 'driver_queued') setQueuedRideToActivate(nextRide);
      applyServerTerminalRide(completed);
    } catch {
      Alert.alert('Error', 'Failed to end trip');
    } finally {
      tripActionInFlightRef.current = false;
      setTripActionPending(false);
    }
  };

  // Submit rating
  const handleSubmitRating = async () => {
    if (!completedRide || ratingSubmitInFlightRef.current) return;
    ratingSubmitInFlightRef.current = true;
    setRatingSubmitting(true);
    try {
      if (!user?.uid || !completedRide.rider_id || ratingValue < 1) throw new Error('Please choose a star rating.');
      await rateRider.mutateAsync({ driverId: user.uid, rideId: completedRide.id, riderId: completedRide.rider_id, rating: ratingValue, feedback: ratingFeedback, foundItem, safetyReport });

      Alert.alert('Medaase!', `Your ${ratingValue}-star rating for ${completedRide.rider_name || 'this Rider'} has been submitted.`);
      setShowRating(false);
      setCompletedRide(null);
      setRatingValue(5);
      setRatingFeedback('');
      setFoundItem('');
      setSafetyReport('');
    } catch (err: any) {
      const message = String(err?.message || '').trim();
      if (/already rated this rider/i.test(message)) {
        setShowRating(false);
        setCompletedRide(null);
        setRatingValue(5);
        Alert.alert('Medaase!', 'Your rating was already received.');
        return;
      }
      Alert.alert('Unable to submit rating', message || 'Please check your connection and try again.');
    } finally {
      ratingSubmitInFlightRef.current = false;
      setRatingSubmitting(false);
    }
  };

  const handleFareAcknowledged = async () => {
    setShowFareScreen(false);
    // A fresh completed trip starts with a visible score so Submit is never
    // blocked by an empty rating sheet. Drivers can still tap any star first.
    setRatingValue(5);
    setShowRating(true);
    if (!queuedRideToActivate || !user?.uid) return;
    try {
      const result = await activateQueuedTrip.mutateAsync({
        driverId: user.uid,
        rideId: queuedRideToActivate.id,
        completedRideId: completedRide?.id,
      });
      setActiveTrip(result.ride);
      setNextRide(null);
      setQueuedRideToActivate(null);
    } catch {
      Alert.alert('Queued ride pending', 'The next ride could not be activated automatically. Please refresh the app.');
    }
  };

  const markNotificationRead = async (item: any) => {
    if (item.read_at) return;
    try {
      await firestoreDB.update(COLLECTIONS.DRIVER_NOTIFICATIONS, item.id, { read_at: new Date().toISOString() });
    } catch {}
  };

  // Check approval status
  if (driverProfile?.approval_status === "pending") {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <View style={styles.centerContainer}>
          <Image source={require('@/assets/images/icon.png')} style={styles.largeLogo} resizeMode="contain" />
          <ActivityIndicator size="large" color={GOLD} style={{ marginVertical: 20 }} />
          <Text style={[styles.approvalTitle, { color: themeColors.text }]}>Awaiting Approval</Text>
          <Text style={[styles.approvalSub, { color: themeColors.muted }]}>
            Your documents are being reviewed. We&apos;ll notify you once approved.
          </Text>
        </View>
      </View>
    );
  }

  const dynamicStyles = {
    container: { backgroundColor: themeColors.background },
    text: { color: themeColors.text },
    muted: { color: themeColors.muted },
    card: {
      backgroundColor: isDark ? 'rgba(17, 17, 17, 0.9)' : 'rgba(255, 255, 255, 0.95)',
      borderColor: themeColors.border
    },
    badge: {
      backgroundColor: isDark ? '#111111' : '#FFFFFF',
      borderColor: themeColors.border
    }
  };

  const activeNavigationRawTarget = activeTrip
    ? (activeTrip.status === 'in_progress' ? activeTrip.destination : activeTrip.pickup)
    : null;
  const activeNavigationLatitude = Number(activeNavigationRawTarget?.lat ?? activeNavigationRawTarget?.latitude ?? (activeTrip?.status === 'in_progress' ? activeTrip?.destination_lat : activeTrip?.pickup_lat));
  const activeNavigationLongitude = Number(activeNavigationRawTarget?.lng ?? activeNavigationRawTarget?.longitude ?? (activeTrip?.status === 'in_progress' ? activeTrip?.destination_lng : activeTrip?.pickup_lng));
  const activeNavigationTarget = activeTrip && Number.isFinite(activeNavigationLatitude) && Number.isFinite(activeNavigationLongitude)
    ? {
        latitude: activeNavigationLatitude,
        longitude: activeNavigationLongitude,
        label: activeTrip.status === 'in_progress' ? (activeTrip.destination_address || 'Drop-off') : (activeTrip.pickup_address || 'Pickup'),
      }
    : null;
  const activeRouteMetrics = activeTrip?.live_route_metrics && typeof activeTrip.live_route_metrics === 'object'
    ? activeTrip.live_route_metrics as Record<string, unknown>
    : null;
  const expectedRoutePhase = activeTrip?.status === 'in_progress' ? 'destination' : 'pickup';
  const activeRoutePoints = Array.isArray(activeRouteMetrics?.points)
    ? activeRouteMetrics.points
      .map((point: unknown) => {
        const source: Record<string, unknown> | null = Array.isArray(point)
          ? { lat: point[0], lng: point[1] }
          : point && typeof point === 'object'
            ? point as Record<string, unknown>
            : null;
        return [Number(source?.lat ?? source?.latitude), Number(source?.lng ?? source?.longitude)] as [number, number];
      })
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      .slice(0, 180)
    : [];
  const serverNavigationEta = activeRouteMetrics?.phase === expectedRoutePhase
    ? Number(activeRouteMetrics.duration_minutes)
    : Number.NaN;
  const activeNavigationEta = Number.isFinite(serverNavigationEta) && serverNavigationEta > 0
    ? Math.max(1, Math.ceil(serverNavigationEta))
    : activeNavigationTarget && location
      ? calculateNavigationEtaMinutes(location.coords.latitude, location.coords.longitude, activeNavigationTarget.latitude, activeNavigationTarget.longitude)
      : eta;

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} translucent backgroundColor="transparent" />

      {/* Map Layer */}
      {isOnline ? (
        <NativeDriverGoogleMap
          latitude={location?.coords.latitude}
          longitude={location?.coords.longitude}
          locationTimestamp={location?.timestamp ?? null}
          heading={location?.coords.heading}
          target={activeNavigationTarget}
          etaMinutes={activeNavigationEta}
          routePoints={activeRoutePoints}
          tripStatus={activeTrip ? (activeTrip.status === 'in_progress' ? 'dropoff' : 'pickup') : null}
          dark={isDark}
        />
      ) : (
        <View style={styles.offlineBg}>
           <Image source={require('@/assets/images/icon.png')} style={styles.largeLogo} resizeMode="contain" />
           <Text style={[styles.offlineGreeting, dynamicStyles.text]}>HY3N Driver</Text>
           <Text style={dynamicStyles.muted}>Go online to start navigating</Text>
        </View>
      )}

      {/* Floating Controls */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.statusBadge, dynamicStyles.badge]}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? GREEN : themeColors.muted }]} />
          <Text style={[styles.statusText, dynamicStyles.text]}>{driverStatusLabel}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {false && isOnline && (
            <TouchableOpacity
              style={[styles.notifCircle, dynamicStyles.badge, { borderColor: showHeatmap ? GOLD : themeColors.border }]}
              onPress={() => setShowHeatmap(!showHeatmap)}
            >
              <MaterialIcons name="local-fire-department" size={24} color={showHeatmap ? GOLD : themeColors.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.notifCircle, dynamicStyles.badge]}
            onPress={triggerSOS}
          >
            <MaterialIcons name="emergency" size={26} color={RED} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.notifCircle, dynamicStyles.badge]} onPress={() => setNotifOpen(true)}>
            <MaterialIcons name="notifications-none" size={26} color={themeColors.text} />
            {notifications.filter((item) => !item.read_at).length > 0 && <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{Math.min(9, notifications.filter((item) => !item.read_at).length)}</Text></View>}
          </TouchableOpacity>
        </View>
      </View>

      {!activeTrip && !incomingRide && (
        <TouchableOpacity
          style={[styles.trendsShortcut, dynamicStyles.badge, { top: insets.top + 66 }]}
          onPress={() => router.push('/earnings' as any)}
          accessibilityRole="button"
          accessibilityLabel="View earnings trends"
        >
          <MaterialIcons name="show-chart" size={19} color={GOLD} />
          <Text style={[styles.trendsShortcutText, dynamicStyles.text]}>Earnings trends</Text>
        </TouchableOpacity>
      )}

      {/* Bottom Interface */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 20 }]}>
        {/* Incoming Ride Request */}
        {incomingRide && !activeTrip && (
          <Animated.View {...offerPanResponder.panHandlers} style={[styles.rideRequestCard, dynamicStyles.card, { transform: [{ translateX: offerSwipeX }] }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.offerHeader}><Text style={[styles.rideTitle, dynamicStyles.text]}>New Ride Request</Text><Text style={[styles.offerTimer, { color: rideOfferSeconds <= 5 ? RED : GOLD }]}>{rideOfferSeconds > 0 ? `${rideOfferSeconds}s` : 'Review'}</Text></View>
              <Text style={[styles.rideName, dynamicStyles.text]}>{incomingRide.rider_name}</Text>
              <View style={styles.metaRow}>
                {incomingRide.rider_rating && <Text style={[styles.metaText, dynamicStyles.muted]}>★ {Number(incomingRide.rider_rating).toFixed(1)}</Text>}
                {Number(incomingRide.rider_rating_count) > 0 && <Text style={[styles.metaText, dynamicStyles.muted]}>· {Math.floor(Number(incomingRide.rider_rating_count))} ratings</Text>}
                <Text style={[styles.categoryBadge, { color: GOLD }]}>{rideCategoryName(incomingRide.category)}</Text>
                {!!(incomingRide.distance_km || incomingRide.estimated_distance_km) && <Text style={[styles.metaText, dynamicStyles.muted]}>{Number(incomingRide.distance_km || incomingRide.estimated_distance_km).toFixed(1)} km</Text>}
              </View>
              {hasIncludedAirConditioning(incomingRide.category) && (
                <View style={styles.acServiceBanner} accessibilityLabel={airConditioningReminder(incomingRide.category, 'pickup') || undefined}>
                  <MaterialIcons name="ac-unit" size={17} color="#075985" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.acServiceTitle}>{rideCategoryName(incomingRide.category)} includes AC</Text>
                    <Text style={styles.acServiceText}>Turn on the air conditioning before pickup.</Text>
                  </View>
                </View>
              )}
              <Text style={[styles.rideDetails, dynamicStyles.muted]} numberOfLines={1}>
                From: {incomingRide.pickup_address || 'Pickup'}
              </Text>
              {isHighRiskArea(incomingRide.pickup_address) && <View style={styles.riskBanner}><MaterialIcons name="warning-amber" size={14} color="#7C2D12" /><Text style={styles.riskText}>Use extra caution in this pickup area</Text></View>}
              <Text style={[styles.rideDetails, dynamicStyles.muted]} numberOfLines={1}>
                To: {incomingRide.destination_address || 'Destination'}
              </Text>
              {isDeliveryRide(incomingRide) && (
                <Text style={[styles.deliveryOfferText, dynamicStyles.muted]}>Sender and recipient details appear after you accept.</Text>
              )}
              {/* Payment Method */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 }}>
                {incomingRide.payment_method === 'mobile_money' && <MaterialIcons name="smartphone" size={14} color={GOLD} />}
                {incomingRide.payment_method === 'cash' && <MaterialIcons name="attach-money" size={14} color={GREEN} />}
                {incomingRide.payment_method === 'card' && <MaterialIcons name="credit-card" size={14} color={BLUE} />}
                <Text style={[styles.paymentText, dynamicStyles.muted]} numberOfLines={1}>
                  {incomingRide.payment_method === 'mobile_money'
                    ? 'MoMo'
                    : incomingRide.payment_method === 'cash'
                      ? 'Cash'
                      : incomingRide.payment_method === 'wallet'
                        ? 'Wallet'
                        : 'Card'}
                </Text>
              </View>
            </View>
            <View style={styles.rideActions}>
              <TouchableOpacity
                style={[styles.rideBtn, { backgroundColor: RED }]}
                onPress={handleDeclineRide}
              >
                <MaterialIcons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rideBtn, { backgroundColor: GREEN }]}
                onPress={handleAcceptRide}
                disabled={tripActionPending}
              >
                {tripActionPending ? <ActivityIndicator size="small" color="#FFF" /> : <MaterialIcons name="check" size={20} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Active Trip Navigation Card */}
        {activeTrip && (
          <View style={[styles.navCard, dynamicStyles.card]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.navStatus, { color: GREEN }]}>
                {activeTrip.status === 'driver_arrived'
                  ? 'Waiting for Rider'
                  : activeTrip.status === 'in_progress'
                    ? 'Trip in Progress'
                    : 'Navigate to Pickup'}
              </Text>
              <Text style={[styles.navTitle, dynamicStyles.text]}>{activeTrip.rider_name}</Text>
              <View style={styles.metaRow}>
                {activeTrip.rider_rating && <Text style={[styles.metaText, dynamicStyles.muted]}>★ {Number(activeTrip.rider_rating).toFixed(1)}</Text>}
                {Number(activeTrip.rider_rating_count) > 0 && <Text style={[styles.metaText, dynamicStyles.muted]}>· {Math.floor(Number(activeTrip.rider_rating_count))} ratings</Text>}
                <Text style={[styles.categoryBadge, { color: GOLD }]}>{rideCategoryName(activeTrip.category)}</Text>
                <Text style={[styles.metaText, dynamicStyles.muted]}>{paymentLabel(activeTrip.payment_method)}</Text>
              </View>
              {hasIncludedAirConditioning(activeTrip.category) && (
                <View style={styles.acServiceBanner} accessibilityLabel={airConditioningReminder(activeTrip.category, 'trip') || undefined}>
                  <MaterialIcons name="ac-unit" size={17} color="#075985" />
                  <Text style={[styles.acServiceText, { flex: 1 }]}>{airConditioningReminder(activeTrip.category, 'trip')}</Text>
                </View>
              )}
              <Text style={[styles.navSub, dynamicStyles.muted]} numberOfLines={1}>
                {activeTrip.status === 'in_progress' ? activeTrip.destination_address : activeTrip.pickup_address}
              </Text>
              {isActiveDelivery && deliveryContact && (
                <View style={[styles.deliveryContactCard, { borderColor: themeColors.border }]}>
                  <MaterialIcons name={activeTrip.status === 'in_progress' ? 'person-pin-circle' : 'inventory-2'} size={18} color={GOLD} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deliveryContactTitle, dynamicStyles.text]}>{deliveryContact.label} · {deliveryContact.name}</Text>
                    {deliveryContact.packageDescription && <Text style={[styles.deliveryContactText, dynamicStyles.muted]} numberOfLines={1}>Package: {deliveryContact.packageDescription}</Text>}
                    {deliveryContact.instructions && <Text style={[styles.deliveryContactText, dynamicStyles.muted]} numberOfLines={2}>{deliveryContact.instructions}</Text>}
                  </View>
                </View>
              )}
              {activeTrip.status === 'in_progress' && <Text style={[styles.tripTracking, dynamicStyles.muted]}>Tracked: {tripDistanceKm.toFixed(2)} km</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 }}>
                <Text style={[styles.metaText, dynamicStyles.muted]}>Final fare appears when the trip ends</Text>
                {activeNavigationEta && !isDriverAtPickup && (
                  <Text style={[styles.etaText, dynamicStyles.muted]}>{activeNavigationEta} min</Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.navBtn, { backgroundColor: BLUE }]}
              onPress={() => {
                const target = activeTrip.status === 'in_progress' ? activeTrip.destination : activeTrip.pickup;
                openNavigation(target.lat || 0, target.lng || 0, target.address);
              }}
            >
              <MaterialIcons name="navigation" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* Waiting Timer */}
        {activeTrip && waitingStartedAt && isDriverAtPickup && (
          <View style={[styles.timerCard, dynamicStyles.card, { alignItems: 'stretch', paddingVertical: 13 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: waitTime < FREE_WAITING_MINUTES * 60 ? `${GREEN}20` : `${GOLD}24`, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="schedule" size={19} color={waitTime < FREE_WAITING_MINUTES * 60 ? GREEN : GOLD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: waitTime < FREE_WAITING_MINUTES * 60 ? GREEN : GOLD, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {waitTime < FREE_WAITING_MINUTES * 60 ? 'Rider wait · complimentary time' : 'Paid waiting time'}
                </Text>
                <Text style={[styles.timerText, dynamicStyles.text, { marginTop: 2 }]}>
                  {waitTime < FREE_WAITING_MINUTES * 60
                    ? `${Math.floor((FREE_WAITING_MINUTES * 60 - waitTime) / 60)}:${String((FREE_WAITING_MINUTES * 60 - waitTime) % 60).padStart(2, '0')} free time remaining`
                    : 'Paid waiting time is being recorded'}
                </Text>
              </View>
            </View>
            <Text style={[styles.metaText, dynamicStyles.muted, { marginTop: 10, lineHeight: 16 }]}>
              {waitTime < FREE_WAITING_MINUTES * 60
                ? `Paid wait starts after ${FREE_WAITING_MINUTES} minutes. The rider sees the same countdown.`
                : `The charge stops when the trip starts. Total wait: ${Math.floor(waitTime / 60)}m ${String(waitTime % 60).padStart(2, '0')}s.`}
            </Text>
          </View>
        )}

        {/* Back-to-back ride queue */}
        {activeTrip && nextRide && (
          <View style={[styles.queueCard, dynamicStyles.card]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.queueTitle, dynamicStyles.text]}>Next ride available</Text>
              <Text style={[styles.queueText, dynamicStyles.muted]} numberOfLines={1}>{nextRide.rider_name || 'Rider'} · {nextRide.pickup_address || 'Pickup'} → {nextRide.destination_address || 'Destination'}</Text>
              {Number(nextRide.rider_rating_count) > 0 && <Text style={[styles.metaText, dynamicStyles.muted]}>★ {Number(nextRide.rider_rating).toFixed(1)} · {Math.floor(Number(nextRide.rider_rating_count))} ratings</Text>}
              {hasIncludedAirConditioning(nextRide.category) && <Text style={styles.queueAcText}><MaterialIcons name="ac-unit" size={12} color="#075985" /> {rideCategoryName(nextRide.category)} includes AC</Text>}
            </View>
            {nextRide.status === 'driver_queued' ? <View style={styles.queuedTag}><Text style={styles.queuedTagText}>Queued</Text></View> : <TouchableOpacity style={styles.queueButton} onPress={handleAcceptQueuedRide}><Text style={styles.queueButtonText}>Queue</Text></TouchableOpacity>}
          </View>
        )}

        {/* Quick Destination Filter */}
        {isOnline && !activeTrip && (
          <TouchableOpacity
            style={[styles.destFilterBar, dynamicStyles.card]}
            onPress={() => setDestModalVisible(true)}
          >
            <MaterialIcons name="home" size={20} color={prefs.destinationFilter ? GOLD : themeColors.muted} />
            <Text style={[styles.destText, prefs.destinationFilter ? dynamicStyles.text : dynamicStyles.muted]}>
              {prefs.destinationFilter ? `Heading to ${prefs.destinationFilter}` : "Set destination filter"}
            </Text>
            {prefs.destinationFilter && (
              <TouchableOpacity onPress={() => setPrefs({ ...prefs, destinationFilter: null })}>
                <MaterialIcons name="cancel" size={20} color={RED} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {activeTrip && (
            <>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: BLUE, flex: 1 }]} onPress={openChat}>
                <MaterialIcons name="chat" size={18} color="#FFF" />
                <Text style={styles.actionBtnText}>Chat</Text>
                {unreadCount > 0 && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unreadCount}</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#475569', flex: 1 }]} onPress={startMobileNetworkCall}>
                <MaterialIcons name="phone" size={18} color="#FFF" />
                <Text style={styles.actionBtnText}>Call</Text>
              </TouchableOpacity>

              {activeTrip.status === 'driver_arrived' ? (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: GREEN, flex: 1 }]}
                  onPress={handleStartTrip}
                  disabled={tripActionPending}
                >
                  {tripActionPending ? <ActivityIndicator size="small" color="#FFF" /> : <><MaterialIcons name="check" size={18} color="#FFF" /><Text style={styles.actionBtnText}>Start Trip</Text></>}
                </TouchableOpacity>
              ) : activeTrip.status === 'driver_arriving' ? (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F59E0B', flex: 1 }]}
                  onPress={handleArrivedAtPickup}
                  disabled={tripActionPending}
                >
                  {tripActionPending ? <ActivityIndicator size="small" color="#FFF" /> : <><MaterialIcons name="location-on" size={18} color="#FFF" /><Text style={styles.actionBtnText}>Arrived</Text></>}
                </TouchableOpacity>
              ) : activeTrip.status === 'in_progress' ? (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: RED, flex: 1 }]} onPress={handleEndTrip} disabled={tripActionPending}>
                  {tripActionPending ? <ActivityIndicator size="small" color="#FFF" /> : <><MaterialIcons name="stop" size={18} color="#FFF" /><Text style={styles.actionBtnText}>End</Text></>}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F59E0B', flex: 1 }]}
                  onPress={handleArrivedAtPickup}
                  disabled={tripActionPending}
                >
                  {tripActionPending ? <ActivityIndicator size="small" color="#FFF" /> : <><MaterialIcons name="location-on" size={18} color="#FFF" /><Text style={styles.actionBtnText}>Arrived</Text></>}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: RED, flex: 1.25, justifyContent: 'center' }]}
                onPress={() => setShowCancel(true)}
                accessibilityLabel="Cancel ride"
              >
                <Text style={[styles.actionBtnText, { textAlign: 'center' }]}>Cancel ride</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={[styles.onlineCard, dynamicStyles.card]}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, { backgroundColor: isOnline ? GREEN : themeColors.muted, transform: [{ scale: isOnline ? pulseAnim : 1 }] }]} />
            <Text style={[styles.onlineStatus, dynamicStyles.text]}>{isOnline ? (hasCurrentLocation ? 'You are Online' : 'Getting your location…') : 'You are Offline'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: isOnline ? RED : GREEN }]}
            onPress={handleToggleOnline}
            disabled={togglingOnline}
          >
            {togglingOnline ? <ActivityIndicator color="#fff" /> : <Text style={styles.toggleBtnText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Destination Modal */}
      <Modal visible={destModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalContainer, dynamicStyles.container]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, dynamicStyles.text]}>Where are you heading?</Text>
            <TouchableOpacity onPress={() => setDestModalVisible(false)}><MaterialIcons name="close" size={24} color={themeColors.text} /></TouchableOpacity>
          </View>
          <TextInput
            style={[styles.modalInput, { color: themeColors.text, borderColor: themeColors.border }]}
            placeholder="Search destination..."
            placeholderTextColor="#999"
            value={destInput}
            onChangeText={setDestInput}
          />
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: GOLD }]}
            onPress={() => { setPrefs({ ...prefs, destinationFilter: destInput }); setDestModalVisible(false); }}
          >
            <Text style={styles.applyBtnText}>Set Destination</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Pickup-code verification */}
      <Modal visible={showOtp} transparent animationType="fade" onRequestClose={() => setShowOtp(false)}>
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.sheet, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <MaterialIcons name="lock" size={30} color={GOLD} />
            <Text style={[styles.sheetTitle, dynamicStyles.text]}>Verify pickup code</Text>
            <Text style={[styles.sheetText, dynamicStyles.muted]}>Ask the rider for the code in their HY3N app before starting this trip.</Text>
            <TextInput style={[styles.codeInput, { color: themeColors.text, borderColor: themeColors.border }]} value={pickupCode} onChangeText={setPickupCode} keyboardType="number-pad" maxLength={6} placeholder="Enter code" placeholderTextColor="#999" />
            <TouchableOpacity style={[styles.sheetPrimary, { backgroundColor: GOLD }]} onPress={handleVerifyPickupCode}><Text style={styles.sheetPrimaryText}>Verify & start trip</Text></TouchableOpacity>
            <TouchableOpacity style={styles.sheetSecondary} onPress={() => setShowOtp(false)}><Text style={[styles.sheetSecondaryText, dynamicStyles.text]}>Cancel</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Driver cancellation reasons */}
      <Modal visible={showCancel} transparent animationType="slide" onRequestClose={() => setShowCancel(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <View style={styles.modalHeader}><Text style={[styles.sheetTitle, dynamicStyles.text]}>Cancel this trip</Text><TouchableOpacity onPress={() => setShowCancel(false)}><MaterialIcons name="close" size={22} color={themeColors.text} /></TouchableOpacity></View>
            <Text style={[styles.sheetText, dynamicStyles.muted]}>Choose the reason that best explains the cancellation.</Text>
            {['Rider did not show up', 'Unable to find rider', 'Vehicle issue', 'Safety concern', 'Other'].map((reason) => <TouchableOpacity key={reason} style={[styles.reasonRow, { borderColor: themeColors.border }]} onPress={() => handleCancelTrip(reason)}><Text style={[styles.reasonText, dynamicStyles.text]}>{reason}</Text><MaterialIcons name="chevron-right" size={20} color={themeColors.muted} /></TouchableOpacity>)}
          </View>
        </View>
      </Modal>

      {/* Fare confirmation before the post-trip rating */}
      <Modal visible={showFareScreen} transparent animationType="slide" onRequestClose={handleFareAcknowledged}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <MaterialIcons name="check-circle" size={34} color={GREEN} />
            <Text style={[styles.sheetTitle, dynamicStyles.text]}>Trip completed</Text>
            <Text style={[styles.sheetText, dynamicStyles.muted]}>{completedRide?.destination_address || 'Trip destination'}</Text>
            <View style={styles.fareHero}>
              <Text style={styles.fareHeroLabel}>FINAL TRIP FARE</Text>
              <Text style={styles.fareHeroAmount}>{formatPassengerFare(completedRide?.final_fare)}</Text>
              <Text style={styles.fareHeroCaption}>Show this amount to the rider</Text>
            </View>
            <View style={styles.fareRows}>
              <Text style={[styles.fareRowText, dynamicStyles.muted]}>Distance · {Number(completedRide?.actual_distance_km || 0).toFixed(2)} km</Text>
              <Text style={[styles.fareRowText, dynamicStyles.muted]}>Waiting fee · {formatPassengerFare(completedRide?.waiting_fee)}</Text>
              <Text style={[styles.fareRowText, dynamicStyles.muted]}>Payment · {paymentLabel(completedRide?.payment_method)}</Text>
            </View>
            <TouchableOpacity style={[styles.sheetPrimary, { backgroundColor: GOLD }]} onPress={handleFareAcknowledged}><Text style={styles.sheetPrimaryText}>Continue</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Notification center */}
      <Modal visible={notifOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setNotifOpen(false)}>
        <View style={[styles.modalContainer, dynamicStyles.container]}>
          <View style={styles.modalHeader}><Text style={[styles.modalTitle, dynamicStyles.text]}>Notifications</Text><TouchableOpacity onPress={() => setNotifOpen(false)}><MaterialIcons name="close" size={24} color={themeColors.text} /></TouchableOpacity></View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
            {notifications.length === 0 ? <View style={styles.emptyNotifications}><MaterialIcons name="notifications-off" size={34} color={themeColors.muted} /><Text style={[styles.sheetText, dynamicStyles.muted]}>You are all caught up.</Text></View> : notifications.map((item) => <TouchableOpacity key={item.id} style={[styles.notificationRow, { borderColor: themeColors.border, opacity: item.read_at ? 0.62 : 1 }]} onPress={() => markNotificationRead(item)}><MaterialIcons name={(item.icon || 'notifications') as any} size={22} color={item.read_at ? themeColors.muted : GOLD} /><View style={{ flex: 1 }}><Text style={[styles.notificationTitle, dynamicStyles.text]}>{item.title || 'HY3N update'}</Text><Text style={[styles.optionSub, dynamicStyles.muted]}>{item.body || item.message || 'You have a new update.'}</Text></View>{!item.read_at && <View style={styles.unreadDot} />}</TouchableOpacity>)}
          </ScrollView>
        </View>
      </Modal>

      {/* Rating Modal */}
      <Modal visible={showRating} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.ratingOverlay}>
          <View style={[styles.ratingModal, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={[styles.ratingTitle, dynamicStyles.text]}>Rate Your Experience</Text>
            <Text style={[styles.ratingSubtitle, dynamicStyles.muted]}>{completedRide?.rider_name}</Text>

            {/* Star Rating */}
            <View style={styles.starsContainer}>
              {[1, 2, 3, 4, 5].map(star => (
                <TouchableOpacity key={star} onPress={() => setRatingValue(star)} disabled={ratingSubmitting}>
                  <MaterialIcons
                    name={star <= ratingValue ? 'star' : 'star-outline'}
                    size={40}
                    color={star <= ratingValue ? GOLD : themeColors.muted}
                  />
                </TouchableOpacity>
              ))}
            </View>

            {/* Feedback, safety and lost-item report */}
            <TextInput
              style={[styles.feedbackInput, { color: themeColors.text, borderColor: themeColors.border }]}
              placeholder="Add feedback (optional)"
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              value={ratingFeedback}
              onChangeText={setRatingFeedback}
            />

            <TextInput style={[styles.compactInput, { color: themeColors.text, borderColor: themeColors.border }]} placeholder="Report a found item (optional)" placeholderTextColor="#999" value={foundItem} onChangeText={setFoundItem} />
            <TextInput style={[styles.compactInput, { color: themeColors.text, borderColor: themeColors.border }]} placeholder="Report a safety concern (optional)" placeholderTextColor="#999" value={safetyReport} onChangeText={setSafetyReport} />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
              style={[styles.ratingBtn, { backgroundColor: themeColors.border, flex: 1 }]}
                onPress={() => { setShowRating(false); setRatingValue(5); }}
                disabled={ratingSubmitting}
              >
                <Text style={[styles.ratingBtnText, { color: themeColors.text }]}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ratingBtn, { backgroundColor: GOLD, flex: 1 }]}
                onPress={handleSubmitRating}
                disabled={ratingSubmitting}
              >
                {ratingSubmitting ? <ActivityIndicator size="small" color="#111" /> : <Text style={styles.ratingBtnText}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Chat Modal */}
      <RideChatModal
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        rideId={activeTrip?.id}
        currentUserId={user?.uid || ''}
        currentUserRole="driver"
        currentUserName={driverProfile?.full_name || "Driver"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  offlineBg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  largeLogo: { width: 100, height: 100, marginBottom: 20, opacity: 0.5 },
  offlineGreeting: { fontSize: 22, fontWeight: '900', marginBottom: 4 },
  approvalTitle: { fontSize: 20, fontWeight: '900', marginTop: 20 },
  approvalSub: { fontSize: 14, marginTop: 12, textAlign: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 30, borderWidth: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { fontWeight: '800', fontSize: 14 },
  trendsShortcut: { position: 'absolute', right: 20, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10 },
  trendsShortcutText: { fontSize: 13, fontWeight: '900' },
  notifCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerBadge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: RED, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  headerBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 10 },

  rideRequestCard: { flexDirection: 'row', padding: 16, borderRadius: 20, borderWidth: 1, gap: 12, alignItems: 'center' },
  rideTitle: { fontSize: 11, fontWeight: '700', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 },
  offerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offerTimer: { fontSize: 14, fontWeight: '900' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 3 },
  metaText: { fontSize: 11, fontWeight: '700' },
  categoryBadge: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  acServiceBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: '#E0F2FE', borderWidth: 1, borderColor: '#7DD3FC' },
  acServiceTitle: { color: '#075985', fontSize: 11, fontWeight: '900' },
  acServiceText: { color: '#0C4A6E', fontSize: 10, fontWeight: '700', lineHeight: 14, marginTop: 1 },
  riskBanner: { marginTop: 7, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 7, backgroundColor: '#FEF3C7', flexDirection: 'row', gap: 5, alignItems: 'center' },
  riskText: { color: '#7C2D12', fontSize: 10, fontWeight: '800' },
  rideName: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  rideDetails: { fontSize: 12, marginTop: 2 },
  deliveryOfferText: { fontSize: 10, lineHeight: 14, marginTop: 6, fontWeight: '700' },
  rideFare: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  surgeText: { fontSize: 11, fontWeight: '900' },
  paymentText: { fontSize: 11, fontWeight: '600' },
  rideActions: { flexDirection: 'row', gap: 8 },
  rideBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  navCard: { flexDirection: 'row', padding: 16, borderRadius: 20, borderWidth: 1, gap: 12, alignItems: 'center' },
  navStatus: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  navTitle: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  navSub: { fontSize: 13, marginTop: 2 },
  deliveryContactCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 9, padding: 9, borderWidth: 1, borderRadius: 10 },
  deliveryContactTitle: { fontSize: 12, fontWeight: '900' },
  deliveryContactText: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  navFare: { fontSize: 16, fontWeight: '900' },
  etaText: { fontSize: 12, fontWeight: '600' },
  tripTracking: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  navBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  timerCard: { flexDirection: 'row', padding: 12, borderRadius: 16, borderWidth: 1, alignItems: 'center', gap: 12 },
  timerText: { fontSize: 14, fontWeight: '900', flex: 1 },
  feeText: { fontSize: 12, fontWeight: '700' },
  queueCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, gap: 10 },
  queueTitle: { fontSize: 13, fontWeight: '900' },
  queueText: { fontSize: 11, marginTop: 3 },
  queueAcText: { color: '#075985', fontSize: 10, fontWeight: '900', marginTop: 4 },
  queueButton: { backgroundColor: GOLD, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9 },
  queueButtonText: { color: '#000', fontSize: 12, fontWeight: '900' },
  queuedTag: { backgroundColor: '#DCFCE7', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9 },
  queuedTagText: { color: '#166534', fontSize: 11, fontWeight: '900' },

  destFilterBar: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1, gap: 12 },
  destText: { flex: 1, fontSize: 14, fontWeight: '700' },

  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12 },
  actionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  unreadBadge: { position: 'absolute', top: -8, right: -8, width: 20, height: 20, borderRadius: 10, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  unreadText: { color: '#FFF', fontSize: 10, fontWeight: '900' },

  onlineCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 20, padding: 16, borderWidth: 1 },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  onlineStatus: { fontSize: 16, fontWeight: '900' },
  toggleBtn: { paddingHorizontal: 20, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toggleBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  modalContainer: { flex: 1, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  modalInput: { height: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, marginBottom: 20 },
  applyBtn: { height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  applyBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.56)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 13 },
  sheetTitle: { fontSize: 20, fontWeight: '900' },
  sheetText: { fontSize: 14, lineHeight: 20 },
  sheetPrimary: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  sheetPrimaryText: { color: '#000', fontWeight: '900', fontSize: 14 },
  sheetSecondary: { height: 40, alignItems: 'center', justifyContent: 'center' },
  sheetSecondaryText: { fontWeight: '800', fontSize: 14 },
  codeInput: { height: 56, borderWidth: 1, borderRadius: 12, fontSize: 24, textAlign: 'center', letterSpacing: 6, fontWeight: '800' },
  reasonRow: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reasonText: { fontSize: 14, fontWeight: '800' },
  fareHero: { alignItems: 'center', backgroundColor: GOLD, borderRadius: 20, minHeight: 166, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 18, marginVertical: 8 },
  fareHeroLabel: { color: '#191300', fontSize: 14, fontWeight: '900', letterSpacing: 1.4 },
  fareHeroAmount: { color: '#000', fontSize: 58, fontWeight: '900', letterSpacing: -2.5, lineHeight: 68, marginTop: 2 },
  fareHeroCaption: { color: '#352900', fontSize: 13, fontWeight: '700', marginTop: 2 },
  fareRows: { gap: 6, marginBottom: 5 },
  fareRowText: { fontSize: 12 },
  callOption: { minHeight: 72, borderWidth: 1, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionSub: { fontSize: 12, marginTop: 2 },
  notificationRow: { minHeight: 74, borderWidth: 1, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  notificationTitle: { fontSize: 14, fontWeight: '900' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  emptyNotifications: { alignItems: 'center', gap: 10, paddingVertical: 70 },

  ratingOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  ratingModal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  ratingTitle: { fontSize: 20, fontWeight: '900', marginBottom: 4 },
  ratingSubtitle: { fontSize: 14, marginBottom: 24 },
  starsContainer: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 24 },
  feedbackInput: { height: 86, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, marginBottom: 10, textAlignVertical: 'top' },
  compactInput: { height: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 13, marginBottom: 9 },
  ratingBtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ratingBtnText: { fontSize: 15, fontWeight: '800', color: '#000' }
});
