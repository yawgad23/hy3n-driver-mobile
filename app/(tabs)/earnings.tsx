import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Animated, useColorScheme, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { Colors } from '@/constants/theme';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#3B82F6';

type Period = 'week' | 'month';

const TIERS = [
  { label: 'Bronze', min: 0, max: 49, color: '#CD7F32' },
  { label: 'Silver', min: 50, max: 149, color: '#C0C0C0' },
  { label: 'Gold', min: 150, max: 299, color: GOLD },
  { label: 'Platinum', min: 300, max: Infinity, color: '#E5E4E2' },
];

function getTier(trips: number) {
  return TIERS.slice().reverse().find(t => trips >= t.min) || TIERS[0];
}

export default function DriverEarningsScreen() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';
  const themeColors = Colors[isDark ? 'dark' : 'light'];
  
  const { user, driverProfile } = useDriverAuth();
  const [period, setPeriod] = useState<Period>('week');
  const [loading, setLoading] = useState(true);
  const [allCompleted, setAllCompleted] = useState<any[]>([]);
  const [todayCommission, setTodayCommission] = useState<any>(null);
  const [commissionLoading, setCommissionLoading] = useState(true);
  
  const challengeProgress = useRef(new Animated.Value(0)).current;
  const CHALLENGE_TARGET = 10;
  const CHALLENGE_BONUS = 50;

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    firestoreDB.list(COLLECTIONS.RIDES, { driver_id: user.uid, status: 'completed' })
      .then((rides: any[]) => setAllCompleted(rides))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    setCommissionLoading(true);
    firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: user.uid, date: today })
      .then((records: any[]) => {
        const paid = records.find((r: any) => r.status === 'paid' || r.status === 'confirmed');
        setTodayCommission(paid || records[0] || null);
      })
      .catch(() => setTodayCommission(null))
      .finally(() => setCommissionLoading(false));
  }, [user]);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  
  const startOfWeek = (() => {
    const d = new Date(now);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const todayTrips = allCompleted.filter(r => r.created_date?.startsWith(todayStr));
  const weekTrips = allCompleted.filter(r => r.created_date && new Date(r.created_date) >= startOfWeek);
  
  const todayEarnings = todayTrips.reduce((s, r) => s + (r.fare || 0), 0);
  const weekEarnings = weekTrips.reduce((s, r) => s + (r.fare || 0), 0);
  const totalEarnings = allCompleted.reduce((s, r) => s + (r.fare || 0), 0);

  const dailyData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    const dayTrips = allCompleted.filter(r => r.created_date?.startsWith(key));
    return {
      day: d.toLocaleDateString('en-GH', { weekday: 'short' }),
      amount: dayTrips.reduce((s, r) => s + (r.fare || 0), 0),
      trips: dayTrips.length,
    };
  });

  const maxBar = Math.max(...dailyData.map(d => d.amount), 10);

  useEffect(() => {
    Animated.timing(challengeProgress, {
      toValue: Math.min(weekTrips.length / CHALLENGE_TARGET, 1),
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [weekTrips.length]);

  const dynamicStyles = {
    container: { backgroundColor: themeColors.background },
    text: { color: themeColors.text },
    muted: { color: themeColors.muted },
    card: { 
      backgroundColor: isDark ? '#111111' : '#FFFFFF',
      borderColor: themeColors.border 
    },
    header: { borderBottomColor: themeColors.border }
  };

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }, dynamicStyles.header]}>
        <Text style={[styles.headerTitle, dynamicStyles.text]}>Earnings</Text>
        <Text style={styles.headerSub}>You keep 100% of fares — daily fee applies</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* KPI Grid */}
        <View style={styles.kpiGrid}>
          <View style={[styles.kpiCard, dynamicStyles.card]}>
            <Text style={[styles.kpiLabel, dynamicStyles.muted]}>Today</Text>
            <Text style={[styles.kpiValue, dynamicStyles.text]}>GH₵{todayEarnings.toFixed(0)}</Text>
            <Text style={[styles.kpiSub, dynamicStyles.muted]}>{todayTrips.length} trips</Text>
          </View>
          <View style={[styles.kpiCard, dynamicStyles.card]}>
            <Text style={[styles.kpiLabel, dynamicStyles.muted]}>This Week</Text>
            <Text style={[styles.kpiValue, dynamicStyles.text]}>GH₵{weekEarnings.toFixed(0)}</Text>
            <Text style={[styles.kpiSub, dynamicStyles.muted]}>{weekTrips.length} trips</Text>
          </View>
        </View>

        {/* Detailed Bar Chart */}
        <View style={[styles.chartCard, dynamicStyles.card]}>
          <Text style={[styles.chartTitle, dynamicStyles.text]}>Daily Performance</Text>
          <View style={styles.barChart}>
            {dailyData.map((d, i) => (
              <View key={i} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${(d.amount / maxBar) * 100}%` }]} />
                </View>
                <Text style={[styles.barDay, dynamicStyles.muted]}>{d.day}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Commission Status */}
        {!commissionLoading && todayCommission && (
          <View style={[styles.infoCard, dynamicStyles.card, { borderColor: GREEN + '40', backgroundColor: GREEN + '08' }]}>
            <MaterialIcons name="verified" size={20} color={GREEN} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.infoTitle, { color: GREEN }]}>Daily Fee Paid</Text>
              <Text style={dynamicStyles.muted}>Access active until midnight</Text>
            </View>
            <Text style={[styles.infoAmount, dynamicStyles.text]}>GH₵{todayCommission.amount || 50}</Text>
          </View>
        )}

        {/* Weekly Challenge */}
        <View style={[styles.challengeCard, dynamicStyles.card]}>
          <View style={styles.challengeHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.challengeTitle, dynamicStyles.text]}>Weekly Challenge</Text>
              <Text style={dynamicStyles.muted}>Complete {CHALLENGE_TARGET} rides for bonus</Text>
            </View>
            <View style={styles.rewardBadge}>
              <Text style={styles.rewardText}>GH₵{CHALLENGE_BONUS}</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, {
              width: challengeProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: weekTrips.length >= CHALLENGE_TARGET ? GREEN : GOLD,
            }]} />
          </View>
          <Text style={[styles.challengeStatus, dynamicStyles.muted]}>
            {weekTrips.length} / {CHALLENGE_TARGET} rides completed
          </Text>
        </View>

        {/* Tier Status */}
        <View style={[styles.tierCard, dynamicStyles.card]}>
          <Text style={[styles.summaryTitle, dynamicStyles.text]}>Driver Tier</Text>
          <View style={styles.tierRow}>
            {TIERS.map((t, i) => (
              <View key={i} style={[styles.tierDot, { backgroundColor: t.color, opacity: driverProfile?.total_trips >= t.min ? 1 : 0.2 }]} />
            ))}
          </View>
          <Text style={[styles.tierLabel, { color: getTier(driverProfile?.total_trips || 0).color }]}>
            {getTier(driverProfile?.total_trips || 0).label} Status
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 28, fontWeight: '900' },
  headerSub: { fontSize: 13, color: GOLD, fontWeight: '700', marginTop: 4 },
  
  kpiGrid: { flexDirection: 'row', gap: 12, padding: 20 },
  kpiCard: { flex: 1, padding: 16, borderRadius: 20, borderWidth: 1 },
  kpiLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  kpiValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
  kpiSub: { fontSize: 11, marginTop: 2 },

  chartCard: { marginHorizontal: 20, padding: 20, borderRadius: 24, borderWidth: 1, marginBottom: 20 },
  chartTitle: { fontSize: 15, fontWeight: '800', marginBottom: 16 },
  barChart: { flexDirection: 'row', height: 120, alignItems: 'flex-end', gap: 8 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: GOLD, borderRadius: 4 },
  barDay: { fontSize: 10, fontWeight: '700' },

  infoCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1, marginBottom: 20 },
  infoTitle: { fontSize: 15, fontWeight: '800' },
  infoAmount: { fontSize: 18, fontWeight: '900' },

  challengeCard: { marginHorizontal: 20, padding: 20, borderRadius: 24, borderWidth: 1, marginBottom: 20 },
  challengeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  challengeTitle: { fontSize: 15, fontWeight: '800' },
  rewardBadge: { backgroundColor: GOLD + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  rewardText: { color: GOLD, fontWeight: '900', fontSize: 14 },
  progressTrack: { height: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', borderRadius: 3 },
  challengeStatus: { fontSize: 11, fontWeight: '600' },

  tierCard: { marginHorizontal: 20, padding: 20, borderRadius: 24, borderWidth: 1, alignItems: 'center' },
  summaryTitle: { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  tierRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tierDot: { width: 12, height: 12, borderRadius: 6 },
  tierLabel: { fontSize: 16, fontWeight: '900' },
});
