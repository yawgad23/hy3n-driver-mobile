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
            router.replace('/driver/login' as any);
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

  const approvalColor = driverProfile?.approval_status === 'approved' ? GREEN : driverProfile?.approval_status === 'rejected' ? RED : GOLD;
  const approvalLabel = driverProfile?.approval_status === 'approved' ? 'Approved' : driverProfile?.approval_status === 'rejected' ? 'Rejected' : 'Pending Review';

  const getTierColor = (tier?: string) => {
    if (tier === 'Platinum') return '#E5E4E2';
    if (tier === 'Gold') return GOLD;
    if (tier === 'Silver') return '#C0C0C0';
    return '#CD7F32';
  };

  const trips = driverProfile?.total_trips || 0;
  const tier = trips >= 500 ? 'Platinum' : trips >= 200 ? 'Gold' : trips >= 50 ? 'Silver' : 'Bronze';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Driver Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Avatar + Name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <MaterialIcons name="person" size={44} color={GOLD} />
          </View>
          <Text style={styles.driverName}>{driverProfile?.full_name || user?.displayName || 'Driver'}</Text>
          <Text style={styles.driverEmail}>{driverProfile?.email || user?.email || ''}</Text>
          <View style={styles.tierBadge}>
            <MaterialIcons name="star" size={14} color={getTierColor(tier)} />
            <Text style={[styles.tierText, { color: getTierColor(tier) }]}>{tier} Driver</Text>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{driverProfile?.rating?.toFixed(1) || '5.0'}</Text>
            <MaterialIcons name="star" size={14} color={GOLD} />
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{driverProfile?.total_trips || 0}</Text>
            <Text style={styles.statLabel}>Total Trips</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: approvalColor, fontSize: 12 }]}>{approvalLabel}</Text>
            <Text style={styles.statLabel}>Status</Text>
          </View>
        </View>

        {/* Vehicle Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vehicle Information</Text>
          <View style={styles.infoCard}>
            <InfoRow icon="directions-car" label="Make & Model" value={driverProfile?.vehicle_make && driverProfile?.vehicle_model ? `${driverProfile.vehicle_make} ${driverProfile.vehicle_model}` : 'Not set'} />
            <InfoRow icon="palette" label="Color" value={driverProfile?.vehicle_color || 'Not set'} />
            <InfoRow icon="confirmation-number" label="Plate Number" value={driverProfile?.vehicle_plate || 'Not set'} />
            <InfoRow icon="badge" label="License Number" value={driverProfile?.license_number || 'Not set'} last />
          </View>
        </View>

        {/* Account Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.infoCard}>
            <InfoRow icon="email" label="Email" value={driverProfile?.email || user?.email || 'Not set'} />
            <InfoRow icon="phone" label="Phone" value={driverProfile?.phone || 'Not set'} last />
          </View>
        </View>

        {/* Safety Score */}
        {driverProfile?.safety_metrics && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Safety Score</Text>
            <View style={styles.safetyCard}>
              <Text style={styles.safetyScore}>{driverProfile.safety_metrics.overall_safety_score || 100}</Text>
              <Text style={styles.safetyLabel}>/ 100</Text>
              <View style={styles.safetyBar}>
                <View style={[styles.safetyFill, { width: `${driverProfile.safety_metrics.overall_safety_score || 100}%` }]} />
              </View>
              <Text style={styles.safetySubtext}>Excellent driving record</Text>
            </View>
          </View>
        )}

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
          onPress={() => router.replace('/(tabs)' as any)}
          activeOpacity={0.85}
        >
          <MaterialIcons name="directions-car" size={20} color={GOLD} />
          <Text style={styles.switchRiderText}>Switch to Rider Mode</Text>
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

function InfoRow({ icon, label, value, last }: { icon: any; label: string; value: string; last?: boolean }) {
  return (
    <View style={[infoStyles.row, !last && infoStyles.rowBorder]}>
      <MaterialIcons name={icon} size={18} color="#9CA3AF" style={{ marginRight: 10 }} />
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={infoStyles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: '#2A2A2A' },
  label: { flex: 1, color: '#9CA3AF', fontSize: 13 },
  value: { color: '#FAFAFA', fontSize: 13, fontWeight: '600', maxWidth: '55%', textAlign: 'right' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  headerTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1A1200', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  driverName: { fontSize: 20, fontWeight: '800', color: TEXT },
  driverEmail: { fontSize: 13, color: MUTED },
  tierBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1A1200', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  tierText: { fontSize: 13, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: BORDER },
  statValue: { fontSize: 18, fontWeight: '800', color: TEXT },
  statLabel: { fontSize: 11, color: MUTED, textAlign: 'center' },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  infoCard: { backgroundColor: CARD, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  menuText: { flex: 1, color: TEXT, fontSize: 14, fontWeight: '500' },
  safetyCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: 8 },
  safetyScore: { fontSize: 40, fontWeight: '800', color: GREEN },
  safetyLabel: { fontSize: 16, color: MUTED, marginTop: -8 },
  safetyBar: { width: '100%', height: 8, backgroundColor: '#1A1A1A', borderRadius: 4, overflow: 'hidden' },
  safetyFill: { height: '100%', backgroundColor: GREEN, borderRadius: 4 },
  safetySubtext: { fontSize: 13, color: MUTED },
  switchRiderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 12, backgroundColor: '#1A1400', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, borderWidth: 1, borderColor: '#3A2E00' },
  switchRiderText: { flex: 1, color: GOLD, fontSize: 15, fontWeight: '700', marginLeft: 10 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#2A0000', borderRadius: 14, paddingVertical: 16 },
  signOutText: { color: RED, fontSize: 15, fontWeight: '700' },
  version: { textAlign: 'center', color: MUTED, fontSize: 12, marginBottom: 16 },
});
