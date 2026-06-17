import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const GREEN = '#22C55E';
const RED = '#EF4444';

interface Trip {
  id: string;
  pickup?: string;
  pickup_address?: string;
  pickup_location?: string;
  destination?: string;
  destination_address?: string;
  dropoff_location?: string;
  fare?: number;
  fare_estimate?: number;
  status: string;
  created_date?: string;
  trip_date?: string;
  rider_name?: string;
  passenger_name?: string;
  distance?: number;
  distance_km?: number;
  duration?: number;
  duration_min?: number;
  duration_minutes?: number;
  category?: string;
  driver_feedback?: string;
  passenger_feedback?: string;
  payment_method?: string;
}

type FilterKey = 'all' | 'today' | 'week' | 'completed' | 'cancelled';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All Trips' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function isToday(d: Date) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isThisWeek(d: Date) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return d >= weekStart && d <= weekEnd;
}

function formatTripDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isToday(d)) return `Today, ${d.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })}`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${d.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-GH', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' });
}

function getPickup(t: Trip) {
  return t.pickup_address || t.pickup_location || t.pickup || '—';
}
function getDestination(t: Trip) {
  return t.destination_address || t.dropoff_location || t.destination || '—';
}
function getFare(t: Trip) {
  return t.fare || t.fare_estimate || 0;
}
function getRiderName(t: Trip) {
  return t.rider_name || t.passenger_name || 'Rider';
}
function getDuration(t: Trip) {
  return t.duration_min || t.duration_minutes || t.duration || null;
}
function getDistance(t: Trip) {
  return t.distance_km || t.distance || null;
}

