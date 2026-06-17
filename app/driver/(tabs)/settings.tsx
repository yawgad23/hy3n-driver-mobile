import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { router } from 'expo-router';
import { useDriverPreferences } from '@/hooks/use-driver-preferences';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const RED = '#EF4444';
const GREEN = '#22C55E';

export default function DriverSettingsScreen() {
  const { driverProfile, signOut } = useDriverAuth();
  const insets = useSafeAreaInsets();
  const [deleting, setDeleting] = useState(false);
  const { prefs, toggle, saving, loaded } = useDriverPreferences();

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your driver profile, trip history, and all personal data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              if (driverProfile?.id) {
                await firestoreDB.delete(COLLECTIONS.DRIVER_PROFILES, driverProfile.id);
              }
              await signOut();
              router.replace('/driver/login' as any);
            } catch {
              Alert.alert('Error', 'Failed to delete account. Please try again or contact hello@ridehy3n.com');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const prefRows: {
    key: keyof typeof prefs;
    icon: string;
    label: string;
    desc: string;
    iconColor: string;
  }[] = [
    {
      key: 'notifications',
      icon: prefs.notifications ? 'notifications' : 'notifications-off',
      label: 'Push Notifications',
      desc: 'Alerts for new trip requests',
      iconColor: '#3B82F6',
    },
    {
      key: 'soundAlerts',
      icon: prefs.soundAlerts ? 'volume-up' : 'volume-off',
      label: 'Sound Alerts',
      desc: 'Audio ping for incoming trips',
      iconColor: '#A855F7',
    },
    {
      key: 'autoAccept',
      icon: 'flash-on',
      label: 'Auto-Accept Trips',
      desc: 'Automatically accept nearby requests',
      iconColor: '#EAB308',
    },
    {
      key: 'longTripsOnly',
      icon: 'map',
      label: 'Long Trips Only',
      desc: 'Only show trips over 10 km',
      iconColor: '#22C55E',
    },
    {
      key: 'preferHighRated',
      icon: 'star',
      label: 'Prefer High-Rated Riders',
      desc: 'Prioritise riders rated 4.5+',
      iconColor: '#F97316',
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        {saving && (
          <View style={styles.savingBadge}>
            <ActivityIndicator size="small" color={GOLD} />
            <Text style={styles.savingText}>Saving…</Text>
          </View>
        )}
        {!saving && loaded && (
          <View style={styles.savedBadge}>
            <MaterialIcons name="cloud-done" size={14} color={GREEN} />
            <Text style={styles.savedText}>Synced</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}>
        {/* Driver Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Driver Preferences</Text>
          {prefRows.map((row, i) => (
            <View key={row.key}>
              <View style={styles.prefRow}>
                <View style={[styles.prefIcon, { backgroundColor: row.iconColor + '20' }]}>
                  <MaterialIcons name={row.icon as any} size={20} color={row.iconColor} />
                </View>
                <View style={styles.prefText}>
                  <Text style={styles.prefLabel}>{row.label}</Text>
                  <Text style={styles.prefDesc}>{row.desc}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={() => toggle(row.key)}
                  trackColor={{ false: BORDER, true: GOLD + '80' }}
                  thumbColor={prefs[row.key] ? GOLD : MUTED}
                  ios_backgroundColor={BORDER}
                />
              </View>
              {i < prefRows.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/* Auto-Accept info banner */}
        {prefs.autoAccept && (
          <View style={styles.autoAcceptBanner}>
            <MaterialIcons name="flash-on" size={18} color="#EAB308" />
            <Text style={styles.autoAcceptText}>
              Auto-Accept is on. New ride requests will be accepted automatically — no tap needed.
            </Text>
          </View>
        )}

        {/* Account Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.infoRow}>
            <MaterialIcons name="person" size={18} color={MUTED} />
            <Text style={styles.infoLabel}>Name</Text>
            <Text style={styles.infoValue}>{driverProfile?.full_name || '—'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <MaterialIcons name="email" size={18} color={MUTED} />
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{driverProfile?.email || '—'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <MaterialIcons name="phone" size={18} color={MUTED} />
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{driverProfile?.phone || '—'}</Text>
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <TouchableOpacity
            style={styles.supportRow}
            onPress={() => router.push('/support' as any)}
            activeOpacity={0.75}
          >
            <MaterialIcons name="help-outline" size={20} color={GOLD} />
            <Text style={styles.supportText}>Help & Support</Text>
            <MaterialIcons name="chevron-right" size={20} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <View style={[styles.section, styles.dangerSection]}>
          <Text style={[styles.sectionTitle, { color: RED }]}>Danger Zone</Text>
          <Text style={styles.dangerDesc}>
            Permanently delete your driver profile and all associated data. This action cannot be undone.
          </Text>
          <TouchableOpacity
            style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
            onPress={handleDeleteAccount}
            disabled={deleting}
            activeOpacity={0.8}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="delete-forever" size={20} color="#fff" />
            )}
            <Text style={styles.deleteBtnText}>{deleting ? 'Deleting...' : 'Delete My Account'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '800', color: TEXT },
  savingBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  savingText: { fontSize: 12, color: GOLD },
  savedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  savedText: { fontSize: 12, color: '#22C55E' },
  scroll: { flex: 1 },
  section: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  prefIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefText: { flex: 1 },
  prefLabel: { fontSize: 14, fontWeight: '600', color: TEXT },
  prefDesc: { fontSize: 12, color: MUTED, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: BORDER, marginVertical: 2 },
  autoAcceptBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#EAB30810',
    borderWidth: 1,
    borderColor: '#EAB30840',
    borderRadius: 12,
    padding: 12,
  },
  autoAcceptText: { flex: 1, fontSize: 13, color: '#EAB308', lineHeight: 18 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  infoLabel: { flex: 1, fontSize: 14, color: MUTED },
  infoValue: { fontSize: 14, fontWeight: '600', color: TEXT, maxWidth: '55%', textAlign: 'right' },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  supportText: { flex: 1, fontSize: 14, fontWeight: '600', color: TEXT },
  dangerSection: { borderColor: '#EF444440' },
  dangerDesc: { fontSize: 13, color: MUTED, lineHeight: 20, marginBottom: 12 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: RED,
    borderRadius: 12,
    height: 48,
  },
  deleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
