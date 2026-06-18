import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Animated,
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
const BLUE = '#3B82F6';

type Period = 'week' | 'month';

// ── Tier config matching web app (0/50/150/300) ────────────────────────────
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
  const { user, driverProfile } = useDriverAuth();
  const insets = useSafeAreaInsets();
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

  // Load today's commission record
  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const driverId = user.uid;
    setCommissionLoading(true);
    firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId, date: today })
      .then((records: any[]) => {
        // Prefer paid/confirmed, then processing, then any
        const paid = records.find((r: any) => r.status === 'paid' || r.status === 'confirmed');
        const processing = records.find((r: any) => r.status === 'processing');
        setTodayCommission(paid || processing || records[0] || null);
      })
      .catch(() => setTodayCommission(null))
      .finally(() => setCommissionLoading(false));
  }, [user]);

  // ── Date helpers ─────────────────────────────────────────────────────────
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startOfWeek = (() => {
    const d = new Date(now);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day); // Mon start
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const todayTrips = allCompleted.filter(r => r.created_date?.startsWith(todayStr));
  const weekTrips = allCompleted.filter(r => r.created_date && new Date(r.created_date) >= startOfWeek);
  const last7Trips = allCompleted.filter(r => r.created_date && new Date(r.created_date) >= weekAgo);

  const todayEarnings = todayTrips.reduce((s: number, r: any) => s + (r.fare || 0), 0);
  const weekEarnings = weekTrips.reduce((s: number, r: any) => s + (r.fare || 0), 0);
  const totalEarnings = allCompleted.reduce((s: number, r: any) => s + (r.fare || 0), 0);
  const totalDurationHrs = allCompleted.reduce((s: number, r: any) => s + (r.duration_min || 0), 0) / 60;
  const avgHourlyRate = totalDurationHrs > 0 ? totalEarnings / totalDurationHrs : 0;
  const avgPerTrip = allCompleted.length > 0 ? totalEarnings / allCompleted.length : 0;

  // ── Service type & daily fee ──────────────────────────────────────────────
  const serviceType = driverProfile?.service_type || 'car';
  const dailyFee = (serviceType === 'okada' || serviceType === 'delivery') ? 30 : 50;

  // ── Daily breakdown for week chart ───────────────────────────────────────
  const dailyData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    const dayTrips = allCompleted.filter(r => r.created_date?.startsWith(key));
    return {
      day: d.toLocaleDateString('en-GH', { weekday: 'short' }),
      amount: dayTrips.reduce((s: number, r: any) => s + (r.fare || 0), 0),
      trips: dayTrips.length,
    };
  });

  // ── 4-week trend ──────────────────────────────────────────────────────────
  const weeklyTrend = Array.from({ length: 4 }, (_, i) => {
    const ws = new Date(startOfWeek);
    ws.setDate(ws.getDate() - (3 - i) * 7);
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    we.setHours(23, 59, 59, 999);
    const wTrips = allCompleted.filter(r => {
      const d = r.created_date ? new Date(r.created_date) : null;
      return d && d >= ws && d <= we;
    });
    return {
      label: i === 3 ? 'This wk' : `${3 - i}w ago`,
      amount: wTrips.reduce((s: number, r: any) => s + (r.fare || 0), 0),
      trips: wTrips.length,
    };
  });

  const maxBar = Math.max(...(period === 'week' ? dailyData : weeklyTrend).map(d => d.amount), 1);

  // ── Acceptance rate ───────────────────────────────────────────────────────
  const acceptanceRate = driverProfile?.acceptance_rate;

  // ── Tier ─────────────────────────────────────────────────────────────────
  const totalTrips = driverProfile?.total_trips || 0;
  const tier = getTier(totalTrips);

  // ── Weekly challenge ──────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(challengeProgress, {
      toValue: Math.min(last7Trips.length / CHALLENGE_TARGET, 1),
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [last7Trips.length]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Earnings</Text>
        <Text style={styles.headerSub}>You keep 100% of fares — flat daily fee applies</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Period Toggle */}
        <View style={styles.periodRow}>
          {(['week', 'month'] as Period[]).map(p => (
            <TouchableOpacity key={p} style={[styles.periodBtn, period === p && styles.periodBtnActive]} onPress={() => setPeriod(p)}>
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p === 'week' ? 'This Week' : '4-Week Trend'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator size="large" color={GOLD} /></View>
        ) : (
          <>
            {/* KPI Cards */}
            <View style={styles.kpiGrid}>
              <KpiCard icon="attach-money" label="Today's Earnings" value={`GH₵${todayEarnings.toFixed(2)}`} sub={`${todayTrips.length} trips today`} color={GOLD} />
              <KpiCard icon="calendar-today" label="This Week" value={`GH₵${weekEarnings.toFixed(2)}`} sub={`${weekTrips.length} trips`} color={BLUE} />
              <KpiCard icon="speed" label="Avg Hourly Rate" value={`GH₵${avgHourlyRate.toFixed(2)}/hr`} sub={`GH₵${avgPerTrip.toFixed(2)} per trip`} color="#A78BFA" />
              <KpiCard icon="trending-up" label="All-Time Revenue" value={`GH₵${totalEarnings.toFixed(2)}`} sub={`${allCompleted.length} completed`} color={GREEN} />
            </View>

            {/* Bar Chart */}
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>
                {period === 'week' ? 'Daily Earnings — This Week' : '4-Week Earnings Trend'}
              </Text>
              <View style={styles.barChart}>
                {(period === 'week' ? dailyData : weeklyTrend).map((d, i) => (
                  <View key={i} style={styles.barCol}>
                    <Text style={styles.barAmount}>{d.amount > 0 ? `₵${d.amount.toFixed(0)}` : ''}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { height: `${(d.amount / maxBar) * 100}%` }]} />
                    </View>
                    <Text style={styles.barDay}>{period === 'week' ? (d as any).day : (d as any).label}</Text>
                    {d.trips > 0 && <Text style={styles.barTrips}>{d.trips}t</Text>}
                  </View>
                ))}
              </View>
            </View>

            {/* Today's Commission Status Card */}
            {commissionLoading ? (
              <View style={[styles.infoCard, { borderColor: BORDER, backgroundColor: CARD }]}>
                <ActivityIndicator size="small" color={GOLD} />
                <Text style={[styles.infoSub, { marginLeft: 10 }]}>Checking commission status...</Text>
              </View>
            ) : todayCommission ? (() => {
              const isPaid = todayCommission.status === 'paid' || todayCommission.status === 'confirmed';
              const isProcessing = todayCommission.status === 'processing';
              const isFailed = todayCommission.status === 'failed';
              const statusColor = isPaid ? GREEN : isProcessing ? '#F59E0B' : RED;
              const statusIcon = isPaid ? 'check-circle' : isProcessing ? 'access-time' : 'error-outline';
              const statusLabel = isPaid ? 'Commission Paid' : isProcessing ? 'Awaiting USSD Approval' : 'Payment Failed';
              const statusSub = isPaid
                ? `GH₵${todayCommission.amount || dailyFee} deducted via ${todayCommission.momo_network === 'vodafone-gh' ? 'Vodafone Cash' : todayCommission.momo_network === 'tigo-gh' ? 'AirtelTigo Money' : 'MTN MoMo'}`
                : isProcessing
                ? 'Check your phone for the USSD prompt and approve the payment'
                : 'Payment could not be processed — go online to retry';
              return (
                <View style={[styles.infoCard, { borderColor: statusColor + '50', backgroundColor: isPaid ? '#001A00' : isProcessing ? '#1A1400' : '#1A0000' }]}>
                  <MaterialIcons name={statusIcon as any} size={18} color={statusColor} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.infoTitle, { color: statusColor }]}>{statusLabel}</Text>
                    <Text style={styles.infoSub}>{statusSub}</Text>
                  </View>
                  <Text style={[styles.infoAmount, { color: statusColor }]}>GH₵{todayCommission.amount || dailyFee}</Text>
                </View>
              );
            })() : (
              <View style={[styles.infoCard, { borderColor: GOLD + '50', backgroundColor: '#1A1400' }]}>
                <MaterialIcons name="account-balance-wallet" size={18} color={GOLD} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.infoTitle, { color: GOLD }]}>Daily Platform Fee</Text>
                  <Text style={styles.infoSub}>Not yet paid today — go online to pay automatically</Text>
                </View>
                <Text style={[styles.infoAmount, { color: GOLD }]}>GH₵{dailyFee}</Text>
              </View>
            )}

            {/* Acceptance Rate */}
            {acceptanceRate !== undefined && (
              <View style={[styles.rateCard, {
                borderColor: acceptanceRate >= 80 ? GREEN + '50' : acceptanceRate >= 60 ? GOLD + '50' : RED + '50',
                backgroundColor: acceptanceRate >= 80 ? '#001A00' : acceptanceRate >= 60 ? '#1A1400' : '#1A0000',
              }]}>
                <View style={styles.rateHeader}>
                  <MaterialIcons name="check-circle" size={18} color={acceptanceRate >= 80 ? GREEN : acceptanceRate >= 60 ? GOLD : RED} />
                  <Text style={styles.rateTitle}>Acceptance Rate</Text>
                  <Text style={[styles.rateValue, { color: acceptanceRate >= 80 ? GREEN : acceptanceRate >= 60 ? GOLD : RED }]}>
                    {acceptanceRate}%
                  </Text>
                </View>
                <View style={styles.rateTrack}>
                  <View style={[styles.rateFill, {
                    width: `${Math.min(acceptanceRate, 100)}%`,
                    backgroundColor: acceptanceRate >= 80 ? GREEN : acceptanceRate >= 60 ? GOLD : RED,
                  }]} />
                </View>
                <Text style={styles.rateSub}>
                  {acceptanceRate >= 80
                    ? 'Great! High acceptance keeps you a priority driver.'
                    : acceptanceRate >= 60
                    ? 'Accepting more rides improves your dispatch priority.'
                    : 'Low acceptance rate — try to accept more rides.'}
                </Text>
              </View>
            )}

            {/* Weekly Challenge */}
            <View style={styles.challengeCard}>
              <View style={styles.challengeHeader}>
                <MaterialIcons name="emoji-events" size={22} color={GOLD} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.challengeTitle}>Weekly Challenge</Text>
                  <Text style={styles.challengeSubtitle}>Complete 10 rides this week</Text>
                </View>
                <View style={styles.challengeReward}>
                  <Text style={styles.challengeRewardText}>GH₵{CHALLENGE_BONUS}</Text>
                  <Text style={styles.challengeRewardLabel}>Bonus</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <Animated.View style={[styles.progressFill, {
                  width: challengeProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  backgroundColor: last7Trips.length >= CHALLENGE_TARGET ? GREEN : GOLD,
                }]} />
              </View>
              <View style={styles.challengeFooter}>
                <Text style={styles.challengeCount}>
                  {last7Trips.length >= CHALLENGE_TARGET ? '✓ Challenge Complete!' : `${last7Trips.length} / ${CHALLENGE_TARGET} trips`}
                </Text>
                {last7Trips.length >= CHALLENGE_TARGET
                  ? <Text style={[styles.challengeStatus, { color: GREEN }]}>Bonus paid Monday</Text>
                  : <Text style={styles.challengeStatus}>{CHALLENGE_TARGET - last7Trips.length} more to go</Text>
                }
              </View>
            </View>

            {/* Streak */}
            {totalTrips >= 5 && (
              <View style={styles.streakCard}>
                <Text style={styles.streakFlame}>🔥</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.streakTitle}>{Math.min(totalTrips, 7)}-day streak!</Text>
                  <Text style={styles.streakSub}>Keep it up for a bonus reward</Text>
                </View>
                <View style={styles.streakBadge}>
                  <Text style={styles.streakBadgeText}>+₵5</Text>
                </View>
              </View>
            )}

            {/* Driver Tier */}
            <View style={styles.tierCard}>
              <View style={styles.tierHeader}>
                <MaterialIcons name="star" size={20} color={GOLD} />
                <Text style={styles.tierTitle}>Driver Tier</Text>
              </View>
              <View style={styles.tierRow}>
                {TIERS.map((t) => {
                  const isActive = tier.label === t.label;
                  return (
                    <View key={t.label} style={[styles.tierBadge, isActive && { backgroundColor: t.color + '20', borderColor: t.color }]}>
                      <Text style={[styles.tierBadgeText, isActive && { color: t.color }]}>{t.label}</Text>
                      <Text style={styles.tierBadgeTrips}>{t.min}+ trips</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.tierSubtext}>
                {totalTrips} trips completed · Higher tiers unlock better bonuses
              </Text>
            </View>

            {/* All-Time Summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>All-Time Performance</Text>
              <View style={styles.summaryGrid}>
                <SummaryCell label="Total Revenue" value={`GH₵${totalEarnings.toFixed(2)}`} color={GOLD} />
                <SummaryCell label="Completed Trips" value={String(allCompleted.length)} color={BLUE} />
                <SummaryCell label="Avg GH₵/hr" value={`GH₵${avgHourlyRate.toFixed(2)}`} color="#A78BFA" />
                <SummaryCell label="Avg Fare" value={`GH₵${avgPerTrip.toFixed(2)}`} color={GREEN} />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function KpiCard({ icon, label, value, sub, color }: { icon: any; label: string; value: string; sub: string; color: string }) {
  return (
    <View style={[kpiStyles.card, { borderColor: color + '30' }]}>
      <View style={[kpiStyles.iconWrap, { backgroundColor: color + '15' }]}>
        <MaterialIcons name={icon} size={18} color={color} />
      </View>
      <Text style={kpiStyles.label}>{label}</Text>
      <Text style={[kpiStyles.value, { color }]}>{value}</Text>
      <Text style={kpiStyles.sub}>{sub}</Text>
    </View>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={summaryStyles.cell}>
      <Text style={[summaryStyles.value, { color }]}>{value}</Text>
      <Text style={summaryStyles.label}>{label}</Text>
    </View>
  );
}

const kpiStyles = StyleSheet.create({
  card: { flex: 1, minWidth: '45%', backgroundColor: '#111', borderRadius: 16, padding: 14, borderWidth: 1, gap: 4 },
  iconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  label: { fontSize: 11, color: '#9CA3AF' },
  value: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 11, color: '#9CA3AF' },
});

const summaryStyles = StyleSheet.create({
  cell: { width: '48%', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: '#1A1A1A' },
  value: { fontSize: 20, fontWeight: '800' },
  label: { fontSize: 11, color: '#9CA3AF', marginTop: 4, textAlign: 'center' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  headerTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 12, color: GOLD + 'CC', marginTop: 2 },
  periodRow: { flexDirection: 'row', gap: 8, padding: 16 },
  periodBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#111', borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  periodBtnActive: { backgroundColor: GOLD + '20', borderColor: GOLD },
  periodText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  periodTextActive: { color: GOLD },
  loadingWrap: { paddingVertical: 60, alignItems: 'center' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  chartCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: CARD, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: BORDER },
  chartTitle: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 16 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barAmount: { fontSize: 9, color: GOLD, fontWeight: '600' },
  barTrack: { flex: 1, width: '100%', backgroundColor: '#1A1A1A', borderRadius: 4, justifyContent: 'flex-end' },
  barFill: { backgroundColor: GOLD, borderRadius: 4, minHeight: 4 },
  barDay: { fontSize: 10, color: MUTED, fontWeight: '600' },
  barTrips: { fontSize: 9, color: MUTED },
  infoCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 16, borderRadius: 16, padding: 14, borderWidth: 1 },
  infoTitle: { fontSize: 13, fontWeight: '700' },
  infoSub: { fontSize: 11, color: MUTED, marginTop: 2 },
  infoAmount: { fontSize: 22, fontWeight: '800' },
  rateCard: { marginHorizontal: 16, marginBottom: 16, borderRadius: 16, padding: 14, borderWidth: 1 },
  rateHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rateTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: TEXT },
  rateValue: { fontSize: 18, fontWeight: '800' },
  rateTrack: { height: 8, backgroundColor: '#1A1A1A', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  rateFill: { height: '100%', borderRadius: 4 },
  rateSub: { fontSize: 11, color: MUTED },
  challengeCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: '#0D1A00', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#1A3300' },
  challengeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  challengeTitle: { fontSize: 15, fontWeight: '700', color: TEXT },
  challengeSubtitle: { fontSize: 12, color: MUTED, marginTop: 2 },
  challengeReward: { alignItems: 'center', backgroundColor: GOLD + '20', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  challengeRewardText: { fontSize: 16, fontWeight: '800', color: GOLD },
  challengeRewardLabel: { fontSize: 10, color: MUTED },
  progressTrack: { height: 8, backgroundColor: '#1A2A00', borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: '100%', borderRadius: 4 },
  challengeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  challengeCount: { fontSize: 13, fontWeight: '700', color: TEXT },
  challengeStatus: { fontSize: 12, color: MUTED },
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 16, backgroundColor: '#1A0A00', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#3A1A00' },
  streakFlame: { fontSize: 28 },
  streakTitle: { fontSize: 14, fontWeight: '700', color: TEXT },
  streakSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  streakBadge: { backgroundColor: '#FF6B0020', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#FF6B0040' },
  streakBadgeText: { fontSize: 14, fontWeight: '800', color: '#FF6B00' },
  tierCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: CARD, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: BORDER },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  tierTitle: { fontSize: 15, fontWeight: '700', color: TEXT },
  tierRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tierBadge: { flex: 1, alignItems: 'center', padding: 10, borderRadius: 10, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: BORDER },
  tierBadgeText: { fontSize: 11, fontWeight: '700', color: MUTED },
  tierBadgeTrips: { fontSize: 9, color: MUTED, marginTop: 2 },
  tierSubtext: { fontSize: 12, color: MUTED, textAlign: 'center' },
  summaryCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: CARD, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: BORDER },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 14 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
