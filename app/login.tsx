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
const PRIMARY = '#0a7ea4';

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
  const { signIn, signInWithGoogle } = useDriverAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

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
          {/* Google Sign-In */}
          <TouchableOpacity
            style={styles.googleBtn}
            onPress={handleGoogleLogin}
            disabled={googleLoading}
            activeOpacity={0.8}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color={TEXT} />
            ) : (
              <>
                <GoogleIcon />
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Email */}
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrap}>
            <MaterialIcons name="email" size={18} color={MUTED} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={MUTED}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          {/* Password */}
          <View style={styles.passwordHeader}>
            <Text style={styles.label}>Password</Text>
            <TouchableOpacity onPress={() => router.push('/forgot-password' as any)}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.inputWrap}>
            <MaterialIcons name="lock" size={18} color={MUTED} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="••••••••"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleEmailLogin}
            />
            <TouchableOpacity onPress={() => setShowPassword(p => !p)} style={styles.eyeBtn}>
              <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={18} color={MUTED} />
            </TouchableOpacity>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginBtn, emailLoading && { opacity: 0.7 }]}
            onPress={handleEmailLogin}
            disabled={emailLoading}
            activeOpacity={0.85}
          >
            {emailLoading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.loginBtnText}>Log in</Text>
            )}
          </TouchableOpacity>

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
