import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, ActivityIndicator, Alert } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS } from '@/lib/firebase';
import { useColors } from '@/hooks/use-colors';
import { trpc } from '@/lib/trpc';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const BORDER = '#2A2A2A';
const MUTED = '#9CA3AF';

export const unstable_settings = {
  anchor: 'home',
};

// ─── Sign Out escape hatch — shared by every gate below ──────────────────────
// None of the gates (NoProfile/Approval/Commission) render the real <Tabs>
// navigator, so the Profile tab's sign-out button is unreachable from them.
// Every gate needs its own way out, or a driver who hasn't paid/been approved
// yet is stuck until they kill the app.
function SignOutLink() {
  const { signOut } = useDriverAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          setLoading(true);
          try {
            await signOut();
            router.replace('/');
          } catch {
            Alert.alert('Error', 'Failed to sign out. Please try again.');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  return (
    <TouchableOpacity onPress={handleSignOut} disabled={loading} style={{ marginTop: 16, alignItems: 'center' }}>
      {loading ? (
        <ActivityIndicator size="small" color="#9CA3AF" />
      ) : (
        <Text style={{ color: '#9CA3AF', fontSize: 13, textDecorationLine: 'underline' }}>Sign Out</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Commission Gate (Automatic Hubtel Charge) ───────────────────────────────
type CommissionStatus = 'idle' | 'processing' | 'ussd_sent' | 'paid' | 'failed';

function CommissionGate({ driver, onConfirmed }: { driver: any; onConfirmed: () => void }) {
  const colors = useColors();
  const vehicleType = (driver.service_type || driver.vehicle_type || driver.category || '').toLowerCase();
  const isOkadaOrDelivery = vehicleType.includes('okada') || vehicleType.includes('motor') || vehicleType.includes('delivery') || vehicleType.includes('bike');
  const feeAmount = isOkadaOrDelivery ? 30 : 50;
  const [commissionStatus, setCommissionStatus] = useState<CommissionStatus>('idle');
  const [commissionRecord, setCommissionRecord] = useState<any>(null);
  const [error, setError] = useState('');

  const chargeMutation = trpc.commission.charge.useMutation();

  // Determine MoMo network label for display
  const networkLabels: Record<string, string> = {
    'mtn-gh': 'MTN MoMo',
    'vodafone-gh': 'Vodafone Cash',
    'tigo-gh': 'AirtelTigo Money',
  };
  const momoNetwork = driver.momo_network || 'mtn-gh';
  const networkLabel = networkLabels[momoNetwork] || 'MoMo';
  const momoNumber = driver.momo_number || '';

  // Poll Firestore every 8s while USSD is pending (waiting for driver to approve on phone)
  useEffect(() => {
    if (commissionStatus !== 'ussd_sent') return;
    const driverId = driver.user_id || driver.id;
    const today = new Date().toISOString().split('T')[0];
    const poll = setInterval(() => {
      firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId, date: today })
        .then((records: any[]) => {
          const rec = records.find((r: any) => r.status === 'paid' || r.status === 'confirmed');
          if (rec) {
            setCommissionRecord(rec);
            setCommissionStatus('paid');
            clearInterval(poll);
            setTimeout(onConfirmed, 1800);
          }
          // Also check for failed
          const failed = records.find((r: any) => r.status === 'failed');
          if (failed && !rec) {
            setCommissionRecord(failed);
            setCommissionStatus('failed');
            clearInterval(poll);
          }
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(poll);
  }, [commissionStatus]);

  const handleCharge = async () => {
    if (!momoNumber) {
      setError('No MoMo number found on your profile. Please contact support.');
      return;
    }
    setError('');
    setCommissionStatus('processing');
    const driverId = driver.user_id || driver.id;
    const today = new Date().toISOString().split('T')[0];
    try {
      const result = await chargeMutation.mutateAsync({
        driverId,
        driverName: driver.full_name || 'Driver',
        momoNumber,
        momoNetwork,
        serviceType: driver.service_type || 'car',
        date: today,
      });

      if (result.success) {
        // Write commission record to Firestore with status 'processing'
        const rec = await firestoreDB.create(COLLECTIONS.DAILY_COMMISSION, {
          driver_id: driverId,
          driver_name: driver.full_name,
          date: today,
          amount: feeAmount,
          momo_number: momoNumber,
          momo_network: momoNetwork,
          hubtel_transaction_id: result.transactionId,
          hubtel_reference: result.clientReference,
          status: 'processing',
          charge_method: 'hubtel_auto',
          submitted_at: new Date().toISOString(),
        });
        setCommissionRecord(rec);
        setCommissionStatus('ussd_sent');
      } else {
        // Hubtel charge failed — fall back to showing error with retry
        setError(result.message || 'Payment initiation failed. Please try again.');
        setCommissionStatus('failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to initiate payment. Please try again.');
      setCommissionStatus('failed');
    }
  };

  const handleRetry = () => {
    setCommissionStatus('idle');
    setError('');
    setCommissionRecord(null);
  };

  // ── Paid / Confirmed ──
  if (commissionStatus === 'paid') {
    return (
      <View style={[styles.gateContainer, { backgroundColor: colors.background }]}>
        <MaterialIcons name="check-circle" size={72} color="#22C55E" />
        <Text style={[styles.gateTitle, { color: '#22C55E' }]}>Commission Paid!</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          GH₵{feeAmount} deducted from your {networkLabel}. You're all set — going online now!
        </Text>
      </View>
    );
  }

  // ── USSD Sent (waiting for driver to approve on phone) ──
  if (commissionStatus === 'ussd_sent') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.gateContainer}
      >
        <View style={[styles.gateIconBox, { backgroundColor: '#F59E0B20' }]}>
          <MaterialIcons name="phone-android" size={40} color="#F59E0B" />
        </View>
        <Text style={[styles.gateTitle, { color: colors.foreground }]}>Check Your Phone</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          A USSD prompt has been sent to your {networkLabel} number. Approve the payment of{' '}
          <Text style={{ color: GOLD, fontWeight: '700' }}>GH₵{feeAmount}</Text> on your phone to continue.
        </Text>
        <View style={[styles.commissionCard, { backgroundColor: colors.surface, borderColor: '#F59E0B40' }]}>
          <Text style={[styles.commissionLabel, { color: colors.muted }]}>Awaiting Your Approval</Text>
          <Text style={[styles.commissionAmount, { color: GOLD }]}>GH₵{feeAmount}.00</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.commissionMomo, { color: colors.muted }]}>
            Network: <Text style={{ color: colors.foreground, fontWeight: '700' }}>{networkLabel}</Text>
          </Text>
          <Text style={[styles.commissionMomo, { color: colors.muted }]}>
            Number: <Text style={{ color: colors.foreground, fontWeight: '700' }}>{momoNumber}</Text>
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <ActivityIndicator size="small" color="#F59E0B" />
          <Text style={{ color: '#F59E0B', fontSize: 13 }}>Waiting for your approval...</Text>
        </View>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: BORDER, marginTop: 4 }]}
          onPress={handleRetry}
        >
          <Text style={[styles.submitBtnText, { color: MUTED }]}>Cancel &amp; Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL('https://wa.me/233546728330?text=I%20need%20help%20with%20my%20daily%20commission%20payment')}>
          <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 4 }}>Need help? Contact Support</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Processing (API call in progress) ──
  if (commissionStatus === 'processing') {
    return (
      <View style={[styles.gateContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={[styles.gateTitle, { color: colors.foreground, marginTop: 16 }]}>Initiating Payment...</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          Contacting {networkLabel}. A USSD prompt will appear on your phone shortly.
        </Text>
      </View>
    );
  }

  // ── Failed ──
  if (commissionStatus === 'failed') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.gateContainer}
      >
        <View style={[styles.gateIconBox, { backgroundColor: '#EF444420' }]}>
          <MaterialIcons name="error-outline" size={40} color="#EF4444" />
        </View>
        <Text style={[styles.gateTitle, { color: '#EF4444' }]}>Payment Failed</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          {error || 'The payment could not be processed. Please check your MoMo balance and try again.'}
        </Text>
        <View style={[styles.commissionCard, { backgroundColor: colors.surface, borderColor: '#EF444440' }]}>
          <Text style={[styles.commissionLabel, { color: colors.muted }]}>Daily Platform Fee</Text>
          <Text style={[styles.commissionAmount, { color: GOLD }]}>GH₵{feeAmount}.00</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.commissionMomo, { color: colors.muted }]}>
            Network: <Text style={{ color: colors.foreground, fontWeight: '700' }}>{networkLabel}</Text>
          </Text>
          <Text style={[styles.commissionMomo, { color: colors.muted }]}>
            Number: <Text style={{ color: colors.foreground, fontWeight: '700' }}>{momoNumber}</Text>
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD }]}
          onPress={handleRetry}
        >
          <Text style={styles.submitBtnText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL('https://wa.me/233546728330?text=I%20need%20help%20with%20my%20daily%20commission%20payment')}>
          <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 4 }}>Contact Support</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Idle (initial state — show fee info and Pay Now button) ──
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
        Pay your daily platform fee to start receiving rides today.
      </Text>

      <View style={[styles.commissionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.commissionLabel, { color: colors.muted }]}>Daily Platform Fee</Text>
        <Text style={[styles.commissionAmount, { color: GOLD }]}>GH₵ {feeAmount}.00</Text>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.commissionMomo, { color: colors.muted, textAlign: 'center' }]}>
          Will be charged to your{' '}
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>{networkLabel}</Text>
        </Text>
        {momoNumber ? (
          <Text style={[styles.commissionMomo, { color: colors.muted, textAlign: 'center', marginTop: 2 }]}>
            Number: <Text style={{ color: colors.foreground, fontWeight: '700' }}>{momoNumber}</Text>
          </Text>
        ) : (
          <Text style={{ color: '#EF4444', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
            No MoMo number on file. Contact support.
          </Text>
        )}
      </View>

      <View style={[styles.ussdNote, { backgroundColor: '#1A1A1A', borderColor: BORDER }]}>
        <MaterialIcons name="info-outline" size={16} color={MUTED} style={{ marginTop: 1 }} />
        <Text style={{ color: MUTED, fontSize: 12, flex: 1, lineHeight: 18 }}>
          After tapping Pay Now, you will receive a USSD prompt on your phone. Approve it to complete the payment.
        </Text>
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: GOLD, opacity: !momoNumber ? 0.5 : 1 }]}
        onPress={handleCharge}
        disabled={!momoNumber}
      >
        <MaterialIcons name="payments" size={20} color="#000" style={{ marginRight: 6 }} />
        <Text style={styles.submitBtnText}>Pay GH₵{feeAmount} via {networkLabel}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => Linking.openURL('https://wa.me/233546728330?text=I%20need%20help%20with%20my%20daily%20commission%20payment')}>
        <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 4 }}>Need help? Contact Support</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Approval Gate ────────────────────────────────────────────────────────────
