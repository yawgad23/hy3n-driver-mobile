import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES, FREE_WAITING_MINUTES, POPULAR_DESTINATIONS, calculateFare, getFareBreakdown } from '@/constants/rides';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Dimensions, Alert, ActivityIndicator, Animated, Image, Platform, PanResponder,
  Modal, TextInput, StatusBar, useColorScheme
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { trpc } from '@/lib/trpc';
import { Linking } from 'react-native';
import { RideChatModal } from '@/components/ride-chat-modal';
import { InCallScreen, IncomingCallModal } from '@/components/in-call-screen';
import { useVoiceCall } from '@/hooks/use-voice-call';
import MapView, { PROVIDER_GOOGLE, Circle } from 'react-native-maps';
import { Colors } from '@/constants/theme';

const INCOMING_TRIP_ALERT = require('../../assets/audio/incoming-trip-alert.wav');
const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#3B82F6';

const { height } = Dimensions.get('window');

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';
  const themeColors = Colors[isDark ? 'dark' : 'light'];
  
  const { user, driverProfile } = useDriverAuth();
  const { prefs, toggle: togglePref, setPrefs } = useDriverPreferences();
  const mapRef = useRef<MapView>(null);
  const incomingTripPlayer = useAudioPlayer(INCOMING_TRIP_ALERT, {
    downloadFirst: true,
    keepAudioSessionActive: true,
  });
  const setAvailability = trpc.driverOperations.setAvailability.useMutation();
  const updateDriverLocation = trpc.driverOperations.updateLocation.useMutation();
  const respondToOffer = trpc.driverTrips.respondToOffer.useMutation();
  const arriveAtPickup = trpc.driverTrips.arrive.useMutation();
  const verifyPickup = trpc.driverTrips.verifyPickup.useMutation();
  const startTrip = trpc.driverTrips.start.useMutation();
  const completeTrip = trpc.driverTrips.complete.useMutation();
  const cancelTrip = trpc.driverTrips.cancel.useMutation();
  const activateQueuedTrip = trpc.driverTrips.activateQueued.useMutation();
  const createSos = trpc.driverSafety.createSos.useMutation();
  const recordDrivingEvent = trpc.driverSafety.recordDrivingEvent.useMutation();
  
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<ExpoLocation.LocationObject | null>(null);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [incomingRide, setIncomingRide] = useState<any>(null);
  const [completedRide, setCompletedRide] = useState<any>(null);
  const [showRating, setShowRating] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [eta, setEta] = useState<number | null>(null);
  const [nextRide, setNextRide] = useState<any>(null);
  const [queuedRideToActivate, setQueuedRideToActivate] = useState<any>(null);
  const [rideOfferSeconds, setRideOfferSeconds] = useState(20);
  const [showOtp, setShowOtp] = useState(false);
  const [pickupCode, setPickupCode] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showCallOptions, setShowCallOptions] = useState(false);
  const [showFareScreen, setShowFareScreen] = useState(false);
  const [showTripSummary, setShowTripSummary] = useState(false);
  const [foundItem, setFoundItem] = useState('');
  const [safetyReport, setSafetyReport] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [tripDistanceKm, setTripDistanceKm] = useState(0);
  const [tripStartedAt, setTripStartedAt] = useState<string | null>(null);
  const lastTripLocationRef = useRef<ExpoLocation.LocationObject | null>(null);
  const lastSpeedRef = useRef<number | null>(null);
  const lastSafetyEventAtRef = useRef(0);
  const offerSwipeX = useRef(new Animated.Value(0)).current;
  
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

  // Heatmap / Demand Zones
  const [showHeatmap, setShowHeatmap] = useState(true);
  const demandZones = useMemo(() => POPULAR_DESTINATIONS.map(d => ({
    ...d,
    intensity: Math.random() * 0.5 + 0.2 
  })), []);

  // Waiting Time Logic
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const [waitTime, setWaitTime] = useState(0);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [destModalVisible, setDestModalVisible] = useState(false);
  const [destInput, setDestInput] = useState('');
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingFeedback, setRatingFeedback] = useState('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const call = useVoiceCall({
    rideId: activeTrip?.id,
    myId: user?.uid,
    myName: driverProfile?.full_name || 'Driver',
    myRole: 'driver',
    otherName: activeTrip?.rider_name,
  });

  const riderPhone = activeTrip?.rider_phone || activeTrip?.passenger_phone || activeTrip?.phone || '';
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

  // Incoming-ride alert: play the distinctive local tone repeatedly until the
  // driver accepts, declines, the offer expires, or sound alerts are disabled.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});

    return () => {
      incomingTripPlayer.pause();
      incomingTripPlayer.seekTo(0).catch(() => {});
    };
  }, [incomingTripPlayer]);

  useEffect(() => {
    const shouldAlert = Boolean(incomingRide?.id) && !activeTrip && prefs.soundAlerts;
    if (!shouldAlert) {
      incomingTripPlayer.pause();
      incomingTripPlayer.seekTo(0).catch(() => {});
      return;
    }

    incomingTripPlayer.loop = true;
    incomingTripPlayer.volume = 0.92;
    incomingTripPlayer.seekTo(0)
      .catch(() => {})
      .finally(() => incomingTripPlayer.play());

    return () => {
      incomingTripPlayer.pause();
      incomingTripPlayer.seekTo(0).catch(() => {});
    };
  }, [incomingRide?.id, activeTrip?.id, prefs.soundAlerts, incomingTripPlayer]);

  // Waiting time counter
  useEffect(() => {
    if (arrivedAt && !activeTrip?.trip_started_at) {
      waitTimerRef.current = setInterval(() => {
        setWaitTime(prev => prev + 1);
      }, 1000);
    } else {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      setWaitTime(0);
    }
    return () => { if (waitTimerRef.current) clearInterval(waitTimerRef.current); };
  }, [arrivedAt, activeTrip?.trip_started_at]);

  useEffect(() => {
    let subscription: any;
    (async () => {
      let { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let loc = await ExpoLocation.getCurrentPositionAsync({});
      setLocation(loc);
      subscription = await ExpoLocation.watchPositionAsync(
        { accuracy: ExpoLocation.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (newLoc) => setLocation(newLoc)
      );
    })();
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (driverProfile) setIsOnline(driverProfile.is_online || false);
  }, [driverProfile]);

  // Receive driver-assigned requests in real time. A ride is only shown when it
  // meets the driver's saved preferences; active drivers may queue one next ride.
  useEffect(() => {
    if (!user?.uid || !isOnline) return;

    const unsubscribe = firestoreDB.subscribe(COLLECTIONS.RIDES, { driver_id: user.uid }, (rides) => {
      const matched = rides.find((ride: any) => ride.status === 'matched');
      if (!matched) return;

      const estimatedDistance = Number(matched.distance_km || matched.estimated_distance_km || 0);
      const eligibleForLongTrip = !prefs.longTripsOnly || estimatedDistance >= 8;
      const eligibleForRating = !prefs.preferHighRated || Number(matched.rider_rating || 5) >= 4.5;
      if (!eligibleForLongTrip || !eligibleForRating) return;

      if (activeTrip) {
        setNextRide((current: any) => current?.id === matched.id ? current : matched);
        return;
      }

      setIncomingRide((current: any) => {
        if (current?.id === matched.id) return current;
        setRideOfferSeconds(20);
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'New Ride Request',
            body: `Ride from ${matched.rider_name || 'a rider'} · GH₵${matched.fare_estimate || 0}`,
            sound: 'default',
            priority: Notifications.AndroidNotificationPriority.MAX,
          },
          trigger: null,
        }).catch(() => {});
        return matched;
      });
    });

    return () => unsubscribe?.();
  }, [user?.uid, isOnline, activeTrip, prefs.longTripsOnly, prefs.preferHighRated]);

  // Recover a trip if the app is reopened while the driver is already assigned.
  useEffect(() => {
    if (!user?.uid) return;
    firestoreDB.list(COLLECTIONS.RIDES, { driver_id: user.uid }, null).then((rides) => {
      const current = rides.find((ride: any) => ['driver_arriving', 'in_progress'].includes(ride.status));
      if (current) {
        setActiveTrip(current);
        setTripStartedAt(current.trip_started_at || null);
        setArrivedAt(current.driver_arrived_at || null);
      }
    }).catch(() => {});
  }, [user?.uid]);

  // Automatically expire unanswered requests and optionally accept approved matches.
  useEffect(() => {
    if (!incomingRide || activeTrip) return;
    const timer = setInterval(() => setRideOfferSeconds((seconds) => seconds - 1), 1000);
    return () => clearInterval(timer);
  }, [incomingRide, activeTrip]);

  useEffect(() => {
    if (!incomingRide || activeTrip || rideOfferSeconds > 0) return;
    handleDeclineRide();
  }, [rideOfferSeconds, incomingRide, activeTrip]);

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
    if (!activeTrip?.id) {
      setUnreadCount(0);
      return;
    }
    
    const unsubscribe = firestoreDB.subscribe(COLLECTIONS.RIDE_MESSAGES, (snapshot) => {
      snapshot.forEach((change) => {
        if (change.type === 'added') {
          const msg = change.doc.data();
          if (msg.ride_id === activeTrip.id && msg.sender_role === 'rider' && !showChat) {
            setUnreadCount(prev => prev + 1);
          }
        }
      });
    });

    return () => unsubscribe?.();
  }, [activeTrip?.id, showChat]);

  const openChat = () => { setShowChat(true); setUnreadCount(0); };

  const haversineKm = (from: ExpoLocation.LocationObject, to: ExpoLocation.LocationObject) => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const radiusKm = 6371;
    const dLat = toRad(to.coords.latitude - from.coords.latitude);
    const dLng = toRad(to.coords.longitude - from.coords.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.coords.latitude)) * Math.cos(toRad(to.coords.latitude)) * Math.sin(dLng / 2) ** 2;
    return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Maintain secure server-side driver presence while online, including when the app is foregrounded during an active trip.
  useEffect(() => {
    if (!location || !user?.uid || !isOnline) return;
    updateDriverLocation.mutate({
      driverId: user.uid,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      heading: location.coords.heading === null ? undefined : location.coords.heading,
      speedKmh: location.coords.speed === null || location.coords.speed === undefined ? undefined : Math.max(0, Number((location.coords.speed * 3.6).toFixed(1))),
    });
  }, [location, user?.uid, isOnline]);

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
      await setAvailability.mutateAsync({
        driverId: user.uid,
        status: newStatus ? 'online' : 'offline',
      });
      setIsOnline(newStatus);
    } catch (err) {
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleAcceptRide = async () => {
    if (!incomingRide || !user?.uid) return;
    try {
      const result = await respondToOffer.mutateAsync({
        driverId: user.uid,
        rideId: incomingRide.id,
        decision: 'accept',
        driverName: driverProfile?.full_name || undefined,
      });
      setActiveTrip(result.ride);
      setIncomingRide(null);
      setRideOfferSeconds(20);
    } catch (err) {
      Alert.alert('Error', 'Failed to accept ride');
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
    try {
      await respondToOffer.mutateAsync({ driverId: user.uid, rideId: incomingRide.id, decision: 'decline' });
      setIncomingRide(null);
      setRideOfferSeconds(20);
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
    Alert.alert('Send emergency alert?', 'Your current location and active trip details will be shared with HY3N safety support.', [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Send SOS', style: 'destructive', onPress: async () => {
          try {
            if (!user?.uid) throw new Error('Sign in required');
            await createSos.mutateAsync({
              driverId: user.uid,
              driverName: driverProfile?.full_name || undefined,
              rideId: activeTrip?.id || undefined,
              message: 'Emergency alert initiated from the driver app.',
              ...(location ? { location: { latitude: location.coords.latitude, longitude: location.coords.longitude } } : {}),
            });
            Alert.alert('SOS sent', 'HY3N safety support has been alerted. If you are in immediate danger, call emergency services.');
          } catch {
            Alert.alert('SOS not sent', 'Please call emergency services or try again.');
          }
        },
      },
    ]);
  };

  // Driver arrival at pickup
  const handleArrivedAtPickup = async () => {
    if (!activeTrip || !user?.uid) return;
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
    }
  };

  // Calculate waiting fee
  const calculateWaitingFee = () => {
    if (!arrivedAt) return { waitingMinutes: 0, waitingFee: 0 };
    const arrivedAtTime = new Date(arrivedAt).getTime();
    const now = Date.now();
    const totalMinutes = (now - arrivedAtTime) / (1000 * 60);
    const chargeableMinutes = Math.max(0, totalMinutes - FREE_WAITING_MINUTES);
    const categoryConfig = RIDE_CATEGORIES.find(c => c.id === activeTrip?.category) || RIDE_CATEGORIES[0];
    const feePerMin = categoryConfig.waitingFeePerMin || 0.50;
    const fee = parseFloat((chargeableMinutes * feePerMin).toFixed(2));
    return { waitingMinutes: parseFloat(chargeableMinutes.toFixed(1)), waitingFee: fee };
  };

  const beginTrip = async (ride = activeTrip) => {
    if (!ride || !user?.uid) return;
    try {
      const { waitingMinutes, waitingFee } = calculateWaitingFee();
      const result = await startTrip.mutateAsync({
        driverId: user.uid,
        rideId: ride.id,
        waitingTimeMinutes: waitingMinutes,
        waitingFee,
      });
      const updatedRide: any = result.ride;
      const startedAt = updatedRide.trip_started_at || new Date().toISOString();
      setActiveTrip(updatedRide);
      setTripStartedAt(startedAt);
      setTripDistanceKm(0);
      lastTripLocationRef.current = location;
      setArrivedAt(null);
    } catch {
      Alert.alert('Error', 'Failed to start trip');
    }
  };

  // Verify the rider's pickup code before the trip begins when a code was issued.
  const handleStartTrip = async () => {
    if (!activeTrip) return;
    if (activeTrip.pickup_code && !activeTrip.pickup_verified_at) {
      setShowOtp(true);
      return;
    }
    await beginTrip();
  };

  const handleVerifyPickupCode = async () => {
    if (!activeTrip || !user?.uid || !pickupCode.trim()) return;
    try {
      const result = await verifyPickup.mutateAsync({
        driverId: user.uid,
        rideId: activeTrip.id,
        pickupCode: pickupCode.trim(),
      });
      setPickupCode('');
      setShowOtp(false);
      await beginTrip(result.ride);
    } catch (error: any) {
      Alert.alert('Unable to verify code', error?.message || 'Please ask the rider for the code shown in their app.');
    }
  };

  // End trip and calculate a transparent category-based fare from tracked distance.
  const handleEndTrip = async () => {
    if (!activeTrip) return;
    try {
      const waitingFee = Number(activeTrip.waiting_fee || 0);
      const durationMinutes = tripStartedAt ? Math.max(1, (Date.now() - new Date(tripStartedAt).getTime()) / 60000) : Number(activeTrip.duration_minutes || 0);
      const calculatedFare = calculateFare(activeTrip.category || 'standard', tripDistanceKm || Number(activeTrip.distance_km || 0), durationMinutes, Number(activeTrip.surge_multiplier || 1));
      const baseFare = Math.max(Number(activeTrip.fare_estimate || 0), calculatedFare);
      const totalFare = parseFloat((baseFare + waitingFee).toFixed(2));
      const fareBreakdown = getFareBreakdown(activeTrip.category || 'standard', tripDistanceKm || Number(activeTrip.distance_km || 0), durationMinutes, Number(activeTrip.surge_multiplier || 1));

      if (!user?.uid) throw new Error('Sign in required');
      const result = await completeTrip.mutateAsync({
        driverId: user.uid,
        rideId: activeTrip.id,
        finalFare: totalFare,
        tipAmount: Number(activeTrip.tip_amount || 0),
        actualDistanceKm: Number(tripDistanceKm.toFixed(2)),
        actualDurationMinutes: Number(durationMinutes.toFixed(1)),
        fareBreakdown,
      });

      const completed = { ...result.ride, waiting_fee: waitingFee, actual_distance_km: tripDistanceKm, actual_duration_minutes: durationMinutes, fare_breakdown: fareBreakdown };
      setCompletedRide(completed);
      if (nextRide?.status === 'driver_queued') setQueuedRideToActivate(nextRide);
      setActiveTrip(null);
      setArrivedAt(null);
      setTripStartedAt(null);
      lastTripLocationRef.current = null;
      setShowFareScreen(true);
    } catch {
      Alert.alert('Error', 'Failed to end trip');
    }
  };

  // Submit rating
  const handleSubmitRating = async () => {
    if (!completedRide) return;
    try {
      await firestoreDB.update(COLLECTIONS.RIDES, completedRide.id, {
        driver_rating: ratingValue,
        driver_feedback: ratingFeedback
      });

      // Update rider's average rating
      const riderProfiles = await firestoreDB.query(COLLECTIONS.RIDER_PROFILES, [
        { field: 'user_id', operator: '==', value: completedRide.rider_id }
      ]);

      if (riderProfiles.length > 0) {
        const riderProfile = riderProfiles[0];
        const rides = await firestoreDB.query(COLLECTIONS.RIDES, [
          { field: 'rider_id', operator: '==', value: completedRide.rider_id }
        ]);
        
        const ratedRides = rides.filter((r: any) => Number(r.driver_rating || 0) > 0);
        if (ratedRides.length > 0) {
          const avgRating = ratedRides.reduce((sum: number, r: any) => sum + Number(r.driver_rating || 0), 0) / ratedRides.length;
          await firestoreDB.update(COLLECTIONS.RIDER_PROFILES, riderProfile.id, {
            rating: parseFloat(avgRating.toFixed(2))
          });
        }
      }

      if (foundItem.trim()) {
        await firestoreDB.create(COLLECTIONS.FOUND_ITEMS, {
          driver_id: user?.uid,
          ride_id: completedRide.id,
          rider_id: completedRide.rider_id || null,
          description: foundItem.trim(),
          status: 'reported',
          reported_at: new Date().toISOString(),
        });
      }
      if (safetyReport.trim()) {
        await firestoreDB.create(COLLECTIONS.RIDE_REPORTS, {
          reporter_id: user?.uid,
          reporter_role: 'driver',
          ride_id: completedRide.id,
          type: 'safety',
          description: safetyReport.trim(),
          status: 'open',
          created_at: new Date().toISOString(),
        });
      }

      setShowRating(false);
      setCompletedRide(null);
      setRatingValue(0);
      setRatingFeedback('');
      setFoundItem('');
      setSafetyReport('');
    } catch (err) {
      Alert.alert('Error', 'Failed to submit rating');
    }
  };

  const handleFareAcknowledged = async () => {
    setShowFareScreen(false);
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
            Your documents are being reviewed. We'll notify you once approved.
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

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} translucent backgroundColor="transparent" />

      {/* Map Layer */}
      {isOnline ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: location?.coords.latitude || 5.6037,
            longitude: location?.coords.longitude || -0.1870,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          showsUserLocation={true}
        >
          {showHeatmap && demandZones.map((zone, idx) => (
            <Circle
              key={idx}
              center={{ latitude: zone.lat, longitude: zone.lng }}
              radius={800}
              fillColor={`rgba(212, 175, 55, ${zone.intensity})`}
              strokeColor="transparent"
            />
          ))}
        </MapView>
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
          <Text style={[styles.statusText, dynamicStyles.text]}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {isOnline && (
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

      {/* Bottom Interface */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 20 }]}>
        {/* Incoming Ride Request */}
        {incomingRide && !activeTrip && (
          <Animated.View {...offerPanResponder.panHandlers} style={[styles.rideRequestCard, dynamicStyles.card, { transform: [{ translateX: offerSwipeX }] }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.offerHeader}><Text style={[styles.rideTitle, dynamicStyles.text]}>New Ride Request</Text><Text style={[styles.offerTimer, { color: rideOfferSeconds <= 5 ? RED : GOLD }]}>{Math.max(0, rideOfferSeconds)}s</Text></View>
              <Text style={[styles.rideName, dynamicStyles.text]}>{incomingRide.rider_name}</Text>
              <View style={styles.metaRow}>
                {incomingRide.rider_rating && <Text style={[styles.metaText, dynamicStyles.muted]}>★ {Number(incomingRide.rider_rating).toFixed(1)}</Text>}
                <Text style={[styles.categoryBadge, { color: GOLD }]}>{RIDE_CATEGORIES.find((category) => category.id === incomingRide.category)?.name || 'Standard'}</Text>
                {!!(incomingRide.distance_km || incomingRide.estimated_distance_km) && <Text style={[styles.metaText, dynamicStyles.muted]}>{Number(incomingRide.distance_km || incomingRide.estimated_distance_km).toFixed(1)} km</Text>}
              </View>
              <Text style={[styles.rideDetails, dynamicStyles.muted]} numberOfLines={1}>
                From: {incomingRide.pickup_address || 'Pickup'}
              </Text>
              {isHighRiskArea(incomingRide.pickup_address) && <View style={styles.riskBanner}><MaterialIcons name="warning-amber" size={14} color="#7C2D12" /><Text style={styles.riskText}>Use extra caution in this pickup area</Text></View>}
              <Text style={[styles.rideDetails, dynamicStyles.muted]} numberOfLines={1}>
                To: {incomingRide.destination_address || 'Destination'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <Text style={[styles.rideFare, { color: GOLD }]}>GH₵{incomingRide.fare_estimate}</Text>
                {incomingRide.surge_multiplier && incomingRide.surge_multiplier > 1 && (
                  <Text style={[styles.surgeText, { color: RED, marginLeft: 8 }]}>
                    {incomingRide.surge_multiplier}x Surge
                  </Text>
                )}
              </View>
              {/* Payment Method */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 }}>
                {incomingRide.payment_method === 'mobile_money' && <MaterialIcons name="smartphone" size={14} color={GOLD} />}
                {incomingRide.payment_method === 'cash' && <MaterialIcons name="attach-money" size={14} color={GREEN} />}
                {incomingRide.payment_method === 'card' && <MaterialIcons name="credit-card" size={14} color={BLUE} />}
                <Text style={[styles.paymentText, dynamicStyles.muted]} numberOfLines={1}>
                  {incomingRide.payment_method === 'mobile_money' ? 'MoMo' : incomingRide.payment_method === 'cash' ? 'Cash' : 'Card'}
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
              >
                <MaterialIcons name="check" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Active Trip Navigation Card */}
        {activeTrip && (
          <View style={[styles.navCard, dynamicStyles.card]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.navStatus, { color: GREEN }]}>
                {activeTrip.status === 'driver_arriving' 
                  ? (arrivedAt ? 'Waiting for Rider' : 'Navigate to Pickup') 
                  : 'Trip in Progress'}
              </Text>
              <Text style={[styles.navTitle, dynamicStyles.text]}>{activeTrip.rider_name}</Text>
              <View style={styles.metaRow}>
                {activeTrip.rider_rating && <Text style={[styles.metaText, dynamicStyles.muted]}>★ {Number(activeTrip.rider_rating).toFixed(1)}</Text>}
                <Text style={[styles.categoryBadge, { color: GOLD }]}>{RIDE_CATEGORIES.find((category) => category.id === activeTrip.category)?.name || 'Standard'}</Text>
                <Text style={[styles.metaText, dynamicStyles.muted]}>{paymentLabel(activeTrip.payment_method)}</Text>
              </View>
              <Text style={[styles.navSub, dynamicStyles.muted]} numberOfLines={1}>
                {activeTrip.status === 'in_progress' ? activeTrip.destination_address : activeTrip.pickup_address}
              </Text>
              {activeTrip.status === 'in_progress' && <Text style={[styles.tripTracking, dynamicStyles.muted]}>Tracked: {tripDistanceKm.toFixed(2)} km</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 }}>
                <Text style={[styles.navFare, { color: GOLD }]}>
                  GH₵{activeTrip.waiting_fee 
                    ? (activeTrip.fare_estimate + activeTrip.waiting_fee).toFixed(2) 
                    : activeTrip.fare_estimate}
                </Text>
                {eta && activeTrip.status === 'driver_arriving' && !arrivedAt && (
                  <Text style={[styles.etaText, dynamicStyles.muted]}>{eta} min</Text>
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
        {activeTrip && arrivedAt && activeTrip.status === 'driver_arriving' && (
          <View style={[styles.timerCard, dynamicStyles.card]}>
            <MaterialIcons name="schedule" size={20} color={GOLD} />
            <Text style={[styles.timerText, dynamicStyles.text]}>
              Waiting: {Math.floor(waitTime / 60)}m {waitTime % 60}s
            </Text>
            {waitTime > FREE_WAITING_MINUTES * 60 && (
              <Text style={[styles.feeText, { color: RED }]}>
                Fee: GH₵{calculateWaitingFee().waitingFee}
              </Text>
            )}
          </View>
        )}

        {/* Back-to-back ride queue */}
        {activeTrip && nextRide && (
          <View style={[styles.queueCard, dynamicStyles.card]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.queueTitle, dynamicStyles.text]}>Next ride available</Text>
              <Text style={[styles.queueText, dynamicStyles.muted]} numberOfLines={1}>{nextRide.rider_name || 'Rider'} · {nextRide.pickup_address || 'Pickup'} → {nextRide.destination_address || 'Destination'}</Text>
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
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#475569', flex: 1 }]} onPress={() => setShowCallOptions(true)}>
                <MaterialIcons name="phone" size={18} color="#FFF" />
                <Text style={styles.actionBtnText}>Call</Text>
              </TouchableOpacity>

              {activeTrip.status === 'driver_arriving' ? (
                arrivedAt ? (
                  <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: GREEN, flex: 1 }]}
                    onPress={handleStartTrip}
                  >
                    <MaterialIcons name="check" size={18} color="#FFF" />
                    <Text style={styles.actionBtnText}>Start</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: '#F59E0B', flex: 1 }]}
                    onPress={handleArrivedAtPickup}
                  >
                    <MaterialIcons name="location-on" size={18} color="#FFF" />
                    <Text style={styles.actionBtnText}>Arrived</Text>
                  </TouchableOpacity>
                )
              ) : (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: RED, flex: 1 }]} onPress={handleEndTrip}>
                  <MaterialIcons name="stop" size={18} color="#FFF" />
                  <Text style={styles.actionBtnText}>End</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#64748B', flex: 0.7 }]} onPress={() => setShowCancel(true)}>
                <MaterialIcons name="close" size={18} color="#FFF" />
                <Text style={styles.actionBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={[styles.onlineCard, dynamicStyles.card]}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, { backgroundColor: isOnline ? GREEN : themeColors.muted, transform: [{ scale: isOnline ? pulseAnim : 1 }] }]} />
            <Text style={[styles.onlineStatus, dynamicStyles.text]}>{isOnline ? 'You are Online' : 'You are Offline'}</Text>
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
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <MaterialIcons name="lock" size={30} color={GOLD} />
            <Text style={[styles.sheetTitle, dynamicStyles.text]}>Verify pickup code</Text>
            <Text style={[styles.sheetText, dynamicStyles.muted]}>Ask the rider for the code in their HY3N app before starting this trip.</Text>
            <TextInput style={[styles.codeInput, { color: themeColors.text, borderColor: themeColors.border }]} value={pickupCode} onChangeText={setPickupCode} keyboardType="number-pad" maxLength={6} placeholder="Enter code" placeholderTextColor="#999" />
            <TouchableOpacity style={[styles.sheetPrimary, { backgroundColor: GOLD }]} onPress={handleVerifyPickupCode}><Text style={styles.sheetPrimaryText}>Verify & start trip</Text></TouchableOpacity>
            <TouchableOpacity style={styles.sheetSecondary} onPress={() => setShowOtp(false)}><Text style={[styles.sheetSecondaryText, dynamicStyles.text]}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
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
            <MaterialIcons name="receipt-long" size={32} color={GOLD} />
            <Text style={[styles.sheetTitle, dynamicStyles.text]}>Trip completed</Text>
            <Text style={[styles.sheetText, dynamicStyles.muted]}>{completedRide?.destination_address || 'Trip destination'}</Text>
            <View style={[styles.fareTotal, { borderColor: themeColors.border }]}><Text style={[styles.fareTotalLabel, dynamicStyles.muted]}>Driver earnings (before commission)</Text><Text style={styles.fareTotalAmount}>GH₵{Number(completedRide?.final_fare || 0).toFixed(2)}</Text></View>
            <View style={styles.fareRows}>
              <Text style={[styles.fareRowText, dynamicStyles.muted]}>Distance · {Number(completedRide?.actual_distance_km || 0).toFixed(2)} km</Text>
              <Text style={[styles.fareRowText, dynamicStyles.muted]}>Waiting fee · GH₵{Number(completedRide?.waiting_fee || 0).toFixed(2)}</Text>
              <Text style={[styles.fareRowText, dynamicStyles.muted]}>Payment · {paymentLabel(completedRide?.payment_method)}</Text>
            </View>
            <TouchableOpacity style={[styles.sheetPrimary, { backgroundColor: GOLD }]} onPress={handleFareAcknowledged}><Text style={styles.sheetPrimaryText}>Continue</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Calling choice: secure in-app audio with mobile-network fallback */}
      <Modal visible={showCallOptions} transparent animationType="fade" onRequestClose={() => setShowCallOptions(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <View style={styles.modalHeader}><Text style={[styles.sheetTitle, dynamicStyles.text]}>Contact rider</Text><TouchableOpacity onPress={() => setShowCallOptions(false)}><MaterialIcons name="close" size={22} color={themeColors.text} /></TouchableOpacity></View>
            <TouchableOpacity style={[styles.callOption, { borderColor: themeColors.border }]} onPress={async () => { setShowCallOptions(false); if (activeTrip?.rider_id) await call.startCall(activeTrip.rider_id); else Alert.alert('Call unavailable', 'The rider does not have an in-app call identifier.'); }}><MaterialIcons name="wifi-calling-3" size={24} color={BLUE} /><View style={{ flex: 1 }}><Text style={[styles.reasonText, dynamicStyles.text]}>In-app voice call</Text><Text style={[styles.optionSub, dynamicStyles.muted]}>Uses your data connection</Text></View></TouchableOpacity>
            <TouchableOpacity style={[styles.callOption, { borderColor: themeColors.border, opacity: riderPhone ? 1 : 0.45 }]} disabled={!riderPhone} onPress={() => { setShowCallOptions(false); Linking.openURL(`tel:${riderPhone}`).catch(() => Alert.alert('Unable to call', 'This phone cannot open the dialer.')); }}><MaterialIcons name="phone" size={24} color={GREEN} /><View style={{ flex: 1 }}><Text style={[styles.reasonText, dynamicStyles.text]}>Mobile network call</Text><Text style={[styles.optionSub, dynamicStyles.muted]}>{riderPhone || 'Phone number unavailable'}</Text></View></TouchableOpacity>
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
                <TouchableOpacity key={star} onPress={() => setRatingValue(star)}>
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
                onPress={() => { setShowRating(false); setRatingValue(0); }}
              >
                <Text style={[styles.ratingBtnText, { color: themeColors.text }]}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.ratingBtn, { backgroundColor: GOLD, flex: 1 }]}
                onPress={handleSubmitRating}
              >
                <Text style={styles.ratingBtnText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Chat Modal */}
      <IncomingCallModal call={call} otherName={activeTrip?.rider_name} otherRole="rider" />
      <InCallScreen call={call} otherName={activeTrip?.rider_name} otherRole="rider" otherPhone={riderPhone} />

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
  riskBanner: { marginTop: 7, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 7, backgroundColor: '#FEF3C7', flexDirection: 'row', gap: 5, alignItems: 'center' },
  riskText: { color: '#7C2D12', fontSize: 10, fontWeight: '800' },
  rideName: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  rideDetails: { fontSize: 12, marginTop: 2 },
  rideFare: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  surgeText: { fontSize: 11, fontWeight: '900' },
  paymentText: { fontSize: 11, fontWeight: '600' },
  rideActions: { flexDirection: 'row', gap: 8 },
  rideBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  navCard: { flexDirection: 'row', padding: 16, borderRadius: 20, borderWidth: 1, gap: 12, alignItems: 'center' },
  navStatus: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  navTitle: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  navSub: { fontSize: 13, marginTop: 2 },
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
  fareTotal: { borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 3 },
  fareTotalLabel: { fontSize: 12, fontWeight: '700' },
  fareTotalAmount: { color: GOLD, fontSize: 28, fontWeight: '900', marginTop: 3 },
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
