import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { auth } from '@/lib/firebase';
import {
  PhoneAuthProvider,
  signInWithCredential,
  RecaptchaVerifier,
} from 'firebase/auth';

const GOLD = '#D4AF37';
const GREEN = '#006B3F';
const BG = '#0A0A0A';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';

type LoginTab = 'phone' | 'email';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [tab, setTab] = useState<LoginTab>('phone');

  // Phone OTP state
  const [phone, setPhone] = useState(''); // stores only the local digits after +233
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);

  // Email state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  // ── Phone OTP ──────────────────────────────────────────────────────────────
  const handleSendOTP = async () => {
    const cleaned = ('+233' + phone.trim().replace(/\s/g, '')).replace(/\+233\+233/, '+233');
    if (!cleaned || cleaned.length < 9) {
      Alert.alert('Invalid Number', 'Please enter a valid phone number with country code (e.g. +233241234567)');
      return;
    }
    setPhoneLoading(true);
    try {
      // Firebase Phone Auth — works on real devices and Expo Go with test numbers
      const provider = new PhoneAuthProvider(auth);
      // On native, we pass a dummy recaptcha verifier that Firebase ignores for real devices
      const vid = await provider.verifyPhoneNumber(cleaned, new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' }) as any);
      setVerificationId(vid);
      Alert.alert('OTP Sent', `A verification code has been sent to ${cleaned}`);
    } catch (err: any) {
      // On Expo Go web preview, phone auth requires a real device — show helpful message
      if (err.code === 'auth/operation-not-supported-in-this-environment' || err.code === 'auth/web-storage-unsupported') {
        Alert.alert(
          'Phone Login',
          'Phone OTP login works on real iOS/Android devices. Please use Email login for testing in the browser preview, or scan the QR code to test on your phone.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', err.message || 'Failed to send OTP');
      }
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit verification code');
      return;
    }
    if (!verificationId) return;
    setOtpLoading(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, otp.trim());
      await signInWithCredential(auth, credential);
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'Invalid verification code');
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Email Login ────────────────────────────────────────────────────────────
  const handleEmailLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter your email and password');
      return;
    }
    setEmailLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || 'Invalid email or password');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                {/* Logo */}
        <View style={styles.logoRow}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={{ width: 180, height: 180, resizeMode: 'contain' }}
          />
        </View>
        <Text style={styles.title}>Akwaaba to HY3N</Text>
        <Text style={styles.subtitle}>Ghana's premium ride-hailing app</Text>

        {/* Tab Switcher */}
        <View style={styles.tabRow}>
          {(['phone', 'email'] as LoginTab[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            >
              <MaterialIcons
                name={t === 'phone' ? 'phone' : 'email'}
                size={16}
                color={tab === t ? GOLD : MUTED}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'phone' ? 'Phone' : 'Email'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Phone OTP Tab ── */}
        {tab === 'phone' && (
          <View>
            {!verificationId ? (
              <>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.inputWrap}>
                  <View style={{ paddingHorizontal: 12, paddingVertical: 12, borderRightWidth: 1, borderRightColor: BORDER, justifyContent: 'center' }}>
                    <Text style={{ color: TEXT, fontWeight: '700', fontSize: 15 }}>🇬🇭 +233</Text>
                  </View>
                  <TextInput
                    style={[styles.input, { flex: 1, borderWidth: 0 }]}
                    placeholder="24 123 4567"
                    placeholderTextColor={MUTED}
                    value={phone}
                    onChangeText={(val) => {
                      // Strip any leading +233 or 0 if user pastes full number
                      const stripped = val.replace(/^\+?233/, '').replace(/^0/, '');
                      setPhone(stripped);
                    }}
                    keyboardType="number-pad"
                    autoComplete="tel"
                    maxLength={9}
                  />
                </View>
                <Text style={styles.hint}>Enter your Ghana mobile number (e.g. 24 123 4567)</Text>
                <TouchableOpacity
                  style={[styles.btn, phoneLoading && styles.btnDisabled]}
                  onPress={handleSendOTP}
                  disabled={phoneLoading}
                >
                  {phoneLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.btnText}>Send Verification Code</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.otpSentBanner}>
                  <MaterialIcons name="check-circle" size={18} color={GREEN} />
                  <Text style={styles.otpSentText}>Code sent to +233{phone}</Text>
                </View>
                <Text style={styles.label}>Verification Code</Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="sms" size={20} color={MUTED} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="6-digit code"
                    placeholderTextColor={MUTED}
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.btn, otpLoading && styles.btnDisabled]}
                  onPress={handleVerifyOTP}
                  disabled={otpLoading}
                >
                  {otpLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.btnText}>Verify & Log In</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setVerificationId(null)} style={styles.resendRow}>
                  <Text style={styles.resendText}>Didn't receive it? </Text>
                  <Text style={[styles.resendText, { color: GOLD, fontWeight: '700' }]}>Resend</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── Email Tab ── */}
        {tab === 'email' && (
          <View>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrap}>
              <MaterialIcons name="email" size={20} color={MUTED} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={MUTED}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <MaterialIcons name="lock" size={20} color={MUTED} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={MUTED}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color={MUTED} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => router.push('/forgot-password' as any)} style={styles.forgotRow}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, emailLoading && styles.btnDisabled]}
              onPress={handleEmailLogin}
              disabled={emailLoading}
            >
              {emailLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnText}>Log In</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google Sign-In */}
        <TouchableOpacity
          style={styles.googleBtn}
          onPress={() => Alert.alert(
            'Google Sign-In',
            'Google Sign-In is available in the published app. Please use Phone or Email login for now.',
            [{ text: 'OK' }]
          )}
          activeOpacity={0.85}
        >
          <View style={styles.googleIcon}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#4285F4' }}>G</Text>
          </View>
          <Text style={styles.googleText}>Continue with Google</Text>
        </TouchableOpacity>

        {/* Register link */}
        <View style={styles.registerRow}>
          <Text style={styles.registerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/register' as any)}>
            <Text style={styles.registerLink}>Create one</Text>
          </TouchableOpacity>
        </View>

                {/* Terms */}
        <Text style={styles.terms}>
          By continuing, you agree to HY3N's{' '}
          <Text style={{ color: GOLD }}>Terms of Service</Text> and{' '}
          <Text style={{ color: GOLD }}>Privacy Policy</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoRow: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 6, color: TEXT },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 28, color: MUTED },
  tabRow: { flexDirection: 'row', backgroundColor: CARD, borderRadius: 12, padding: 4, marginBottom: 24, borderWidth: 1, borderColor: BORDER },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10 },
  tabBtnActive: { backgroundColor: `${GOLD}1A`, borderWidth: 1, borderColor: GOLD },
  tabText: { color: MUTED, fontSize: 16, fontWeight: '600' },
  tabTextActive: { color: GOLD },
  label: { color: MUTED, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, marginBottom: 16, paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, height: 54, fontSize: 17, color: TEXT },
  eyeBtn: { padding: 4 },
  hint: { color: MUTED, fontSize: 13, marginTop: -10, marginBottom: 16 },
  btn: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 16, backgroundColor: GREEN },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  forgotRow: { alignItems: 'flex-end', marginBottom: 20, marginTop: -8 },
  forgotText: { fontSize: 15, fontWeight: '600', color: GOLD },
  otpSentBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: `${GREEN}1A`, borderRadius: 10, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: `${GREEN}4D` },
  otpSentText: { color: GREEN, fontSize: 14, fontWeight: '600', flex: 1 },
  resendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  resendText: { color: MUTED, fontSize: 14 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: { color: MUTED, fontSize: 14, marginHorizontal: 12 },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, borderRadius: 12, borderWidth: 2, borderColor: '#4285F4',
    backgroundColor: '#fff', marginBottom: 24, gap: 12,
  },
  googleIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  googleText: { color: '#1F1F1F', fontSize: 17, fontWeight: '700' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  registerText: { fontSize: 15, color: MUTED },
  registerLink: { fontSize: 15, fontWeight: '700', color: GOLD },
  terms: { fontSize: 12, color: MUTED, textAlign: 'center', lineHeight: 20 },
});
