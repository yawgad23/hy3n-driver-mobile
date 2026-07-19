import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as ExpoLocation from 'expo-location';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';
import { RIDE_CATEGORIES, FREE_WAITING_MINUTES } from '@/constants/rides';
import { trpc } from '@/lib/trpc';
import { getApiBaseUrl } from '@/constants/oauth';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Dimensions, Alert, ActivityIndicator, Animated, Image, Platform,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import { RideChatModal, useUnreadChatCount } from '@/components/ride-chat-modal';
import { useVoiceCall } from '@/hooks/use-voice-call';
import { InCallScreen, IncomingCallModal } from '@/components/in-call-screen';

// ─── Navigation helper ────────────────────────────────────────────────────────
const openNavigation = (location: { name: string; address: string; lat?: number; lng?: number } | string) => {
  let lat: number | undefined, lng: number | undefined, label = '';
  if (typeof location === 'object') { lat = location.lat; lng = location.lng; label = location.name || location.address || ''; }
  else { label = location; }
  const encodedLabel = encodeURIComponent(label);
  if (lat && lng) {
    const googleUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
    const appleMapsUrl = `maps://?daddr=${lat},${lng}`;
    const googleWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    if (Platform.OS === 'ios') {
      Linking.canOpenURL(googleUrl).then(s => Linking.openURL(s ? googleUrl : appleMapsUrl));
    } else {
      Linking.canOpenURL('comgooglemaps://').then(s => Linking.openURL(s ? googleUrl : googleWebUrl));
    }
  } else {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedLabel}`);
  }
};

// ─── High-risk area detection ─────────────────────────────────────────────────
const HIGH_RISK_KEYWORDS = [
  'Nima', 'Mamobi', 'Agbogbloshie', 'Sabon Zongo', 'Darkuman', 'Chorkor',
  'Bukom', 'Ussher', 'James Town', 'Jamestown', 'Adabraka Night',
  'Ashaiman', 'Avenor', 'Alajo', 'Kotobabi', 'Abeka',
];
function getAreaAlert(address?: string) {
  if (!address) return null;
  const lower = address.toLowerCase();
  return HIGH_RISK_KEYWORDS.find(k => lower.includes(k.toLowerCase())) || null;
}

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const SCREEN_HEIGHT = Dimensions.get('window').height;

interface RideRequest {
  id: string;
  rider_name?: string;
  passenger_name?: string;
  rider_phone?: string;
  rider_rating?: number;
  pickup: { name: string; address: string; lat?: number; lng?: number } | string;
  pickup_address?: string;
  destination: { name: string; address: string; lat?: number; lng?: number } | string;
  destination_address?: string;
  fare: number;
  fare_estimate?: number;
  distance?: number;
  distance_km?: number;
  duration?: number;
  duration_min?: number;
  duration_minutes?: number;
  status: string;
  category?: string;
  ride_pin?: string;
  driver_id?: string;
  declined_by?: string[];
  created_at?: string;
  created_date?: string;
}

interface ActiveTrip {
  id: string;
  rider_name?: string;
  passenger_name?: string;
  rider_phone?: string;
  pickup: { name: string; address: string } | string;
  destination: { name: string; address: string } | string;
  fare: number;
  status: string;
  ride_pin?: string;
  distance_km?: number;
  distance?: number;
  duration_min?: number;
  duration_minutes?: number;
  duration?: number;
  category?: string;
}

// ─── Notification Center Modal ────────────────────────────────────────────────
function NotificationCenter({ visible, onClose, driverId }: { visible: boolean; onClose: () => void; driverId: string }) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const TYPE_ICON: Record<string, { icon: string; color: string }> = {
    ride_completed:      { icon: 'check-circle',  color: GREEN },
    ride_cancelled:      { icon: 'cancel',         color: RED  },
    commission_paid:     { icon: 'credit-card',    color: GREEN },
    commission_rejected: { icon: 'error',          color: RED  },
    commission_pending:  { icon: 'access-time',    color: GOLD },
    rating_received:     { icon: 'star',           color: GOLD },
    support_reply:       { icon: 'info',           color: '#3B82F6' },
    approval_approved:   { icon: 'verified',       color: GREEN },
    approval_rejected:   { icon: 'cancel',         color: RED  },
    general:             { icon: 'notifications',  color: GOLD },
  };

  const buildFromFirestore = async () => {
    try {
      // Primary: read from notifications + push_notifications collections
      const [notifDocs, pushDocs] = await Promise.all([
        firestoreDB.list('notifications', { user_id: driverId }).catch(() => [] as any[]),
        firestoreDB.list('push_notifications', { user_id: driverId }).catch(() => [] as any[]),
      ]);
      const merged = [...notifDocs, ...pushDocs];
      if (merged.length > 0) {
        const sorted = merged.sort((a: any, b: any) =>
          (b.created_date || '').localeCompare(a.created_date || '')
        ).slice(0, 50);
        setNotifications(sorted);
        return;
      }
    } catch {}

    // Fallback: build from rides + commission records
    try {
      const [rides, commissions] = await Promise.all([
        firestoreDB.list(COLLECTIONS.RIDES, { driver_id: driverId }),
        firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId }).catch(() => [] as any[]),
      ]);

      const rideNotifs = rides
        .filter((r: any) => r.status === 'completed' || r.status === 'cancelled')
        .sort((a: any, b: any) => (b.completed_at || b.created_date || '').localeCompare(a.completed_at || a.created_date || ''))
        .slice(0, 15)
        .map((r: any) => ({
          id: `ride_${r.id}`,
          type: r.status === 'completed' ? 'ride_completed' : 'ride_cancelled',
          title: r.status === 'completed' ? 'Trip Completed' : 'Trip Cancelled',
          body: r.status === 'completed'
            ? `Trip to ${r.destination_address || r.destination || 'destination'} completed. Fare: GH₵${r.fare || r.fare_estimate || '—'}`
            : `Trip to ${r.destination_address || r.destination || 'destination'} was cancelled.`,
          created_date: r.completed_at || r.cancelled_at || r.created_date,
          read: true,
        }));

      const commissionNotifs = (commissions as any[]).slice(0, 10).map((c: any) => ({
        id: `comm_${c.id}`,
        type: c.status === 'confirmed' ? 'commission_paid' : c.status === 'rejected' ? 'commission_rejected' : 'commission_pending',
        title: c.status === 'confirmed' ? 'Commission Confirmed' : c.status === 'rejected' ? 'Commission Rejected' : 'Commission Pending',
        body: c.status === 'confirmed'
          ? `Your GH₵${c.amount || 50} daily commission was confirmed. You're ready to go!`
          : c.status === 'rejected'
          ? 'Your commission payment was rejected. Please resubmit with the correct reference.'
          : `Your GH₵${c.amount || 50} commission is awaiting admin confirmation.`,
        created_date: c.created_date || c.submitted_at,
        read: c.status !== 'pending',
      }));

      const all = [...rideNotifs, ...commissionNotifs].sort((a, b) =>
        (b.created_date || '').localeCompare(a.created_date || '')
      );
      setNotifications(all);
    } catch {}
  };

  useEffect(() => {
    if (!visible || !driverId) return;
    setLoading(true);
    buildFromFirestore().finally(() => setLoading(false));
  }, [visible, driverId]);

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.read && !n.id.startsWith('ride_') && !n.id.startsWith('comm_'));
    for (const n of unread) {
      try { await firestoreDB.update('notifications', n.id, { read: true }); } catch {}
    }
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const formatAgo = (iso?: string) => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={notifStyles.container}>
        <View style={notifStyles.header}>
          <MaterialIcons name="notifications" size={22} color={GOLD} />
          <Text style={notifStyles.title}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={notifStyles.unreadBadge}>
              <Text style={notifStyles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead} style={notifStyles.markReadBtn}>
              <Text style={notifStyles.markReadText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={notifStyles.closeBtn}>
            <MaterialIcons name="close" size={22} color={TEXT} />
          </TouchableOpacity>
        </View>
        {loading ? (
          <View style={notifStyles.center}>
            <ActivityIndicator size="large" color={GOLD} />
          </View>
        ) : notifications.length === 0 ? (
          <View style={notifStyles.center}>
            <MaterialIcons name="notifications-none" size={56} color={MUTED} />
            <Text style={notifStyles.emptyTitle}>No notifications yet</Text>
            <Text style={notifStyles.emptyText}>Trip updates, commission status, and ratings will appear here.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {notifications.map(n => {
              const cfg = TYPE_ICON[n.type] || TYPE_ICON.general;
              return (
                <View key={n.id} style={[notifStyles.item, !n.read && notifStyles.itemUnread]}>
                  <View style={[notifStyles.iconBox, { backgroundColor: cfg.color + '20' }]}>
                    <MaterialIcons name={cfg.icon as any} size={22} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[notifStyles.itemTitle, !n.read && { color: TEXT }]}>{n.title}</Text>
                    {n.body && <Text style={notifStyles.itemBody}>{n.body}</Text>}
                    {n.created_date && <Text style={notifStyles.itemTime}>{formatAgo(n.created_date)}</Text>}
                  </View>
                  {!n.read && <View style={notifStyles.unreadDot} />}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─── Post-Trip Summary Dialog ─────────────────────────────────────────────────
function TripSummaryModal({
  visible,
  onClose,
  trip,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  trip: ActiveTrip | null;
  onSubmit: (data: { rating: number; remarks: string; foundItem: boolean; itemDescription: string }) => void;
}) {
  const [rating, setRating] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [foundItem, setFoundItem] = useState(false);
  const [itemDescription, setItemDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const RIDER_TAGS = ['Friendly', 'Ready on time', 'Good communication', 'Clean entry', 'Polite', 'No issues'];

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please rate the passenger before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const fullRemarks = [remarks.trim(), ...selectedTags].filter(Boolean).join(' · ');
      await onSubmit({ rating, remarks: fullRemarks, foundItem, itemDescription: foundItem ? itemDescription : '' });
      setRating(0); setRemarks(''); setSelectedTags([]); setFoundItem(false); setItemDescription('');
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const passengerName = trip?.rider_name || trip?.passenger_name || 'Rider';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={summaryStyles.container}>
          <View style={summaryStyles.header}>
            <MaterialIcons name="check-circle" size={24} color={GREEN} />
            <Text style={summaryStyles.title}>Trip Summary & Feedback</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }}>
            {/* Trip details */}
            <View style={summaryStyles.tripCard}>
              <Text style={summaryStyles.sectionLabel}>Trip Completed</Text>
              <Text style={summaryStyles.fareText}>GH₵{trip?.fare?.toFixed(2) || '0.00'}</Text>
              <Text style={summaryStyles.riderText}>{passengerName}</Text>
            </View>

            {/* Rate Passenger */}
            <View style={summaryStyles.section}>
              <Text style={summaryStyles.sectionLabel}>Rate Passenger</Text>
              <Text style={summaryStyles.sectionDesc}>How was {passengerName}?</Text>
              <View style={summaryStyles.starsRow}>
                {[1, 2, 3, 4, 5].map(star => (
                  <TouchableOpacity key={star} onPress={() => setRating(star)} activeOpacity={0.7}>
                    <MaterialIcons
                      name={star <= rating ? 'star' : 'star-border'}
                      size={40}
                      color={star <= rating ? GOLD : MUTED}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              {/* Quick tags */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 2 }}>
                  {RIDER_TAGS.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        onPress={() => setSelectedTags(prev => active ? prev.filter(t => t !== tag) : [...prev, tag])}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: active ? `${GOLD}22` : '#1A1A1A', borderWidth: 1, borderColor: active ? GOLD : BORDER }}
                      >
                        <Text style={{ color: active ? GOLD : TEXT, fontSize: 13, fontWeight: active ? '600' : '400' }}>{tag}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <TextInput
                style={[summaryStyles.remarksInput, { marginTop: 12 }]}
                placeholder="Optional remarks about the passenger..."
                placeholderTextColor={MUTED}
                value={remarks}
                onChangeText={setRemarks}
                multiline
                numberOfLines={3}
                maxLength={200}
              />
            </View>

            {/* Found Item */}
            <View style={summaryStyles.section}>
              <View style={summaryStyles.foundItemRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MaterialIcons name="inventory-2" size={20} color={MUTED} />
                  <Text style={summaryStyles.foundItemLabel}>Found an item in your vehicle?</Text>
                </View>
                <TouchableOpacity
                  style={[summaryStyles.foundItemBtn, foundItem && { backgroundColor: GOLD }]}
                  onPress={() => setFoundItem(p => !p)}
                >
                  <Text style={[summaryStyles.foundItemBtnText, foundItem && { color: '#000' }]}>
                    {foundItem ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              </View>
              {foundItem && (
                <TextInput
                  style={[summaryStyles.remarksInput, { marginTop: 10 }]}
                  placeholder="Describe the item (e.g. Black wallet, phone charger)..."
                  placeholderTextColor={MUTED}
                  value={itemDescription}
                  onChangeText={setItemDescription}
                  multiline
                  numberOfLines={2}
                  maxLength={300}
                />
              )}
            </View>
          </ScrollView>

          <View style={summaryStyles.footer}>
            <TouchableOpacity
              style={[summaryStyles.submitBtn, (rating === 0 || submitting) && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={rating === 0 || submitting}
              activeOpacity={0.85}
            >
              {submitting ? <ActivityIndicator size="small" color="#000" /> : null}
              <Text style={summaryStyles.submitBtnText}>
                {submitting ? 'Submitting...' : 'Submit & Finish Trip'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function DriverHomeScreen() {
  const { driverProfile, user, updateDriverProfile } = useDriverAuth();
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(driverProfile?.is_online || false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState<RideRequest | null>(null);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todayTrips, setTodayTrips] = useState(0);
  const [countdown, setCountdown] = useState(20);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [completedTrip, setCompletedTrip] = useState<ActiveTrip | null>(null);
  const unreadCount = useUnreadChatCount(activeTrip?.id || null, user?.uid || '', 'driver');
  const { prefs } = useDriverPreferences();
  const [driverDestination, setDriverDestination] = useState<string>('');
  const [destModalVisible, setDestModalVisible] = useState(false);
  const [destInput, setDestInput] = useState('');
  const [destSuggestions, setDestSuggestions] = useState<any[]>([]);
  const destDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [acceptedCategories, setAcceptedCategories] = useState<string[]>([]);
  const [catModalVisible, setCatModalVisible] = useState(false);
  // ─── Waiting Timer ────────────────────────────────────────────────────────────
  const [waitSeconds, setWaitSeconds] = useState(0);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrivedAtRef = useRef<number | null>(null);
  const locationSubRef = useRef<ExpoLocation.LocationSubscription | null>(null);

  // ─── Voice Call ───────────────────────────────────────────────────────────────
  const riderName = activeTrip?.rider_name || activeTrip?.passenger_name || 'Rider';
  const riderPhone = (activeTrip as any)?.rider_phone || (activeTrip as any)?.passenger_phone;
  const riderId = (activeTrip as any)?.rider_id || (activeTrip as any)?.passenger_id;
  const call = useVoiceCall({
    rideId: activeTrip?.id,
    myId: user?.uid,
    myName: driverProfile?.full_name || 'Driver',
    myRole: 'driver',
    otherName: riderName,
  });

  const handleCallRider = () => {
    if (!activeTrip) return;
    if (riderId) {
      call.startCall(riderId);
    } else if (riderPhone) {
      Linking.openURL(`tel:${riderPhone}`);
    }
  };

  // Load persisted destination and categories on mount
  useEffect(() => {
    import('@react-native-async-storage/async-storage').then(({ default: AS }) => {
      AS.getItem('hy3n_driver_destination').then(v => { if (v) setDriverDestination(v); }).catch(() => {});
      AS.getItem('hy3n_driver_categories').then(v => {
        if (v) { try { setAcceptedCategories(JSON.parse(v)); } catch {} }
        else if (driverProfile?.accepted_categories?.length) { setAcceptedCategories(driverProfile.accepted_categories); }
      }).catch(() => {});
    });
  }, []);
  const saveCategories = async (cats: string[]) => {
    const { default: AS } = await import('@react-native-async-storage/async-storage');
    setAcceptedCategories(cats);
    await AS.setItem('hy3n_driver_categories', JSON.stringify(cats));
    if (driverProfile?.id) {
      firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, { accepted_categories: cats }).catch(() => {});
    }
  };
  // Category compatibility matrix
  const isKantanka = (driverProfile?.vehicle_make || '').toLowerCase().includes('kantanka');
  const serviceType = driverProfile?.service_type || 'car';
  const allowedCategories: string[] = isKantanka
    ? ['standard', 'comfort', 'kantanka', 'executive', 'okada', 'express_delivery']
    : serviceType === 'okada'
    ? ['okada']
    : serviceType === 'delivery'
    ? ['express_delivery']
    : ['standard', 'comfort', 'executive']; // regular car: comfort can also do standard

  const saveDestination = async (dest: string) => {
    const { default: AS } = await import('@react-native-async-storage/async-storage');
    if (dest.trim()) {
      await AS.setItem('hy3n_driver_destination', dest.trim());
      setDriverDestination(dest.trim());
    } else {
      await AS.removeItem('hy3n_driver_destination');
      setDriverDestination('');
    }
  };

  // Fetch live Google Places suggestions for Driver Destination
  useEffect(() => {
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
    if (!destInput || destInput.trim().length < 2) {
      setDestSuggestions([]);
      return;
    }
    // Don't fetch if the input exactly matches the currently saved destination (meaning they just opened the modal)
    if (destInput === driverDestination) return;
    
    destDebounceRef.current = setTimeout(async () => {
      try {
        const base = getApiBaseUrl();
        const url = `${base}/api/places/autocomplete?input=${encodeURIComponent(destInput)}`;
        const res = await fetch(url);
        const data = await res.json() as { predictions: any[] };
        const mapped = (data.predictions || []).map((p: any) => ({
          name: p.structured_formatting?.main_text || p.description,
          address: p.structured_formatting?.secondary_text || p.description,
        }));
        setDestSuggestions(mapped);
      } catch {
        setDestSuggestions([]);
      }
    }, 350);
  }, [destInput, driverDestination]);

  // Waiting timer: starts when driver arrives at pickup, counts billable minutes after 3 free
  useEffect(() => {
    if (activeTrip?.status === 'driver_arrived') {
      if (!arrivedAtRef.current) arrivedAtRef.current = Date.now();
      waitTimerRef.current = setInterval(() => {
        setWaitSeconds(Math.floor((Date.now() - (arrivedAtRef.current || Date.now())) / 1000));
      }, 1000);
    } else {
      if (waitTimerRef.current) { clearInterval(waitTimerRef.current); waitTimerRef.current = null; }
      if (activeTrip?.status !== 'driver_arrived') { arrivedAtRef.current = null; setWaitSeconds(0); }
    }
    return () => { if (waitTimerRef.current) { clearInterval(waitTimerRef.current); waitTimerRef.current = null; } };
  }, [activeTrip?.status]);

  const freeWaitSecs = FREE_WAITING_MINUTES * 60;
  const billableWaitMins = Math.max(0, (waitSeconds - freeWaitSecs) / 60);
  const waitingFeePerMin = RIDE_CATEGORIES.find(c => c.id === activeTrip?.category)?.waitingFeePerMin ?? 0.55;
  const currentWaitingFee = parseFloat((billableWaitMins * waitingFeePerMin).toFixed(2));

  // Pulse animation for online indicator
  useEffect(() => {
    if (isOnline) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isOnline]);

  // Listen for incoming ride requests when online
  useEffect(() => {
    if (!isOnline || !user) return;
    const unsubscribe = firestoreDB.subscribe(
      COLLECTIONS.RIDES,
      { status: 'searching' },
      (rides: any[]) => {
        const driverId = user.uid;
        const pending = rides.find((r: any) => {
          if (r.driver_id && r.driver_id !== driverId) return false;
          if (Array.isArray(r.declined_by) && r.declined_by.includes(driverId)) return false;
          if (!r.status || r.status !== 'searching') return false;
          // Long-trips-only filter: skip rides under 10 km
          if (prefs.longTripsOnly) {
            const dist = r.distance_km || r.distance || 0;
            if (dist > 0 && dist < 10) return false;
          }
          // Category filter: only show rides matching driver's accepted categories
          if (acceptedCategories.length > 0) {
            const rideCategory = (r.category || r.categoryId || '').toLowerCase();
            if (rideCategory && !acceptedCategories.includes(rideCategory)) return false;
          }
          // Set Destination filter: only show rides heading toward driver's chosen area
          if (driverDestination) {
            const dest = (
              r.destination_address ||
              (typeof r.destination === 'object' ? r.destination?.address || r.destination?.name : r.destination) ||
              ''
            ).toLowerCase();
            if (dest && !dest.includes(driverDestination.toLowerCase())) return false;
          }
          return true;
        });
        if (pending && !activeTrip) {
          setIncomingRequest(pending as RideRequest);
          setCountdown(20);
        }
      }
    );
    return unsubscribe;
  }, [isOnline, user, activeTrip]);

  // Auto-Accept: when preference is on and a request arrives, accept after a 3s grace period
  const autoAcceptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoAcceptTimerRef.current) clearTimeout(autoAcceptTimerRef.current);
    if (incomingRequest && prefs.autoAccept && !activeTrip) {
      autoAcceptTimerRef.current = setTimeout(() => {
        handleAcceptRide();
      }, 3000); // 3-second grace so driver can still manually decline
    }
    return () => { if (autoAcceptTimerRef.current) clearTimeout(autoAcceptTimerRef.current); };
  }, [incomingRequest?.id, prefs.autoAccept]);

  // Countdown timer for ride request
  useEffect(() => {
    if (!incomingRequest) { if (countdownRef.current) clearInterval(countdownRef.current); return; }
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          setIncomingRequest(null);
          return 20;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [incomingRequest]);

  // ETA location tracking: when driver has an active trip heading to pickup, watch GPS and write
  // current_lat/current_lng + eta_seconds to the ride doc every 15 seconds
  useEffect(() => {
    const isHeadingToPickup = activeTrip?.status === 'driver_arriving';
    if (!isHeadingToPickup || !activeTrip?.id) {
      if (locationSubRef.current) { locationSubRef.current.remove(); locationSubRef.current = null; }
      return;
    }
    let lastWrite = 0;
    ExpoLocation.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      ExpoLocation.watchPositionAsync(
        { accuracy: ExpoLocation.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 20 },
        (pos) => {
          const now = Date.now();
          if (now - lastWrite < 15000) return; // throttle to every 15s
          lastWrite = now;
          const { latitude, longitude } = pos.coords;
          // Estimate ETA: haversine distance to pickup, assume 30 km/h avg speed in city
          const pickupLat = typeof activeTrip.pickup === 'object' ? (activeTrip.pickup as any).lat : null;
          const pickupLng = typeof activeTrip.pickup === 'object' ? (activeTrip.pickup as any).lng : null;
          let etaSeconds: number | undefined;
          if (pickupLat && pickupLng) {
            const R = 6371000;
            const dLat = (pickupLat - latitude) * Math.PI / 180;
            const dLng = (pickupLng - longitude) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(latitude * Math.PI/180) * Math.cos(pickupLat * Math.PI/180) * Math.sin(dLng/2)**2;
            const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            etaSeconds = Math.round(distM / (30000/3600)); // 30 km/h
          }
          const update: any = { driver_current_lat: latitude, driver_current_lng: longitude };
          if (etaSeconds !== undefined) update.eta_seconds = etaSeconds;
          firestoreDB.update(COLLECTIONS.RIDES, activeTrip.id, update).catch(() => {});
        }
      ).then(sub => { locationSubRef.current = sub; }).catch(() => {});
    });
    return () => { if (locationSubRef.current) { locationSubRef.current.remove(); locationSubRef.current = null; } };
  }, [activeTrip?.status, activeTrip?.id]);

  // Load today's earnings
  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    firestoreDB.list(COLLECTIONS.RIDES, { driver_id: user.uid, status: 'completed' }).then((rides: any[]) => {
      const todayRides = rides.filter(r => (r.created_date || '').startsWith(today));
      setTodayTrips(todayRides.length);
      setTodayEarnings(todayRides.reduce((sum: number, r: any) => sum + (r.fare || 0), 0));
    }).catch(() => {});
  }, [user, activeTrip]);

  const handleToggleOnline = async () => {
    if (!driverProfile) {
      Alert.alert('Profile Incomplete', 'Your driver profile is not set up yet. Please complete registration.');
      return;
    }
    if (driverProfile.approval_status !== 'approved') {
      Alert.alert(
        'Application Pending',
        driverProfile.approval_status === 'rejected'
          ? 'Your application was rejected. Please contact support at hello@ridehy3n.com'
          : 'Your driver application is under review. You\'ll be notified once approved.',
        [{ text: 'OK' }]
      );
      return;
    }
    setTogglingOnline(true);
    try {
      const newStatus = !isOnline;
      await updateDriverProfile({ is_online: newStatus, is_available: newStatus });
      setIsOnline(newStatus);
      if (!newStatus) setIncomingRequest(null);
      // When going online, write current GPS location so riders can see nearby cars
      if (newStatus && driverProfile?.id) {
        try {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
            firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, {
              current_lat: pos.coords.latitude,
              current_lng: pos.coords.longitude,
            }).catch(() => {});
          }
        } catch {
          // GPS unavailable — location will update when driver accepts a trip
        }
      }
    } catch {
      Alert.alert('Error', 'Failed to update status. Please try again.');
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleAcceptRide = async () => {
    if (!incomingRequest || !user) return;
    const now = new Date().toISOString();
    try {
      await firestoreDB.update(COLLECTIONS.RIDES, incomingRequest.id, {
        driver_id: user.uid,
        driver_name: driverProfile?.full_name || 'Driver',
        driver_phone: driverProfile?.phone || '',
        driver_vehicle: driverProfile?.vehicle_make && driverProfile?.vehicle_model
          ? `${driverProfile.vehicle_make} ${driverProfile.vehicle_model}`
          : '',
        driver_plate: driverProfile?.vehicle_plate || '',
        status: 'driver_arriving',
        matched_at: now,
        driver_accepted_at: now,
      });
      // Mark driver as unavailable so matching engine skips them
      if (driverProfile?.id) {
        firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, { is_available: false }).catch(() => {});
      }
      setActiveTrip({ ...incomingRequest, status: 'driver_arriving' });
      setIncomingRequest(null);
    } catch {
      Alert.alert('Error', 'Could not accept ride. Please try again.');
    }
  };

  const handleDeclineRide = async () => {
    if (!incomingRequest || !user) return;
    const driverId = user.uid;
    try {
      const existing = Array.isArray(incomingRequest.declined_by) ? incomingRequest.declined_by : [];
      await firestoreDB.update(COLLECTIONS.RIDES, incomingRequest.id, {
        status: 'searching',
        driver_id: null,
        pending_driver_at: null,
        declined_by: [...existing, driverId],
      });
    } catch { /* best effort */ }
    setIncomingRequest(null);
  };

  const getLocationName = (loc: { name: string; address: string } | string): string => {
    if (typeof loc === 'string') return loc;
    return loc.name || loc.address || 'Unknown';
  };

  const getPickupAddress = (req: RideRequest): string => {
    if (typeof req.pickup === 'object') return req.pickup.address || req.pickup.name || '';
    return req.pickup_address || req.pickup || '';
  };

  const sendReceiptMutation = trpc.trips.sendReceipt.useMutation();

  const handleTripAction = async (action: 'pickup' | 'start' | 'complete') => {
    if (!activeTrip) return;
    const statusMap = { pickup: 'driver_arrived', start: 'in_progress', complete: 'completed' };
    try {
      const completedAt = new Date().toISOString();
      const extra: any = {};
      if (action === 'start') extra.started_at = completedAt;
      if (action === 'complete') {
        extra.completed_at = completedAt;
        // Save waiting fee calculated from the live timer
        if (currentWaitingFee > 0) extra.waiting_fee = currentWaitingFee;
      }
      await firestoreDB.update(COLLECTIONS.RIDES, activeTrip.id, { status: statusMap[action], ...extra });
      if (action === 'complete') {
        // Re-mark driver as available
        if (driverProfile?.id) {
          firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, { is_available: true }).catch(() => {});
        }
        // Send receipt email to rider (best-effort, non-blocking)
        const riderEmail = (activeTrip as any).rider_email || (activeTrip as any).passenger_email;
        if (riderEmail) {
          sendReceiptMutation.mutate({
            riderEmail,
            riderName: activeTrip.rider_name || activeTrip.passenger_name || 'Rider',
            driverName: driverProfile?.full_name || 'Driver',
            driverVehicle: driverProfile?.vehicle_make && driverProfile?.vehicle_model
              ? `${driverProfile.vehicle_make} ${driverProfile.vehicle_model}`
              : driverProfile?.vehicle_make || 'Vehicle',
            driverPlate: driverProfile?.vehicle_plate || '',
            pickup: typeof activeTrip.pickup === 'object'
              ? activeTrip.pickup.address || activeTrip.pickup.name || ''
              : (activeTrip as any).pickup_address || activeTrip.pickup || '',
            destination: typeof activeTrip.destination === 'object'
              ? activeTrip.destination.address || activeTrip.destination.name || ''
              : (activeTrip as any).destination_address || activeTrip.destination || '',
            fare: activeTrip.fare,
            paymentMethod: (activeTrip as any).payment_method || 'cash',
            distance: activeTrip.distance_km || activeTrip.distance,
            duration: activeTrip.duration_min || activeTrip.duration_minutes || activeTrip.duration,
            category: activeTrip.category,
            tripId: activeTrip.id,
            completedAt,
          });
        }
        setTodayEarnings(prev => prev + activeTrip.fare);
        setTodayTrips(prev => prev + 1);
        setCompletedTrip(activeTrip);
        setActiveTrip(null);
        setSummaryVisible(true);
      } else {
        setActiveTrip(prev => prev ? { ...prev, status: statusMap[action] } : null);
      }
    } catch {
      Alert.alert('Error', 'Failed to update trip status.');
    }
  };

  const handleSummarySubmit = async (data: { rating: number; remarks: string; foundItem: boolean; itemDescription: string }) => {
    if (!completedTrip) return;
    await firestoreDB.update(COLLECTIONS.RIDES, completedTrip.id, {
      passenger_rating: data.rating,
      driver_remarks: data.remarks,
      found_item: data.foundItem,
      found_item_description: data.itemDescription || null,
    });
    if (data.foundItem && data.itemDescription) {
      await firestoreDB.create(COLLECTIONS.RIDE_REPORTS, {
        ride_id: completedTrip.id,
        driver_id: user?.uid,
        report_type: 'found_item',
        description: data.itemDescription,
        status: 'open',
        created_date: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Maakye 🌅';
    if (h < 17) return 'Maaha ☀️';
    return 'Maadwo 🌙';
  };

  const firstName = driverProfile?.full_name?.split(' ')[0] || 'Driver';
  const driverId = (driverProfile as any)?.user_id || user?.uid || '';

  // High-risk area alert for incoming request
  const pickupAddress = incomingRequest ? getPickupAddress(incomingRequest) : '';
  const areaAlert = getAreaAlert(pickupAddress);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
          <View>
            <Text style={styles.greeting}>{getGreeting()}, {firstName}! 👋</Text>
            <Text style={styles.subGreeting}>Wo ho te sɛn?</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.notifBtn} onPress={() => setNotifOpen(true)}>
          <MaterialIcons name="notifications-none" size={24} color={TEXT} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Online/Offline Toggle */}
        <View style={styles.onlineCard}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, { backgroundColor: isOnline ? GREEN : MUTED, transform: [{ scale: isOnline ? pulseAnim : 1 }] }]} />
            <View>
              <Text style={styles.onlineStatus}>{isOnline ? 'You are Online' : 'You are Offline'}</Text>
              <Text style={styles.onlineSubtext}>{isOnline ? 'Accepting ride requests' : 'Tap to start accepting rides'}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: isOnline ? RED : GREEN }, togglingOnline && { opacity: 0.7 }]}
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

        {/* Set Destination Card */}
        {isOnline && !activeTrip && (
          <View style={styles.destCard}>
            <View style={styles.destCardLeft}>
              <MaterialIcons name="flag" size={18} color={driverDestination ? GOLD : MUTED} />
              <View style={{ flex: 1 }}>
                <Text style={styles.destCardLabel}>Set Destination</Text>
                {driverDestination ? (
                  <Text style={styles.destCardValue} numberOfLines={1}>{driverDestination}</Text>
                ) : (
                  <Text style={styles.destCardPlaceholder}>Filter rides by destination area</Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {driverDestination && (
                <TouchableOpacity
                  style={styles.destClearBtn}
                  onPress={() => saveDestination('')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="close" size={16} color={MUTED} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.destSetBtn, driverDestination && { backgroundColor: GOLD + '20', borderColor: GOLD }]}
                onPress={() => { setDestInput(driverDestination); setDestModalVisible(true); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.destSetBtnText, driverDestination && { color: GOLD }]}>
                  {driverDestination ? 'Change' : 'Set'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Ride Category Selector Card */}
        {isOnline && !activeTrip && (
          <View style={styles.destCard}>
            <View style={styles.destCardLeft}>
              <MaterialIcons name="category" size={18} color={acceptedCategories.length > 0 ? GOLD : MUTED} />
              <View style={{ flex: 1 }}>
                <Text style={styles.destCardLabel}>Ride Categories</Text>
                {acceptedCategories.length > 0 ? (
                  <Text style={styles.destCardValue} numberOfLines={1}>
                    {acceptedCategories.map(id => RIDE_CATEGORIES.find(c => c.id === id)?.name || id).join(', ')}
                  </Text>
                ) : (
                  <Text style={styles.destCardPlaceholder}>All categories (tap to restrict)</Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {acceptedCategories.length > 0 && (
                <TouchableOpacity style={styles.destClearBtn} onPress={() => saveCategories([])} activeOpacity={0.7}>
                  <MaterialIcons name="close" size={16} color={MUTED} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.destSetBtn, acceptedCategories.length > 0 && { backgroundColor: GOLD + '20', borderColor: GOLD }]}
                onPress={() => setCatModalVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.destSetBtnText, acceptedCategories.length > 0 && { color: GOLD }]}>Choose</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {/* Category Selector Modal */}
        <Modal visible={catModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCatModalVisible(false)}>
          <View style={styles.destModal}>
            <View style={styles.destModalHeader}>
              <MaterialIcons name="category" size={22} color={GOLD} />
              <Text style={styles.destModalTitle}>Ride Categories</Text>
              <TouchableOpacity onPress={() => setCatModalVisible(false)}>
                <MaterialIcons name="close" size={22} color={MUTED} />
              </TouchableOpacity>
            </View>
            <Text style={styles.destModalDesc}>
              {isKantanka
                ? 'Your Kantanka vehicle can work under all categories.'
                : serviceType === 'okada'
                ? 'Okada vehicles work under the Okada category only.'
                : serviceType === 'delivery'
                ? 'Delivery vehicles work under Express Delivery only.'
                : 'Select the categories you want to accept. Comfort vehicles can also do Standard rides.'}
            </Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {RIDE_CATEGORIES.filter(cat => allowedCategories.includes(cat.id)).map(cat => {
                const isSelected = acceptedCategories.includes(cat.id);
                const toggle = () => {
                  setAcceptedCategories(prev =>
                    prev.includes(cat.id) ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                  );
                };
                return (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={toggle}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 14,
                      paddingVertical: 14, paddingHorizontal: 4,
                      borderBottomWidth: 0.5, borderBottomColor: BORDER,
                    }}
                  >
                    <View style={{
                      width: 24, height: 24, borderRadius: 6, borderWidth: 2,
                      borderColor: isSelected ? GOLD : BORDER,
                      backgroundColor: isSelected ? GOLD : 'transparent',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSelected && <MaterialIcons name="check" size={14} color="#000" />}
                    </View>
                    <MaterialIcons name={cat.icon as any} size={20} color={isSelected ? GOLD : MUTED} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: isSelected ? TEXT : MUTED, fontWeight: '700', fontSize: 14 }}>{cat.name}</Text>
                      <Text style={{ color: MUTED, fontSize: 12, marginTop: 1 }}>{cat.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={[styles.destModalActions, { marginTop: 16 }]}>
              <TouchableOpacity
                style={[styles.destModalBtn, { backgroundColor: '#1A1A1A', borderColor: BORDER }]}
                onPress={() => { setAcceptedCategories([]); saveCategories([]); setCatModalVisible(false); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.destModalBtnText, { color: MUTED }]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.destModalBtn, { backgroundColor: GOLD, borderColor: GOLD, flex: 1 }]}
                onPress={() => { saveCategories(acceptedCategories); setCatModalVisible(false); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.destModalBtnText, { color: '#000' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        {/* Set Destination Modal */}
        <Modal visible={destModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDestModalVisible(false)}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.destModal}>
              <View style={styles.destModalHeader}>
                <MaterialIcons name="flag" size={22} color={GOLD} />
                <Text style={styles.destModalTitle}>Set Destination</Text>
                <TouchableOpacity onPress={() => setDestModalVisible(false)}>
                  <MaterialIcons name="close" size={22} color={MUTED} />
                </TouchableOpacity>
              </View>
              <Text style={styles.destModalDesc}>
                Only ride requests heading toward this area will be shown to you. Leave blank to see all requests.
              </Text>
              <TextInput
                style={styles.destModalInput}
                placeholder="e.g. Airport, East Legon, Tema"
                placeholderTextColor={MUTED}
                value={destInput}
                onChangeText={setDestInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => { saveDestination(destInput); setDestModalVisible(false); }}
              />
              
              {destSuggestions.length > 0 && destInput.length > 1 && (
                <ScrollView style={{ maxHeight: 200, marginTop: 10, borderRadius: 10, backgroundColor: '#1A1A1A', borderColor: BORDER, borderWidth: 1 }}>
                  {destSuggestions.map((place, i) => (
                    <TouchableOpacity
                      key={i}
                      style={{ padding: 14, borderBottomWidth: i === destSuggestions.length - 1 ? 0 : 1, borderBottomColor: BORDER }}
                      onPress={() => {
                        setDestInput(place.name);
                        setDestSuggestions([]);
                        saveDestination(place.name);
                        setDestModalVisible(false);
                      }}
                    >
                      <Text style={{ color: TEXT, fontWeight: '600', fontSize: 15 }}>{place.name}</Text>
                      {place.address && place.address !== place.name && (
                        <Text style={{ color: MUTED, fontSize: 12, marginTop: 4 }} numberOfLines={1}>{place.address}</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <View style={styles.destModalActions}>
                <TouchableOpacity
                  style={[styles.destModalBtn, { backgroundColor: '#1A1A1A', borderColor: BORDER }]}
                  onPress={() => { saveDestination(''); setDestModalVisible(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.destModalBtnText, { color: MUTED }]}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.destModalBtn, { backgroundColor: GOLD, borderColor: GOLD, flex: 1 }]}
                  onPress={() => { saveDestination(destInput); setDestModalVisible(false); }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.destModalBtnText, { color: '#000' }]}>Save Destination</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Approval Status Banner */}
        {driverProfile && driverProfile.approval_status !== 'approved' && (
          <View style={[styles.statusBanner, { backgroundColor: driverProfile.approval_status === 'rejected' ? '#3B0000' : '#1A1200' }]}>
            <MaterialIcons name={driverProfile.approval_status === 'rejected' ? 'cancel' : 'hourglass-empty'} size={20} color={driverProfile.approval_status === 'rejected' ? RED : GOLD} />
            <Text style={[styles.statusBannerText, { color: driverProfile.approval_status === 'rejected' ? RED : GOLD }]}>
              {driverProfile.approval_status === 'rejected'
                ? 'Application rejected. Contact hello@ridehy3n.com'
                : 'Application under review — you\'ll be notified once approved'}
            </Text>
          </View>
        )}

        {/* Active Trip */}
        {activeTrip && (
          <View style={styles.activeTripCard}>
            <View style={styles.activeTripHeader}>
              <MaterialIcons name="directions-car" size={20} color={GOLD} />
              <Text style={styles.activeTripTitle}>Active Trip</Text>
              <View style={[styles.tripStatusBadge, { backgroundColor: activeTrip.status === 'in_progress' ? '#1A3300' : '#1A2600' }]}>
                <Text style={[styles.tripStatusText, { color: activeTrip.status === 'in_progress' ? GREEN : GOLD }]}>
                  {activeTrip.status === 'driver_arriving' ? 'Heading to Pickup' : activeTrip.status === 'driver_arrived' ? 'At Pickup' : 'In Progress'}
                </Text>
              </View>
            </View>
            <View style={styles.tripRoute}>
              <View style={styles.routeRow}>
                <View style={[styles.routeDot, { backgroundColor: GREEN }]} />
                <Text style={styles.routeText} numberOfLines={1}>{getLocationName(activeTrip.pickup)}</Text>
              </View>
              <View style={styles.routeConnector} />
              <View style={styles.routeRow}>
                <View style={[styles.routeDot, { backgroundColor: RED }]} />
                <Text style={styles.routeText} numberOfLines={1}>{getLocationName(activeTrip.destination)}</Text>
              </View>
            </View>
            <View style={styles.tripFareRow}>
              <Text style={styles.tripFare}>GH₵{activeTrip.fare.toFixed(2)}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(riderId || riderPhone) && (
                  <TouchableOpacity style={styles.callBtn} onPress={handleCallRider}>
                    <MaterialIcons name="phone" size={18} color={GOLD} />
                    <Text style={styles.callBtnText}>Call</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.callBtn, { backgroundColor: '#1A1400', borderColor: GOLD, borderWidth: 1 }]} onPress={() => setChatOpen(true)}>
                  <MaterialIcons name="chat" size={18} color={GOLD} />
                  <Text style={styles.callBtnText}>Chat</Text>
                  {unreadCount > 0 && (
                    <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: RED, borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{unreadCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
            {/* Navigation buttons */}
            <View style={styles.navBtnRow}>
              {(activeTrip.status === 'matched' || activeTrip.status === 'driver_arriving') && (
                <TouchableOpacity style={styles.navBtn} onPress={() => openNavigation(activeTrip.pickup)} activeOpacity={0.85}>
                  <MaterialIcons name="navigation" size={16} color="#fff" />
                  <Text style={styles.navBtnText}>Navigate to Pickup</Text>
                </TouchableOpacity>
              )}
              {activeTrip.status === 'in_progress' && (
                <TouchableOpacity style={[styles.navBtn, { backgroundColor: '#0D2200' }]} onPress={() => openNavigation(activeTrip.destination)} activeOpacity={0.85}>
                  <MaterialIcons name="navigation" size={16} color={GREEN} />
                  <Text style={[styles.navBtnText, { color: GREEN }]}>Navigate to Destination</Text>
                </TouchableOpacity>
              )}
            </View>
            {/* Ride PIN */}
            {activeTrip.status === 'driver_arrived' && activeTrip.ride_pin && (
              <View style={styles.pinContainer}>
                <MaterialIcons name="pin" size={16} color={GOLD} />
                <Text style={styles.pinLabel}>Ask rider for PIN</Text>
                <View style={styles.pinBoxRow}>
                  {activeTrip.ride_pin.split('').map((digit, i) => (
                    <View key={i} style={styles.pinBox}>
                      <Text style={styles.pinDigit}>{digit}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {/* Waiting Timer — shown when driver is at pickup */}
            {activeTrip.status === 'driver_arrived' && (
              <View style={{ backgroundColor: waitSeconds >= freeWaitSecs ? '#1A0A00' : '#0A1A0A', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: waitSeconds >= freeWaitSecs ? GOLD : GREEN, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <MaterialIcons name="access-time" size={16} color={waitSeconds >= freeWaitSecs ? GOLD : GREEN} />
                  <Text style={{ color: waitSeconds >= freeWaitSecs ? GOLD : GREEN, fontSize: 13, fontWeight: '600' }}>
                    {waitSeconds < freeWaitSecs
                      ? `Free waiting: ${Math.floor((freeWaitSecs - waitSeconds) / 60)}m ${(freeWaitSecs - waitSeconds) % 60}s remaining`
                      : `Waiting fee: GH\u20b5${currentWaitingFee.toFixed(2)} (${Math.floor((waitSeconds - freeWaitSecs) / 60)}m ${(waitSeconds - freeWaitSecs) % 60}s)`
                    }
                  </Text>
                </View>
                <Text style={{ color: MUTED, fontSize: 11 }}>
                  {`Waited: ${Math.floor(waitSeconds / 60)}m ${waitSeconds % 60}s · 3 min free, then GH\u20b5${waitingFeePerMin.toFixed(2)}/min`}
                </Text>
              </View>
            )}
            <View style={styles.tripActions}>
              {(activeTrip.status === 'matched' || activeTrip.status === 'driver_arriving') && (
                <TouchableOpacity style={styles.tripActionBtn} onPress={() => handleTripAction('pickup')} activeOpacity={0.85}>
                  <Text style={styles.tripActionText}>Arrived at Pickup</Text>
                </TouchableOpacity>
              )}
              {activeTrip.status === 'driver_arrived' && (
                <TouchableOpacity style={styles.tripActionBtn} onPress={() => handleTripAction('start')} activeOpacity={0.85}>
                  <Text style={styles.tripActionText}>Start Trip</Text>
                </TouchableOpacity>
              )}
              {activeTrip.status === 'in_progress' && (
                <TouchableOpacity style={[styles.tripActionBtn, { backgroundColor: GREEN }]} onPress={() => handleTripAction('complete')} activeOpacity={0.85}>
                  <Text style={styles.tripActionText}>Complete Trip</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Incoming Ride Request */}
        {incomingRequest && !activeTrip && (
          <View style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <View>
                <Text style={styles.requestTitle}>New Ride Request</Text>
                <Text style={styles.requestFare}>GH₵{(incomingRequest.fare || incomingRequest.fare_estimate || 0).toFixed(2)}</Text>
              </View>
              <View style={[styles.countdownBadge, { borderColor: countdown <= 5 ? RED : GOLD }]}>
                <Text style={[styles.countdownText, { color: countdown <= 5 ? RED : GOLD }]}>{countdown}s</Text>
              </View>
            </View>

            {/* Auto-Accept indicator */}
            {prefs.autoAccept && (
              <View style={styles.autoAcceptIndicator}>
                <MaterialIcons name="flash-on" size={14} color="#EAB308" />
                <Text style={styles.autoAcceptIndicatorText}>Auto-Accepting in 3s — tap Decline to cancel</Text>
              </View>
            )}

            {/* Rider info */}
            <View style={styles.riderInfoRow}>
              <View style={styles.riderAvatar}>
                <MaterialIcons name="person" size={22} color={GOLD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.riderNameText}>{incomingRequest.rider_name || incomingRequest.passenger_name || 'Rider'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MaterialIcons name="star" size={13} color={GOLD} />
                  <Text style={styles.riderRating}>{incomingRequest.rider_rating || '4.8'} rating</Text>
                </View>
              </View>
              {incomingRequest.category && (
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{incomingRequest.category}</Text>
                </View>
              )}
            </View>

            <View style={styles.tripRoute}>
              <View style={styles.routeRow}>
                <View style={[styles.routeDot, { backgroundColor: GREEN }]} />
                <Text style={styles.routeText} numberOfLines={1}>{getPickupAddress(incomingRequest)}</Text>
              </View>
              <View style={styles.routeConnector} />
              <View style={styles.routeRow}>
                <View style={[styles.routeDot, { backgroundColor: RED }]} />
                <Text style={styles.routeText} numberOfLines={1}>
                  {typeof incomingRequest.destination === 'object'
                    ? incomingRequest.destination.address || incomingRequest.destination.name
                    : incomingRequest.destination_address || incomingRequest.destination}
                </Text>
              </View>
            </View>

            <View style={styles.requestMeta}>
              {(incomingRequest.distance || incomingRequest.distance_km) && (
                <Text style={styles.requestMetaText}>{(incomingRequest.distance_km || incomingRequest.distance || 0).toFixed(1)} km</Text>
              )}
              {(incomingRequest.duration || incomingRequest.duration_min || incomingRequest.duration_minutes) && (
                <Text style={styles.requestMetaText}>{incomingRequest.duration_min || incomingRequest.duration_minutes || incomingRequest.duration} min</Text>
              )}
            </View>

            {/* High-risk area alert */}
            {areaAlert && (
              <View style={styles.areaAlert}>
                <MaterialIcons name="warning" size={16} color="#F59E0B" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.areaAlertTitle}>Area Notice</Text>
                  <Text style={styles.areaAlertText}>Pickup is near {areaAlert}. Stay alert and trust your instincts.</Text>
                </View>
              </View>
            )}

            <View style={styles.requestActions}>
              <TouchableOpacity style={styles.declineBtn} onPress={handleDeclineRide} activeOpacity={0.85}>
                <MaterialIcons name="close" size={22} color={RED} />
                <Text style={[styles.requestActionText, { color: RED }]}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.acceptBtn} onPress={handleAcceptRide} activeOpacity={0.85}>
                <MaterialIcons name="check" size={22} color="#000" />
                <Text style={[styles.requestActionText, { color: '#000' }]}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Today's Earnings Snapshot */}
        <View style={styles.earningsRow}>
          <View style={styles.earningsCard}>
            <MaterialIcons name="account-balance-wallet" size={22} color={GOLD} />
            <Text style={styles.earningsAmount}>GH₵{todayEarnings.toFixed(2)}</Text>
            <Text style={styles.earningsLabel}>Today's Earnings</Text>
          </View>
          <View style={styles.earningsCard}>
            <MaterialIcons name="directions-car" size={22} color={GOLD} />
            <Text style={styles.earningsAmount}>{todayTrips}</Text>
            <Text style={styles.earningsLabel}>Trips Today</Text>
          </View>
          <View style={styles.earningsCard}>
            <MaterialIcons name="star" size={22} color={GOLD} />
            <Text style={styles.earningsAmount}>{driverProfile?.rating?.toFixed(1) || '5.0'}</Text>
            <Text style={styles.earningsLabel}>Rating</Text>
          </View>
        </View>

        {/* Driver Info Card */}
        <View style={styles.driverInfoCard}>
          <View style={styles.driverInfoRow}>
            <View style={styles.driverAvatar}>
              <MaterialIcons name="person" size={28} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{driverProfile?.full_name || 'Driver'}</Text>
              <Text style={styles.driverVehicle}>
                {driverProfile?.vehicle_make && driverProfile?.vehicle_model
                  ? `${driverProfile.vehicle_make} ${driverProfile.vehicle_model} · ${driverProfile.vehicle_plate || ''}`
                  : 'Vehicle not set up'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as any)}>
              <MaterialIcons name="chevron-right" size={22} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Offline message */}
        {!isOnline && !activeTrip && (
          <View style={styles.offlineMsg}>
            <MaterialIcons name="power-settings-new" size={40} color={MUTED} />
            <Text style={styles.offlineMsgTitle}>You're offline</Text>
            <Text style={styles.offlineMsgText}>Go online to start receiving ride requests</Text>
          </View>
        )}
      </ScrollView>

      {/* In-app Chat Modal */}
      {activeTrip && (
        <RideChatModal
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          rideId={activeTrip.id}
          currentUserId={user?.uid || ''}
          currentUserRole="driver"
          currentUserName={driverProfile?.full_name || 'Driver'}
        />
      )}

      {/* Notification Center */}
      <NotificationCenter
        visible={notifOpen}
        onClose={() => setNotifOpen(false)}
        driverId={driverId}
      />

      {/* Post-Trip Summary */}
      <TripSummaryModal
        visible={summaryVisible}
        onClose={() => { setSummaryVisible(false); setCompletedTrip(null); }}
        trip={completedTrip}
        onSubmit={handleSummarySubmit}
      />

      {/* Voice Call — full-screen overlay when in call */}
      <InCallScreen
        call={call}
        otherName={riderName}
        otherRole="rider"
        otherPhone={riderPhone}
      />

      {/* Incoming call modal — shown when rider calls driver */}
      <IncomingCallModal
        call={call}
        otherName={riderName}
        otherRole="rider"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 8 },
  greeting: { fontSize: 15, fontWeight: '700', color: TEXT },
  subGreeting: { fontSize: 12, color: MUTED },
  notifBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  onlineCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: 16, backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onlineDot: { width: 12, height: 12, borderRadius: 6 },
  onlineStatus: { fontSize: 15, fontWeight: '700', color: TEXT },
  onlineSubtext: { fontSize: 12, color: MUTED, marginTop: 2 },
  toggleBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  toggleBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12 },
  statusBannerText: { flex: 1, fontSize: 13, fontWeight: '600' },
  activeTripCard: { margin: 16, backgroundColor: '#0D1A0D', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1A3300' },
  activeTripHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  activeTripTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: TEXT },
  tripStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tripStatusText: { fontSize: 12, fontWeight: '600' },
  tripRoute: { gap: 4, marginBottom: 12 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, color: TEXT, fontSize: 14 },
  routeConnector: { width: 1, height: 12, backgroundColor: BORDER, marginLeft: 4 },
  tripFareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  tripFare: { fontSize: 22, fontWeight: '800', color: GOLD },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A1200', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  callBtnText: { color: GOLD, fontSize: 13, fontWeight: '600' },
  tripActions: { gap: 8 },
  tripActionBtn: { backgroundColor: GOLD, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  tripActionText: { color: '#000', fontSize: 15, fontWeight: '800' },
  requestCard: { margin: 16, backgroundColor: '#1A1200', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: GOLD + '40' },
  requestHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  requestTitle: { fontSize: 12, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  requestFare: { fontSize: 28, fontWeight: '800', color: GOLD, marginTop: 2 },
  countdownBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2A2000', alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  countdownText: { fontSize: 16, fontWeight: '800' },
  riderInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  riderAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: GOLD + '20', alignItems: 'center', justifyContent: 'center' },
  riderNameText: { fontSize: 15, fontWeight: '700', color: TEXT },
  riderRating: { fontSize: 12, color: MUTED },
  categoryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: GOLD + '20', borderWidth: 1, borderColor: GOLD + '40' },
  categoryText: { fontSize: 12, color: GOLD, fontWeight: '600' },
  requestMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  requestMetaText: { color: MUTED, fontSize: 13 },
  areaAlert: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F59E0B10', borderWidth: 1, borderColor: '#F59E0B40', borderRadius: 12, padding: 10, marginBottom: 12 },
  areaAlertTitle: { fontSize: 12, fontWeight: '700', color: '#F59E0B' },
  areaAlertText: { fontSize: 11, color: MUTED, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: 10 },
  declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2A0000', borderRadius: 12, height: 52 },
  acceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: GOLD, borderRadius: 12, height: 52 },
  requestActionText: { fontSize: 15, fontWeight: '800' },
  earningsRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  earningsCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: BORDER },
  earningsAmount: { fontSize: 18, fontWeight: '800', color: TEXT },
  earningsLabel: { fontSize: 11, color: MUTED, textAlign: 'center' },
  driverInfoCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  driverInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1A1200', alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 15, fontWeight: '700', color: TEXT },
  driverVehicle: { fontSize: 12, color: MUTED, marginTop: 2 },
  offlineMsg: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  offlineMsgTitle: { fontSize: 18, fontWeight: '700', color: MUTED },
  offlineMsgText: { fontSize: 14, color: MUTED, textAlign: 'center', paddingHorizontal: 32 },
  navBtnRow: { marginTop: 10, gap: 8 },
  navBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1A2A3A', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16 },
  navBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pinContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 4, backgroundColor: '#1A1400', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#3A2E00' },
  pinLabel: { fontSize: 12, color: GOLD, fontWeight: '600', flex: 1 },
  pinBoxRow: { flexDirection: 'row', gap: 6 },
  pinBox: { width: 28, height: 32, borderRadius: 6, backgroundColor: '#2A2200', borderWidth: 1.5, borderColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  pinDigit: { fontSize: 16, fontWeight: '800', color: GOLD, letterSpacing: 1 },
  autoAcceptIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EAB30815', borderWidth: 1, borderColor: '#EAB30840', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  autoAcceptIndicatorText: { flex: 1, fontSize: 12, color: '#EAB308', fontWeight: '600' },
  // Set Destination
  destCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: BORDER, gap: 10 },
  destCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  destCardLabel: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  destCardValue: { fontSize: 14, fontWeight: '600', color: TEXT, marginTop: 2 },
  destCardPlaceholder: { fontSize: 13, color: MUTED, marginTop: 2 },
  destClearBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  destSetBtn: { paddingHorizontal: 14, height: 30, borderRadius: 8, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  destSetBtnText: { fontSize: 13, fontWeight: '700', color: MUTED },
  destModal: { flex: 1, backgroundColor: '#0A0A0A', padding: 24 },
  destModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 8 },
  destModalTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: TEXT },
  destModalDesc: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 20 },
  destModalInput: { backgroundColor: '#111111', borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: TEXT, marginBottom: 20 },
  destModalActions: { flexDirection: 'row', gap: 12 },
  destModalBtn: { height: 50, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  destModalBtnText: { fontSize: 15, fontWeight: '700' },
});

const notifStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1117' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: '#2A2A2A' },
  title: { fontSize: 20, fontWeight: '800', color: TEXT },
  unreadBadge: { backgroundColor: RED, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  markReadBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: GOLD + '20' },
  markReadText: { color: GOLD, fontSize: 12, fontWeight: '700' },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT },
  emptyText: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#1A1A1A' },
  itemUnread: { backgroundColor: '#FFFFFF08' },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, fontWeight: '700', color: MUTED },
  itemBody: { fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 18 },
  itemTime: { fontSize: 11, color: '#555', marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD, marginTop: 6 },
});

const summaryStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: TEXT },
  tripCard: { backgroundColor: '#0D1A0D', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#1A3300' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  fareText: { fontSize: 36, fontWeight: '800', color: GOLD, marginVertical: 4 },
  riderText: { fontSize: 15, color: TEXT, fontWeight: '600' },
  section: { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 8 },
  sectionDesc: { fontSize: 14, color: TEXT, fontWeight: '500' },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  remarksInput: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 12, color: TEXT, fontSize: 14, minHeight: 70, textAlignVertical: 'top', borderWidth: 1, borderColor: BORDER },
  foundItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  foundItemLabel: { fontSize: 14, color: TEXT, fontWeight: '500' },
  foundItemBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, backgroundColor: BORDER, borderWidth: 1, borderColor: BORDER },
  foundItemBtnText: { fontSize: 14, fontWeight: '700', color: MUTED },
  footer: { padding: 20, paddingBottom: 40, borderTopWidth: 0.5, borderTopColor: BORDER },
  submitBtn: { backgroundColor: GOLD, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
});
