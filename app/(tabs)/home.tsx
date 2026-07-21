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
  const [togglingOnline, setTogglingOnline] = useState(false);
  
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

  // Wait Time Logic
  const [isArrived, setIsArrived] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [destModalVisible, setDestModalVisible] = useState(false);
  const [destInput, setDestInput] = useState('');

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
    if (isArrived && !activeTrip?.started_at) {
      waitTimerRef.current = setInterval(() => {
        setWaitTime(prev => prev + 1);
      }, 1000);
    } else {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      setWaitTime(0);
    }
    return () => { if (waitTimerRef.current) clearInterval(waitTimerRef.current); };
  }, [isArrived, activeTrip?.started_at]);

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
          <TouchableOpacity style={[styles.notifCircle, dynamicStyles.badge]} onPress={() => setNotifOpen(true)}>
            <MaterialIcons name="notifications-none" size={26} color={themeColors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Interface */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 20 }]}>
        {/* Active Trip Navigation Card */}
        {activeTrip && (
          <View style={[styles.navCard, dynamicStyles.card]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.navTitle, dynamicStyles.text]}>Next: {activeTrip.started_at ? 'Dropoff' : 'Pickup'}</Text>
              <Text style={[styles.navSub, dynamicStyles.muted]} numberOfLines={1}>
                {activeTrip.started_at ? activeTrip.destination.address : activeTrip.pickup.address}
              </Text>
            </View>
            <TouchableOpacity 
              style={[styles.navBtn, { backgroundColor: BLUE }]}
              onPress={() => {
                const target = activeTrip.started_at ? activeTrip.destination : activeTrip.pickup;
                openNavigation(target.lat, target.lng, target.address);
              }}
            >
              <MaterialIcons name="navigation" size={24} color="#FFF" />
              <Text style={styles.navBtnText}>NAVIGATE</Text>
            </TouchableOpacity>
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
    </View>
  );
}

const BLUE = '#3B82F6';

const styles = StyleSheet.create({
  container: { flex: 1 },
  offlineBg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  largeLogo: { width: 100, height: 100, marginBottom: 20, opacity: 0.5 },
  offlineGreeting: { fontSize: 22, fontWeight: '900', marginBottom: 4 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 30, borderWidth: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { fontWeight: '800', fontSize: 14 },
  notifCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 10 },
  
  navCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 },
  navTitle: { fontSize: 16, fontWeight: '900' },
  navSub: { fontSize: 13, marginTop: 2 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 50, borderRadius: 12 },
  navBtnText: { color: '#FFF', fontWeight: '900', fontSize: 13 },

  destFilterBar: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1, gap: 12 },
  destText: { flex: 1, fontSize: 14, fontWeight: '700' },
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
  applyBtn: { height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  applyBtnText: { color: '#000', fontSize: 16, fontWeight: '800' }
});
