import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES } from '@/constants/rides';
import { trpc } from '@/lib/trpc';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Dimensions, Alert, ActivityIndicator, Animated, Image, Platform,
  Modal, TextInput, KeyboardAvoidingView, StatusBar
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import { RideChatModal, useUnreadChatCount } from '@/components/ride-chat-modal';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';

const { width, height } = Dimensions.get('window');

// Custom Map Style for Dark Mode
const mapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#121212" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#121212" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#757575" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#3c3c3c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] }
];

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, driverProfile } = useDriverAuth();
  const mapRef = useRef<MapView>(null);
  
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<ExpoLocation.LocationObject | null>(null);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [togglingOnline, setTogglingOnline] = useState(false);
  
  const [notifOpen, setNotifOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { unreadCount } = useUnreadChatCount(activeTrip?.id);

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
    if (driverProfile) {
      setIsOnline(driverProfile.is_online || false);
    }
  }, [driverProfile]);

  const handleToggleOnline = async () => {
    if (!driverProfile) return;
    if (driverProfile.approval_status !== 'approved') {
      Alert.alert('Not Approved', 'Your application is still under review.');
      return;
    }

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

  const firstName = driverProfile?.full_name?.split(' ')[0] || 'Driver';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* 1. CONDITIONAL MAP (Only shown when Online) */}
      {isOnline ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          customMapStyle={mapStyle}
          initialRegion={{
            latitude: location?.coords.latitude || 5.6037,
            longitude: location?.coords.longitude || -0.1870,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          }}
          showsUserLocation={true}
          showsMyLocationButton={false}
          followsUserLocation={true}
        >
          {activeTrip && activeTrip.pickup?.lat && (
            <Marker 
              coordinate={{ latitude: activeTrip.pickup.lat, longitude: activeTrip.pickup.lng }}
              title="Pickup"
            >
              <View style={styles.markerContainer}>
                <MaterialIcons name="person-pin-circle" size={32} color={GREEN} />
              </View>
            </Marker>
          )}
        </MapView>
      ) : (
        <View style={[styles.offlineBg, { paddingTop: insets.top + 20 }]}>
           <Image 
            source={require('@/assets/images/icon.png')} 
            style={styles.largeLogo} 
            resizeMode="contain" 
          />
          <Text style={styles.offlineGreeting}>Hello, {firstName}!</Text>
          <Text style={styles.offlineSub}>Ready to start your day?</Text>
        </View>
      )}

      {/* 2. HEADER (Floats over map or offline bg) */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? GREEN : MUTED }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>

        <TouchableOpacity style={styles.notifCircle} onPress={() => setNotifOpen(true)}>
          <MaterialIcons name="notifications-none" size={26} color="#FFF" />
          <View style={styles.notifDot} />
        </TouchableOpacity>
      </View>

      {/* 3. SCROLLABLE CONTENT (The original "Go Online" card position) */}
      <ScrollView 
        style={styles.scroll} 
        contentContainerStyle={{ paddingTop: 120, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.onlineCard}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, { backgroundColor: isOnline ? GREEN : MUTED, transform: [{ scale: isOnline ? pulseAnim : 1 }] }]} />
            <View>
              <Text style={styles.onlineStatus}>{isOnline ? 'You are Online' : 'You are Offline'}</Text>
              <Text style={styles.onlineSubtext}>{isOnline ? 'Accepting ride requests' : 'Tap to start accepting rides'}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: isOnline ? RED : GREEN }]}
            onPress={handleToggleOnline}
            disabled={togglingOnline}
            activeOpacity={0.85}
          >
            {togglingOnline ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.toggleBtnText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Stats Row (Visible when offline or online) */}
        {!activeTrip && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Today's Trips</Text>
              <Text style={styles.statValue}>0</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Earnings</Text>
              <Text style={styles.statValue}>GH₵0.00</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Chat Modal */}
      {activeTrip && (
        <RideChatModal
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          rideId={activeTrip.id}
          otherName={activeTrip.rider_name || 'Rider'}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  offlineBg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  largeLogo: { width: 120, height: 120, marginBottom: 20, opacity: 0.8 },
  offlineGreeting: { color: TEXT, fontSize: 24, fontWeight: '900' },
  offlineSub: { color: MUTED, fontSize: 16, marginTop: 8 },

  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  notifCircle: {
    width: 46, height: 46,
    borderRadius: 23,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  notifDot: {
    position: 'absolute', top: 12, right: 12,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: RED, borderWidth: 1.5, borderColor: '#111111',
  },

  scroll: { flex: 1, zIndex: 10 },
  onlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(17, 17, 17, 0.9)',
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 20,
  },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 15, flex: 1 },
  onlineDot: { width: 12, height: 12, borderRadius: 6 },
  onlineStatus: { color: TEXT, fontSize: 18, fontWeight: '900' },
  onlineSubtext: { color: MUTED, fontSize: 13, marginTop: 2 },
  toggleBtn: {
    paddingHorizontal: 20,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

  statsRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16 },
  statItem: {
    flex: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.9)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  statLabel: { color: MUTED, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { color: GOLD, fontSize: 18, fontWeight: '900', marginTop: 4 },

  markerContainer: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#FFF',
  }
});