function ApprovalGate({ driver }: { driver: any }) {
  const colors = useColors();
  const router = useRouter();
  const isRejected = driver.approval_status === 'rejected';
  const rejectionReason = driver.rejection_reason || driver.rejection_note || driver.admin_note || '';

  // Timeline steps for pending state
  const steps = [
    { icon: 'check-circle', label: 'Account Created', done: true },
    { icon: 'upload-file', label: 'Documents Uploaded', done: true },
    { icon: 'access-time', label: 'Under Review', done: false, active: true },
    { icon: 'verified', label: 'Approved & Ready', done: false },
  ];

  if (isRejected) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[styles.gateContainer, { paddingBottom: 40 }]}
      >
        <View style={[styles.gateIconBox, { backgroundColor: '#EF444420' }]}>
          <MaterialIcons name="cancel" size={40} color="#EF4444" />
        </View>
        <Text style={[styles.gateTitle, { color: '#EF4444' }]}>Application Not Approved</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          Your driver application was reviewed and could not be approved at this time.
        </Text>

        {/* Rejection Reason Card */}
        {!!rejectionReason && (
          <View style={[styles.rejectionCard, { backgroundColor: '#EF444415', borderColor: '#EF444440' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MaterialIcons name="info" size={18} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 13 }}>Reason from Admin</Text>
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 22 }}>{rejectionReason}</Text>
          </View>
        )}

        {/* What to do next */}
        <View style={[styles.rejectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14, marginBottom: 10 }}>What to do next</Text>
          {[
            'Review the reason above carefully',
            'Update your documents or information',
            'Resubmit your application below',
            'Contact support if you need help',
          ].map((step, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD + '30', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: GOLD, fontSize: 11, fontWeight: '800' }}>{i + 1}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20, flex: 1 }}>{step}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD }]}
          onPress={() => router.push('/driver/reupload-docs' as any)}
        >
          <MaterialIcons name="upload" size={18} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.submitBtnText}>Fix & Resubmit Documents</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ marginTop: 6 }}
          onPress={() => router.push('/register' as any)}
        >
          <Text style={{ color: MUTED, fontSize: 12, textDecorationLine: 'underline', textAlign: 'center' }}>Or restart full application</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ marginTop: 4 }}
          onPress={() => Linking.openURL('https://wa.me/233546728330?text=My%20driver%20application%20was%20rejected.%20Can%20you%20help%3F')}
        >
          <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline', textAlign: 'center' }}>Contact Support via WhatsApp</Text>
        </TouchableOpacity>
        <SignOutLink />
      </ScrollView>
    );
  }

  // Pending state with timeline
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.gateContainer, { paddingBottom: 40 }]}
    >
      <View style={[styles.gateIconBox, { backgroundColor: '#F59E0B20' }]}>
        <MaterialIcons name="access-time" size={40} color="#F59E0B" />
      </View>
      <Text style={[styles.gateTitle, { color: colors.foreground }]}>Application Under Review</Text>
      <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
        Welcome, {driver.full_name?.split(' ')[0]}! Our team is reviewing your application. This usually takes 24–48 hours.
      </Text>

      {/* Timeline */}
      <View style={[styles.rejectionCard, { backgroundColor: colors.surface, borderColor: colors.border, width: '100%' }]}>
        {steps.map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: i < steps.length - 1 ? 18 : 0 }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: step.done ? '#22C55E20' : step.active ? '#F59E0B20' : colors.background,
                borderWidth: 2,
                borderColor: step.done ? '#22C55E' : step.active ? '#F59E0B' : colors.border,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialIcons
                  name={step.icon as any}
                  size={18}
                  color={step.done ? '#22C55E' : step.active ? '#F59E0B' : colors.muted}
                />
              </View>
              {i < steps.length - 1 && (
                <View style={{ width: 2, height: 18, backgroundColor: step.done ? '#22C55E40' : colors.border, marginTop: 4 }} />
              )}
            </View>
            <View style={{ flex: 1, paddingTop: 6 }}>
              <Text style={{ color: step.done ? '#22C55E' : step.active ? '#F59E0B' : colors.muted, fontWeight: '700', fontSize: 14 }}>
                {step.label}
              </Text>
              {step.active && (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Estimated: 24–48 hours</Text>
              )}
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
        onPress={() => Linking.openURL('https://wa.me/233546728330?text=I%20need%20help%20with%20my%20driver%20application')}
      >
        <MaterialIcons name="support-agent" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
        <Text style={[styles.submitBtnText, { color: colors.foreground }]}>Contact Support</Text>
      </TouchableOpacity>
      <SignOutLink />
    </ScrollView>
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
        onPress={() => router.push('/register' as any)}
      >
        <Text style={styles.submitBtnText}>Register as a Driver</Text>
      </TouchableOpacity>
      <SignOutLink />
    </View>
  );
}

