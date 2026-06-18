import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { router } from 'expo-router';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#3B82F6';

// ── Tier config matching web app (0/50/150/300) ────────────────────────────
const TIERS = [
  { label: 'Bronze',   min: 0,   color: '#CD7F32' },
  { label: 'Silver',   min: 50,  color: '#C0C0C0' },
  { label: 'Gold',     min: 150, color: GOLD },
  { label: 'Platinum', min: 300, color: '#E5E4E2' },
];

function getTier(trips: number) {
  return [...TIERS].reverse().find(t => trips >= t.min) || TIERS[0];
}

export default function DriverProfileScreen() {
  const { driverProfile, user, signOut } = useDriverAuth();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/driver' as any);
          } catch {
            Alert.alert('Error', 'Failed to sign out. Please try again.');
          } finally {
            setSigningOut(false);
          }
        }
      }
    ]);
  };

  const handleSupport = () => {
    Linking.openURL('mailto:hello@ridehy3n.com?subject=Driver Support Request');
  };

  const handleWhatsApp = () => {
    Linking.openURL('https://wa.me/233200000000?text=Hi HY3N Support, I need help as a driver.').catch(() => {
      Alert.alert('WhatsApp not installed', 'Please email us at hello@ridehy3n.com');
    });
  };

  const trips = driverProfile?.total_trips || 0;
  const tier = getTier(trips);
  const safetyScore = driverProfile?.safety_metrics?.overall_safety_score ?? 98;

  const safetyGrade = (() => {
    if (safetyScore >= 90) return { grade: 'A+', color: GREEN };
    if (safetyScore >= 80) return { grade: 'A', color: GREEN };
    if (safetyScore >= 70) return { grade: 'B', color: BLUE };
    if (safetyScore >= 60) return { grade: 'C', color: GOLD };
    if (safetyScore >= 50) return { grade: 'D', color: '#F97316' };
    return { grade: 'F', color: RED };
  })();

  const verificationItems = [
    { label: 'Identity Verified', done: true },
    { label: 'License Verified', done: !!driverProfile?.license_number },
    { label: 'Vehicle Inspected', done: !!driverProfile?.vehicle_model },
    { label: 'Background Check', done: true },
    { label: 'Phone Verified', done: !!driverProfile?.phone },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Driver Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* Profile Hero */}
        <View style={styles.heroGradient}>
          <View style={styles.heroContent}>
            <View style={styles.avatar}>
              <MaterialIcons name="person" size={44} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{driverProfile?.full_name || user?.displayName || 'Driver'}</Text>
              <View style={styles.tierBadge}>
                <MaterialIcons name="star" size={13} color={tier.color} />
                <Text style={[styles.tierText, { color: tier.color }]}>{tier.label} Driver</Text>
              </View>
            </View>
          </View>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <StatCell value={(driverProfile?.rating ?? 5.0).toFixed(1)} label="⭐ Rating" color={GOLD} />
            <View style={styles.statDivider} />
            <StatCell value={String(trips)} label="🚗 Trips" color={TEXT} />
            <View style={styles.statDivider} />
            <StatCell value={`${safetyScore}%`} label="🛡 Safety" color={GREEN} />
          </View>
        </View>

        {/* Verification Checklist */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification</Text>
          <View style={styles.infoCard}>
            {verificationItems.map((item, i) => (
              <View key={item.label} style={[styles.verifyRow, i > 0 && { borderTopWidth: 0.5, borderTopColor: BORDER }]}>
                <Text style={styles.verifyLabel}>{item.label}</Text>
                <MaterialIcons
                  name={item.done ? 'check-circle' : 'error-outline'}
                  size={18}
                  color={item.done ? GREEN : MUTED}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Safety Score */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Safety Performance</Text>
          <View style={styles.safetyCard}>
            <View style={[styles.safetyGradeCircle, { borderColor: safetyGrade.color + '60' }]}>
              <Text style={[styles.safetyGrade, { color: safetyGrade.color }]}>{safetyGrade.grade}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.safetyScoreText}>{safetyScore}/100</Text>
              <Text style={styles.safetyLabel}>Safety Score</Text>
              <View style={styles.safetyBar}>
                <View style={[styles.safetyFill, { width: `${safetyScore}%`, backgroundColor: safetyGrade.color }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Driver Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Driver Info</Text>
          <View style={styles.infoCard}>
            <InfoRow icon="phone" label="Phone" value={driverProfile?.phone} color={GREEN} />
            <InfoRow icon="email" label="Email" value={driverProfile?.email || user?.email} color={BLUE} />
            <InfoRow icon="directions-car" label="Vehicle" value={
              driverProfile?.vehicle_make && driverProfile?.vehicle_model
                ? `${driverProfile.vehicle_make} ${driverProfile.vehicle_model}`
                : driverProfile?.vehicle_model
            } color={GOLD} />
            <InfoRow icon="confirmation-number" label="License Plate" value={driverProfile?.vehicle_plate} color="#A78BFA" />
            <InfoRow icon="badge" label="License Number" value={driverProfile?.license_number} color="#F97316" last />
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <View style={styles.infoCard}>
            <TouchableOpacity style={styles.menuRow} onPress={handleWhatsApp} activeOpacity={0.7}>
              <MaterialIcons name="chat" size={20} color={GOLD} />
              <Text style={styles.menuText}>Live Chat (WhatsApp)</Text>
              <MaterialIcons name="chevron-right" size={20} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuRow, { borderTopWidth: 0.5, borderTopColor: BORDER }]} onPress={handleSupport} activeOpacity={0.7}>
              <MaterialIcons name="email" size={20} color={GOLD} />
              <Text style={styles.menuText}>Email Support</Text>
              <MaterialIcons name="chevron-right" size={20} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuRow, { borderTopWidth: 0.5, borderTopColor: BORDER }]} onPress={() => Linking.openURL('https://ridehy3n.com')} activeOpacity={0.7}>
              <MaterialIcons name="language" size={20} color={GOLD} />
              <Text style={styles.menuText}>Visit ridehy3n.com</Text>
              <MaterialIcons name="chevron-right" size={20} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Switch to Rider Mode */}
        <TouchableOpacity
          style={styles.switchRiderBtn}
          onPress={() => Linking.openURL('https://ridehy3n.com')}
          activeOpacity={0.85}
        >
          <MaterialIcons name="directions-car" size={20} color={GOLD} />
          <Text style={styles.switchRiderText}>Switch to User Mode</Text>
          <MaterialIcons name="chevron-right" size={20} color={GOLD} />
        </TouchableOpacity>

        {/* Sign Out */}
        <TouchableOpacity
          style={[styles.signOutBtn, signingOut && { opacity: 0.6 }]}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.85}
        >
          <MaterialIcons name="logout" size={20} color={RED} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>HY3N Driver App · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function StatCell({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value, color, last }: { icon: any; label: string; value?: string | null; color: string; last?: boolean }) {
  return (
    <View style={[infoStyles.row, !last && infoStyles.rowBorder]}>
      <View style={[infoStyles.iconWrap, { backgroundColor: color + '15' }]}>
        <MaterialIcons name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={infoStyles.value} numberOfLines={1}>{value || '—'}</Text>
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
  value: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 11, color: MUTED, marginTop: 2 },
});

const infoStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: BORDER },
  iconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, color: MUTED },
  value: { fontSize: 13, fontWeight: '600', color: TEXT, marginTop: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  headerTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  heroGradient: { backgroundColor: '#0D0D0D', borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, marginBottom: 16 },
  heroContent: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  avatar: { width: 72, height: 72, borderRadius: 20, backgroundColor: '#1A1200', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: GOLD + '40' },
  driverName: { fontSize: 20, fontWeight: '800', color: TEXT, marginBottom: 6 },
  tierBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: '#1A1200', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tierText: { fontSize: 12, fontWeight: '700' },
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, borderTopWidth: 0.5, borderTopColor: BORDER },
  statDivider: { width: 0.5, height: 32, backgroundColor: BORDER },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  infoCard: { backgroundColor: CARD, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER },
  verifyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  verifyLabel: { fontSize: 14, color: TEXT },
  safetyCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', gap: 16 },
  safetyGradeCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  safetyGrade: { fontSize: 22, fontWeight: '800' },
  safetyScoreText: { fontSize: 20, fontWeight: '800', color: TEXT },
  safetyLabel: { fontSize: 11, color: MUTED, marginTop: 2, marginBottom: 8 },
  safetyBar: { height: 6, backgroundColor: '#1A1A1A', borderRadius: 3, overflow: 'hidden' },
  safetyFill: { height: '100%', borderRadius: 3 },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  menuText: { flex: 1, color: TEXT, fontSize: 14, fontWeight: '500' },
  switchRiderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 12, backgroundColor: '#1A1400', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, borderWidth: 1, borderColor: '#3A2E00' },
  switchRiderText: { flex: 1, color: GOLD, fontSize: 15, fontWeight: '700', marginLeft: 10 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#2A0000', borderRadius: 14, paddingVertical: 16 },
  signOutText: { color: RED, fontSize: 15, fontWeight: '700' },
  version: { textAlign: 'center', color: MUTED, fontSize: 12, marginBottom: 16 },
});
