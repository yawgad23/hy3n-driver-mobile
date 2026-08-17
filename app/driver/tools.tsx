import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { trpc } from '@/lib/trpc';

const GOLD = '#D4AF37'; const BG = '#0A0A0A'; const CARD = '#111111'; const BORDER = '#2A2A2A'; const TEXT = '#FAFAFA'; const MUTED = '#9CA3AF'; const GREEN = '#22C55E'; const RED = '#EF4444';
const CATEGORIES = [
  { key: 'standard', label: 'Standard', icon: 'directions-car' },
  { key: 'comfort', label: 'Comfort', icon: 'airline-seat-recline-normal' },
  { key: 'xl', label: 'XL', icon: 'airport-shuttle' },
  { key: 'delivery', label: 'Delivery', icon: 'local-shipping' },
] as const;
const RADII = [3, 5, 8, 12, 20];
const HAZARDS = [
  { value: 'accident', label: 'Accident', icon: 'car-crash' },
  { value: 'road_closure', label: 'Road closed', icon: 'block' },
  { value: 'flooding', label: 'Flooding', icon: 'water' },
  { value: 'security', label: 'Security', icon: 'shield' },
  { value: 'traffic', label: 'Traffic', icon: 'traffic' },
] as const;
type HazardType = (typeof HAZARDS)[number]['value'];

function metric(value: number | null | undefined, suffix = '') { return value === null || value === undefined ? '—' : `${value}${suffix}`; }

