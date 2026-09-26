import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  Alert, Image,
} from 'react-native';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';

function GoogleIcon() {
  return (
    <View style={styles.googleIconWrap}>
      <Text style={styles.googleIconText}>
        <Text style={{ color: '#4285F4' }}>G</Text>
      </Text>
    </View>
  );
}

export default function DriverLoginScreen() {
  const { signIn, startPhoneSignIn, confirmPhoneSignIn, signInWithGoogle } = useDriverAuth();
  const [loginMode, setLoginMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSendPhoneCode = async () => {
    setPhoneLoading(true);
    try {
      const result = await startPhoneSignIn(phone);
      setPhone(result.phoneNumber);
      setVerificationId(result.verificationId);
      setVerificationCode('');
    } catch (err: any) {
      Alert.alert('Could not send code', err?.message || 'Please check the phone number and try again.');
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleConfirmPhoneCode = async () => {
    if (!verificationId) return;
    setVerifyLoading(true);
    try {
      await confirmPhoneSignIn(verificationId, verificationCode);
      router.replace('/home');
    } catch (err: any) {
      Alert.alert('Verification failed', err?.message || 'Enter the 6-digit code that was sent to your phone.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleEmailLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter your email and password');
      return;
    }
    setEmailLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/home');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        Alert.alert('Login Failed', 'Invalid email or password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        Alert.alert('Too Many Attempts', 'Account temporarily locked. Please reset your password or try again later.');
      } else {
        Alert.alert('Login Failed', err.message || 'An error occurred. Please try again.');
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      router.replace('/home');
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        Alert.alert('Google Sign-In Failed', err.message || 'Could not sign in with Google. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo + Greeting */}
        <View style={styles.logoRow}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.title}>Akwaaba, Driver 🚗</Text>
        <Text style={styles.subtitle}>Wo ho te sɛn? Log in to start driving</Text>

        {/* Card */}
        <View style={styles.card}>
          <View style={styles.loginModeRow}>
            <TouchableOpacity style={[styles.loginModeBtn, loginMode === 'phone' && styles.loginModeBtnActive]} onPress={() => setLoginMode('phone')}>
              <MaterialIcons name="phone" size={18} color={loginMode === 'phone' ? GOLD : MUTED} />
              <Text style={[styles.loginModeText, loginMode === 'phone' && styles.loginModeTextActive]}>Phone</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.loginModeBtn, loginMode === 'email' && styles.loginModeBtnActive]} onPress={() => setLoginMode('email')}>
              <MaterialIcons name="email" size={18} color={loginMode === 'email' ? GOLD : MUTED} />
              <Text style={[styles.loginModeText, loginMode === 'email' && styles.loginModeTextActive]}>Email</Text>
            </TouchableOpacity>
          </View>

          {loginMode === 'phone' ? (
            !verificationId ? (
              <>
                <Text style={styles.label}>Ghana phone number</Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="phone" size={18} color={MUTED} style={styles.inputIcon} />
                  <TextInput style={styles.input} placeholder="024 123 4567" placeholderTextColor={MUTED} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" returnKeyType="send" onSubmitEditing={handleSendPhoneCode} />
                </View>
                <Text style={styles.phoneHint}>We will send a secure 6-digit code to this number.</Text>
                <TouchableOpacity style={[styles.loginBtn, phoneLoading && { opacity: 0.7 }]} onPress={handleSendPhoneCode} disabled={phoneLoading} activeOpacity={0.85}>
                  {phoneLoading ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.loginBtnText}>Send verification code</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.codeSentBanner}>
                  <MaterialIcons name="check-circle" size={18} color="#22C55E" />
                  <Text style={styles.codeSentText}>Code sent to {phone}</Text>
                </View>
                <Text style={styles.label}>Verification code</Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="sms" size={18} color={MUTED} style={styles.inputIcon} />
                  <TextInput style={styles.input} placeholder="6-digit code" placeholderTextColor={MUTED} value={verificationCode} onChangeText={setVerificationCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} returnKeyType="done" onSubmitEditing={handleConfirmPhoneCode} />
                </View>
                <TouchableOpacity style={[styles.loginBtn, verifyLoading && { opacity: 0.7 }]} onPress={handleConfirmPhoneCode} disabled={verifyLoading} activeOpacity={0.85}>
                  {verifyLoading ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.loginBtnText}>Verify & log in</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setVerificationId(null); setVerificationCode(''); }} style={styles.changePhoneBtn}>
                  <Text style={styles.changePhoneText}>Use a different number</Text>
                </TouchableOpacity>
              </>
            )
          ) : (
            <>
              <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleLogin} disabled={googleLoading} activeOpacity={0.8}>
                {googleLoading ? <ActivityIndicator size="small" color={TEXT} /> : <><GoogleIcon /><Text style={styles.googleText}>Continue with Google</Text></>}
              </TouchableOpacity>
              <View style={styles.dividerRow}><View style={styles.dividerLine} /><Text style={styles.dividerText}>or</Text><View style={styles.dividerLine} /></View>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputWrap}>
                <MaterialIcons name="email" size={18} color={MUTED} style={styles.inputIcon} />
                <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={MUTED} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
              </View>
              <View style={styles.passwordHeader}>
                <Text style={styles.label}>Password</Text>
                <TouchableOpacity onPress={() => router.push('/forgot-password' as any)}><Text style={styles.forgotText}>Forgot password?</Text></TouchableOpacity>
              </View>
              <View style={styles.inputWrap}>
                <MaterialIcons name="lock" size={18} color={MUTED} style={styles.inputIcon} />
                <TextInput style={[styles.input, { flex: 1 }]} placeholder="••••••••" placeholderTextColor={MUTED} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} returnKeyType="done" onSubmitEditing={handleEmailLogin} />
                <TouchableOpacity onPress={() => setShowPassword(p => !p)} style={styles.eyeBtn}><MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={18} color={MUTED} /></TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.loginBtn, emailLoading && { opacity: 0.7 }]} onPress={handleEmailLogin} disabled={emailLoading} activeOpacity={0.85}>
                {emailLoading ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.loginBtnText}>Log in</Text>}
              </TouchableOpacity>
            </>
          )}

          {/* Back to landing */}
          <TouchableOpacity
            style={styles.registerRow}
            onPress={() => router.replace('/' as any)}
            activeOpacity={0.7}
          >
            <MaterialIcons name="arrow-back" size={14} color={MUTED} />
            <Text style={[styles.registerText, { marginLeft: 4 }]}>Back to start</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          By continuing, you agree to HY3N&apos;s{' '}
          <Text style={{ color: GOLD }}>Terms of Service</Text> and{' '}
          <Text style={{ color: GOLD }}>Privacy Policy</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  logoRow: { alignItems: 'center', marginBottom: 8 },
  logo: { width: 72, height: 72, borderRadius: 18 },
  title: { fontSize: 26, fontWeight: '800', color: TEXT, textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: MUTED, textAlign: 'center', marginBottom: 28 },
  card: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  loginModeRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 4, marginBottom: 18 },
  loginModeBtn: { flex: 1, height: 42, borderRadius: 9, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  loginModeBtnActive: { backgroundColor: '#D4AF371A', borderWidth: 1, borderColor: GOLD },
  loginModeText: { color: MUTED, fontSize: 14, fontWeight: '700' },
  loginModeTextActive: { color: GOLD },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 48,
    gap: 10,
    marginBottom: 16,
  },
  googleIconWrap: {
    width: 24,
    height: 24,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: { fontSize: 14, fontWeight: '700' },
  googleText: { color: TEXT, fontSize: 15, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: { color: MUTED, fontSize: 12 },
  label: { color: MUTED, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  phoneHint: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: -5, marginBottom: 16 },
  codeSentBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: '#22C55E55', backgroundColor: '#22C55E14', marginBottom: 16 },
  codeSentText: { color: '#86EFAC', fontSize: 13, fontWeight: '700', flex: 1 },
  changePhoneBtn: { alignItems: 'center', marginTop: -7, marginBottom: 4 },
  changePhoneText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 14,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: TEXT, fontSize: 15 },
  eyeBtn: { padding: 4 },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  forgotText: { color: GOLD, fontSize: 13, fontWeight: '600' },
  loginBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  loginBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  registerText: { color: MUTED, fontSize: 14 },
  registerLink: { color: GOLD, fontSize: 14, fontWeight: '700' },
  footer: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
