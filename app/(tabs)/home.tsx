import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES } from '@/constants/rides';
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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Colors } from '@/constants/theme';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';

const { width, height } = Dimensions.get('window');

// Custom Map Styles
const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#121212" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#121212" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#757575" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#3c3c3c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] }
];

const lightMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#f5f5f5" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#e9e9e9" }] }
];

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
  const [togglingOnline, setTogglingOnline] = useState(false);
  
  const [notifOpen, setNotifOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [destModalVisible, setDestModalVisible] = useState(false);
  const [destInput, setDestInput] = useState('');
  
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

  const handleSOS = () => {
    Alert.alert(
      "Emergency SOS",
      "This will alert HY3N security and share your live location. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "YES, ALERT SOS", style: "destructive", onPress: () => {
          // Logic to send SOS to backend/emergency contacts
          Alert.alert("SOS Sent", "Help is on the way. Stay calm.");
        }}
      ]
    );
  };

  const saveDestination = (dest: string) => {
    setPrefs({ ...prefs, destinationFilter: dest || null });
    setDestModalVisible(false);
  };

  const firstName = driverProfile?.full_name?.split(' ')[0] || 'Driver';

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

      {/* 1. CONDITIONAL MAP (Only shown when Online) */}
      {isOnline ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          customMapStyle={isDark ? darkMapStyle : lightMapStyle}
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
          <Text style={[styles.offlineGreeting, dynamicStyles.text]}>Hello, {firstName}!</Text>
          <Text style={[styles.offlineSub, dynamicStyles.muted]}>Ready to start your day?</Text>
        </View>
      )}

      {/* 2. HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.statusBadge, dynamicStyles.badge]}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? GREEN : themeColors.muted }]} />
          <Text style={[styles.statusText, dynamicStyles.text]}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {isOnline && (
            <TouchableOpacity style={[styles.notifCircle, { backgroundColor: RED, borderColor: RED }]} onPress={handleSOS}>
              <MaterialIcons name="emergency" size={24} color="#FFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.notifCircle, dynamicStyles.badge]} onPress={() => setNotifOpen(true)}>
            <MaterialIcons name="notifications-none" size={26} color={themeColors.text} />
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. SCROLLABLE CONTENT */}
      <ScrollView 
        style={styles.scroll} 
        contentContainerStyle={{ paddingTop: 120, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.onlineCard, dynamicStyles.card]}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, { backgroundColor: isOnline ? GREEN : themeColors.muted, transform: [{ scale: isOnline ? pulseAnim : 1 }] }]} />
            <View>
              <Text style={[styles.onlineStatus, dynamicStyles.text]}>{isOnline ? 'You are Online' : 'You are Offline'}</Text>
              <Text style={[styles.onlineSubtext, dynamicStyles.muted]}>{isOnline ? 'Accepting ride requests' : 'Tap to start accepting rides'}</Text>
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

        {/* Uber/Bolt Features Row */}
        {isOnline && (
          <View style={styles.featureRow}>
            <TouchableOpacity 
              style={[styles.featureCard, dynamicStyles.card]}
              onPress={() => togglePref('autoAccept')}
            >
              <MaterialIcons name={prefs.autoAccept ? "check-circle" : "radio-button-unchecked"} size={20} color={prefs.autoAccept ? GREEN : themeColors.muted} />
              <Text style={[styles.featureLabel, dynamicStyles.text]}>Auto Accept</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.featureCard, dynamicStyles.card]}
              onPress={() => setDestModalVisible(true)}
            >
              <MaterialIcons name="location-on" size={20} color={prefs.destinationFilter ? GOLD : themeColors.muted} />
              <Text style={[styles.featureLabel, dynamicStyles.text]}>
                {prefs.destinationFilter ? "Filter On" : "Set Destination"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!activeTrip && (
          <View style={styles.statsRow}>
            <View style={[styles.statItem, dynamicStyles.card]}>
              <Text style={[styles.statLabel, dynamicStyles.muted]}>Today's Trips</Text>
              <Text style={styles.statValue}>0</Text>
            </View>
            <View style={[styles.statItem, dynamicStyles.card]}>
              <Text style={[styles.statLabel, dynamicStyles.muted]}>Earnings</Text>
              <Text style={styles.statValue}>GH₵0.00</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Destination Filter Modal */}
      <Modal visible={destModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalContainer, dynamicStyles.container]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, dynamicStyles.text]}>Destination Filter</Text>
            <TouchableOpacity onPress={() => setDestModalVisible(false)}>
              <MaterialIcons name="close" size={24} color={themeColors.text} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.modalSub, dynamicStyles.muted]}>Only receive requests heading toward this area.</Text>
          
          <TextInput
            style={[styles.modalInput, { color: themeColors.text, borderColor: themeColors.border }]}
            placeholder="Enter area (e.g. East Legon)"
            placeholderTextColor={MUTED}
            value={destInput}
            onChangeText={setDestInput}
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: BORDER, flex: 1 }]}
              onPress={() => saveDestination('')}
            >
              <Text style={[styles.modalBtnText, { color: TEXT }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: GOLD, flex: 2 }]}
              onPress={() => saveDestination(destInput)}
            >
              <Text style={[styles.modalBtnText, { color: '#000' }]}>Apply Filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  container: { flex: 1 },
  offlineBg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  largeLogo: { width: 120, height: 120, marginBottom: 20, opacity: 0.8 },
  offlineGreeting: { fontSize: 24, fontWeight: '900' },
  offlineSub: { fontSize: 16, marginTop: 8 },

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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { fontWeight: '800', fontSize: 14 },
  notifCircle: {
    width: 46, height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  notifDot: {
    position: 'absolute', top: 12, right: 12,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: RED, borderWidth: 1.5, borderColor: '#FFF',
  },

  scroll: { flex: 1, zIndex: 10 },
  onlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 16,
    borderWidth: 1,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 15, flex: 1 },
  onlineDot: { width: 12, height: 12, borderRadius: 6 },
  onlineStatus: { fontSize: 18, fontWeight: '900' },
  onlineSubtext: { fontSize: 13, marginTop: 2 },
  toggleBtn: {
    paddingHorizontal: 20,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

  featureRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginBottom: 12 },
  featureCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  featureLabel: { fontSize: 14, fontWeight: '700' },

  statsRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16 },
  statItem: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  statLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { color: GOLD, fontSize: 18, fontWeight: '900', marginTop: 4 },

  markerContainer: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#FFF',
  },

  // Modal
  modalContainer: { flex: 1, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  modalSub: { fontSize: 14, marginBottom: 24 },
  modalInput: {
    height: 56,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 24,
  },
  modalBtn: {
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontSize: 16, fontWeight: '800' }
});
