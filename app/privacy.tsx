import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";

const GOLD = "#D4AF37";
const GREEN = "#006B3F";
const BG = "#0A0A0A";
const CARD = "#1A1A1A";
const BORDER = "#2A2A2A";
const TEXT = "#FAFAFA";
const MUTED = "#9CA3AF";

const PRIVACY_SECTIONS = [
  {
    title: "Information We Collect",
    content:
      "We collect information you provide directly to us, such as your name, email address, phone number, and payment information when you register for an account. We also collect location data to provide ride-matching services, trip history, and usage data to improve the HY3N platform.",
  },
  {
    title: "How We Use Your Information",
    content:
      "We use the information we collect to provide, maintain, and improve our services, process transactions, send you technical notices and support messages, and respond to your comments and questions. Location data is used solely for matching you with nearby drivers and providing navigation.",
  },
  {
    title: "Information Sharing",
    content:
      "We do not sell, trade, or rent your personal information to third parties. We may share your information with drivers to facilitate your ride, and with payment processors to complete transactions. All third-party partners are bound by strict data protection agreements.",
  },
  {
    title: "Data Security",
    content:
      "We implement industry-standard security measures to protect your personal information. All data is encrypted in transit and at rest. We use Firebase Authentication and Firestore, which comply with international data protection standards.",
  },
  {
    title: "Your Rights",
    content:
      "You have the right to access, update, or delete your personal information at any time. You can update your profile in the Account tab, or contact our support team to request data deletion. We will respond to all requests within 30 days.",
  },
  {
    title: "Cookies & Analytics",
    content:
      "We use analytics tools to understand how users interact with the HY3N app. This data is anonymised and used only to improve our services. You can opt out of analytics in your account settings.",
  },
  {
    title: "Contact Us",
    content:
      "If you have any questions about this Privacy Policy, please contact us at privacy@hy3n.app or through the Support section of the app. Our Data Protection Officer is available to address any concerns.",
  },
];

const TERMS_SECTIONS = [
  {
    title: "Acceptance of Terms",
    content:
      "By downloading, installing, or using the HY3N mobile application, you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use the app.",
  },
  {
    title: "Eligibility",
    content:
      "You must be at least 18 years old to use HY3N. By using the app, you represent and warrant that you meet this age requirement and have the legal capacity to enter into a binding agreement.",
  },
  {
    title: "Ride Services",
    content:
      "HY3N connects riders with independent drivers. HY3N is not a transportation company and does not employ drivers. All drivers are independent contractors who have agreed to HY3N's driver terms and have undergone background verification.",
  },
  {
    title: "Payment & Pricing",
    content:
      "Fares are calculated based on distance, time, ride category, and current demand. All prices are in Ghana Cedis (GH₵). You agree to pay the fare shown at the time of booking. Cancellation fees may apply after a driver has been assigned.",
  },
  {
    title: "Prohibited Conduct",
    content:
      "You agree not to use HY3N for any unlawful purpose, to harass or harm drivers, to provide false information, or to attempt to circumvent the platform's safety features. Violations may result in account suspension or termination.",
  },
  {
    title: "Limitation of Liability",
    content:
      "HY3N shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the service. Our total liability shall not exceed the amount paid for the specific ride giving rise to the claim.",
  },
  {
    title: "Governing Law",
    content:
      "These Terms of Use shall be governed by the laws of the Republic of Ghana. Any disputes shall be resolved in the courts of Accra, Ghana.",
  },
];

export default function PrivacyScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"privacy" | "terms">("privacy");
  const [expanded, setExpanded] = useState<number | null>(null);

  const sections = activeTab === "privacy" ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  return (
    <ScreenContainer containerClassName="bg-[#0A0A0A]" safeAreaClassName="bg-[#0A0A0A]">
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 0.5,
          borderBottomColor: BORDER,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: CARD,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialIcons name="arrow-back" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, flex: 1 }}>
          Legal
        </Text>
      </View>

      {/* Tab Switcher */}
      <View
        style={{
          flexDirection: "row",
          marginHorizontal: 16,
          marginTop: 16,
          marginBottom: 8,
          backgroundColor: CARD,
          borderRadius: 12,
          padding: 4,
          borderWidth: 0.5,
          borderColor: BORDER,
        }}
      >
        {(["privacy", "terms"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => { setActiveTab(tab); setExpanded(null); }}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 6,
              backgroundColor: activeTab === tab ? GREEN : "transparent",
            }}
          >
            <MaterialIcons
              name={tab === "privacy" ? "shield" : "description"}
              size={16}
              color={activeTab === tab ? "#fff" : MUTED}
            />
            <Text
              style={{
                color: activeTab === tab ? "#fff" : MUTED,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {tab === "privacy" ? "Privacy Policy" : "Terms of Use"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <Text style={{ color: MUTED, fontSize: 12, marginBottom: 16 }}>
          Last updated: May 18, 2026
        </Text>

        {sections.map((section, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setExpanded(expanded === i ? null : i)}
            style={{
              backgroundColor: CARD,
              borderRadius: 14,
              marginBottom: 8,
              borderWidth: 0.5,
              borderColor: expanded === i ? `${GREEN}66` : BORDER,
              overflow: "hidden",
            }}
            activeOpacity={0.85}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: `${GREEN}1A`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: GREEN, fontWeight: "bold", fontSize: 13 }}>
                  {i + 1}
                </Text>
              </View>
              <Text
                style={{
                  color: TEXT,
                  fontWeight: "600",
                  fontSize: 14,
                  flex: 1,
                }}
              >
                {section.title}
              </Text>
              <MaterialIcons
                name={expanded === i ? "keyboard-arrow-up" : "keyboard-arrow-down"}
                size={20}
                color={MUTED}
              />
            </View>
            {expanded === i && (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 16,
                  paddingTop: 0,
                  borderTopWidth: 0.5,
                  borderTopColor: BORDER,
                }}
              >
                <Text
                  style={{
                    color: MUTED,
                    fontSize: 13,
                    lineHeight: 22,
                    marginTop: 12,
                  }}
                >
                  {section.content}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}

        <View
          style={{
            backgroundColor: `${GREEN}0D`,
            borderRadius: 14,
            padding: 16,
            marginTop: 8,
            borderWidth: 1,
            borderColor: `${GREEN}33`,
          }}
        >
          <Text style={{ color: GREEN, fontWeight: "bold", fontSize: 13, marginBottom: 6 }}>
            Questions?
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>
            Contact us at{" "}
            <Text style={{ color: GOLD }}>privacy@hy3n.app</Text>
            {" "}or through the Support section of the app.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
