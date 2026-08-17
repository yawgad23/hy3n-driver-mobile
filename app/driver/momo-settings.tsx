import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLLECTIONS, firestoreDB } from '@/lib/firebase';
import { useDriverAuth } from '@/lib/driver-auth-context';

const GOLD = '#D4AF37'; const BG = '#0A0A0A'; const CARD = '#111111'; const BORDER = '#2A2A2A'; const TEXT = '#FAFAFA'; const MUTED = '#9CA3AF'; const GREEN = '#22C55E';
const PROVIDERS = ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'];

export default function MoMoSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, driverProfile, updateDriverProfile } = useDriverAuth();
  const [provider, setProvider] = useState('MTN MoMo');
  const [number, setNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProvider(driverProfile?.momo_provider || 'MTN MoMo');
    setNumber(driverProfile?.momo_number || '');
    setAccountName(driverProfile?.momo_account_name || driverProfile?.full_name || '');
  }, [driverProfile]);

  const save = async () => {
    const normalized = number.replace(/\s+/g, '');
    if (!/^0\d{9}$/.test(normalized) && !/^233\d{9}$/.test(normalized)) {
      Alert.alert('Check your number', 'Enter a valid Ghana mobile-money number, for example 024 123 4567.'); return;
    }
    if (!accountName.trim()) { Alert.alert('Account name required', 'Enter the name registered with the mobile-money provider.'); return; }
    setSaving(true);
    try {
      const payload = { momo_provider: provider, momo_number: normalized, momo_account_name: accountName.trim(), momo_updated_at: new Date().toISOString() };
      if (driverProfile?.id) await updateDriverProfile(payload);
      else if (user?.uid) await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, user.uid, payload);
      Alert.alert('Payout method saved', 'Your earnings will be paid to this mobile-money account after applicable verification.');
    } catch { Alert.alert('Unable to save', 'Please try again.'); }
    finally { setSaving(false); }
  };

  return <View style={[styles.container, { paddingTop: insets.top }]}>
    <View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={TEXT} /></TouchableOpacity><View><Text style={styles.headerTitle}>MoMo payout settings</Text><Text style={styles.headerSub}>Manage where your earnings are sent</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.secureBanner}><MaterialIcons name="verified-user" size={22} color={GREEN} /><View style={{ flex: 1 }}><Text style={styles.secureTitle}>Secure payout information</Text><Text style={styles.secureText}>Your number is used only for verified driver payouts and support checks.</Text></View></View>
      <Text style={styles.label}>Mobile-money provider</Text>
      <View style={styles.providerWrap}>{PROVIDERS.map((item) => <TouchableOpacity key={item} style={[styles.provider, provider === item && styles.providerActive]} onPress={() => setProvider(item)}><Text style={[styles.providerText, provider === item && styles.providerTextActive]}>{item}</Text>{provider === item && <MaterialIcons name="check-circle" size={17} color={GOLD} />}</TouchableOpacity>)}</View>
      <Text style={styles.label}>Mobile-money number</Text><TextInput style={styles.input} value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="024 123 4567" placeholderTextColor="#6B7280" maxLength={13} />
      <Text style={styles.label}>Registered account name</Text><TextInput style={styles.input} value={accountName} onChangeText={setAccountName} placeholder="Full name on MoMo account" placeholderTextColor="#6B7280" autoCapitalize="words" />
      <View style={styles.info}><MaterialIcons name="info-outline" size={19} color={GOLD} /><Text style={styles.infoText}>Payout changes may be verified before they take effect. Never share your MoMo PIN or OTP.</Text></View>
      <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.7 }]} onPress={save} disabled={saving}>{saving ? <ActivityIndicator color="#000" /> : <Text style={styles.saveText}>Save payout method</Text>}</TouchableOpacity>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: TEXT, fontSize: 20, fontWeight: '900' }, headerSub: { color: MUTED, fontSize: 12, marginTop: 2 }, content: { padding: 16, paddingBottom: 44 }, secureBanner: { flexDirection: 'row', gap: 12, backgroundColor: '#052E16', borderWidth: 1, borderColor: '#14532D', borderRadius: 14, padding: 14, marginBottom: 24 }, secureTitle: { color: '#BBF7D0', fontWeight: '900', fontSize: 13 }, secureText: { color: '#86EFAC', fontSize: 12, lineHeight: 17, marginTop: 3 }, label: { color: MUTED, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 9, marginTop: 18 }, providerWrap: { gap: 9 }, provider: { minHeight: 49, borderWidth: 1, borderColor: BORDER, borderRadius: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD }, providerActive: { borderColor: GOLD, backgroundColor: '#1A1400' }, providerText: { color: TEXT, fontSize: 14, fontWeight: '700' }, providerTextActive: { color: GOLD }, input: { height: 53, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 11, paddingHorizontal: 14, color: TEXT, fontSize: 15 }, info: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 22, backgroundColor: '#1A1400', borderRadius: 11, padding: 13 }, infoText: { flex: 1, color: '#FDE68A', lineHeight: 18, fontSize: 12 }, saveButton: { height: 53, borderRadius: 12, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 28 }, saveText: { color: '#000', fontSize: 15, fontWeight: '900' },
});
