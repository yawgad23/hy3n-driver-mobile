import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Linking } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { useColors } from '@/hooks/use-colors';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const BORDER = '#2A2A2A';
const MUTED = '#9CA3AF';

// ─── Commission Gate ──────────────────────────────────────────────────────────
function CommissionGate({ driver }: { driver: any }) {
  const colors = useColors();
  // Fee based on vehicle type: GH₵50 for cars, GH₵30 for okada/delivery
  const vehicleType = (driver.vehicle_type || driver.category || '').toLowerCase();
  const isOkadaOrDelivery = vehicleType.includes('okada') || vehicleType.includes('motor') || vehicleType.includes('delivery') || vehicleType.includes('bike');
  const feeAmount = isOkadaOrDelivery ? 30 : 50;
  const [amount, setAmount] = useState(String(feeAmount));
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reference.trim()) {
      setError('Please enter your MoMo reference number.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const driverId = driver.user_id || driver.id;
      await firestoreDB.create(COLLECTIONS.DAILY_COMMISSION, {
        driver_id: driverId,
        driver_name: driver.full_name,
        date: today,
        amount: parseFloat(amount) || feeAmount,
        reference: reference.trim(),
        status: 'pending',
        submitted_at: new Date().toISOString(),
      });
      setSubmitted(true);
    } catch (err: any) {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <View style={[styles.gateContainer, { backgroundColor: colors.background }]}>
        <MaterialIcons name="check-circle" size={72} color="#22C55E" />
        <Text style={[styles.gateTitle, { color: colors.foreground }]}>Payment Submitted!</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          Your payment is being verified by admin. You'll be able to go online once confirmed. This usually takes a few minutes.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.gateContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.gateIconBox, { backgroundColor: GOLD + '20' }]}>
        <MaterialIcons name="account-balance-wallet" size={40} color={GOLD} />
      </View>
      <Text style={[styles.gateTitle, { color: colors.foreground }]}>
        Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'},{' '}
        {driver.full_name?.split(' ')[0]}!
      </Text>
      <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
        Pay your daily platform fee via MoMo to start receiving rides today.
      </Text>

      <View style={[styles.commissionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.commissionLabel, { color: colors.muted }]}>Daily Platform Fee</Text>
        <Text style={[styles.commissionAmount, { color: GOLD }]}>GH₵ {feeAmount}.00</Text>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.commissionMomo, { color: colors.muted }]}>
          Send to MoMo:{' '}
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>0546728330</Text>
        </Text>
        <Text style={[styles.commissionMomo, { color: colors.muted }]}>
          Name:{' '}
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>HY3N Technologies</Text>
        </Text>
      </View>

      <View style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.inputLabel, { color: colors.muted }]}>MoMo Reference Number</Text>
        <TextInput
          style={[styles.inputField, { color: colors.foreground }]}
          placeholder="e.g. 1234567890"
          placeholderTextColor={colors.muted}
          value={reference}
          onChangeText={setReference}
          returnKeyType="done"
        />
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: GOLD, opacity: submitting ? 0.7 : 1 }]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Text style={styles.submitBtnText}>{submitting ? 'Submitting...' : 'Submit Payment'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Approval Gate ────────────────────────────────────────────────────────────
function ApprovalGate({ driver }: { driver: any }) {
  const colors = useColors();
  const router = useRouter();
  const isRejected = driver.approval_status === 'rejected';

  return (
    <View style={[styles.gateContainer, { backgroundColor: colors.background, flex: 1 }]}>
      <View style={[styles.gateIconBox, {
        backgroundColor: isRejected ? '#EF444420' : '#F59E0B20',
      }]}>
        <MaterialIcons
          name={isRejected ? 'cancel' : 'access-time'}
          size={40}
          color={isRejected ? '#EF4444' : '#F59E0B'}
        />
      </View>
      <Text style={[styles.gateTitle, { color: colors.foreground }]}>
        {isRejected ? 'Application Not Approved' : 'Application Under Review'}
      </Text>
      <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
        {isRejected
          ? 'Unfortunately, your driver application was not approved at this time. Please contact our support team for more information or to reapply.'
          : `Welcome, ${driver.full_name?.split(' ')[0]}! Your application is being reviewed by our admin team. You will be notified once approved.`}
      </Text>
      {isRejected ? (
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD }]}
          onPress={() => router.push('/driver/register' as any)}
        >
          <Text style={styles.submitBtnText}>Reapply</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
          onPress={() => Linking.openURL('mailto:hello@ridehy3n.com')}
        >
          <Text style={[styles.submitBtnText, { color: colors.foreground }]}>Contact Support</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── No Profile Gate ──────────────────────────────────────────────────────────
function NoProfileGate() {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[styles.gateContainer, { backgroundColor: colors.background, flex: 1 }]}>
      <View style={[styles.gateIconBox, { backgroundColor: GOLD + '20' }]}>
        <MaterialIcons name="directions-car" size={40} color={GOLD} />
      </View>
      <Text style={[styles.gateTitle, { color: colors.foreground }]}>HY3N Driver</Text>
      <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
        Your account is not yet linked to a driver profile. Register as a driver to get started.
      </Text>
      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: GOLD }]}
        onPress={() => router.push('/driver/register' as any)}
      >
        <Text style={styles.submitBtnText}>Register as a Driver</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Shell ───────────────────────────────────────────────────────────────