// ─── Main Shell ───────────────────────────────────────────────────────────────
export default function DriverTabLayout() {
  const { user, driverProfile, loading } = useDriverAuth();
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
        const isPaid = records.some((r: any) => r.status === 'paid' || r.status === 'confirmed');
        setCommissionConfirmed(isPaid);
      })
      .catch(() => setCommissionConfirmed(false))
      .finally(() => setCheckingCommission(false));

    // Poll every 15s for payment status (paid or confirmed)
    const interval = setInterval(() => {
      firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId, date: today })
        .then((records: any[]) => {
          const isPaid = records.some((r: any) => r.status === 'paid' || r.status === 'confirmed');
          setCommissionConfirmed(isPaid);
        })
        .catch(() => {});
    }, 15000);

    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    const midnightTimeout = setTimeout(() => {
      setCommissionConfirmed(false);
    }, timeUntilMidnight);

    return () => {
      clearInterval(interval);
      clearTimeout(midnightTimeout);
    };
  }, [driverProfile]);

  // Subscribe to lost item alerts
  useEffect(() => {
    if (!driverProfile) return;
    const driverId = (driverProfile as any).user_id || driverProfile.id;
    const unsubscribe = firestoreDB.subscribe(
      COLLECTIONS.RIDE_REPORTS,
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

  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/' as any);
    }
  }, [loading, user]);

  if (loading || checkingCommission) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading driver profile...</Text>
      </View>
    );
  }

  if (!user) return null;

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
        <CommissionGate driver={driverProfile} onConfirmed={() => setCommissionConfirmed(true)} />
        <SignOutLink />
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
          name="home"
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  ussdNote: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
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
  pendingDots: { alignItems: 'center', marginTop: 8 },
  momoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  copyBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, minWidth: 56 },
  rejectionCard: { width: '100%', borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 4 },
});
