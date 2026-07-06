import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const BORDER = '#2A2A2A';

export default function DriverLandingScreen() {
  const { user, loading } = useDriverAuth();
  const insets = useSafeAreaInsets();

  // If already authenticated, skip straight to the tabs
  useEffect(() => {
    if (!loading && user) {
      router.replace('/home');
    }
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.loadingLogo}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color={GOLD} style={{ marginTop: 32 }} />
      </View>
    );
  }

  // Not logged in — show the landing page
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 32) }]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Hero */}
      <View style={styles.hero}>
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.brand}>HY3N Driver</Text>
        <Text style={styles.tagline}>Drive. Earn. Repeat.</Text>
        <Text style={styles.sub}>
          Ghana's proudly homegrown ride-hailing platform.{'\n'}
          Join thousands of drivers earning daily.
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>GH₵50</Text>
          <Text style={styles.statLabel}>Daily fee (cars)</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>6</Text>
          <Text style={styles.statLabel}>Ride categories</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>24/7</Text>
          <Text style={styles.statLabel}>Support</Text>
        </View>
      </View>

      {/* CTA Buttons */}
      <View style={styles.ctaSection}>
        <TouchableOpacity
          style={styles.signInBtn}
          onPress={() => router.push('/login' as any)}
          activeOpacity={0.85}
        >
          <MaterialIcons name="login" size={20} color="#000" />
          <Text style={styles.signInText}>Sign In</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.becomeBtn}
          onPress={() => router.push('/register' as any)}
          activeOpacity={0.85}
        >
          <MaterialIcons name="directions-car" size={20} color={GOLD} />
          <Text style={styles.becomeBtnText}>Become a Driver</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>
        By continuing, you agree to HY3N's{' '}
        <Text style={{ color: GOLD }}>Terms of Service</Text>
        {' '}and{' '}
        <Text style={{ color: GOLD }}>Privacy Policy</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogo: {
    width: 100,
    height: 100,
    borderRadius: 24,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 24,
  },
  logo: {
    width: 90,
    height: 90,
    borderRadius: 22,
    marginBottom: 8,
  },
  brand: {
    fontSize: 34,
    fontWeight: '900',
    color: TEXT,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  sub: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 280,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 18,
    paddingHorizontal: 12,
    marginBottom: 28,
    gap: 0,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: GOLD,
  },
  statLabel: {
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: BORDER,
  },
  ctaSection: {
    gap: 14,
    marginBottom: 20,
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: GOLD,
    borderRadius: 14,
    height: 56,
  },
  signInText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '800',
  },
  becomeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'transparent',
    borderRadius: 14,
    height: 56,
    borderWidth: 1.5,
    borderColor: GOLD,
  },
  becomeBtnText: {
    color: GOLD,
    fontSize: 17,
    fontWeight: '800',
  },
  footer: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
});