export default function DriverTabLayout() {
  const { driverProfile, loading } = useDriverAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === 'web' ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  const [commissionConfirmed, setCommissionConfirmed] = useState(false);
  const [checkingCommission, setCheckingCommission] = useState(true);
  const [lostItemAlerts, setLostItemAlerts] = useState<any[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  // Check today's commission
  useEffect(() => {
    if (!driverProfile || driverProfile.approval_status !== 'approved') {
      setCheckingCommission(false);
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const driverId = (driverProfile as any).user_id || driverProfile.id;
    firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId, date: today })
      .then((records: any[]) => {
        setCommissionConfirmed(records.some((r: any) => r.status === 'confirmed'));
      })
      .catch(() => setCommissionConfirmed(false))
      .finally(() => setCheckingCommission(false));

    // Poll every 15s for admin confirmation
    const interval = setInterval(() => {
      firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId, date: today })
        .then((records: any[]) => {
          setCommissionConfirmed(records.some((r: any) => r.status === 'confirmed'));
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [driverProfile]);

  // Subscribe to lost item alerts
  useEffect(() => {
    if (!driverProfile) return;
    const driverId = (driverProfile as any).user_id || driverProfile.id;
    const unsubscribe = firestoreDB.subscribe(
      'RideReport',
      { driver_id: driverId, report_type: 'lost_item' },
      (reports: any[]) => {
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        setLostItemAlerts(
          reports.filter(
            (r: any) => r.status === 'open' && new Date(r.created_date).getTime() > cutoff
          )
        );
      }
    );
    return unsubscribe;
  }, [driverProfile]);

  const visibleAlerts = lostItemAlerts.filter(a => !dismissedAlerts.includes(a.id));

  if (loading || checkingCommission) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading driver profile...</Text>
      </View>
    );
  }

  if (!driverProfile) return <NoProfileGate />;

  if (
    driverProfile.approval_status === 'pending' ||
    driverProfile.approval_status === 'rejected' ||
    !driverProfile.approval_status
  ) {
    return <ApprovalGate driver={driverProfile} />;
  }

  if (!commissionConfirmed) {
    return (
      <View style={{ flex: 1 }}>
        <CommissionGate driver={driverProfile} />
        {/* Tab bar still visible */}
        <View style={[styles.staticTabBar, {
          backgroundColor: BG,
          borderTopColor: BORDER,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
        }]}>
          {[
            { icon: 'home', label: 'Home' },
            { icon: 'history', label: 'History' },
            { icon: 'account-balance-wallet', label: 'Earnings' },
            { icon: 'person', label: 'Profile' },
            { icon: 'settings', label: 'Settings' },
          ].map((tab) => (
            <View key={tab.label} style={styles.staticTabItem}>
              <MaterialIcons name={tab.icon as any} size={24} color={MUTED} />
              <Text style={[styles.staticTabLabel, { color: MUTED }]}>{tab.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Lost Item Alert Banners */}
      {visibleAlerts.length > 0 && (
        <View style={[styles.alertBanner, { top: insets.top + 8 }]}>
          {visibleAlerts.map((alert) => (
            <View key={alert.id} style={styles.alertCard}>
              <View style={styles.alertIcon}>
                <MaterialIcons name="inventory" size={20} color="#000" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>🎒 Lost Item Alert</Text>
                <Text style={styles.alertBody} numberOfLines={2}>
                  A rider reported leaving a {alert.category?.replace('lost_', '') || 'item'} in your vehicle. Please check your car.
                </Text>
                {alert.rider_phone && (
                  <Text
                    style={styles.alertPhone}
                    onPress={() => Linking.openURL(`tel:${alert.rider_phone}`)}
                  >
                    Call rider: {alert.rider_phone}
                  </Text>
                )}
                <Text style={styles.alertRef}>Ref: {alert.ticket_ref}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setDismissedAlerts(p => [...p, alert.id])}
                style={styles.alertClose}
              >
                <MaterialIcons name="close" size={16} color="#000" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Tabs
        screenOptions={{
          tabBarActiveTintColor: GOLD,
          tabBarInactiveTintColor: MUTED,
          headerShown: false,
          tabBarStyle: {
            paddingTop: 8,
            paddingBottom: bottomPadding,
            height: tabBarHeight,
            backgroundColor: BG,
            borderTopColor: BORDER,
            borderTopWidth: 0.5,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <MaterialIcons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'History',
            tabBarIcon: ({ color, size }) => <MaterialIcons name="history" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="earnings"
          options={{
            title: 'Earnings',
            tabBarIcon: ({ color, size }) => <MaterialIcons name="account-balance-wallet" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <MaterialIcons name="person" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => <MaterialIcons name="settings" size={size} color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 14, marginTop: 12 },
  gateContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 16,
  },
  gateIconBox: {
    width: 96,
    height: 96,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  gateTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  gateSubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  commissionCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  commissionLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  commissionAmount: { fontSize: 36, fontWeight: '800' },
  divider: { width: '100%', height: 1, marginVertical: 8 },
  commissionMomo: { fontSize: 13 },
  inputBox: { width: '100%', borderRadius: 12, borderWidth: 1, padding: 14 },
  inputLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  inputField: { fontSize: 16, fontWeight: '600' },
  errorText: { color: '#EF4444', fontSize: 13, textAlign: 'center' },
  submitBtn: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  staticTabBar: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    paddingTop: 8,
  },
  staticTabItem: { flex: 1, alignItems: 'center', gap: 2 },
  staticTabLabel: { fontSize: 10, fontWeight: '600' },
  alertBanner: { position: 'absolute', left: 12, right: 12, zIndex: 100, gap: 8 },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F59E0B',
    borderRadius: 16,
    padding: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: { fontWeight: '700', fontSize: 13, color: '#000' },
  alertBody: { fontSize: 12, color: '#000', opacity: 0.8, marginTop: 2 },
  alertPhone: { fontSize: 12, fontWeight: '700', color: '#000', textDecorationLine: 'underline', marginTop: 2 },
  alertRef: { fontSize: 10, color: '#000', opacity: 0.6, marginTop: 2 },
  alertClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
