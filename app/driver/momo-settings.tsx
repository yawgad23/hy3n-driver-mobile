import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { trpc } from '@/lib/trpc';

const GOLD = '#D4AF37'; const BG = '#0A0A0A'; const CARD = '#111111'; const BORDER = '#2A2A2A'; const TEXT = '#FAFAFA'; const MUTED = '#9CA3AF'; const GREEN = '#22C55E';
const PROVIDERS = [
  { label: 'MTN MoMo', value: 'mtn_momo' },
  { label: 'Telecel Cash', value: 'telecel_cash' },
  { label: 'AirtelTigo Money', value: 'airteltigo_money' },
] as const;
type Provider = (typeof PROVIDERS)[number]['value'];

function normaliseNumber(value: string) {
  const compact = value.replace(/[\s-]/g, '');
  if (compact.startsWith('233') && !compact.startsWith('+')) return `0${compact.slice(3)}`;
  return compact;
}

export default function MoMoSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, driverProfile } = useDriverAuth();
  const [provider, setProvider] = useState<Provider>('mtn_momo');
  const [number, setNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const financeQuery = trpc.driverFinance.getOverview.useQuery(
    { driverId: user?.uid || '', period: 'week' },
    { enabled: Boolean(user?.uid) },
  );
  const savePayoutMethod = trpc.driverFinance.savePayoutMethod.useMutation({
    onSuccess: (result) => {
      setSavedMask(result.payoutMethod.accountNumberMasked);
      setNumber('');
      Alert.alert('Payout method saved', `Your earnings will be paid to ${result.payoutMethod.accountNumberMasked} after applicable verification.`);
    },
    onError: (error) => Alert.alert('Unable to save', error.message || 'Please try again.'),
  });
  const requestPayout = trpc.driverFinance.requestPayout.useMutation({
    onSuccess: async (result) => {
      setPayoutAmount('');
      await financeQuery.refetch();
      Alert.alert('Payout requested', `GH₵${Number((result.request as any).amount || 0).toFixed(2)} has been submitted for processing.`);
    },
    onError: (error) => Alert.alert('Payout unavailable', error.message || 'Please try again.'),
  });

  useEffect(() => {
    const matchingProvider = PROVIDERS.find((item) => item.value === driverProfile?.momo_provider);
    setProvider(matchingProvider?.value || 'mtn_momo');
    setAccountName(driverProfile?.momo_account_holder || driverProfile?.momo_account_name || driverProfile?.full_name || '');
    setSavedMask(driverProfile?.momo_number_masked || null);
  }, [driverProfile]);

  const save = () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Please sign in again before saving a payout method.');
      return;
    }
    const normalized = normaliseNumber(number);
    if (!/^(?:\+233|0)\d{9}$/.test(normalized)) {
      Alert.alert('Check your number', 'Enter a valid Ghana mobile-money number, for example 024 123 4567.');
      return;
    }
    if (accountName.trim().length < 2) {
      Alert.alert('Account name required', 'Enter the name registered with the mobile-money provider.');
      return;
    }
    savePayoutMethod.mutate({ driverId: user.uid, provider, accountNumber: normalized, accountHolder: accountName.trim() });
  };

  const submitPayout = () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Please sign in again before requesting a payout.');
      return;
    }
    const amount = Number(payoutAmount);
    if (!Number.isFinite(amount) || amount < 10) {
      Alert.alert('Check payout amount', 'Enter a payout amount of at least GH₵10.00.');
      return;
    }
    requestPayout.mutate({ driverId: user.uid, amount });
  };

  const availableBalance = financeQuery.data?.totals.availableBalance || 0;
  const hasMethod = Boolean(savedMask || driverProfile?.momo_number_masked || driverProfile?.momo_number);

  return <View style={[styles.container, { paddingTop: insets.top }]}>
    <View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={TEXT} /></TouchableOpacity><View><Text style={styles.headerTitle}>MoMo payout settings</Text><Text style={styles.headerSub}>Manage where your earnings are sent</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.secureBanner}><MaterialIcons name="verified-user" size={22} color={GREEN} /><View style={{ flex: 1 }}><Text style={styles.secureTitle}>Secure payout information</Text><Text style={styles.secureText}>Your number is used only for verified driver payouts and support checks.</Text></View></View>
      <Text style={styles.label}>Mobile-money provider</Text>
      <View style={styles.providerWrap}>{PROVIDERS.map((item) => <TouchableOpacity key={item.value} style={[styles.provider, provider === item.value && styles.providerActive]} onPress={() => setProvider(item.value)}><Text style={[styles.providerText, provider === item.value && styles.providerTextActive]}>{item.label}</Text>{provider === item.value && <MaterialIcons name="check-circle" size={17} color={GOLD} />}</TouchableOpacity>)}</View>
      <Text style={styles.label}>Mobile-money number</Text><TextInput style={styles.input} value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder={savedMask || '024 123 4567'} placeholderTextColor="#6B7280" maxLength={14} />
      <Text style={styles.label}>Registered account name</Text><TextInput style={styles.input} value={accountName} onChangeText={setAccountName} placeholder="Full name on MoMo account" placeholderTextColor="#6B7280" autoCapitalize="words" />
      <View style={styles.info}><MaterialIcons name="info-outline" size={19} color={GOLD} /><Text style={styles.infoText}>Payout changes may be verified before they take effect. Never share your MoMo PIN or OTP.</Text></View>
      <TouchableOpacity style={[styles.saveButton, savePayoutMethod.isPending && { opacity: 0.7 }]} onPress={save} disabled={savePayoutMethod.isPending}>{savePayoutMethod.isPending ? <ActivityIndicator color="#000" /> : <Text style={styles.saveText}>Save payout method</Text>}</TouchableOpacity>

      <View style={styles.payoutCard}>
        <View style={styles.payoutHeader}><View><Text style={styles.payoutTitle}>Request a payout</Text><Text style={styles.payoutSubtitle}>Available this week</Text></View><Text style={styles.balance}>GH₵{Number(availableBalance).toFixed(2)}</Text></View>
        <TextInput style={styles.input} value={payoutAmount} onChangeText={setPayoutAmount} keyboardType="decimal-pad" placeholder="Amount to withdraw" placeholderTextColor="#6B7280" />
        <TouchableOpacity style={[styles.requestButton, (!hasMethod || requestPayout.isPending) && { opacity: 0.55 }]} onPress={submitPayout} disabled={!hasMethod || requestPayout.isPending}>{requestPayout.isPending ? <ActivityIndicator color={GOLD} /> : <Text style={styles.requestText}>{hasMethod ? 'Request payout' : 'Save a payout method first'}</Text>}</TouchableOpacity>
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: TEXT, fontSize: 20, fontWeight: '900' }, headerSub: { color: MUTED, fontSize: 12, marginTop: 2 }, content: { padding: 16, paddingBottom: 44 }, secureBanner: { flexDirection: 'row', gap: 12, backgroundColor: '#052E16', borderWidth: 1, borderColor: '#14532D', borderRadius: 14, padding: 14, marginBottom: 24 }, secureTitle: { color: '#BBF7D0', fontWeight: '900', fontSize: 13 }, secureText: { color: '#86EFAC', fontSize: 12, lineHeight: 17, marginTop: 3 }, label: { color: MUTED, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 9, marginTop: 18 }, providerWrap: { gap: 9 }, provider: { minHeight: 49, borderWidth: 1, borderColor: BORDER, borderRadius: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD }, providerActive: { borderColor: GOLD, backgroundColor: '#1A1400' }, providerText: { color: TEXT, fontSize: 14, fontWeight: '700' }, providerTextActive: { color: GOLD }, input: { height: 53, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 11, paddingHorizontal: 14, color: TEXT, fontSize: 15 }, info: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 22, backgroundColor: '#1A1400', borderRadius: 11, padding: 13 }, infoText: { flex: 1, color: '#FDE68A', lineHeight: 18, fontSize: 12 }, saveButton: { height: 53, borderRadius: 12, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 28 }, saveText: { color: '#000', fontSize: 15, fontWeight: '900' }, payoutCard: { marginTop: 28, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 15, padding: 15 }, payoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, payoutTitle: { color: TEXT, fontSize: 16, fontWeight: '900' }, payoutSubtitle: { color: MUTED, fontSize: 12, marginTop: 3 }, balance: { color: GOLD, fontSize: 20, fontWeight: '900' }, requestButton: { height: 47, borderRadius: 11, borderWidth: 1, borderColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 10 }, requestText: { color: GOLD, fontSize: 14, fontWeight: '900' },
});
