import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
  Share,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useThemeContext } from "@/lib/theme-provider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme, setColorScheme } = useThemeContext();
  const isDarkMode = colorScheme === "dark";

  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [showSavedPlaces, setShowSavedPlaces] = useState(false);
  const [showLoyalty, setShowLoyalty] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showPayments, setShowPayments] = useState(false);

  const [profile, setProfile] = useState({
    name: "John Doe",
    phone: "+233 55 123 4567",
    email: "john@example.com",
    rating: 4.8,
  });
  const [editForm, setEditForm] = useState({ name: profile.name, phone: profile.phone, email: profile.email });

  const handleSaveProfile = () => {
    setProfile({ ...editForm, rating: profile.rating });
    setShowEditProfile(false);
    Alert.alert("Success", "Profile updated successfully");
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: () => Alert.alert("Logged out") },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all ride history. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete Account", style: "destructive", onPress: () => Alert.alert("Account deleted") },
      ]
    );
  };

  const handleReferFriend = async () => {
    try {
      await Share.share({
        message: "Join HY3N and get GH₵20 off your first ride! Use my code: JOHN2024\n\nDownload the app: https://hy3n.app",
        title: "Refer a Friend - HY3N",
      });
    } catch {
      Alert.alert("Refer a Friend", "Share your code JOHN2024 with friends and earn GH₵20 per referral!");
    }
  };

  const MenuItem = ({
    icon,
    label,
    onPress,
    rightElement,
    color,
    borderColor,
    bgColor,
  }: {
    icon: React.ComponentProps<typeof MaterialIcons>["name"];
    label: string;
    onPress?: () => void;
    rightElement?: React.ReactNode;
    color?: string;
    borderColor?: string;
    bgColor?: string;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 16,
        backgroundColor: bgColor || "#111111",
        borderWidth: 0.5,
        borderColor: borderColor || "#2A2A2A",
        borderRadius: 14,
        marginBottom: 8,
      }}
    >
      <MaterialIcons name={icon} size={20} color={color || "#9CA3AF"} />
      <Text style={{ flex: 1, color: color || "#FAFAFA", fontSize: 14, fontWeight: "500" }}>{label}</Text>
      {rightElement || <MaterialIcons name="chevron-right" size={18} color="#4A4A4A" />}
    </TouchableOpacity>
  );

  return (
    <ScreenContainer className="p-0">
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
        <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 24 }}>Account</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* Profile Card */}
        <View style={{ backgroundColor: "#111111", borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 0.5, borderColor: "#2A2A2A", alignItems: "center" }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#1A1A1A", borderWidth: 2, borderColor: "#D4AF37", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <MaterialIcons name="person" size={36} color="#D4AF37" />
          </View>
          <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18 }}>{profile.name}</Text>
          <Text style={{ color: "#9CA3AF", fontSize: 13, marginTop: 2 }}>{profile.email}</Text>
          <Text style={{ color: "#9CA3AF", fontSize: 13 }}>{profile.phone}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, backgroundColor: "rgba(212,175,55,0.1)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 }}>
            <MaterialIcons name="star" size={14} color="#D4AF37" />
            <Text style={{ color: "#D4AF37", fontWeight: "600", fontSize: 13 }}>{profile.rating}</Text>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>avg rating</Text>
          </View>
        </View>

        {/* Menu Items */}
        <MenuItem icon="person-outline" label="Edit Profile" onPress={() => setShowEditProfile(true)} />
        <MenuItem icon="account-balance-wallet" label="My Wallet" onPress={() => router.push("/(tabs)/wallet")} />

        {/* Saved Places */}
        <MenuItem
          icon="place"
          label="Saved Places"
          onPress={() => setShowSavedPlaces(!showSavedPlaces)}
          rightElement={<MaterialIcons name={showSavedPlaces ? "expand-less" : "expand-more"} size={20} color="#4A4A4A" />}
        />
        {showSavedPlaces && (
          <View style={{ backgroundColor: "#0D0D0D", borderRadius: 14, padding: 12, marginTop: -4, marginBottom: 8, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
            {[{ icon: "home" as const, label: "Home", value: "Not set" }, { icon: "work" as const, label: "Work", value: "Not set" }].map((place) => (
              <TouchableOpacity
                key={place.label}
                onPress={() => Alert.alert(`Set ${place.label}`, `Enter your ${place.label.toLowerCase()} address`)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#1A1A1A" }}
              >
                <MaterialIcons name={place.icon} size={18} color="#9CA3AF" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#FAFAFA", fontSize: 13, fontWeight: "500" }}>{place.label}</Text>
                  <Text style={{ color: "#4A4A4A", fontSize: 12 }}>{place.value}</Text>
                </View>
                <MaterialIcons name="edit" size={16} color="#4A4A4A" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => Alert.alert("Add Place", "Enter a new saved place")}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12 }}
            >
              <MaterialIcons name="add-location" size={18} color="#D4AF37" />
              <Text style={{ color: "#D4AF37", fontSize: 13, fontWeight: "500" }}>Add New Place</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Loyalty Rewards */}
        <MenuItem
          icon="emoji-events"
          label="Loyalty Rewards"
          color="#D4AF37"
          borderColor="rgba(212,175,55,0.2)"
          onPress={() => setShowLoyalty(!showLoyalty)}
          rightElement={<MaterialIcons name={showLoyalty ? "expand-less" : "expand-more"} size={20} color="#4A4A4A" />}
        />
        {showLoyalty && (
          <View style={{ backgroundColor: "#0D0D0D", borderRadius: 14, padding: 16, marginTop: -4, marginBottom: 8, borderWidth: 0.5, borderColor: "rgba(212,175,55,0.2)" }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 4 }}>Your Points</Text>
            <Text style={{ color: "#D4AF37", fontWeight: "bold", fontSize: 32 }}>2,450</Text>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 4 }}>Earn 1 point per GH₵1 spent on rides</Text>
            <View style={{ marginTop: 12, height: 6, backgroundColor: "#1A1A1A", borderRadius: 3 }}>
              <View style={{ width: "49%", height: 6, backgroundColor: "#D4AF37", borderRadius: 3 }} />
            </View>
            <Text style={{ color: "#9CA3AF", fontSize: 11, marginTop: 4 }}>2,450 / 5,000 points to Gold status</Text>
          </View>
        )}

        {/* Help Center */}
        <MenuItem
          icon="help-outline"
          label="Help Center"
          onPress={() => setShowHelp(!showHelp)}
          rightElement={<MaterialIcons name={showHelp ? "expand-less" : "expand-more"} size={20} color="#4A4A4A" />}
        />
        {showHelp && (
          <View style={{ backgroundColor: "#0D0D0D", borderRadius: 14, padding: 12, marginTop: -4, marginBottom: 8, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
            {["FAQ", "Contact Support", "Report an Issue", "Terms & Conditions", "Privacy Policy"].map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => Alert.alert(item)}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#1A1A1A" }}
              >
                <Text style={{ color: "#FAFAFA", fontSize: 13 }}>{item}</Text>
                <MaterialIcons name="chevron-right" size={16} color="#4A4A4A" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Biometric Login */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "#111111", borderWidth: 0.5, borderColor: "#2A2A2A", borderRadius: 14, marginBottom: 8 }}>
          <MaterialIcons name="fingerprint" size={20} color="#9CA3AF" />
          <Text style={{ flex: 1, color: "#FAFAFA", fontSize: 14, fontWeight: "500" }}>Biometric Login</Text>
          <Switch
            value={biometricEnabled}
            onValueChange={(v) => { setBiometricEnabled(v); Alert.alert("Biometric", v ? "Biometric login enabled" : "Biometric login disabled"); }}
            trackColor={{ false: "#2A2A2A", true: "rgba(212,175,55,0.4)" }}
            thumbColor={biometricEnabled ? "#D4AF37" : "#4A4A4A"}
          />
        </View>

        {/* Dark Mode */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "#111111", borderWidth: 0.5, borderColor: "#2A2A2A", borderRadius: 14, marginBottom: 8 }}>
          <MaterialIcons name={isDarkMode ? "dark-mode" : "light-mode"} size={20} color="#9CA3AF" />
          <Text style={{ flex: 1, color: "#FAFAFA", fontSize: 14, fontWeight: "500" }}>{isDarkMode ? "Dark Mode" : "Light Mode"}</Text>
          <Switch
            value={isDarkMode}
            onValueChange={(v) => setColorScheme(v ? "dark" : "light")}
            trackColor={{ false: "#2A2A2A", true: "rgba(212,175,55,0.4)" }}
            thumbColor={isDarkMode ? "#D4AF37" : "#4A4A4A"}
          />
        </View>

        <MenuItem icon="group-add" label="Refer a Friend" onPress={handleReferFriend} />
        <MenuItem icon="credit-card" label="Payment Methods" onPress={() => setShowPayments(true)} />
        <MenuItem icon="shield" label="Safety" onPress={() => Alert.alert("Safety", "Emergency contacts and safety features")} />

        {/* Logout */}
        <TouchableOpacity
          onPress={handleLogout}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "rgba(206,17,38,0.05)", borderWidth: 0.5, borderColor: "rgba(206,17,38,0.2)", borderRadius: 14, marginTop: 8, marginBottom: 8 }}
        >
          <MaterialIcons name="logout" size={20} color="#CE1126" />
          <Text style={{ flex: 1, color: "#CE1126", fontSize: 14, fontWeight: "500" }}>Log Out</Text>
        </TouchableOpacity>

        {/* Delete Account */}
        <TouchableOpacity
          onPress={handleDeleteAccount}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "rgba(206,17,38,0.05)", borderWidth: 0.5, borderColor: "rgba(206,17,38,0.2)", borderRadius: 14, marginBottom: insets.bottom + 16 }}
        >
          <MaterialIcons name="delete-forever" size={20} color="#CE1126" />
          <Text style={{ flex: 1, color: "#CE1126", fontSize: 14, fontWeight: "500" }}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={showEditProfile} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
            <TouchableOpacity onPress={() => setShowEditProfile(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="close" size={18} color="#FAFAFA" />
            </TouchableOpacity>
            <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18, flex: 1 }}>Edit Profile</Text>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }}>
            {[
              { label: "Full Name", key: "name", placeholder: "Enter your name", keyboard: "default" as const },
              { label: "Phone Number", key: "phone", placeholder: "+233 XX XXX XXXX", keyboard: "phone-pad" as const },
              { label: "Email Address", key: "email", placeholder: "Enter your email", keyboard: "email-address" as const },
            ].map((field) => (
              <View key={field.key} style={{ marginBottom: 16 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>{field.label}</Text>
                <TextInput
                  value={editForm[field.key as keyof typeof editForm]}
                  onChangeText={(v) => setEditForm((prev) => ({ ...prev, [field.key]: v }))}
                  placeholder={field.placeholder}
                  placeholderTextColor="#4A4A4A"
                  keyboardType={field.keyboard}
                  style={{ backgroundColor: "#1A1A1A", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: "#FAFAFA", fontSize: 15, borderWidth: 1, borderColor: "#2A2A2A" }}
                />
              </View>
            ))}

            <TouchableOpacity
              onPress={handleSaveProfile}
              style={{ backgroundColor: "#D4AF37", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8, marginBottom: insets.bottom + 16 }}
            >
              <Text style={{ color: "#000", fontWeight: "bold", fontSize: 16 }}>Save Changes</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Payment Methods Modal */}
      <Modal visible={showPayments} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
            <TouchableOpacity onPress={() => setShowPayments(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="close" size={18} color="#FAFAFA" />
            </TouchableOpacity>
            <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18, flex: 1 }}>Payment Methods</Text>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }}>
            {[
              { icon: "account-balance-wallet" as const, label: "HY3N Wallet", sub: "GH₵245.50 available", color: "#D4AF37" },
              { icon: "smartphone" as const, label: "Mobile Money", sub: "+233 55 123 4567", color: "#006B3F" },
              { icon: "money" as const, label: "Cash", sub: "Pay driver directly", color: "#9CA3AF" },
            ].map((pm) => (
              <TouchableOpacity
                key={pm.label}
                style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, backgroundColor: "#111111", borderRadius: 14, marginBottom: 10, borderWidth: 0.5, borderColor: "#2A2A2A" }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name={pm.icon} size={22} color={pm.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 14 }}>{pm.label}</Text>
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{pm.sub}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color="#4A4A4A" />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => Alert.alert("Add Payment", "Add a new payment method")}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "#1A1A1A", borderRadius: 14, borderWidth: 1, borderColor: "#D4AF37", borderStyle: "dashed", marginBottom: insets.bottom + 16 }}
            >
              <MaterialIcons name="add" size={20} color="#D4AF37" />
              <Text style={{ color: "#D4AF37", fontWeight: "600", fontSize: 14 }}>Add Payment Method</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
