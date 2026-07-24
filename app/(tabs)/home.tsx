import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES, FREE_WAITING_MINUTES, POPULAR_DESTINATIONS } from '@/constants/rides';
import { trpc } from '@/lib/trpc';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Dimensions, Alert, ActivityIndicator, Animated, Image, Platform,
  Modal, TextInput, KeyboardAvoidingView, StatusBar, useColorScheme
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import { RideChatModal, useUnreadChatCount } from '@/components/ride-chat-modal';
import MapView, { Marker, PROVIDER_GOOGLE, Circle } from 'react-native-maps';
import { Colors } from '@/constants/theme';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#3B82F6';

const { width, height } = Dimensions.get('window');

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';
  const themeColors = Colors[isDark ? 'dark' : 'light'];
  
  const { user, driverProfile } = useDriverAuth();
  const { prefs, toggle: togglePref, setPrefs } = useDriverPreferences();
  const mapRef = useRef<MapView>(null);
  
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

  // Subscribe to incoming rides — FIX: prevent duplicate ride requests
  useEffect(() => {
    if (!user?.id || !isOnline) return;
    
    const unsubscribe = firestoreDB.subscribe(COLLECTIONS.RIDES, (snapshot) => {
      snapshot.forEach((change) => {
        if (change.type === 'modified') {
          const ride = change.doc.data();
          // Only show incoming ride if:
          // 1. The ride is matched to this driver
          // 2. No active trip is in progress
          // 3. No incoming ride is already shown (avoid duplicates)
          if (
            ride.status === 'matched' && 
            ride.driver_id === user.id && 
            !activeTrip && 
            !incomingRide
          ) {
            setIncomingRide(ride);
            // Show notification
            Notifications.scheduleNotificationAsync({
              content: {
                title: 'New Ride Request!',
                body: `Ride from ${ride.rider_name} - GH₵${ride.fare_estimate}`,
              },
              trigger: null,
            });
          }
        }
      });
    });

    return () => unsubscribe?.();
  }, [user?.id, isOnline, activeTrip, incomingRide]);

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

  const handleToggleOnline = async () => {
    if (!driverProfile) return;
    setTogglingOnline(true);
    try {
      const newStatus = !isOnline;
      await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, {
        is_online: newStatus,
        last_online: new Date().toISOString()
      });
      setIsOnline(newStatus);
    } catch (err) {
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleAcceptRide = async () => {
    if (!incomingRide || !driverProfile) return;
    try {
      await firestoreDB.update(COLLECTIONS.RIDES, incomingRide.id, {
        status: 'driver_arriving'
      });
      setActiveTrip({ ...incomingRide, status: 'driver_arriving' });
      setIncomingRide(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to accept ride');
    }
  };

  const handleDeclineRide = async () => {
    if (!incomingRide) return;
    try {
      await firestoreDB.update(COLLECTIONS.RIDES, incomingRide.id, {
        status: 'requested',
        driver_id: null,
        driver_name: null
      });
      setIncomingRide(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to decline ride');
    }
  };

  // Driver arrival at pickup
  const handleArrivedAtPickup = async () => {
    if (!activeTrip) return;
    try {
      const arrivedAtTime = new Date().toISOString();
      await firestoreDB.update(COLLECTIONS.RIDES, activeTrip.id, {
        driver_arrived_at: arrivedAtTime,
        free_waiting_minutes: FREE_WAITING_MINUTES
      });
      setArrivedAt(arrivedAtTime);
      setActiveTrip({ ...activeTrip, driver_arrived_at: arrivedAtTime });
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

  // Start trip
  const handleStartTrip = async () => {
    if (!activeTrip) return;
    try {
      const tripStartedAt = new Date().toISOString();
      const { waitingMinutes, waitingFee } = calculateWaitingFee();
      await firestoreDB.update(COLLECTIONS.RIDES, activeTrip.id, {
        status: 'in_progress',
        trip_started_at: tripStartedAt,
        waiting_time_minutes: waitingMinutes,
        waiting_fee: waitingFee
      });
      setActiveTrip({
        ...activeTrip,
        status: 'in_progress',
        trip_started_at: tripStartedAt,
        waiting_time_minutes: waitingMinutes,
        waiting_fee: waitingFee
      });
      setArrivedAt(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to start trip');
    }
  };

  // End trip
  const handleEndTrip = async () => {
    if (!activeTrip) return;
    try {
      const baseFare = activeTrip.fare_estimate || 0;
      const waitingFee = activeTrip.waiting_fee || 0;
      const totalFare = parseFloat((baseFare + waitingFee).toFixed(2));
      
      await firestoreDB.update(COLLECTIONS.RIDES, activeTrip.id, {
        status: 'completed',
        final_fare: totalFare,
        waiting_fee: waitingFee
      });

      // Create earning record
      await firestoreDB.add(COLLECTIONS.EARNINGS, {
        driver_id: user.id,
        ride_id: activeTrip.id,
        amount: totalFare,
        commission: totalFare * 0.15,
        net_amount: totalFare * 0.85,
        status: 'available',
        created_at: new Date().toISOString()
      });

      setCompletedRide({ ...activeTrip, final_fare: totalFare, waiting_fee: waitingFee });
      setActiveTrip(null);
      setArrivedAt(null);
      setShowRating(true);
    } catch (err) {
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
        
        const ratedRides = rides.filter(r => r.driver_rating > 0);
        if (ratedRides.length > 0) {
          const avgRating = ratedRides.reduce((sum, r) => sum + r.driver_rating, 0) / ratedRides.length;
          await firestoreDB.update(COLLECTIONS.RIDER_PROFILES, riderProfile.id, {
            rating: parseFloat(avgRating.toFixed(2))
          });
        }
      }

      setShowRating(false);
      setCompletedRide(null);
      setRatingValue(0);
      setRatingFeedback('');
    } catch (err) {
      Alert.alert('Error', 'Failed to submit rating');
    }
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
            onPress={() => Alert.alert('SOS', 'Emergency assistance requested')}
          >
            <MaterialIcons name="emergency" size={26} color={RED} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.notifCircle, dynamicStyles.badge]} onPress={() => setNotifOpen(true)}>
            <MaterialIcons name="notifications-none" size={26} color={themeColors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Interface */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 20 }]}>
        {/* Incoming Ride Request */}
        {incomingRide && !activeTrip && (
          <View style={[styles.rideRequestCard, dynamicStyles.card]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rideTitle, dynamicStyles.text]}>New Ride Request</Text>
              <Text style={[styles.rideName, dynamicStyles.text]}>{incomingRide.rider_name}</Text>
              <Text style={[styles.rideDetails, dynamicStyles.muted]} numberOfLines={1}>
                From: {incomingRide.pickup_address || 'Pickup'}
              </Text>
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
          </View>
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
              <Text style={[styles.navSub, dynamicStyles.muted]} numberOfLines={1}>
                {activeTrip.status === 'in_progress' ? activeTrip.destination_address : activeTrip.pickup_address}
              </Text>
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
              <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: BLUE, flex: 1 }]}
                onPress={openChat}
              >
                <MaterialIcons name="chat" size={18} color="#FFF" />
                <Text style={styles.actionBtnText}>Chat</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{unreadCount}</Text>
                  </View>
                )}
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
                <TouchableOpacity 
                  style={[styles.actionBtn, { backgroundColor: RED, flex: 1 }]}
                  onPress={handleEndTrip}
                >
                  <MaterialIcons name="stop" size={18} color="#FFF" />
                  <Text style={styles.actionBtnText}>End</Text>
                </TouchableOpacity>
              )}
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

            {/* Feedback */}
            <TextInput
              style={[styles.feedbackInput, { color: themeColors.text, borderColor: themeColors.border }]}
              placeholder="Add feedback (optional)"
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              value={ratingFeedback}
              onChangeText={setRatingFeedback}
            />

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
      <RideChatModal
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        rideId={activeTrip?.id}
        currentUserId={user?.id}
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
  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 10 },
  
  rideRequestCard: { flexDirection: 'row', padding: 16, borderRadius: 20, borderWidth: 1, gap: 12, alignItems: 'center' },
  rideTitle: { fontSize: 11, fontWeight: '700', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  navBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  timerCard: { flexDirection: 'row', padding: 12, borderRadius: 16, borderWidth: 1, alignItems: 'center', gap: 12 },
  timerText: { fontSize: 14, fontWeight: '900', flex: 1 },
  feeText: { fontSize: 12, fontWeight: '700' },

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

  ratingOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  ratingModal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  ratingTitle: { fontSize: 20, fontWeight: '900', marginBottom: 4 },
  ratingSubtitle: { fontSize: 14, marginBottom: 24 },
  starsContainer: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 24 },
  feedbackInput: { height: 100, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, marginBottom: 20, textAlignVertical: 'top' },
  ratingBtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ratingBtnText: { fontSize: 15, fontWeight: '800', color: '#000' }
});
