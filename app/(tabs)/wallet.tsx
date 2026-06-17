import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useAuth } from "@/lib/auth-context";
import { firestoreDB } from "@/lib/firebase";
import { notifyWalletTopUp } from "@/lib/notifications";

const GOLD = "#D4AF37";
const GREEN = "#006B3F";
const RED = "#CE1126";
const BG = "#0A0A0A";
const SURFACE = "#111111";
const CARD = "#1A1A1A";
const BORDER = "#2A2A2A";
const TEXT = "#FAFAFA";
const MUTED = "#9CA3AF";

interface Transaction {
  id: string;
  type: "credit" | "debit" | "refund";
  amount: number;
  description: string;
  date: string;
  reference: string;
}

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: "t1", type: "credit", amount: 100, description: "Wallet Top-Up via MoMo", date: new Date(Date.now() - 3600000).toISOString(), reference: "HY3N-TXN-001" },
  { id: "t2", type: "debit", amount: 47.49, description: "Ride to Accra Mall", date: new Date(Date.now() - 86400000).toISOString(), reference: "HY3N-TXN-002" },
  { id: "t3", type: "refund", amount: 12.50, description: "Refund – Cancelled Ride", date: new Date(Date.now() - 2 * 86400000).toISOString(), reference: "HY3N-TXN-003" },
  { id: "t4", type: "debit", amount: 99.28, description: "Ride to Labadi Beach", date: new Date(Date.now() - 5 * 86400000).toISOString(), reference: "HY3N-TXN-004" },
  { id: "t5", type: "credit", amount: 50, description: "Wallet Top-Up via Card", date: new Date(Date.now() - 7 * 86400000).toISOString(), reference: "HY3N-TXN-005" },
  { id: "t6", type: "debit", amount: 42.84, description: "Ride to West Hills Mall", date: new Date(Date.now() - 8 * 86400000).toISOString(), reference: "HY3N-TXN-006" },
  { id: "t7", type: "credit", amount: 200, description: "Wallet Top-Up via MoMo", date: new Date(Date.now() - 10 * 86400000).toISOString(), reference: "HY3N-TXN-007" },
];

