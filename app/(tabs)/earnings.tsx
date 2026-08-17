import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { Colors } from '@/constants/theme';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const BLUE = '#3B82F6';
const PURPLE = '#A78BFA';
const COMMISSION_RATE = 0.15;
type Period = 'day' | 'week' | 'month';
type Ride = Record<string, any>;

const TIERS = [
  { label: 'Bronze', min: 0, color: '#CD7F32' }, { label: 'Silver', min: 50, color: '#C0C0C0' },
  { label: 'Gold', min: 150, color: GOLD }, { label: 'Platinum', min: 300, color: '#E5E4E2' },
];

function getTier(trips: number) { return [...TIERS].reverse().find((tier) => trips >= tier.min) || TIERS[0]; }
function timestampOf(ride: Ride) { return new Date(ride.completed_at || ride.created_date || ride.updated_date || 0); }
function fareOf(ride: Ride) { return Number(ride.final_fare ?? ride.fare ?? ride.fare_estimate ?? 0); }
function commissionOf(ride: Ride) { const fare = fareOf(ride); return Number(ride.commission ?? ride.commission_amount ?? (fare * COMMISSION_RATE)); }
function displayDay(date: Date) { return date.toLocaleDateString('en-GH', { weekday: 'short' }); }

export default function DriverEarningsScreen() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';
  const themeColors = Colors[isDark ? 'dark' : 'light'];
  const { user, driverProfile } = useDriverAuth();
  const [period, setPeriod] = useState<Period>('week');
  const [completed, setCompleted] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayCommission, setTodayCommission] = useState<Ride | null>(null);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      firestoreDB.list(COLLECTIONS.RIDES, { driver_id: user.uid, status: 'completed' }),
      firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: user.uid, date: new Date().toISOString().slice(0, 10) }),
    ]).then(([rides, fees]) => {
      setCompleted(rides as Ride[]);
      setTodayCommission((fees as Ride[]).find((fee) => ['paid', 'confirmed'].includes(fee.status)) || (fees as Ride[])[0] || null);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user?.uid]);

  const dashboard = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    if (period === 'day') start.setHours(0, 0, 0, 0);
    if (period === 'week') { start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0); }
    if (period === 'month') { start.setDate(now.getDate() - 29); start.setHours(0, 0, 0, 0); }
    const selected = completed.filter((ride) => timestampOf(ride) >= start);
    const gross = selected.reduce((sum, ride) => sum + fareOf(ride), 0);
    const commission = selected.reduce((sum, ride) => sum + commissionOf(ride), 0);
    const tips = selected.reduce((sum, ride) => sum + Number(ride.tip_amount || 0), 0);
    const net = Math.max(0, gross - commission + tips);

    const unitCount = period === 'day' ? 6 : period === 'week' ? 7 : 4;
    const buckets = Array.from({ length: unitCount }, (_, index) => {
      const bucketStart = new Date(now);
      let label = '';
      if (period === 'day') { bucketStart.setHours(index * 4, 0, 0, 0); label = `${String(index * 4).padStart(2, '0')}:00`; }
      else if (period === 'week') { bucketStart.setDate(now.getDate() - (6 - index)); bucketStart.setHours(0, 0, 0, 0); label = displayDay(bucketStart); }
      else { bucketStart.setDate(now.getDate() - ((3 - index) * 7 + 6)); bucketStart.setHours(0, 0, 0, 0); label = `Week ${index + 1}`; }
      const bucketEnd = new Date(bucketStart);
      if (period === 'day') bucketEnd.setHours(bucketStart.getHours() + 4);
      else if (period === 'week') bucketEnd.setDate(bucketStart.getDate() + 1);
      else bucketEnd.setDate(bucketStart.getDate() + 7);
      const rides = selected.filter((ride) => { const stamp = timestampOf(ride); return stamp >= bucketStart && stamp < bucketEnd; });
      return { label, total: rides.reduce((sum, ride) => sum + fareOf(ride), 0), rides: rides.length };
    });

    const categories = selected.reduce<Record<string, number>>((acc, ride) => {
      const category = String(ride.category || ride.service_type || 'Standard'); acc[category] = (acc[category] || 0) + fareOf(ride); return acc;
    }, {});
    return { selected, gross, commission, tips, net, buckets, categories, average: selected.length ? net / selected.length : 0 };
  }, [completed, period]);

  const maxBucket = Math.max(...dashboard.buckets.map((bucket) => bucket.total), 1);
  const totalCategoryValue = Math.max(Object.values(dashboard.categories).reduce((sum, value) => sum + value, 0), 1);
  const categoryColors = [GOLD, BLUE, PURPLE, GREEN];
  const title = period === 'day' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Last 30 days';
  const tier = getTier(driverProfile?.total_trips || 0);
  const dynamic = { container: { backgroundColor: themeColors.background }, card: { backgroundColor: isDark ? '#111111' : '#FFFFFF', borderColor: themeColors.border }, text: { color: themeColors.text }, muted: { color: themeColors.muted } };

  return <View style={[styles.container, dynamic.container]}>
    <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: themeColors.border }]}><Text style={[styles.headerTitle, dynamic.text]}>Earnings</Text><Text style={styles.headerSub}>Track what you earn and what you keep</Text></View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <View style={[styles.periodControl, dynamic.card]}>{([['day', 'Today'], ['week', 'Week'], ['month', 'Month']] as const).map(([value, label]) => <TouchableOpacity key={value} style={[styles.periodButton, period === value && styles.periodActive]} onPress={() => setPeriod(value)}><Text style={[styles.periodText, period === value ? styles.periodTextActive : dynamic.muted]}>{label}</Text></TouchableOpacity>)}</View>
      {loading ? <ActivityIndicator color={GOLD} style={{ marginVertical: 46 }} /> : <>
        <View style={[styles.heroCard, dynamic.card]}><Text style={[styles.heroLabel, dynamic.muted]}>NET EARNINGS · {title.toUpperCase()}</Text><Text style={styles.heroAmount}>GH₵{dashboard.net.toFixed(2)}</Text><View style={styles.heroMeta}><Text style={styles.heroMetaText}>{dashboard.selected.length} completed trips</Text><Text style={styles.heroMetaText}>Avg. GH₵{dashboard.average.toFixed(2)} / trip</Text></View></View>
        <View style={styles.kpiGrid}><Kpi icon="payments" label="Gross fares" value={dashboard.gross} color={GOLD} dynamic={dynamic} /><Kpi icon="account-balance-wallet" label="Tips" value={dashboard.tips} color={GREEN} dynamic={dynamic} /><Kpi icon="receipt-long" label="Commission" value={dashboard.commission} color={BLUE} dynamic={dynamic} /><Kpi icon="local-taxi" label="Trips" value={dashboard.selected.length} color={PURPLE} dynamic={dynamic} count /></View>
        <View style={[styles.card, dynamic.card]}><View style={styles.cardTitleRow}><View><Text style={[styles.cardTitle, dynamic.text]}>Earnings trend</Text><Text style={[styles.cardCaption, dynamic.muted]}>Gross fares by {period === 'month' ? 'week' : period === 'week' ? 'day' : 'four-hour period'}</Text></View><MaterialIcons name="show-chart" size={23} color={GOLD} /></View><View style={styles.barChart}>{dashboard.buckets.map((bucket) => <View key={bucket.label} style={styles.barColumn}><Text style={[styles.barValue, dynamic.muted]}>{bucket.total ? `₵${Math.round(bucket.total)}` : ''}</Text><View style={[styles.barTrack, { backgroundColor: isDark ? '#242424' : '#F3F4F6' }]}><View style={[styles.barFill, { height: `${Math.max(5, (bucket.total / maxBucket) * 100)}%` }]} /></View><Text style={[styles.barLabel, dynamic.muted]}>{bucket.label}</Text></View>)}</View></View>
        <View style={[styles.card, dynamic.card]}><Text style={[styles.cardTitle, dynamic.text]}>Your earnings breakdown</Text><View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, dynamic.muted]}>Gross fares</Text><Text style={[styles.breakdownValue, dynamic.text]}>GH₵{dashboard.gross.toFixed(2)}</Text></View><View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, dynamic.muted]}>Tips</Text><Text style={[styles.breakdownValue, { color: GREEN }]}>+ GH₵{dashboard.tips.toFixed(2)}</Text></View><View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, dynamic.muted]}>Service commission</Text><Text style={[styles.breakdownValue, { color: '#F87171' }]}>− GH₵{dashboard.commission.toFixed(2)}</Text></View><View style={[styles.totalRow, { borderTopColor: themeColors.border }]}><Text style={[styles.totalLabel, dynamic.text]}>Net earnings</Text><Text style={styles.totalValue}>GH₵{dashboard.net.toFixed(2)}</Text></View></View>
        <View style={[styles.card, dynamic.card]}><Text style={[styles.cardTitle, dynamic.text]}>Fare mix</Text>{Object.keys(dashboard.categories).length === 0 ? <Text style={[styles.emptyText, dynamic.muted]}>Complete trips to see your earning mix.</Text> : Object.entries(dashboard.categories).map(([category, value], index) => <View key={category} style={styles.mixRow}><View style={[styles.mixDot, { backgroundColor: categoryColors[index % categoryColors.length] }]} /><Text style={[styles.mixLabel, dynamic.text]}>{category}</Text><View style={[styles.mixTrack, { backgroundColor: isDark ? '#242424' : '#F3F4F6' }]}><View style={[styles.mixFill, { backgroundColor: categoryColors[index % categoryColors.length], width: `${(value / totalCategoryValue) * 100}%` }]} /></View><Text style={[styles.mixValue, dynamic.text]}>GH₵{value.toFixed(0)}</Text></View>)}</View>
        {todayCommission && <View style={[styles.feeCard, { borderColor: GREEN + '55' }]}><MaterialIcons name="verified" size={21} color={GREEN} /><View style={{ flex: 1 }}><Text style={styles.feeTitle}>Daily fee paid</Text><Text style={styles.feeText}>Your driver access is active until midnight.</Text></View><Text style={styles.feeAmount}>GH₵{Number(todayCommission.amount || 0).toFixed(0)}</Text></View>}
        <View style={[styles.tierCard, dynamic.card]}><View style={[styles.tierIcon, { backgroundColor: tier.color + '24' }]}><MaterialIcons name="workspace-premium" size={25} color={tier.color} /></View><View style={{ flex: 1 }}><Text style={[styles.cardTitle, dynamic.text]}>{tier.label} driver</Text><Text style={[styles.cardCaption, dynamic.muted]}>{driverProfile?.total_trips || 0} lifetime trips · Keep driving to unlock tier rewards.</Text></View></View>
      </>}
    </ScrollView>
  </View>;
}
function Kpi({ icon, label, value, color, dynamic, count = false }: { icon: any; label: string; value: number; color: string; dynamic: any; count?: boolean }) { return <View style={[styles.kpiCard, dynamic.card]}><MaterialIcons name={icon} size={18} color={color} /><Text style={[styles.kpiValue, dynamic.text]}>{count ? value : `GH₵${value.toFixed(0)}`}</Text><Text style={[styles.kpiLabel, dynamic.muted]}>{label}</Text></View>; }
const styles = StyleSheet.create({
  container: { flex: 1 }, header: { paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1 }, headerTitle: { fontSize: 27, fontWeight: '900' }, headerSub: { fontSize: 13, color: GOLD, fontWeight: '700', marginTop: 3 }, content: { padding: 16, paddingBottom: 100, gap: 14 }, periodControl: { flexDirection: 'row', borderWidth: 1, padding: 4, borderRadius: 13 }, periodButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 9 }, periodActive: { backgroundColor: GOLD }, periodText: { fontSize: 13, fontWeight: '800' }, periodTextActive: { color: '#000' }, heroCard: { borderWidth: 1, borderRadius: 19, padding: 19 }, heroLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7 }, heroAmount: { color: GOLD, fontSize: 32, fontWeight: '900', marginTop: 6 }, heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 11 }, heroMetaText: { color: '#AFAFAF', fontSize: 11, fontWeight: '700' }, kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, kpiCard: { width: '48.5%', borderWidth: 1, borderRadius: 14, padding: 13 }, kpiValue: { fontSize: 18, fontWeight: '900', marginTop: 7 }, kpiLabel: { fontSize: 11, fontWeight: '700', marginTop: 3 }, card: { borderWidth: 1, borderRadius: 17, padding: 16 }, cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, cardTitle: { fontSize: 16, fontWeight: '900' }, cardCaption: { fontSize: 11, marginTop: 3 }, barChart: { height: 160, flexDirection: 'row', gap: 7, alignItems: 'flex-end', marginTop: 16 }, barColumn: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }, barValue: { fontSize: 9, marginBottom: 4 }, barTrack: { flex: 1, width: '100%', borderRadius: 5, justifyContent: 'flex-end', overflow: 'hidden' }, barFill: { width: '100%', borderRadius: 5, backgroundColor: GOLD }, barLabel: { fontSize: 9, marginTop: 6 }, breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }, breakdownLabel: { fontSize: 13 }, breakdownValue: { fontSize: 13, fontWeight: '800' }, totalRow: { borderTopWidth: 1, marginTop: 14, paddingTop: 13, flexDirection: 'row', justifyContent: 'space-between' }, totalLabel: { fontSize: 15, fontWeight: '900' }, totalValue: { color: GOLD, fontSize: 17, fontWeight: '900' }, mixRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }, mixDot: { width: 8, height: 8, borderRadius: 4 }, mixLabel: { width: 68, fontSize: 12, fontWeight: '700' }, mixTrack: { height: 8, borderRadius: 4, flex: 1, overflow: 'hidden' }, mixFill: { height: '100%', borderRadius: 4 }, mixValue: { width: 47, textAlign: 'right', fontSize: 11, fontWeight: '800' }, emptyText: { fontSize: 13, marginTop: 13 }, feeCard: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#052E16', borderWidth: 1, borderRadius: 15, padding: 14 }, feeTitle: { color: GREEN, fontSize: 13, fontWeight: '900' }, feeText: { color: '#86EFAC', fontSize: 11, marginTop: 2 }, feeAmount: { color: '#BBF7D0', fontWeight: '900', fontSize: 15 }, tierCard: { flexDirection: 'row', alignItems: 'center', gap: 12 }, tierIcon: { width: 49, height: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
