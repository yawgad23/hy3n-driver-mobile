import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES, FREE_WAITING_MINUTES } from '@/constants/rides';
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
  
  // Wait Time Logic
  const [isArrived, setIsArrived] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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

  // Wait Timer Effect
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

  const formatWaitTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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

      {/* Conditional Map Background */}
      {isOnline ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: location?.coords.latitude || 5.6037,
            longitude: location?.coords.longitude || -0.1870,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          }}
          showsUserLocation={true}
          followsUserLocation={true}
        />
      ) : (
        <View style={styles.offlineBg}>
           <Image source={require('@/assets/images/icon.png')} style={styles.largeLogo} resizeMode="contain" />
           <Text style={[styles.offlineGreeting, dynamicStyles.text]}>HY3N Driver</Text>
           <Text style={dynamicStyles.muted}>Go online to start earning</Text>
        </View>
      )}

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.statusBadge, dynamicStyles.badge]}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? GREEN : themeColors.muted }]} />
          <Text style={[styles.statusText, dynamicStyles.text]}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>
      </View>

      {/* Bottom UI */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 20 }]}>
        {/* Wait Timer Card (Visible when arrived at pickup) */}
        {isArrived && (
          <View style={[styles.waitCard, dynamicStyles.card]}>
            <View>
              <Text style={[styles.waitLabel, dynamicStyles.text]}>Wait Time</Text>
              <Text style={[styles.waitValue, { color: waitTime > FREE_WAITING_MINUTES * 60 ? RED : GREEN }]}>
                {formatWaitTime(waitTime)}
              </Text>
            </View>
            <View style={styles.waitInfo}>
              <Text style={dynamicStyles.muted}>
                {waitTime > FREE_WAITING_MINUTES * 60 ? 'Charging for wait...' : 'Free wait time'}
              </Text>
            </View>
          </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  offlineBg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  largeLogo: { width: 100, height: 100, marginBottom: 20, opacity: 0.5 },
  offlineGreeting: { fontSize: 22, fontWeight: '900', marginBottom: 4 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, zIndex: 10 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 30, borderWidth: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { fontWeight: '800', fontSize: 14 },
  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 12 },
  waitCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1 },
  waitLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  waitValue: { fontSize: 24, fontWeight: '900' },
  waitInfo: { alignItems: 'flex-end' },
  onlineCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 20, padding: 16, borderWidth: 1 },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  onlineStatus: { fontSize: 16, fontWeight: '900' },
  toggleBtn: { paddingHorizontal: 20, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toggleBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
