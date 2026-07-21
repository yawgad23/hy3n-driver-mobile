import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES } from '@/constants/rides';
import { trpc } from '@/lib/trpc';
import {
  View, Text, TouchableOpacity, StyleSheet,
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

  // Animation for the "Go Online" card pulse
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

  // Initial location and tracking
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

  // Sync online status with profile
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

  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 12) return 'Good Morning';
    if (hrs < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const firstName = driverProfile?.full_name?.split(' ')[0] || 'Driver';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* 1. THE MAP (Background) */}
      <MapView
        ref={mapRef}
        style={styles.map}
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

      {/* 2. TOP FLOATING ELEMENTS */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 10 }]}>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? GREEN : MUTED }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>

        <TouchableOpacity style={styles.notifCircle} onPress={() => setNotifOpen(true)}>
          <MaterialIcons name="notifications-none" size={26} color="#FFF" />
          <View style={styles.notifDot} />
        </TouchableOpacity>
      </View>

      {/* 3. BOTTOM FLOATING CARD (Matches Screenshot) */}
      <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.mainCard}>
          <View style={styles.dragHandle} />
          
          <View style={styles.cardHeader}>
            <View style={styles.offlineIconBox}>
              <MaterialIcons 
                name={isOnline ? "directions-car" : "wifi-off"} 
                size={28} 
                color={isOnline ? GREEN : MUTED} 
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{isOnline ? "You're Online" : "You're Offline"}</Text>
              <Text style={styles.cardSubtitle}>
                {isOnline ? "Waiting for nearby trips..." : "Go online to start receiving trips"}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.goBtn, { backgroundColor: isOnline ? RED : GREEN }]}
            onPress={handleToggleOnline}
            disabled={togglingOnline}
            activeOpacity={0.85}
          >
            {togglingOnline ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <MaterialIcons name={isOnline ? "power-settings-new" : "sensors"} size={22} color="#FFF" style={{ marginRight: 10 }} />
                <Text style={styles.goBtnText}>{isOnline ? "Go Offline" : "Go Online"}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

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
  map: { width: width, height: height + 100 }, // Slightly larger to cover safe areas
  
  // Top UI
  topOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  statusText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  notifCircle: {
    width: 50, height: 50,
    borderRadius: 25,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  notifDot: {
    position: 'absolute', top: 14, right: 14,
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: RED, borderWidth: 2, borderColor: '#111111',
  },

  // Bottom UI
  bottomOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 12,
    zIndex: 10,
  },
  mainCard: {
    backgroundColor: '#0F1117',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderRadius: 32,
    padding: 24,
    paddingTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.6,
    shadowRadius: 25,
    elevation: 15,
  },
  dragHandle: {
    width: 40, height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 16 },
  offlineIconBox: {
    width: 54, height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  cardSubtitle: { color: MUTED, fontSize: 14, marginTop: 4, fontWeight: '500' },
  goBtn: {
    height: 64,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  goBtnText: { color: '#FFF', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },

  // Marker
  markerContainer: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#FFF',
  }
});
