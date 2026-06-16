import { ScrollView, Text, View, Pressable, Switch } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useState } from "react";

export default function ProfileScreen() {
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Profile Header */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <View className="flex-row items-center gap-4">
            <View className="w-16 h-16 bg-primary rounded-full items-center justify-center">
              <Text className="text-2xl font-bold text-background">JD</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xl font-bold text-foreground">John Doe</Text>
              <Text className="text-sm text-muted mt-1">+233 24 123 4567</Text>
              <Text className="text-xs text-muted">john@example.com</Text>
            </View>
          </View>
        </View>

        {/* Account Section */}
        <Text className="text-lg font-semibold text-foreground mb-3">Account</Text>
        <Pressable className="bg-surface rounded-lg p-4 mb-2 border border-border">
          <Text className="text-base text-foreground">Edit Profile</Text>
          <Text className="text-xs text-muted mt-1">Update your information</Text>
        </Pressable>
        <Pressable className="bg-surface rounded-lg p-4 mb-4 border border-border">
          <Text className="text-base text-foreground">Payment Methods</Text>
          <Text className="text-xs text-muted mt-1">Manage your cards and wallets</Text>
        </Pressable>

        {/* Preferences Section */}
        <Text className="text-lg font-semibold text-foreground mb-3">Preferences</Text>
        <View className="bg-surface rounded-lg p-4 mb-2 border border-border">
          <View className="flex-row justify-between items-center">
            <View className="flex-1">
              <Text className="text-base text-foreground">Dark Mode</Text>
              <Text className="text-xs text-muted mt-1">Use dark theme</Text>
            </View>
            <Switch value={darkMode} onValueChange={setDarkMode} />
          </View>
        </View>
        <View className="bg-surface rounded-lg p-4 mb-4 border border-border">
          <View className="flex-row justify-between items-center">
            <View className="flex-1">
              <Text className="text-base text-foreground">Notifications</Text>
              <Text className="text-xs text-muted mt-1">Ride and promo alerts</Text>
            </View>
            <Switch value={notifications} onValueChange={setNotifications} />
          </View>
        </View>

        {/* Support Section */}
        <Text className="text-lg font-semibold text-foreground mb-3">Support</Text>
        <Pressable className="bg-surface rounded-lg p-4 mb-2 border border-border">
          <Text className="text-base text-foreground">Help & Support</Text>
          <Text className="text-xs text-muted mt-1">FAQs and contact support</Text>
        </Pressable>
        <Pressable className="bg-surface rounded-lg p-4 mb-4 border border-border">
          <Text className="text-base text-foreground">About HY3N</Text>
          <Text className="text-xs text-muted mt-1">Version 1.0.0</Text>
        </Pressable>

        {/* Sign Out Button */}
        <Pressable
          style={({ pressed }) => [
            { opacity: pressed ? 0.8 : 1 },
          ]}
          className="bg-error rounded-lg p-4 items-center"
        >
          <Text className="text-base font-semibold text-background">Sign Out</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}
