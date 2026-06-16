import { View, Text, TouchableOpacity, ScrollView, Linking, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const SAFETY_ITEMS = [
  {
    title: "Emergency SOS",
    description: "Instantly alert emergency services and your emergency contacts",
    icon: "emergency" as const,
    color: "#CE1126",
    action: "sos",
  },
  {
    title: "Share Trip",
    description: "Share your live trip details with trusted contacts",
    icon: "share-location" as const,
    color: "#D4AF37",
    action: "share",
  },
  {
    title: "Emergency Contacts",
    description: "Manage your emergency contacts list",
    icon: "contacts" as const,
    color: "#006B3F",
    action: "contacts",
  },
  {
    title: "Safety Center",
    description: "Learn about HY3N's safety features and policies",
    icon: "security" as const,
    color: "#D4AF37",
    action: "center",
  },
  {
    title: "Report an Issue",
    description: "Report a safety concern about a recent trip",
    icon: "report-problem" as const,
    color: "#F59E0B",
    action: "report",
  },
  {
    title: "Driver Verification",
    description: "Verify your driver's identity before entering the vehicle",
    icon: "verified-user" as const,
    color: "#006B3F",
    action: "verify",
  },
];

export default function SafetyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleAction = (action: string) => {
    switch (action) {
      case "sos":
        Alert.alert(
          "Emergency SOS",
          "This will call emergency services (999) and notify your emergency contacts.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Call 999", style: "destructive", onPress: () => Linking.openURL("tel:999") },
          ]
        );
        break;
      case "share":
        Alert.alert("Share Trip", "Trip sharing will be available when you have an active ride.");
        break;
      case "contacts":
        Alert.alert("Emergency Contacts", "You can add up to 3 emergency contacts who will be notified in case of an emergency.");
        break;
      case "center":
        Alert.alert("Safety Center", "HY3N is committed to your safety. All drivers are background-checked and verified.");
        break;
      case "report":
        Alert.alert("Report an Issue", "Please select a recent trip to report a safety concern.", [
          { text: "Cancel", style: "cancel" },
          { text: "View Trips", onPress: () => { router.back(); } },
        ]);
        break;
      case "verify":
        Alert.alert("Driver Verification", "Always check that the driver's name, photo, and vehicle match the app before entering.");
        break;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 16,
          borderBottomWidth: 0.5,
          borderBottomColor: "#2A2A2A",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "#1A1A1A",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FAFAFA" />
        </TouchableOpacity>
        <Text style={{ color: "#FAFAFA", fontSize: 18, fontWeight: "700" }}>Safety</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* Emergency Banner */}
        <TouchableOpacity
          onPress={() => handleAction("sos")}
          style={{
            backgroundColor: "rgba(206,17,38,0.12)",
            borderWidth: 1,
            borderColor: "rgba(206,17,38,0.3)",
            borderRadius: 16,
            padding: 20,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: "#CE1126",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialIcons name="emergency" size={28} color="#FAFAFA" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#CE1126", fontWeight: "700", fontSize: 16 }}>Emergency SOS</Text>
            <Text style={{ color: "#9CA3AF", fontSize: 13, marginTop: 2 }}>
              Tap to call emergency services immediately
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color="#CE1126" />
        </TouchableOpacity>

        {/* Safety Items */}
        <Text
          style={{
            color: "#9CA3AF",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 12,
          }}
        >
          Safety Features
        </Text>
        <View
          style={{
            backgroundColor: "#111111",
            borderRadius: 16,
            borderWidth: 0.5,
            borderColor: "#2A2A2A",
            overflow: "hidden",
          }}
        >
          {SAFETY_ITEMS.filter((item) => item.action !== "sos").map((item, index) => (
            <TouchableOpacity
              key={item.action}
              onPress={() => handleAction(item.action)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 14,
                borderBottomWidth: index < SAFETY_ITEMS.length - 2 ? 0.5 : 0,
                borderBottomColor: "#2A2A2A",
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: `${item.color}18`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MaterialIcons name={item.icon} size={22} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 15 }}>{item.title}</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 2 }}>{item.description}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color="#4A4A4A" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Safety Tips */}
        <View
          style={{
            backgroundColor: "rgba(212,175,55,0.06)",
            borderRadius: 16,
            borderWidth: 0.5,
            borderColor: "rgba(212,175,55,0.15)",
            padding: 16,
            marginTop: 24,
          }}
        >
          <Text style={{ color: "#D4AF37", fontWeight: "700", fontSize: 14, marginBottom: 12 }}>
            Safety Tips
          </Text>
          {[
            "Always verify your driver's name and photo before entering",
            "Share your trip with a trusted contact",
            "Sit in the back seat when riding alone",
            "Trust your instincts - if something feels wrong, end the trip",
          ].map((tip, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
              <Text style={{ color: "#D4AF37", fontSize: 14 }}>•</Text>
              <Text style={{ color: "#9CA3AF", fontSize: 13, flex: 1, lineHeight: 20 }}>{tip}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