export default function DriverToolsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useDriverAuth();
  const [rideCategories, setRideCategories] = useState<string[]>(['standard']);
  const [pickupRadiusKm, setPickupRadiusKm] = useState(10);
  const [autoAccept, setAutoAccept] = useState(false);
  const [destinationLabel, setDestinationLabel] = useState('');
  const [destinationLatitude, setDestinationLatitude] = useState('');
  const [destinationLongitude, setDestinationLongitude] = useState('');
  const [hazardType, setHazardType] = useState<HazardType>('traffic');
  const [hazardDescription, setHazardDescription] = useState('');

  const preferencesQuery = trpc.driverOperations.getPreferences.useQuery(
    { driverId: user?.uid || '' },
    { enabled: Boolean(user?.uid) },
  );
  const performanceQuery = trpc.driverPerformance.getOverview.useQuery(
    { driverId: user?.uid || '' },
    { enabled: Boolean(user?.uid) },
  );
  const incentivesQuery = trpc.driverFinance.listIncentives.useQuery(
    { driverId: user?.uid || '' },
    { enabled: Boolean(user?.uid) },
  );
  const savePreferences = trpc.driverOperations.savePreferences.useMutation({
    onSuccess: async (result) => {
      await preferencesQuery.refetch();
      Alert.alert('Driver tools updated', `Your dispatch settings have been saved. ${result.destinationUsesRemaining} destination-filter use${result.destinationUsesRemaining === 1 ? '' : 's'} remain today.`);
    },
    onError: (error) => Alert.alert('Unable to save settings', error.message || 'Please try again.'),
  });
  const clearDestination = trpc.driverOperations.clearDestinationFilter.useMutation({
    onSuccess: async () => {
      setDestinationLabel(''); setDestinationLatitude(''); setDestinationLongitude('');
      await preferencesQuery.refetch();
      Alert.alert('Destination filter cleared', 'You will receive eligible requests in your selected pickup radius.');
    },
    onError: (error) => Alert.alert('Unable to clear filter', error.message || 'Please try again.'),
  });
  const reportHazard = trpc.driverSafety.reportRoadHazard.useMutation({
    onSuccess: () => {
      setHazardDescription('');
      Alert.alert('Hazard shared', 'Nearby HY3N drivers can now consider this report while planning their route.');
    },
    onError: (error) => Alert.alert('Unable to share hazard', error.message || 'Please try again.'),
  });

  useEffect(() => {
    const prefs = preferencesQuery.data?.preferences;
    if (!prefs) return;
    setRideCategories(prefs.rideCategories.length ? prefs.rideCategories : ['standard']);
    setPickupRadiusKm(prefs.pickupRadiusKm || 10);
    setAutoAccept(Boolean(prefs.autoAccept));
    setDestinationLabel(prefs.destination?.label || '');
    setDestinationLatitude(prefs.destination?.latitude?.toString() || '');
    setDestinationLongitude(prefs.destination?.longitude?.toString() || '');
  }, [preferencesQuery.data]);

  const toggleCategory = (category: string) => {
    setRideCategories((current) => {
      if (current.includes(category)) return current.length > 1 ? current.filter((item) => item !== category) : current;
      return [...current, category];
    });
  };

  const saveTools = () => {
    if (!user?.uid) { Alert.alert('Sign in required', 'Please sign in again before saving driver tools.'); return; }
    const hasDestinationFields = Boolean(destinationLabel || destinationLatitude || destinationLongitude);
    const latitude = Number(destinationLatitude);
    const longitude = Number(destinationLongitude);
    if (hasDestinationFields && (!destinationLabel.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      Alert.alert('Complete your destination', 'Enter a destination label and valid latitude and longitude, or clear all destination fields.');
      return;
    }
    savePreferences.mutate({
      driverId: user.uid,
      rideCategories,
      pickupRadiusKm,
      autoAccept,
      ...(hasDestinationFields ? { destination: { label: destinationLabel.trim(), latitude, longitude } } : {}),
    });
  };

  const shareHazard = async () => {
    if (!user?.uid) { Alert.alert('Sign in required', 'Please sign in again before reporting a road hazard.'); return; }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Location required', 'Allow location access to share the hazard at its current location.');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      reportHazard.mutate({
        driverId: user.uid,
        type: hazardType,
        description: hazardDescription.trim() || undefined,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch {
      Alert.alert('Location unavailable', 'We could not determine your current location. Please try again in an open area.');
    }
  };

  const prefs = preferencesQuery.data?.preferences;
  const metrics = performanceQuery.data?.metrics;
  const incentives = incentivesQuery.data?.incentives || [];
  const loading = preferencesQuery.isLoading || performanceQuery.isLoading || incentivesQuery.isLoading;
  const destinationActive = Boolean(prefs?.destination);

  return <View style={[styles.container, { paddingTop: insets.top }]}> 
    <View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={TEXT} /></TouchableOpacity><View><Text style={styles.headerTitle}>Driver tools</Text><Text style={styles.headerSub}>Shape the trips you receive and track your progress</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color={GOLD} style={{ marginVertical: 30 }} /> : null}
      <Text style={styles.sectionTitle}>Trip preferences</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ride categories</Text><Text style={styles.caption}>Choose the trips your vehicle can serve.</Text>
        <View style={styles.categoryGrid}>{CATEGORIES.map((category) => { const selected = rideCategories.includes(category.key); return <TouchableOpacity key={category.key} onPress={() => toggleCategory(category.key)} style={[styles.categoryTile, selected && styles.categorySelected]}><MaterialIcons name={category.icon as any} size={20} color={selected ? GOLD : MUTED} /><Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{category.label}</Text><MaterialIcons name={selected ? 'check-circle' : 'radio-button-unchecked'} size={18} color={selected ? GOLD : MUTED} /></TouchableOpacity>; })}</View>
        <Text style={styles.label}>Maximum pickup distance</Text><View style={styles.radiusWrap}>{RADII.map((radius) => <TouchableOpacity key={radius} onPress={() => setPickupRadiusKm(radius)} style={[styles.radius, pickupRadiusKm === radius && styles.radiusSelected]}><Text style={[styles.radiusText, pickupRadiusKm === radius && styles.radiusTextSelected]}>{radius} km</Text></TouchableOpacity>)}</View>
        <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.switchTitle}>Auto-accept matching trips</Text><Text style={styles.caption}>Only applies to trips that meet your preferences.</Text></View><Switch value={autoAccept} onValueChange={setAutoAccept} trackColor={{ false: '#3F3F46', true: '#806B1F' }} thumbColor={autoAccept ? GOLD : '#D4D4D8'} /></View>
      </View>

      <Text style={styles.sectionTitle}>Destination filter</Text>
      <View style={styles.card}><View style={styles.cardTitleRow}><View><Text style={styles.cardTitle}>Head in the right direction</Text><Text style={styles.caption}>{destinationActive ? `${prefs?.destinationUsesRemaining ?? 0} change${(prefs?.destinationUsesRemaining ?? 0) === 1 ? '' : 's'} left today` : 'Up to two destination changes per day'}</Text></View><MaterialIcons name="near-me" size={23} color={GOLD} /></View><TextInput style={styles.input} value={destinationLabel} onChangeText={setDestinationLabel} placeholder="Destination label, e.g. Airport" placeholderTextColor="#6B7280" /><View style={styles.coordinateRow}><TextInput style={[styles.input, styles.coordinateInput]} value={destinationLatitude} onChangeText={setDestinationLatitude} keyboardType="decimal-pad" placeholder="Latitude" placeholderTextColor="#6B7280" /><TextInput style={[styles.input, styles.coordinateInput]} value={destinationLongitude} onChangeText={setDestinationLongitude} keyboardType="decimal-pad" placeholder="Longitude" placeholderTextColor="#6B7280" /></View>{destinationActive ? <TouchableOpacity style={styles.clearButton} onPress={() => clearDestination.mutate({ driverId: user?.uid || '' })} disabled={clearDestination.isPending}><Text style={styles.clearText}>{clearDestination.isPending ? 'Clearing…' : 'Clear destination filter'}</Text></TouchableOpacity> : null}</View>
      <TouchableOpacity style={[styles.saveButton, savePreferences.isPending && { opacity: 0.65 }]} onPress={saveTools} disabled={savePreferences.isPending}>{savePreferences.isPending ? <ActivityIndicator color="#000" /> : <Text style={styles.saveText}>Save driver tools</Text>}</TouchableOpacity>

      <Text style={styles.sectionTitle}>Your performance</Text>
      <View style={styles.metricsGrid}><Metric icon="thumb-up" label="Acceptance" value={metric(metrics?.acceptanceRate, '%')} color={GREEN} /><Metric icon="cancel" label="Cancellation" value={metric(metrics?.cancellationRate, '%')} color={RED} /><Metric icon="star" label="Rating" value={metrics?.ratingsCount ? Number(metrics.rating || 0).toFixed(2) : '—'} color={GOLD} /><Metric icon="local-taxi" label="Completed" value={metric(metrics?.completedTrips)} color="#A78BFA" /></View>

      <Text style={styles.sectionTitle}>Active incentives</Text>
      {incentives.length === 0 ? <View style={styles.emptyCard}><MaterialIcons name="redeem" size={22} color={MUTED} /><Text style={styles.emptyText}>No active incentives right now. Check back after you drive more trips.</Text></View> : incentives.map((incentive: any) => <View key={incentive.id} style={styles.incentiveCard}><MaterialIcons name="card-giftcard" size={22} color={GOLD} /><View style={{ flex: 1 }}><Text style={styles.incentiveTitle}>{incentive.title || incentive.name || 'Driver incentive'}</Text><Text style={styles.caption}>{incentive.description || 'Complete eligible trips to earn this reward.'}</Text>{incentive.ends_at ? <Text style={styles.incentiveExpiry}>Ends {new Date(incentive.ends_at).toLocaleDateString()}</Text> : null}</View>{incentive.bonus_amount ? <Text style={styles.incentiveAmount}>GH₵{Number(incentive.bonus_amount).toFixed(0)}</Text> : null}</View>)}

      <Text style={styles.sectionTitle}>Road conditions</Text>
      <View style={styles.card}><Text style={styles.cardTitle}>Help drivers route safely</Text><Text style={styles.caption}>Share a temporary hazard at your current location. Reports automatically expire.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hazardList}>{HAZARDS.map((hazard) => <TouchableOpacity key={hazard.value} onPress={() => setHazardType(hazard.value)} style={[styles.hazardChip, hazardType === hazard.value && styles.hazardSelected]}><MaterialIcons name={hazard.icon as any} size={16} color={hazardType === hazard.value ? GOLD : MUTED} /><Text style={[styles.hazardText, hazardType === hazard.value && styles.hazardTextSelected]}>{hazard.label}</Text></TouchableOpacity>)}</ScrollView><TextInput style={[styles.input, styles.hazardInput]} value={hazardDescription} onChangeText={setHazardDescription} placeholder="Optional details for other drivers" placeholderTextColor="#6B7280" maxLength={300} multiline /><TouchableOpacity style={[styles.hazardButton, reportHazard.isPending && { opacity: 0.65 }]} onPress={shareHazard} disabled={reportHazard.isPending}>{reportHazard.isPending ? <ActivityIndicator color={GOLD} /> : <><MaterialIcons name="warning-amber" size={18} color={GOLD} /><Text style={styles.hazardButtonText}>Report current hazard</Text></>}</TouchableOpacity></View>
    </ScrollView>
  </View>;
}

