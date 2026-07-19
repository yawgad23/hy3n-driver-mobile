import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, ActivityIndicator, Alert, TextInput, useColorScheme, KeyboardAvoidingView, Image } from 'react-native';
import { Tabs, useRouter, usePathname } from 'expo-router';
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
type CommissionStatus = 'idle' | 'processing' | 'ussd_sent' | 'checking_status' | 'still_pending' | 'paid' | 'failed';

function CommissionGate({ driver, onConfirmed }: { driver: any; onConfirmed: () => void }) {
  const colors = useColors();
  const isDark = useColorScheme() === 'dark';
  const vehicleType = (driver.service_type || driver.vehicle_type || driver.category || '').toLowerCase();
  const isOkadaOrDelivery = vehicleType.includes('okada') || vehicleType.includes('motor') || vehicleType.includes('delivery') || vehicleType.includes('bike');
  const feeAmount = process.env.EXPO_PUBLIC_DAILY_COMMISSION_AMOUNT
    ? parseFloat(process.env.EXPO_PUBLIC_DAILY_COMMISSION_AMOUNT)
    : (isOkadaOrDelivery ? 30 : 50);
  const [commissionStatus, setCommissionStatus] = useState<CommissionStatus>('idle');
  const [commissionRecord, setCommissionRecord] = useState<any>(null);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(15);

  const chargeMutation = trpc.commission.charge.useMutation();
  const trpcContext = trpc.useUtils();

  // Determine MoMo network label for display
  const networkLabels: Record<string, string> = {
    'mtn-gh': 'MTN MoMo',
    'vodafone-gh': 'Vodafone Cash',
    'tigo-gh': 'AirtelTigo Money',
  };

  const [selectedNetwork, setSelectedNetwork] = useState(driver.momo_network || 'mtn-gh');
  const [phoneInput, setPhoneInput] = useState(driver.momo_number || '');
  const [isEditing, setIsEditing] = useState(false);

  // Sync state with driver prop updates (e.g. after Firestore saves)
  useEffect(() => {
    if (driver) {
      setSelectedNetwork(driver.momo_network || 'mtn-gh');
      setPhoneInput(driver.momo_number || '');
    }
  }, [driver.momo_network, driver.momo_number]);

  const networkLabel = networkLabels[selectedNetwork] || 'MoMo';
  const momoNumber = phoneInput;

  // OTP flow states
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState('');

  const sendOtpMutation = trpc.commission.sendOtp.useMutation();
  const verifyOtpMutation = trpc.commission.verifyOtp.useMutation();

  const handleSendOtp = async () => {
    if (!phoneInput) {
      setError('Please enter a valid phone number');
      return;
    }
    setError('');
    setSendingOtp(true);
    setOtpError('');
    try {
      const result = await sendOtpMutation.mutateAsync({
        phoneNumber: phoneInput,
        driverId: driver.user_id || driver.id,
      });
      if (result.success) {
        setOtpSent(true);
        setDevOtpHint(result.otpCode || '');
      } else {
        setError(result.message || 'Failed to send verification code.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error sending verification code.');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode) {
      setOtpError('Please enter the 6-digit code');
      return;
    }
    setOtpError('');
    setVerifyingOtp(true);
    try {
      const result = await verifyOtpMutation.mutateAsync({
        driverId: driver.user_id || driver.id,
        code: otpCode,
      });
      if (result.success) {
        setOtpVerified(true);
      } else {
        setOtpError(result.message || 'Invalid verification code.');
      }
    } catch (err: any) {
      setOtpError(err?.message || 'Verification failed. Please try again.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!phoneInput) {
      setError('Please enter a valid phone number');
      return;
    }
    setError('');
    try {
      const driverId = driver.id || driver.user_id;
      await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverId, {
        momo_number: phoneInput,
        momo_network: selectedNetwork,
      });
      setIsEditing(false);
      setOtpSent(false);
      setOtpVerified(false);
      setOtpCode('');
    } catch (err: any) {
      setError('Failed to save profile details.');
    }
  };

  // Poll Firestore every 8s while USSD is pending (waiting for driver to approve on phone)
  useEffect(() => {
    if (commissionStatus !== 'ussd_sent') return;
    const driverId = driver.user_id || driver.id;
    const today = new Date().toISOString().split('T')[0];
    const poll = setInterval(() => {
      firestoreDB.list(COLLECTIONS.DAILY_COMMISSION, { driver_id: driverId, date: today }, "")
        .then((records: any[]) => {
          const rec = records.find((r: any) => r.status === 'paid' || r.status === 'confirmed');
          if (rec) {
            setCommissionRecord(rec);
            setCommissionStatus('paid');
            clearInterval(poll);
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
    if (!phoneInput) {
      setError('No MoMo number found. Please add or verify a number.');
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
        momoNumber: phoneInput,
        momoNetwork: selectedNetwork,
        serviceType: driver.service_type || 'car',
        date: today,
      });

      if (result.success) {
        setCommissionRecord(result.commissionRecord);
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

  const handleGoOnline = async () => {
    const docId = commissionRecord?.id;
    if (docId) {
      try {
        await firestoreDB.update(COLLECTIONS.DAILY_COMMISSION, docId, {
          status: 'confirmed',
        });
      } catch (err) {}
    }
    onConfirmed();
  };

  const handleManualCheckStatus = async () => {
    setCommissionStatus('checking_status');
    setCountdown(15);
    setError('');

    const ref = commissionRecord?.hubtel_reference;
    if (!ref) {
      setError('No transaction reference found to check.');
      setCommissionStatus('failed');
      return;
    }

    let currentCountdown = 15;
    
    // Set up countdown interval
    const countdownInterval = setInterval(() => {
      currentCountdown -= 1;
      setCountdown(currentCountdown);
      if (currentCountdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    // Helper to check status
    const check = async () => {
      try {
        const res = await trpcContext.client.transactionStatus.check.query({ clientReference: ref });
        
        if (res && res.responseCode === '0000' && res.data) {
          const status = res.data.status;
          if (status === 'Paid') {
            clearInterval(countdownInterval);
            const docId = commissionRecord?.id;
            if (docId) {
              firestoreDB.update(COLLECTIONS.DAILY_COMMISSION, docId, {
                status: 'confirmed',
              }).catch(() => {});
            }
            setCommissionStatus('paid');
            return true;
          } else if (status === 'Failed' || status === 'Expired' || status === 'Cancelled' || status === 'Declined') {
            clearInterval(countdownInterval);
            setError(res.data.description || 'Transaction failed on Hubtel.');
            setCommissionStatus('failed');
            return true;
          }
        } else if (res && res.success === false) {
          clearInterval(countdownInterval);
          setError(res.message || 'Verification failed.');
          setCommissionStatus('failed');
          return true;
        }
      } catch (err: any) {
        console.error('Error checking status:', err?.message);
      }
      return false;
    };

    // Initial check immediately
    const found = await check();
    if (found) return;

    // Check again every 3 seconds
    const checkInterval = setInterval(async () => {
      if (currentCountdown <= 0) {
        clearInterval(checkInterval);
        clearInterval(countdownInterval);
        setCommissionStatus('still_pending');
        return;
      }
      const done = await check();
      if (done) {
        clearInterval(checkInterval);
        clearInterval(countdownInterval);
      }
    }, 3000);
  };

  // ── Still Pending Screen ──
  if (commissionStatus === 'still_pending') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.gateContainer}
      >
        <View style={[styles.gateIconBox, { backgroundColor: '#F59E0B20' }]}>
          <MaterialIcons name="hourglass-empty" size={40} color="#F59E0B" />
        </View>
        <Text style={[styles.gateTitle, { color: colors.foreground }]}>Payment Pending</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          We haven't received confirmation from your mobile network yet. If you have approved the prompt, please check again.
        </Text>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD }]}
          onPress={handleManualCheckStatus}
        >
          <MaterialIcons name="refresh" size={20} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.submitBtnText}>Check Status Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: BORDER, marginTop: 4 }]}
          onPress={() => setCommissionStatus('ussd_sent')}
        >
          <Text style={[styles.submitBtnText, { color: MUTED }]}>Go Back</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => Linking.openURL('https://wa.me/233546728330?text=I%20need%20help%20with%20my%20daily%20commission%20payment')}>
          <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 4 }}>Contact Support</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Checking Status Screen ──
  if (commissionStatus === 'checking_status') {
    return (
      <View style={[styles.gateContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={[styles.gateTitle, { color: colors.foreground, marginTop: 16 }]}>Verifying Payment...</Text>
        <Text style={[styles.gateSubtitle, { color: colors.muted }]}>
          Checking status with Hubtel. Please wait.
        </Text>
        <View style={[styles.countdownBox, { borderColor: colors.border }]}>
          <Text style={{ color: GOLD, fontSize: 32, fontWeight: '800' }}>{countdown}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Seconds Remaining</Text>
        </View>
      </View>
    );
  }

  // ── Paid / Confirmed (Beautiful Receipt View) ──
  if (commissionStatus === 'paid') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.gateContainer}
      >
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <MaterialIcons name="check-circle" size={80} color="#22C55E" />
          <Text style={[styles.gateTitle, { color: '#22C55E', marginTop: 12 }]}>Payment Successful!</Text>
          <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }}>Thank you for your payment</Text>
        </View>

        {/* Beautiful Receipt Card */}
        <View style={[styles.receiptCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ alignItems: 'center', paddingBottom: 16 }}>
            <Text style={{ color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Amount Paid</Text>
            <Text style={{ color: GOLD, fontSize: 32, fontWeight: '800', marginTop: 4 }}>GH₵ {feeAmount}.00</Text>
          </View>

          <View style={[styles.receiptBadge, { backgroundColor: '#22C55E20' }]}>
            <Text style={{ color: '#22C55E', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>PAID</Text>
          </View>

          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          <View style={{ gap: 12, width: '100%', paddingVertical: 8 }}>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Description</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>Platform Fee</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Mobile Network</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{networkLabel}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Phone Number</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{momoNumber}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Transaction ID</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                {commissionRecord?.hubtel_transaction_id || 'Pending'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Reference</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                {commissionRecord?.hubtel_reference || 'Pending'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Date</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
                {new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD, marginTop: 12 }]}
          onPress={handleGoOnline}
        >
          <MaterialIcons name="power-settings-new" size={20} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.submitBtnText}>Go Online</Text>
        </TouchableOpacity>
      </ScrollView>
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

        {/* Manual verify button */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD, marginTop: 12 }]}
          onPress={handleManualCheckStatus}
        >
          <MaterialIcons name="check" size={20} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.submitBtnText}>I have made payment</Text>
        </TouchableOpacity>

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
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <MaterialIcons name="cancel" size={80} color="#EF4444" />
          <Text style={[styles.gateTitle, { color: '#EF4444', marginTop: 12 }]}>Payment Failed</Text>
          <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }}>The transaction was unsuccessful</Text>
        </View>

        {/* Beautiful Failure Receipt Card */}
        <View style={[styles.receiptCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ alignItems: 'center', paddingBottom: 16 }}>
            <Text style={{ color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Amount Unpaid</Text>
            <Text style={{ color: GOLD, fontSize: 32, fontWeight: '800', marginTop: 4 }}>GH₵ {feeAmount}.00</Text>
          </View>

          <View style={[styles.receiptBadge, { backgroundColor: '#EF444420' }]}>
            <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>FAILED / UNPAID</Text>
          </View>

          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          <View style={{ gap: 12, width: '100%', paddingVertical: 8 }}>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Description</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>Platform Fee</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Mobile Network</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{networkLabel}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Phone Number</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{momoNumber}</Text>
            </View>
            {!!error && (
              <View style={styles.receiptRow}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Failure Reason</Text>
                <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' }} numberOfLines={2}>
                  {error}
                </Text>
              </View>
            )}
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Transaction ID</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                {commissionRecord?.hubtel_transaction_id || 'N/A'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Reference</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                {commissionRecord?.hubtel_reference || 'N/A'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Date</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
                {new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: GOLD, marginTop: 12 }]}
          onPress={handleRetry}
        >
          <MaterialIcons name="refresh" size={20} color="#000" style={{ marginRight: 6 }} />
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
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

      {isEditing ? (
        <View style={[styles.commissionCard, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: 'stretch' }]}>
          <Text style={[styles.inputLabel, { color: colors.muted }]}>Phone Number</Text>
          <TextInput
            style={[styles.inputField, {
              color: colors.foreground,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 10,
              padding: 12,
              fontSize: 15,
              fontWeight: '600',
              marginBottom: 12,
              backgroundColor: isDark ? '#1A1A1A' : '#F3F4F6',
            }]}
            value={phoneInput}
            onChangeText={setPhoneInput}
            placeholder="024XXXXXXX"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
          />

          <Text style={[styles.inputLabel, { color: colors.muted, marginBottom: 8 }]}>Select Network</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {[
              { value: 'mtn-gh', label: 'MTN', color: '#FFCC00', activeText: '#000' },
              { value: 'vodafone-gh', label: 'Telecel', color: '#E60000', activeText: '#FFF' },
              { value: 'tigo-gh', label: 'AirtelTigo', color: '#004F9F', activeText: '#FFF' },
            ].map(net => {
              const isSelected = selectedNetwork === net.value;
              return (
                <TouchableOpacity
                  key={net.value}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1.5,
                    borderColor: isSelected ? net.color : colors.border,
                    backgroundColor: isSelected ? net.color : (isDark ? '#111' : '#F3F4F6'),
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={() => setSelectedNetwork(net.value)}
                >
                  <Text style={{
                    color: isSelected ? net.activeText : colors.foreground,
                    fontWeight: '700',
                    fontSize: 12,
                  }}>{net.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={{
                flex: 1,
                height: 40,
                borderRadius: 10,
                backgroundColor: GOLD,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={handleSaveDetails}
            >
              <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>Save Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 1,
                height: 40,
                borderRadius: 10,
                backgroundColor: '#2A2A2A',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => {
                setPhoneInput(driver.momo_number || '');
                setSelectedNetwork(driver.momo_network || 'mtn-gh');
                setIsEditing(false);
              }}
            >
              <Text style={{ color: '#FAFAFA', fontWeight: '700', fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.commissionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.commissionLabel, { color: colors.muted }]}>Daily Platform Fee</Text>
          <Text style={[styles.commissionAmount, { color: GOLD }]}>GH₵ {feeAmount}.00</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          
          <View style={{ width: '100%', alignItems: 'center', marginVertical: 4 }}>
            <Text style={[styles.commissionMomo, { color: colors.muted, textAlign: 'center' }]}>
              Will be charged to your{' '}
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>{networkLabel}</Text>
            </Text>
            {phoneInput ? (
              <Text style={[styles.commissionMomo, { color: colors.muted, textAlign: 'center', marginTop: 2 }]}>
                Number: <Text style={{ color: colors.foreground, fontWeight: '700' }}>{phoneInput}</Text>
              </Text>
            ) : (
              <Text style={{ color: '#EF4444', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                No MoMo number on file.
              </Text>
            )}

            <TouchableOpacity 
              onPress={() => setIsEditing(true)}
              style={{
                marginTop: 10,
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: '#1E1E1E',
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <MaterialIcons name="edit" size={14} color={GOLD} />
              <Text style={{ color: GOLD, fontSize: 12, fontWeight: '600' }}>Change Payment Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!!error && !isEditing && <Text style={styles.errorText}>{error}</Text>}

      {!isEditing && (
        <>
          {!otpVerified ? (
            <>
              {otpSent ? (
                <View style={{ width: '100%', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>
                    Verify Your Phone Number
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginHorizontal: 20 }}>
                    Enter the 6-digit verification code sent to {phoneInput}
                  </Text>

                  <TextInput
                    style={{
                      width: '60%',
                      letterSpacing: 8,
                      textAlign: 'center',
                      fontSize: 20,
                      fontWeight: '700',
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 12,
                      backgroundColor: isDark ? '#1A1A1A' : '#F3F4F6',
                      color: colors.foreground,
                    }}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder="000000"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={6}
                  />

                  {!!devOtpHint && (
                    <View style={{
                      backgroundColor: isDark ? '#1A1A1A' : '#FEF3C7',
                      borderRadius: 8,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: GOLD,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      <Text style={{ color: isDark ? GOLD : '#B45309', fontSize: 12, fontWeight: '700' }}>
                        🔑 Dev Test OTP: <Text style={{ color: isDark ? '#FFF' : '#78350F' }}>{devOtpHint}</Text>
                      </Text>
                    </View>
                  )}

                  {!!otpError && <Text style={{ color: '#EF4444', fontSize: 12, textAlign: 'center' }}>{otpError}</Text>}

                  <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: GOLD, marginTop: 4 }]}
                    onPress={handleVerifyOtp}
                    disabled={verifyingOtp}
                  >
                    {verifyingOtp ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <MaterialIcons name="verified-user" size={18} color="#000" style={{ marginRight: 6 }} />
                        <Text style={styles.submitBtnText}>Verify OTP Code</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 4, alignItems: 'center' }}>
                    <TouchableOpacity onPress={handleSendOtp} disabled={sendingOtp}>
                      <Text style={{ color: GOLD, fontSize: 13, textDecorationLine: 'underline' }}>
                        {sendingOtp ? 'Resending...' : 'Resend Code'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: colors.border }}>|</Text>
                    <TouchableOpacity onPress={() => { setOtpSent(false); setOtpCode(''); }}>
                      <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline' }}>
                        Change Number
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ width: '100%' }}>
                  <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: GOLD }]}
                    onPress={handleSendOtp}
                    disabled={sendingOtp}
                  >
                    {sendingOtp ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <MaterialIcons name="sms" size={18} color="#000" style={{ marginRight: 6 }} />
                        <Text style={styles.submitBtnText}>Send Verification Code</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <View style={{ width: '100%', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#002A00', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#005500' }}>
                <MaterialIcons name="check-circle" size={18} color="#22C55E" />
                <Text style={{ color: '#22C55E', fontWeight: '700', fontSize: 13 }}>Phone Number Verified</Text>
              </View>

              <View style={[styles.ussdNote, { backgroundColor: '#1A1A1A', borderColor: BORDER }]}>
                <MaterialIcons name="info-outline" size={16} color={MUTED} style={{ marginTop: 1 }} />
                <Text style={{ color: MUTED, fontSize: 12, flex: 1, lineHeight: 18 }}>
                  After tapping Pay Now, you will receive a USSD prompt on your phone. Approve it to complete the payment.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: GOLD }]}
                onPress={handleCharge}
              >
                <MaterialIcons name="payments" size={20} color="#000" style={{ marginRight: 6 }} />
                <Text style={styles.submitBtnText}>Pay GH₵{feeAmount} via {networkLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <TouchableOpacity onPress={() => Linking.openURL('https://wa.me/233546728330?text=I%20need%20help%20with%20my%20daily%20commission%20payment')}>
        <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 4 }}>Need help? Contact Support</Text>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
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
  const pathname = usePathname();
  const { user, driverProfile, loading } = useDriverAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === 'web' ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  const [lostItemAlerts, setLostItemAlerts] = useState<any[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [hasCheckedCommission, setHasCheckedCommission] = useState(false);

  const driverId = (driverProfile as any)?.user_id || driverProfile?.id || '';

  const checkPaid = trpc.commission.checkPaidToday.useQuery(
    { driverId },
    { 
      enabled: !!driverProfile && driverProfile.approval_status === 'approved',
      refetchInterval: 15000,
    }
  );

  useEffect(() => {
    if (checkPaid.isSuccess || checkPaid.isError) {
      setHasCheckedCommission(true);
    }
  }, [checkPaid.isSuccess, checkPaid.isError]);

  const commissionConfirmed = checkPaid.data?.isPaid || false;
  const checkingCommission = checkPaid.isLoading && !hasCheckedCommission;

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
      <View style={[styles.loadingContainer, { backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' }]}>
        <Image 
          source={require('@/assets/images/splash-icon.png')} 
          style={{ width: 180, height: 180, resizeMode: 'contain', marginBottom: 24 }} 
        />
        <ActivityIndicator size="large" color={GOLD} />
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

  const isLockedTab = pathname.endsWith('/home') || pathname.endsWith('/history') || pathname.endsWith('/earnings') || pathname === '/' || pathname === '/index';

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

      {!commissionConfirmed && (
        <View style={[
          StyleSheet.absoluteFill, 
          { 
            backgroundColor: colors.background, 
            bottom: tabBarHeight,
            display: isLockedTab ? 'flex' : 'none'
          }
        ]}>
          <CommissionGate driver={driverProfile} onConfirmed={() => checkPaid.refetch()} />
        </View>
      )}
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
  receiptCard: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  receiptBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashedLine: {
    width: '100%',
    borderWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 12,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  countdownBox: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 2,
  },
});
