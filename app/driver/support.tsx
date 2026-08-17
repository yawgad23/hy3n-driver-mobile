import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { trpc } from '@/lib/trpc';

const GOLD = '#D4AF37'; const BG = '#0A0A0A'; const CARD = '#111111'; const BORDER = '#2A2A2A'; const TEXT = '#FAFAFA'; const MUTED = '#9CA3AF'; const GREEN = '#22C55E';
const TOPICS = [
  { label: 'Trip issue', value: 'trip' },
  { label: 'Payment & earnings', value: 'payment' },
  { label: 'Account & documents', value: 'account' },
  { label: 'Safety issue', value: 'safety' },
  { label: 'Technical issue', value: 'technical' },
  { label: 'Other', value: 'other' },
] as const;

type SupportCategory = (typeof TOPICS)[number]['value'];
type Ticket = { id: string; subject?: string; category?: string; status?: string; created_at?: string; message?: string };

export default function DriverSupportScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useDriverAuth();
  const [topic, setTopic] = useState<SupportCategory>('trip');
  const [message, setMessage] = useState('');
  const ticketsQuery = trpc.driverSupport.listTickets.useQuery(
    { driverId: user?.uid || '' },
    { enabled: Boolean(user?.uid) },
  );
  const submitTicket = trpc.driverSupport.createTicket.useMutation({
    onSuccess: async () => {
      setMessage('');
      await ticketsQuery.refetch();
      Alert.alert('Request submitted', 'HY3N support has received your request.');
    },
    onError: (error) => Alert.alert('Submission failed', error.message || 'Please try again or contact support directly.'),
  });

  const submit = () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Please sign in again before submitting a support request.');
      return;
    }
    if (message.trim().length < 10) {
      Alert.alert('More details needed', 'Please describe the issue in at least a few words so our support team can help.');
      return;
    }
    const selectedTopic = TOPICS.find((item) => item.value === topic);
    submitTicket.mutate({
      driverId: user.uid,
      category: topic,
      subject: selectedTopic?.label || 'Driver support request',
      message: message.trim(),
    });
  };

  const openWhatsApp = () => Linking.openURL('https://wa.me/233200000000?text=Hi%20HY3N%20Support%2C%20I%20need%20driver%20assistance.').catch(() => Alert.alert('WhatsApp unavailable', 'Please email hello@ridehy3n.com.'));
  const tickets = (ticketsQuery.data?.tickets || []) as Ticket[];
  const loadingTickets = ticketsQuery.isLoading || ticketsQuery.isFetching;

  return <View style={[styles.container, { paddingTop: insets.top }]}>
    <View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={TEXT} /></TouchableOpacity><View><Text style={styles.headerTitle}>Driver support</Text><Text style={styles.headerSub}>We are here to help</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.contactCard}><View style={{ flex: 1 }}><Text style={styles.contactTitle}>Need immediate help?</Text><Text style={styles.contactText}>Chat with our driver support team or call emergency services if anyone is in danger.</Text></View><TouchableOpacity style={styles.whatsapp} onPress={openWhatsApp}><MaterialIcons name="chat" size={20} color="#000" /><Text style={styles.whatsappText}>Chat</Text></TouchableOpacity></View>
      <Text style={styles.sectionTitle}>Submit a request</Text>
      <Text style={styles.label}>What can we help with?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topics}>{TOPICS.map((item) => <TouchableOpacity key={item.value} style={[styles.topic, topic === item.value && styles.topicActive]} onPress={() => setTopic(item.value)}><Text style={[styles.topicText, topic === item.value && styles.topicTextActive]}>{item.label}</Text></TouchableOpacity>)}</ScrollView>
      <Text style={styles.label}>Describe the issue</Text><TextInput style={styles.messageInput} value={message} onChangeText={setMessage} multiline textAlignVertical="top" placeholder="Include the ride details, time, or payment reference if relevant." placeholderTextColor="#6B7280" maxLength={1200} />
      <Text style={styles.counter}>{message.length}/1200</Text><TouchableOpacity style={[styles.submitButton, submitTicket.isPending && { opacity: 0.7 }]} disabled={submitTicket.isPending} onPress={submit}>{submitTicket.isPending ? <ActivityIndicator color="#000" /> : <Text style={styles.submitText}>Submit support request</Text>}</TouchableOpacity>
      <Text style={[styles.sectionTitle, { marginTop: 30 }]}>Your requests</Text>
      {loadingTickets && tickets.length === 0 ? <ActivityIndicator color={GOLD} style={{ marginVertical: 18 }} /> : null}
      {!loadingTickets && tickets.length === 0 ? <Text style={styles.noTickets}>No previous support requests.</Text> : null}
      {tickets.map((ticket) => <View key={ticket.id} style={styles.ticket}><View style={{ flex: 1 }}><Text style={styles.ticketTitle}>{ticket.subject || ticket.category || 'Support request'}</Text><Text style={styles.ticketDate}>{ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : 'Recently submitted'}</Text></View><View style={[styles.ticketStatus, { backgroundColor: ticket.status === 'resolved' ? '#052E16' : ticket.status === 'closed' ? '#1F2937' : '#1A1400' }]}><Text style={[styles.ticketStatusText, { color: ticket.status === 'resolved' ? GREEN : ticket.status === 'closed' ? MUTED : GOLD }]}>{ticket.status || 'open'}</Text></View></View>)}
      <View style={styles.emailRow}><MaterialIcons name="email" size={18} color={MUTED} /><Text style={styles.emailText}>You can also email <Text style={{ color: GOLD }}>hello@ridehy3n.com</Text></Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: TEXT, fontSize: 21, fontWeight: '900' }, headerSub: { color: MUTED, fontSize: 12, marginTop: 2 }, content: { padding: 16, paddingBottom: 44 }, contactCard: { flexDirection: 'row', gap: 13, padding: 15, backgroundColor: '#1A1400', borderWidth: 1, borderColor: '#3A2E00', borderRadius: 15 }, contactTitle: { color: '#FDE68A', fontSize: 14, fontWeight: '900' }, contactText: { color: '#D6C784', fontSize: 12, lineHeight: 17, marginTop: 4 }, whatsapp: { alignSelf: 'center', flexDirection: 'row', gap: 5, backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 10 }, whatsappText: { color: '#000', fontWeight: '900', fontSize: 12 }, sectionTitle: { color: TEXT, fontSize: 17, fontWeight: '900', marginTop: 25, marginBottom: 15 }, label: { color: MUTED, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }, topics: { gap: 8, paddingBottom: 4 }, topic: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 }, topicActive: { backgroundColor: '#1A1400', borderColor: GOLD }, topicText: { color: MUTED, fontSize: 12, fontWeight: '700' }, topicTextActive: { color: GOLD }, messageInput: { minHeight: 130, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 13, color: TEXT, fontSize: 14 }, counter: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 6 }, submitButton: { height: 52, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, submitText: { color: '#000', fontSize: 14, fontWeight: '900' }, noTickets: { color: MUTED, fontSize: 13, backgroundColor: CARD, padding: 16, borderRadius: 12 }, ticket: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 9 }, ticketTitle: { color: TEXT, fontSize: 14, fontWeight: '800' }, ticketDate: { color: MUTED, fontSize: 11, marginTop: 4 }, ticketStatus: { borderRadius: 10, paddingVertical: 5, paddingHorizontal: 8 }, ticketStatusText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, emailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 26 }, emailText: { color: MUTED, fontSize: 12 },
});