function Metric({ icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) { return <View style={styles.metricCard}><MaterialIcons name={icon} size={18} color={color} /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: TEXT, fontSize: 21, fontWeight: '900' }, headerSub: { color: MUTED, fontSize: 12, marginTop: 2, maxWidth: 275 }, content: { padding: 16, paddingBottom: 44 }, sectionTitle: { color: MUTED, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }, card: { backgroundColor: CARD, borderRadius: 15, borderWidth: 1, borderColor: BORDER, padding: 14 }, cardTitle: { color: TEXT, fontSize: 15, fontWeight: '900' }, cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, caption: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 3 }, categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 }, categoryTile: { width: '48.5%', borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7 }, categorySelected: { borderColor: GOLD, backgroundColor: '#1A1400' }, categoryText: { color: MUTED, flex: 1, fontSize: 12, fontWeight: '700' }, categoryTextSelected: { color: GOLD }, label: { color: MUTED, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 19, marginBottom: 8 }, radiusWrap: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' }, radius: { borderWidth: 1, borderColor: BORDER, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 }, radiusSelected: { borderColor: GOLD, backgroundColor: '#1A1400' }, radiusText: { color: MUTED, fontSize: 12, fontWeight: '800' }, radiusTextSelected: { color: GOLD }, switchRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER }, switchTitle: { color: TEXT, fontSize: 13, fontWeight: '800' }, input: { height: 48, borderWidth: 1, borderColor: BORDER, borderRadius: 10, color: TEXT, backgroundColor: '#0C0C0C', paddingHorizontal: 12, fontSize: 13, marginTop: 13 }, coordinateRow: { flexDirection: 'row', gap: 9 }, coordinateInput: { flex: 1 }, clearButton: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 8 }, clearText: { color: '#FCA5A5', fontSize: 12, fontWeight: '900' }, saveButton: { height: 52, borderRadius: 12, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, saveText: { color: '#000', fontSize: 14, fontWeight: '900' }, metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, metricCard: { width: '48.5%', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 13, padding: 13 }, metricValue: { color: TEXT, fontSize: 20, fontWeight: '900', marginTop: 7 }, metricLabel: { color: MUTED, fontSize: 11, fontWeight: '700', marginTop: 3 }, emptyCard: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 13, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 10 }, emptyText: { color: MUTED, fontSize: 12, lineHeight: 17, flex: 1 }, incentiveCard: { backgroundColor: CARD, borderWidth: 1, borderColor: '#3A2E00', borderRadius: 13, padding: 14, flexDirection: 'row', gap: 11, alignItems: 'center', marginBottom: 9 }, incentiveTitle: { color: TEXT, fontSize: 14, fontWeight: '900' }, incentiveExpiry: { color: GOLD, fontSize: 11, fontWeight: '800', marginTop: 7 }, incentiveAmount: { color: GOLD, fontSize: 16, fontWeight: '900' }, hazardList: { gap: 8, marginTop: 13, paddingBottom: 2 }, hazardChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 8 }, hazardSelected: { borderColor: GOLD, backgroundColor: '#1A1400' }, hazardText: { color: MUTED, fontSize: 11, fontWeight: '800' }, hazardTextSelected: { color: GOLD }, hazardInput: { minHeight: 68, height: 68, paddingTop: 11, textAlignVertical: 'top' }, hazardButton: { marginTop: 11, height: 45, borderWidth: 1, borderColor: '#6B5520', borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, hazardButtonText: { color: GOLD, fontSize: 13, fontWeight: '900' },
});
