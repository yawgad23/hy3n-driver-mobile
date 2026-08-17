import React from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { trpc } from '@/lib/trpc';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const GREEN = '#22C55E';
const RED = '#EF4444';

type ScheduledRide = {
  id: string;
  rider_name?: string;
  pickup_address?: string;
  destination_address?: string;
  scheduled_at?: string;
  scheduled_pickup_at?: string;
  fare_estimate?: number;
  status?: string;
  category?: string;
};

function statusColor(status?: string) {
  if (['scheduled', 'matched', 'driver_scheduled'].includes(status || '')) return GOLD;
  if (status === 'driver_arriving') return GREEN;
  if (['cancelled', 'expired'].includes(status || '')) return RED;
  return MUTED;
}

export default function ScheduledRidesScreen() {
  const insets = useSafeAreaInsets();
  const { user, driverProfile } = useDriverAuth();
  const ridesQuery = trpc.driverScheduling.listAvailable.useQuery(
    { driverId: user?.uid || '', limit: 30 },
    { enabled: Boolean(user?.uid) },
  );
  const reserveRide = trpc.driverScheduling.reserve.useMutation({
    onSuccess: async () => {
      await ridesQuery.refetch();
      Alert.alert('Ride reserved', 'This ride is now reserved in your upcoming pickup queue.');
    },
    onError: (error) => Alert.alert('Reservation unavailable', error.message || 'This scheduled ride is no longer available.'),
  });
  const releaseRide = trpc.driverScheduling.release.useMutation({
    onSuccess: async () => {
      await ridesQuery.refetch();
      Alert.alert('Ride released', 'The scheduled ride is available for another driver.');
    },
    onError: (error) => Alert.alert('Release failed', error.message || 'The ride could not be released.'),
  });

  const updateStatus = (ride: ScheduledRide, action: 'reserve' | 'release') => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Please sign in again before managing scheduled rides.');
      return;
    }
    const isReserve = action === 'reserve';
    Alert.alert(
      isReserve ? 'Reserve scheduled ride' : 'Release scheduled ride',
      isReserve ? 'This ride will be reserved for its scheduled pickup time.' : 'The ride will be available to another eligible driver.',
      [
        { text: 'Back', style: 'cancel' },
        {
          text: isReserve ? 'Reserve' : 'Release',
          style: isReserve ? 'default' : 'destructive',
          onPress: () => {
            if (isReserve) {
              reserveRide.mutate({ driverId: user.uid, rideId: ride.id, driverName: driverProfile?.full_name || undefined });
            } else {
              releaseRide.mutate({ driverId: user.uid, rideId: ride.id });
            }
          },
        },
      ],
    );
  };

  const rides = (ridesQuery.data?.rides || []) as ScheduledRide[];
  const loading = ridesQuery.isLoading || ridesQuery.isFetching;
  const busyRideId = reserveRide.variables?.rideId || releaseRide.variables?.rideId;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={TEXT} /></TouchableOpacity>
        <View><Text style={styles.headerTitle}>Scheduled rides</Text><Text style={styles.headerSub}>Reserve future pickups that fit your route</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => ridesQuery.refetch()} tintColor={GOLD} />}>
        {loading && rides.length === 0 ? <ActivityIndicator color={GOLD} style={{ marginTop: 48 }} /> : null}
        {!loading && rides.length === 0 ? <View style={styles.empty}><MaterialIcons name="event-available" size={44} color={MUTED} /><Text style={styles.emptyTitle}>No scheduled rides</Text><Text style={styles.emptyText}>Future rides matching your preferences will appear here.</Text></View> : null}
        {rides.map((ride) => {
          const scheduled = ride.scheduled_pickup_at || ride.scheduled_at;
          const reserved = ride.status === 'driver_scheduled';
          const isBusy = busyRideId === ride.id && (reserveRide.isPending || releaseRide.isPending);
          return <View key={ride.id} style={styles.card}>
            <View style={styles.cardTop}><View style={[styles.statusPill, { backgroundColor: `${statusColor(ride.status)}20` }]}><View style={[styles.statusDot, { backgroundColor: statusColor(ride.status) }]} /><Text style={[styles.statusText, { color: statusColor(ride.status) }]}>{(ride.status || 'scheduled').replace('_', ' ')}</Text></View><Text style={styles.time}>{scheduled ? new Date(scheduled).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time pending'}</Text></View>
            <Text style={styles.rider}>{ride.rider_name || 'Rider'}</Text>
            <View style={styles.route}><MaterialIcons name="trip-origin" size={15} color={GREEN} /><Text style={styles.routeText} numberOfLines={1}>{ride.pickup_address || 'Pickup location'}</Text></View>
            <View style={styles.route}><MaterialIcons name="location-on" size={16} color={RED} /><Text style={styles.routeText} numberOfLines={1}>{ride.destination_address || 'Destination'}</Text></View>
            <View style={styles.cardBottom}><Text style={styles.fare}>GH₵{Number(ride.fare_estimate || 0).toFixed(2)}</Text><Text style={styles.category}>{ride.category || 'Standard'}</Text></View>
            {ride.status === 'scheduled' ? <View style={styles.actions}><TouchableOpacity style={[styles.acceptButton, isBusy && { opacity: 0.65 }]} disabled={isBusy} onPress={() => updateStatus(ride, 'reserve')}>{isBusy ? <ActivityIndicator color="#000" /> : <Text style={styles.acceptText}>Reserve ride</Text>}</TouchableOpacity></View> : null}
            {reserved ? <View style={styles.reservedBlock}><View style={styles.accepted}><MaterialIcons name="check-circle" size={16} color={GREEN} /><Text style={styles.acceptedText}>Reserved in your upcoming pickup queue.</Text></View><TouchableOpacity style={[styles.releaseButton, isBusy && { opacity: 0.65 }]} disabled={isBusy} onPress={() => updateStatus(ride, 'release')}><Text style={styles.releaseText}>Release ride</Text></TouchableOpacity></View> : null}
          </View>;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: TEXT, fontSize: 21, fontWeight: '900' }, headerSub: { color: MUTED, fontSize: 12, marginTop: 2 }, content: { padding: 16, gap: 12, paddingBottom: 40 }, card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 14 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 20 }, statusDot: { width: 6, height: 6, borderRadius: 3 }, statusText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, time: { color: MUTED, fontSize: 11, fontWeight: '700' }, rider: { color: TEXT, fontSize: 17, fontWeight: '900', marginTop: 12, marginBottom: 9 }, route: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }, routeText: { color: MUTED, flex: 1, fontSize: 12 }, cardBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 11, borderTopWidth: 1, borderTopColor: BORDER }, fare: { color: GOLD, fontSize: 17, fontWeight: '900' }, category: { color: MUTED, fontSize: 12, fontWeight: '700' }, actions: { flexDirection: 'row', gap: 10, marginTop: 13 }, acceptButton: { flex: 1, height: 42, borderRadius: 10, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' }, acceptText: { color: '#000', fontSize: 13, fontWeight: '900' }, reservedBlock: { marginTop: 13, gap: 9 }, accepted: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#052E16', borderRadius: 10, padding: 10 }, acceptedText: { color: '#86EFAC', fontSize: 12, fontWeight: '700', flex: 1 }, releaseButton: { borderWidth: 1, borderColor: '#5A2424', borderRadius: 10, height: 38, alignItems: 'center', justifyContent: 'center' }, releaseText: { color: '#FCA5A5', fontSize: 12, fontWeight: '900' }, empty: { alignItems: 'center', paddingTop: 90 }, emptyTitle: { color: TEXT, fontSize: 17, fontWeight: '900', marginTop: 12 }, emptyText: { color: MUTED, fontSize: 13, textAlign: 'center', marginTop: 6 },
});