function TripCard({ trip }: { trip: Trip }) {
  const [expanded, setExpanded] = useState(false);
  const fare = getFare(trip);
  const isCompleted = trip.status === 'completed';
  const isCancelled = trip.status === 'cancelled';
  const statusColor = isCompleted ? GREEN : isCancelled ? RED : GOLD;
  const statusBg = isCompleted ? '#0D1A0D' : isCancelled ? '#2A0000' : '#1A1200';
  const statusLabel = isCompleted ? 'Completed' : isCancelled ? 'Cancelled' : trip.status.replace(/_/g, ' ');
  const dist = getDistance(trip);
  const dur = getDuration(trip);

  return (
    <TouchableOpacity
      style={styles.tripCard}
      onPress={() => setExpanded(p => !p)}
      activeOpacity={0.85}
    >
      {/* Header */}
      <View style={styles.tripHeader}>
        <View style={styles.tripHeaderLeft}>
          <View style={[styles.tripAvatar, { backgroundColor: GOLD + '20' }]}>
            <MaterialIcons name="directions-car" size={20} color={GOLD} />
          </View>
          <View>
            <Text style={styles.riderName}>{getRiderName(trip)}</Text>
            <Text style={styles.tripDate}>{formatTripDate(trip.trip_date || trip.created_date)}</Text>
          </View>
        </View>
        <View style={styles.tripHeaderRight}>
          <Text style={[styles.tripFare, { color: isCompleted ? GOLD : MUTED }]}>
            {isCompleted ? `GH₵${Math.round(fare)}` : '—'}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      {/* Route */}
      <View style={styles.tripRoute}>
        <View style={styles.routeRow}>
          <View style={[styles.routeDot, { backgroundColor: GREEN }]} />
          <Text style={styles.routeText} numberOfLines={1}>{getPickup(trip)}</Text>
        </View>
        <View style={styles.routeConnector} />
        <View style={styles.routeRow}>
          <View style={[styles.routeDot, { backgroundColor: RED }]} />
          <Text style={styles.routeText} numberOfLines={1}>{getDestination(trip)}</Text>
        </View>
      </View>

      {/* Meta row */}
      <View style={styles.metaRow}>
        {dist && (
          <View style={styles.metaItem}>
            <MaterialIcons name="place" size={13} color={MUTED} />
            <Text style={styles.metaText}>{typeof dist === 'number' ? dist.toFixed(1) : dist} km</Text>
          </View>
        )}
        {dur && (
          <View style={styles.metaItem}>
            <MaterialIcons name="access-time" size={13} color={MUTED} />
            <Text style={styles.metaText}>{dur} min</Text>
          </View>
        )}
        {trip.category && (
          <View style={[styles.categoryBadge]}>
            <Text style={styles.categoryText}>{trip.category}</Text>
          </View>
        )}
        <MaterialIcons
          name={expanded ? 'expand-less' : 'expand-more'}
          size={18}
          color={MUTED}
          style={{ marginLeft: 'auto' }}
        />
      </View>

      {/* Expanded details */}
      {expanded && (
        <View style={styles.expandedSection}>
          {(trip.driver_feedback || trip.passenger_feedback) && (
            <View style={styles.feedbackBox}>
              <Text style={styles.feedbackTitle}>Passenger Feedback</Text>
              <Text style={styles.feedbackText}>{trip.driver_feedback || trip.passenger_feedback}</Text>
            </View>
          )}
          {trip.payment_method && (
            <View style={styles.expandedRow}>
              <Text style={styles.expandedLabel}>Payment</Text>
              <Text style={styles.expandedValue}>{trip.payment_method.charAt(0).toUpperCase() + trip.payment_method.slice(1)}</Text>
            </View>
          )}
          <View style={styles.expandedRow}>
            <Text style={styles.expandedLabel}>Trip ID</Text>
            <Text style={[styles.expandedValue, { fontFamily: 'monospace', fontSize: 11 }]}>{trip.id?.slice(0, 12)}…</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function DriverHistoryScreen() {
  const { user } = useDriverAuth();
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    firestoreDB.list(COLLECTIONS.RIDES, { driver_id: user.uid })
      .then((data: any[]) => setTrips(data as Trip[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const filtered = trips.filter(t => {
    const d = new Date(t.trip_date || t.created_date || '');
    const matchFilter = (() => {
      if (filter === 'today') return isToday(d);
      if (filter === 'week') return isThisWeek(d);
      if (filter === 'completed') return t.status === 'completed';
      if (filter === 'cancelled') return t.status === 'cancelled';
      return true;
    })();
    const q = search.trim().toLowerCase();
    const matchSearch = !q ||
      getRiderName(t).toLowerCase().includes(q) ||
      getPickup(t).toLowerCase().includes(q) ||
      getDestination(t).toLowerCase().includes(q);
    return matchFilter && matchSearch;
  }).sort((a, b) => {
    const da = new Date(b.trip_date || b.created_date || '').getTime();
    const db2 = new Date(a.trip_date || a.created_date || '').getTime();
    return da - db2;
  });

  const completedTrips = trips.filter(t => t.status === 'completed');
  const now = new Date();
  const todayEarnings = completedTrips
    .filter(t => isToday(new Date(t.trip_date || t.created_date || '')))
    .reduce((s, t) => s + getFare(t), 0);
  const weekEarnings = completedTrips
    .filter(t => isThisWeek(new Date(t.trip_date || t.created_date || '')))
    .reduce((s, t) => s + getFare(t), 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trip History</Text>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <MaterialIcons name="today" size={18} color={GOLD} />
          <Text style={styles.summaryValue}>GH₵{Math.round(todayEarnings)}</Text>
          <Text style={styles.summaryLabel}>Today</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialIcons name="trending-up" size={18} color={GOLD} />
          <Text style={styles.summaryValue}>GH₵{Math.round(weekEarnings)}</Text>
          <Text style={styles.summaryLabel}>This Week</Text>
        </View>
        <View style={styles.summaryCard}>
          <MaterialIcons name="check-circle" size={18} color={GREEN} />
          <Text style={styles.summaryValue}>{completedTrips.length}</Text>
          <Text style={styles.summaryLabel}>Completed</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by rider, pickup or dropoff…"
          placeholderTextColor={MUTED}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <MaterialIcons name="close" size={18} color={MUTED} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Trip List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MaterialIcons name="history" size={48} color={MUTED} />
          <Text style={styles.emptyTitle}>No trips found</Text>
          <Text style={styles.emptyText}>
            {trips.length === 0 ? 'Complete your first trip to see it here' : 'Try adjusting your search or filter'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <TripCard trip={item} />}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.resultCount}>
              {filtered.length} trip{filtered.length !== 1 ? 's' : ''}
              {filter !== 'all' && ` · GH₵${Math.round(filtered.filter(t => t.status === 'completed').reduce((s, t) => s + getFare(t), 0))} earned`}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  headerTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  summaryRow: { flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 0 },
  summaryCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: BORDER },
  summaryValue: { fontSize: 15, fontWeight: '800', color: TEXT },
  summaryLabel: { fontSize: 10, color: MUTED, textAlign: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 12, margin: 16, marginBottom: 8, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: BORDER },
  searchInput: { flex: 1, color: TEXT, fontSize: 14 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4, flexWrap: 'nowrap' },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  filterBtnActive: { backgroundColor: GOLD + '20', borderColor: GOLD },
  filterText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: GOLD },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: MUTED },
  emptyText: { fontSize: 14, color: MUTED, textAlign: 'center', paddingHorizontal: 32 },
  resultCount: { fontSize: 12, color: MUTED, marginBottom: 8 },
  tripCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  tripHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  tripHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tripAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  riderName: { fontSize: 14, fontWeight: '700', color: TEXT },
  tripDate: { fontSize: 11, color: MUTED, marginTop: 2 },
  tripHeaderRight: { alignItems: 'flex-end', gap: 4 },
  tripFare: { fontSize: 18, fontWeight: '800' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '600' },
  tripRoute: { gap: 4, marginBottom: 10 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, color: TEXT, fontSize: 13 },
  routeConnector: { width: 1, height: 10, backgroundColor: BORDER, marginLeft: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 12, color: MUTED },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: BORDER },
  categoryText: { fontSize: 11, color: MUTED, fontWeight: '600' },
  expandedSection: { marginTop: 12, borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 12, gap: 8 },
  feedbackBox: { backgroundColor: '#1A1A1A', borderRadius: 10, padding: 12 },
  feedbackTitle: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  feedbackText: { fontSize: 13, color: TEXT, lineHeight: 18 },
  expandedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expandedLabel: { fontSize: 12, color: MUTED },
  expandedValue: { fontSize: 13, fontWeight: '600', color: TEXT },
});