const QUICK_AMOUNTS = [20, 50, 100, 200, 500];
const TOP_UP_METHODS = [
  { id: "momo", label: "Mobile Money", icon: "smartphone" as const, color: "#FFD700" },
  { id: "card", label: "Debit/Credit Card", icon: "credit-card" as const, color: "#4A90E2" },
  { id: "bank", label: "Bank Transfer", icon: "account-balance" as const, color: "#50C878" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const hours = diff / 3600000;
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "Yesterday";
  return d.toLocaleDateString("en-GH", { month: "short", day: "numeric" });
}

export default function WalletScreen() {
  const { user, riderProfile } = useAuth();
  const [balance, setBalance] = useState(152.73);
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (riderProfile?.wallet_balance !== undefined) setBalance(riderProfile.wallet_balance);
  }, [riderProfile]);

  useEffect(() => {
    if (!user) return;
    firestoreDB.list('WalletTransactions', { user_id: user.uid }, 'date', 'desc', 30)
      .then(txns => { if (txns && txns.length > 0) setTransactions(txns as Transaction[]); })
      .catch(() => {});
  }, [user]);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showTxDetail, setShowTxDetail] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("momo");
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState(false);

  const totalCredits = transactions.filter(t => t.type === "credit" || t.type === "refund").reduce((s, t) => s + t.amount, 0);
  const totalDebits = transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const totalRides = transactions.filter(t => t.type === "debit").length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise(r => setTimeout(r, 1200));
    setRefreshing(false);
  }, []);

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount < 5) { Alert.alert("Invalid Amount", "Minimum top-up is GH₵5.00"); return; }
    if (amount > 5000) { Alert.alert("Invalid Amount", "Maximum top-up is GH₵5,000.00"); return; }
    setTopUpLoading(true);
    await new Promise(r => setTimeout(r, 2000));
    setTopUpLoading(false);
    setTopUpSuccess(true);
    notifyWalletTopUp(amount);
  };

  const txColor = (t: Transaction) => t.type === "credit" ? GREEN : t.type === "refund" ? "#4A90E2" : RED;
  const txSign = (t: Transaction) => t.type === "debit" ? "-" : "+";
  const txIconName = (t: Transaction): any => t.type === "credit" ? "add-circle" : t.type === "refund" ? "replay" : "remove-circle";

  return (
    <ScreenContainer containerClassName="bg-[#0A0A0A]" safeAreaClassName="bg-[#0A0A0A]">
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />}
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
          <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 22 }}>Wallet</Text>
          <Text style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>Manage your HY3N balance</Text>
        </View>

        {/* Balance Card */}
        <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 20, overflow: "hidden" }}>
          <View style={{ backgroundColor: GREEN, padding: 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="account-balance-wallet" size={18} color="#fff" />
                </View>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "600" }}>HY3N Wallet</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)" }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Active</Text>
              </View>
            </View>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginBottom: 4 }}>Available Balance</Text>
            <Text style={{ color: "#fff", fontSize: 38, fontWeight: "bold", letterSpacing: -1 }}>GH₵{balance.toFixed(2)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD }} />
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>Last updated just now</Text>
            </View>
          </View>
          {/* Stats Row */}
          <View style={{ flexDirection: "row", backgroundColor: CARD }}>
            {[
              { label: "Total Loaded", value: `GH₵${totalCredits.toFixed(0)}`, icon: "trending-up" as const, color: GREEN },
              { label: "Total Spent", value: `GH₵${totalDebits.toFixed(0)}`, icon: "trending-down" as const, color: RED },
              { label: "Total Rides", value: `${totalRides}`, icon: "directions-car" as const, color: GOLD },
            ].map((stat, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center", paddingVertical: 14, borderRightWidth: i < 2 ? 0.5 : 0, borderRightColor: BORDER }}>
                <MaterialIcons name={stat.icon} size={16} color={stat.color} />
                <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 14, marginTop: 4 }}>{stat.value}</Text>
                <Text style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Top Up Button */}
        <TouchableOpacity
          onPress={() => { setTopUpAmount(""); setTopUpSuccess(false); setShowTopUp(true); }}
          style={{ marginHorizontal: 16, marginBottom: 20, backgroundColor: GOLD, borderRadius: 16, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <MaterialIcons name="add" size={22} color="#000" />
          <Text style={{ color: "#000", fontWeight: "bold", fontSize: 16 }}>Top Up Wallet</Text>
        </TouchableOpacity>

        {/* Transaction History */}
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 16 }}>Transactions</Text>
            <Text style={{ color: MUTED, fontSize: 12 }}>{transactions.length} total</Text>
          </View>
          {transactions.map((tx) => (
            <TouchableOpacity
              key={tx.id}
              onPress={() => { setSelectedTx(tx); setShowTxDetail(true); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: CARD, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: BORDER }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${txColor(tx)}1A`, alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name={txIconName(tx)} size={20} color={txColor(tx)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: TEXT, fontWeight: "600", fontSize: 13 }} numberOfLines={1}>{tx.description}</Text>
                <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>{formatDate(tx.date)} • {tx.reference}</Text>
              </View>
              <Text style={{ color: txColor(tx), fontWeight: "bold", fontSize: 15 }}>
                {txSign(tx)}GH₵{tx.amount.toFixed(2)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Top Up Modal */}
      <Modal visible={showTopUp} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: BG }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 0.5, borderBottomColor: BORDER }}>
            <TouchableOpacity onPress={() => setShowTopUp(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="close" size={20} color={TEXT} />
            </TouchableOpacity>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, flex: 1 }}>Top Up Wallet</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {topUpSuccess ? (
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${GREEN}1A`, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <MaterialIcons name="check-circle" size={48} color={GREEN} />
                </View>
                <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 20, marginBottom: 8 }}>Top-Up Successful!</Text>
                <Text style={{ color: MUTED, fontSize: 14, textAlign: "center", marginBottom: 6 }}>
                  GH₵{parseFloat(topUpAmount).toFixed(2)} has been added to your wallet
                </Text>
                <Text style={{ color: GOLD, fontWeight: "bold", fontSize: 22, marginBottom: 24 }}>
                  New Balance: GH₵{(balance + parseFloat(topUpAmount)).toFixed(2)}
                </Text>
                <TouchableOpacity onPress={() => setShowTopUp(false)} style={{ backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 48 }}>
                  <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={{ backgroundColor: `${GREEN}1A`, borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: `${GREEN}4D`, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <MaterialIcons name="account-balance-wallet" size={22} color={GREEN} />
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11 }}>Current Balance</Text>
                    <Text style={{ color: GREEN, fontWeight: "bold", fontSize: 18 }}>GH₵{balance.toFixed(2)}</Text>
                  </View>
                </View>

                <Text style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", marginBottom: 8 }}>Enter Amount</Text>
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, marginBottom: 12 }}>
                  <Text style={{ color: GOLD, fontWeight: "bold", fontSize: 20, marginRight: 8 }}>GH₵</Text>
                  <TextInput
                    value={topUpAmount}
                    onChangeText={setTopUpAmount}
                    placeholder="0.00"
                    placeholderTextColor="#4A4A4A"
                    keyboardType="decimal-pad"
                    style={{ flex: 1, color: TEXT, fontSize: 24, fontWeight: "bold", paddingVertical: 16 }}
                  />
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                  {QUICK_AMOUNTS.map((amt) => (
                    <TouchableOpacity
                      key={amt}
                      onPress={() => setTopUpAmount(amt.toString())}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: topUpAmount === amt.toString() ? `${GOLD}1A` : CARD, borderWidth: 1, borderColor: topUpAmount === amt.toString() ? GOLD : BORDER }}
                    >
                      <Text style={{ color: topUpAmount === amt.toString() ? GOLD : MUTED, fontWeight: "600", fontSize: 13 }}>GH₵{amt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", marginBottom: 10 }}>Payment Method</Text>
                <View style={{ gap: 8, marginBottom: 24 }}>
                  {TOP_UP_METHODS.map((method) => (
                    <TouchableOpacity
                      key={method.id}
                      onPress={() => setSelectedMethod(method.id)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: selectedMethod === method.id ? `${method.color}1A` : CARD, borderWidth: 1, borderColor: selectedMethod === method.id ? method.color : BORDER }}
                    >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${method.color}1A`, alignItems: "center", justifyContent: "center" }}>
                        <MaterialIcons name={method.icon} size={20} color={method.color} />
                      </View>
                      <Text style={{ color: selectedMethod === method.id ? TEXT : MUTED, fontWeight: "600", fontSize: 14, flex: 1 }}>{method.label}</Text>
                      {selectedMethod === method.id && <MaterialIcons name="check-circle" size={20} color={method.color} />}
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  onPress={handleTopUp}
                  disabled={topUpLoading || !topUpAmount}
                  style={{ backgroundColor: GOLD, borderRadius: 14, paddingVertical: 15, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: topUpAmount ? 1 : 0.5 }}
                >
                  {topUpLoading ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="add" size={20} color="#000" />
                      <Text style={{ color: "#000", fontWeight: "bold", fontSize: 16 }}>
                        {topUpAmount ? `Top Up GH₵${parseFloat(topUpAmount || "0").toFixed(2)}` : "Enter Amount"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Transaction Detail Modal */}
      <Modal visible={showTxDetail} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: BG }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 0.5, borderBottomColor: BORDER }}>
            <TouchableOpacity onPress={() => setShowTxDetail(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="close" size={20} color={TEXT} />
            </TouchableOpacity>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, flex: 1 }}>Transaction Details</Text>
          </View>
          {selectedTx && (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${txColor(selectedTx)}1A`, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <MaterialIcons name={txIconName(selectedTx)} size={36} color={txColor(selectedTx)} />
                </View>
                <Text style={{ color: txColor(selectedTx), fontWeight: "bold", fontSize: 28 }}>
                  {txSign(selectedTx)}GH₵{selectedTx.amount.toFixed(2)}
                </Text>
                <Text style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>{selectedTx.description}</Text>
              </View>
              <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 16, gap: 14, borderWidth: 0.5, borderColor: BORDER }}>
                {[
                  { label: "Reference", value: selectedTx.reference },
                  { label: "Date", value: new Date(selectedTx.date).toLocaleString("en-GH") },
                  { label: "Type", value: selectedTx.type.charAt(0).toUpperCase() + selectedTx.type.slice(1) },
                  { label: "Status", value: "Completed" },
                ].map((row) => (
                  <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: MUTED, fontSize: 13 }}>{row.label}</Text>
                    <Text style={{ color: TEXT, fontSize: 13, fontWeight: "600" }}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </ScreenContainer>
  );
}
