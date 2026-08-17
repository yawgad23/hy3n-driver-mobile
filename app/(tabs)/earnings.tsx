import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { Colors } from '@/constants/theme';
import { trpc } from '@/lib/trpc';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const BLUE = '#3B82F6';
const PURPLE = '#A78BFA';
type Period = 'today' | 'week' | 'month';

const TIERS = [
  { label: 'Bronze', min: 0, color: '#CD7F32' }, { label: 'Silver', min: 50, color: '#C0C0C0' },
  { label: 'Gold', min: 150, color: GOLD }, { label: 'Platinum', min: 300, color: '#E5E4E2' },
];

function getTier(trips: number) { return [...TIERS].reverse().find((tier) => trips >= tier.min) || TIERS[0]; }
function titleForPeriod(period: Period) { return period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Last 30 days'; }
function trendLabel(date: string, period: Period) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '—';
  if (period === 'month') return value.toLocaleDateString('en-GH', { month: 'short', day: 'numeric' });
  return value.toLocaleDateString('en-GH', { weekday: 'short' });
}

export default function DriverEarningsScreen() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';
  const themeColors = Colors[isDark ? 'dark' : 'light'];
  const { user, driverProfile } = useDriverAuth();
  const [period, setPeriod] = useState<Period>('week');
  const [goalAmount, setGoalAmount] = useState('');
  const financeQuery = trpc.driverFinance.getOverview.useQuery(
    { driverId: user?.uid || '', period },
    { enabled: Boolean(user?.uid) },
  );
  const saveGoal = trpc.driverFinance.saveGoal.useMutation({
    onSuccess: async () => {
      setGoalAmount('');
      await financeQuery.refetch();
      Alert.alert('Goal saved', 'Your earnings goal is now visible on this dashboard.');
    },
    onError: (error) => Alert.alert('Unable to save goal', error.message || 'Please try again.'),
  });

  const setEarningsGoal = () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Please sign in again before setting an earnings goal.');
      return;
    }
    if (period === 'month') {
      Alert.alert('Choose a shorter period', 'Earnings goals are currently available for Today and Week.');
      return;
    }
    const targetAmount = Number(goalAmount);
    if (!Number.isFinite(targetAmount) || targetAmount < 10) {
      Alert.alert('Check your goal', 'Enter a target of at least GH₵10.00.');
      return;
    }
    saveGoal.mutate({ driverId: user.uid, period, targetAmount });
  };

  const overview = financeQuery.data;
  const totals = overview?.totals || { gross: 0, net: 0, tips: 0, commission: 0, tripCount: 0, averagePerTrip: 0, availableBalance: 0 };
  const trend = overview?.trend || [];
  const maxTrend = Math.max(...trend.map((item) => item.amount), 1);
  const title = titleForPeriod(period);
  const tier = getTier(driverProfile?.total_trips || 0);
  const dynamic = { container: { backgroundColor: themeColors.background }, card: { backgroundColor: isDark ? '#111111' : '#FFFFFF', borderColor: themeColors.border }, text: { color: themeColors.text }, muted: { color: themeColors.muted } };
  const goal = overview?.goal;

  return <View style={[styles.container, dynamic.container]}>
    <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: themeColors.border }]}><Text style={[styles.headerTitle, dynamic.text]}>Earnings</Text><Text style={styles.headerSub}>Track what you earn and what you keep</Text></View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <View style={[styles.periodControl, dynamic.card]}>{([['today', 'Today'], ['week', 'Week'], ['month', 'Month']] as const).map(([value, label]) => <TouchableOpacity key={value} style={[styles.periodButton, period === value && styles.periodActive]} onPress={() => setPeriod(value)}><Text style={[styles.periodText, period === value ? styles.periodTextActive : dynamic.muted]}>{label}</Text></TouchableOpacity>)}</View>
      {financeQuery.isLoading ? <ActivityIndicator color={GOLD} style={{ marginVertical: 46 }} /> : <>
        <View style={[styles.heroCard, dynamic.card]}><Text style={[styles.heroLabel, dynamic.muted]}>NET EARNINGS · {title.toUpperCase()}</Text><Text style={styles.heroAmount}>GH₵{Number(totals.net).toFixed(2)}</Text><View style={styles.heroMeta}><Text style={styles.heroMetaText}>{totals.tripCount} completed trips</Text><Text style={styles.heroMetaText}>Avg. GH₵{Number(totals.averagePerTrip).toFixed(2)} / trip</Text></View></View>
        <View style={styles.kpiGrid}><Kpi icon="payments" label="Gross fares" value={totals.gross} color={GOLD} dynamic={dynamic} /><Kpi icon="account-balance-wallet" label="Tips" value={totals.tips} color={GREEN} dynamic={dynamic} /><Kpi icon="receipt-long" label="Commission" value={totals.commission} color={BLUE} dynamic={dynamic} /><Kpi icon="local-taxi" label="Trips" value={totals.tripCount} color={PURPLE} dynamic={dynamic} count /></View>
        <View style={[styles.card, dynamic.card]}><View style={styles.cardTitleRow}><View><Text style={[styles.cardTitle, dynamic.text]}>Earnings trend</Text><Text style={[styles.cardCaption, dynamic.muted]}>Net earnings by completed-trip date</Text></View><MaterialIcons name="show-chart" size={23} color={GOLD} /></View>{trend.length === 0 ? <Text style={[styles.emptyText, dynamic.muted]}>Complete trips to see your earnings trend.</Text> : <View style={styles.barChart}>{trend.map((item) => <View key={item.date} style={styles.barColumn}><Text style={[styles.barValue, dynamic.muted]}>{item.amount ? `₵${Math.round(item.amount)}` : ''}</Text><View style={[styles.barTrack, { backgroundColor: isDark ? '#242424' : '#F3F4F6' }]}><View style={[styles.barFill, { height: `${Math.max(5, (item.amount / maxTrend) * 100)}%` }]} /></View><Text style={[styles.barLabel, dynamic.muted]}>{trendLabel(item.date, period)}</Text></View>)}</View>}</View>
        <View style={[styles.card, dynamic.card]}><Text style={[styles.cardTitle, dynamic.text]}>Your earnings breakdown</Text><View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, dynamic.muted]}>Gross fares</Text><Text style={[styles.breakdownValue, dynamic.text]}>GH₵{Number(totals.gross).toFixed(2)}</Text></View><View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, dynamic.muted]}>Tips</Text><Text style={[styles.breakdownValue, { color: GREEN }]}>+ GH₵{Number(totals.tips).toFixed(2)}</Text></View><View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, dynamic.muted]}>Service commission</Text><Text style={[styles.breakdownValue, { color: '#F87171' }]}>− GH₵{Number(totals.commission).toFixed(2)}</Text></View><View style={[styles.totalRow, { borderTopColor: themeColors.border }]}><Text style={[styles.totalLabel, dynamic.text]}>Net earnings</Text><Text style={styles.totalValue}>GH₵{Number(totals.net).toFixed(2)}</Text></View></View>
        <View style={[styles.balanceCard, dynamic.card]}><View><Text style={[styles.cardTitle, dynamic.text]}>Available to withdraw</Text><Text style={[styles.cardCaption, dynamic.muted]}>Based on settled net earnings and payout requests</Text></View><Text style={styles.balanceAmount}>GH₵{Number(totals.availableBalance).toFixed(2)}</Text></View>
        <View style={[styles.card, dynamic.card]}><View style={styles.cardTitleRow}><View><Text style={[styles.cardTitle, dynamic.text]}>Earnings goal</Text><Text style={[styles.cardCaption, dynamic.muted]}>{period === 'month' ? 'Set goals for Today or Week' : goal ? `${goal.percent}% of your target achieved` : 'Create a focused target for this period'}</Text></View><MaterialIcons name="flag" size={22} color={GOLD} /></View>{goal ? <View style={styles.goalProgress}><View style={[styles.goalTrack, { backgroundColor: isDark ? '#242424' : '#F3F4F6' }]}><View style={[styles.goalFill, { width: `${Math.max(1, goal.percent)}%` }]} /></View><View style={styles.goalMeta}><Text style={[styles.cardCaption, dynamic.muted]}>GH₵{Number(goal.progress).toFixed(0)} earned</Text><Text style={[styles.cardCaption, dynamic.text]}>Target GH₵{Number(goal.amount).toFixed(0)}</Text></View></View> : null}{period !== 'month' ? <View style={styles.goalForm}><TextInput style={[styles.goalInput, { borderColor: themeColors.border, color: themeColors.text }]} value={goalAmount} onChangeText={setGoalAmount} keyboardType="decimal-pad" placeholder="Target amount" placeholderTextColor="#6B7280" /><TouchableOpacity style={[styles.goalButton, saveGoal.isPending && { opacity: 0.65 }]} onPress={setEarningsGoal} disabled={saveGoal.isPending}>{saveGoal.isPending ? <ActivityIndicator color="#000" /> : <Text style={styles.goalButtonText}>{goal ? 'Update goal' : 'Set goal'}</Text>}</TouchableOpacity></View> : null}</View>
        <View style={[styles.tierCard, dynamic.card]}><View style={[styles.tierIcon, { backgroundColor: tier.color + '24' }]}><MaterialIcons name="workspace-premium" size={25} color={tier.color} /></View><View style={{ flex: 1 }}><Text style={[styles.cardTitle, dynamic.text]}>{tier.label} driver</Text><Text style={[styles.cardCaption, dynamic.muted]}>{driverProfile?.total_trips || 0} lifetime trips · Keep driving to unlock tier rewards.</Text></View></View>
      </>}
    </ScrollView>
  </View>;
}
function Kpi({ icon, label, value, color, dynamic, count = false }: { icon: any; label: string; value: number; color: string; dynamic: any; count?: boolean }) { return <View style={[styles.kpiCard, dynamic.card]}><MaterialIcons name={icon} size={18} color={color} /><Text style={[styles.kpiValue, dynamic.text]}>{count ? value : `GH₵${Number(value).toFixed(0)}`}</Text><Text style={[styles.kpiLabel, dynamic.muted]}>{label}</Text></View>; }
const styles = StyleSheet.create({
  container: { flex: 1 }, header: { paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1 }, headerTitle: { fontSize: 27, fontWeight: '900' }, headerSub: { fontSize: 13, color: GOLD, fontWeight: '700', marginTop: 3 }, content: { padding: 16, paddingBottom: 100, gap: 14 }, periodControl: { flexDirection: 'row', borderWidth: 1, padding: 4, borderRadius: 13 }, periodButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 9 }, periodActive: { backgroundColor: GOLD }, periodText: { fontSize: 13, fontWeight: '800' }, periodTextActive: { color: '#000' }, heroCard: { borderWidth: 1, borderRadius: 19, padding: 19 }, heroLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7 }, heroAmount: { color: GOLD, fontSize: 32, fontWeight: '900', marginTop: 6 }, heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 11 }, heroMetaText: { color: '#AFAFAF', fontSize: 11, fontWeight: '700' }, kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, kpiCard: { width: '48.5%', borderWidth: 1, borderRadius: 14, padding: 13 }, kpiValue: { fontSize: 18, fontWeight: '900', marginTop: 7 }, kpiLabel: { fontSize: 11, fontWeight: '700', marginTop: 3 }, card: { borderWidth: 1, borderRadius: 17, padding: 16 }, cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, cardTitle: { fontSize: 16, fontWeight: '900' }, cardCaption: { fontSize: 11, marginTop: 3 }, barChart: { height: 160, flexDirection: 'row', gap: 7, alignItems: 'flex-end', marginTop: 16 }, barColumn: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }, barValue: { fontSize: 9, marginBottom: 4 }, barTrack: { flex: 1, width: '100%', borderRadius: 5, justifyContent: 'flex-end', overflow: 'hidden' }, barFill: { width: '100%', borderRadius: 5, backgroundColor: GOLD }, barLabel: { fontSize: 9, marginTop: 6 }, breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }, breakdownLabel: { fontSize: 13 }, breakdownValue: { fontSize: 13, fontWeight: '800' }, totalRow: { borderTopWidth: 1, marginTop: 14, paddingTop: 13, flexDirection: 'row', justifyContent: 'space-between' }, totalLabel: { fontSize: 15, fontWeight: '900' }, totalValue: { color: GOLD, fontSize: 17, fontWeight: '900' }, emptyText: { fontSize: 13, marginTop: 13 }, balanceCard: { borderWidth: 1, borderRadius: 17, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, balanceAmount: { color: GREEN, fontSize: 20, fontWeight: '900' }, goalProgress: { marginTop: 17 }, goalTrack: { height: 9, borderRadius: 5, overflow: 'hidden' }, goalFill: { height: '100%', backgroundColor: GOLD, borderRadius: 5 }, goalMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }, goalForm: { flexDirection: 'row', gap: 9, marginTop: 15 }, goalInput: { flex: 1, height: 45, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 }, goalButton: { minWidth: 96, height: 45, borderRadius: 10, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, goalButtonText: { color: '#000', fontWeight: '900', fontSize: 12 }, tierCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 17, padding: 16 }, tierIcon: { width: 49, height: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
