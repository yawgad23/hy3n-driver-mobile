import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

interface Transaction {
  id: string;
  type: "top_up" | "ride_payment" | "refund" | "referral_bonus";
  amount: number;
  balanceAfter: number;
  description: string;
  date: string;
}

const SAMPLE_TRANSACTIONS: Transaction[] = [
  { id: "1", type: "top_up", amount: 100, balanceAfter: 245.50, description: "MoMo top-up", date: "Today, 9:00 AM" },
  { id: "2", type: "ride_payment", amount: 85.50, balanceAfter: 145.50, description: "Ride to Kotoka Airport", date: "Today, 10:45 AM" },
  { id: "3", type: "refund", amount: 32.00, balanceAfter: 177.50, description: "Cancelled ride refund", date: "Yesterday, 4:00 PM" },
  { id: "4", type: "ride_payment", amount: 55.20, balanceAfter: 122.30, description: "Ride to Tema Station", date: "Jun 14, 8:30 AM" },
  { id: "5", type: "referral_bonus", amount: 20.00, balanceAfter: 142.30, description: "Referral bonus - Ama K.", date: "Jun 12, 12:00 PM" },
  { id: "6", type: "top_up", amount: 200, balanceAfter: 342.30, description: "Card top-up", date: "Jun 10, 3:00 PM" },
];

const TOP_UP_AMOUNTS = [20, 50, 100, 200, 500];

const TX_CONFIG: Record<string, { icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: string; label: string; isCredit: boolean }> = {
  top_up: { icon: "add-circle", color: "#006B3F", label: "Top Up", isCredit: true },
  ride_payment: { icon: "directions-car", color: "#CE1126", label: "Ride Payment", isCredit: false },
  refund: { icon: "replay", color: "#006B3F", label: "Refund", isCredit: true },
  referral_bonus: { icon: "card-giftcard", color: "#D4AF37", label: "Referral Bonus", isCredit: true },
};

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const [balance] = useState(245.50);
  const [showTopUp, setShowTopUp] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"momo" | "card">("momo");
  const [loading, setLoading] = useState(false);

  const handleTopUp = async () => {
    const amount = selectedAmount || parseFloat(customAmount);
    if (!amount || amount < 1) {
      Alert.alert("Invalid Amount", "Please enter a valid amount");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    setLoading(false);
    setShowTopUp(false);
    setSelectedAmount(null);
    setCustomAmount("");
    Alert.alert("Success!", `GH₵${amount.toFixed(2)} has been added to your wallet`);
  };

  return (
    <ScreenContainer className="p-0">
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
        <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 24 }}>My Wallet</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* Balance Card */}
        <View style={{ borderRadius: 20, padding: 24, backgroundColor: "#111111", borderWidth: 0.5, borderColor: "rgba(212,175,55,0.3)", marginBottom: 12, overflow: "hidden" }}>
          <MaterialIcons name="account-balance-wallet" size={32} color="#D4AF37" style={{ marginBottom: 12 }} />
          <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 4 }}>Available Balance</Text>
          <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 40, letterSpacing: -1 }}>GH₵{balance.toFixed(2)}</Text>
          <TouchableOpacity
            onPress={() => setShowTopUp(true)}
            style={{ marginTop: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#D4AF37", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, alignSelf: "flex-start" }}
          >
            <MaterialIcons name="add" size={16} color="#000" />
            <Text style={{ color: "#000", fontWeight: "bold", fontSize: 14 }}>Top Up</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: "#111111", borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <MaterialIcons name="trending-up" size={16} color="#006B3F" />
              <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Total Added</Text>
            </View>
            <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18 }}>GH₵320.00</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: "#111111", borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <MaterialIcons name="trending-down" size={16} color="#CE1126" />
              <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Total Spent</Text>
            </View>
            <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18 }}>GH₵140.70</Text>
          </View>
        </View>

        {/* Transaction History */}
        <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Transaction History</Text>
        {SAMPLE_TRANSACTIONS.map((tx) => {
          const config = TX_CONFIG[tx.type];
          return (
            <View key={tx.id} style={{ backgroundColor: "#111111", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: config.isCredit ? "rgba(0,107,63,0.1)" : "rgba(206,17,38,0.1)", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name={config.icon} size={18} color={config.color} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 13 }}>{config.label}</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 11 }} numberOfLines={1}>{tx.description}</Text>
                <Text style={{ color: "#4A4A4A", fontSize: 11 }}>{tx.date}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: config.color, fontWeight: "bold", fontSize: 15 }}>
                  {config.isCredit ? "+" : "-"}GH₵{tx.amount.toFixed(2)}
                </Text>
                <Text style={{ color: "#4A4A4A", fontSize: 10 }}>Bal: GH₵{tx.balanceAfter.toFixed(2)}</Text>
              </View>
            </View>
          );
        })}
        <View style={{ height: insets.bottom + 16 }} />
      </ScrollView>

      {/* Top Up Modal */}
      <Modal visible={showTopUp} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
            <TouchableOpacity onPress={() => setShowTopUp(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="close" size={18} color="#FAFAFA" />
            </TouchableOpacity>
            <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18, flex: 1 }}>Top Up Wallet</Text>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Select Amount</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
              {TOP_UP_AMOUNTS.map((amt) => (
                <TouchableOpacity
                  key={amt}
                  onPress={() => { setSelectedAmount(amt); setCustomAmount(""); }}
                  style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: selectedAmount === amt ? "#D4AF37" : "#1A1A1A", borderWidth: 1, borderColor: selectedAmount === amt ? "#D4AF37" : "#2A2A2A" }}
                >
                  <Text style={{ color: selectedAmount === amt ? "#000" : "#FAFAFA", fontWeight: "600", fontSize: 15 }}>GH₵{amt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Or Enter Custom Amount</Text>
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A1A", borderRadius: 12, paddingHorizontal: 14, marginBottom: 20, borderWidth: 1, borderColor: "#2A2A2A" }}>
              <Text style={{ color: "#9CA3AF", fontSize: 16, marginRight: 4 }}>GH₵</Text>
              <TextInput
                value={customAmount}
                onChangeText={(v) => { setCustomAmount(v); setSelectedAmount(null); }}
                placeholder="0.00"
                placeholderTextColor="#4A4A4A"
                keyboardType="decimal-pad"
                style={{ flex: 1, color: "#FAFAFA", fontSize: 16, paddingVertical: 14 }}
              />
            </View>

            <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Payment Method</Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
              {(["momo", "card"] as const).map((pm) => (
                <TouchableOpacity
                  key={pm}
                  onPress={() => setPaymentMethod(pm)}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, backgroundColor: "#1A1A1A", borderWidth: 1.5, borderColor: paymentMethod === pm ? "#D4AF37" : "#2A2A2A" }}
                >
                  <MaterialIcons name={pm === "momo" ? "smartphone" : "credit-card"} size={20} color={paymentMethod === pm ? "#D4AF37" : "#9CA3AF"} />
                  <Text style={{ color: paymentMethod === pm ? "#D4AF37" : "#9CA3AF", fontWeight: "600", fontSize: 14 }}>
                    {pm === "momo" ? "MoMo" : "Card"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleTopUp}
              disabled={loading || (!selectedAmount && !customAmount)}
              style={{ backgroundColor: "#D4AF37", borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: loading || (!selectedAmount && !customAmount) ? 0.5 : 1, marginBottom: insets.bottom + 16 }}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={{ color: "#000", fontWeight: "bold", fontSize: 16 }}>
                  Top Up GH₵{selectedAmount || parseFloat(customAmount) || 0}
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
