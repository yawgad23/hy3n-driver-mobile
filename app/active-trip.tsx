import { ScrollView, Text, View, TouchableOpacity, Pressable } from "react-native";
import { useState, useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { RIDE_CATEGORIES } from "@/constants/rides";

export default function ActiveTripScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [timeElapsed, setTimeElapsed] = useState(0);

  const pickupLocation = (params.pickup as string) || "Pickup Location";
  const dropoffLocation = (params.dropoff as string) || "Dropoff Location";
  const categoryId = (params.category as string) || "standard";
  const category = RIDE_CATEGORIES[categoryId];

  // Simulate time elapsed
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Trip Status */}
        <View className="bg-primary rounded-xl p-6 mb-6 items-center">
          <Text className="text-lg font-semibold text-background mb-2">Driver Arriving</Text>
          <Text className="text-4xl font-bold text-background">{formatTime(timeElapsed)}</Text>
          <Text className="text-sm text-background opacity-80 mt-2">ETA: 5 minutes</Text>
        </View>

        {/* Driver Info */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <Text className="text-sm font-semibold text-muted mb-4 uppercase">Your Driver</Text>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View className="w-12 h-12 bg-primary rounded-full items-center justify-center mr-3">
                <Text className="text-xl">👤</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-foreground">Ahmed Hassan</Text>
                <Text className="text-sm text-muted mt-1">⭐ 4.8 (245 trips)</Text>
              </View>
            </View>
            <View className="items-center">
              <Text className="text-2xl">🚗</Text>
              <Text className="text-xs text-muted mt-1">GH-1234</Text>
            </View>
          </View>
        </View>

        {/* Vehicle Details */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <Text className="text-sm font-semibold text-muted mb-3 uppercase">Vehicle</Text>
          <View className="flex-row justify-between mb-2">
            <Text className="text-foreground">Model</Text>
            <Text className="font-semibold text-foreground">Toyota Corolla</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-foreground">Color</Text>
            <Text className="font-semibold text-foreground">Silver</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-foreground">Plate</Text>
            <Text className="font-semibold text-foreground">GH-1234-AB</Text>
          </View>
        </View>

        {/* Trip Details */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <Text className="text-sm font-semibold text-muted mb-4 uppercase">Trip Details</Text>

          <View className="flex-row mb-4">
            <View className="w-8 h-8 rounded-full bg-primary items-center justify-center mr-3">
              <Text className="text-background font-bold">📍</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-muted">From</Text>
              <Text className="text-base font-semibold text-foreground">{pickupLocation}</Text>
            </View>
          </View>

          <View className="flex-row">
            <View className="w-8 h-8 rounded-full bg-error items-center justify-center mr-3">
              <Text className="text-background font-bold">📍</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-muted">To</Text>
              <Text className="text-base font-semibold text-foreground">{dropoffLocation}</Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View className="flex-row gap-3 mb-3">
          <TouchableOpacity className="flex-1 bg-primary rounded-lg py-3 items-center">
            <Text className="text-base font-bold text-background">📞 Call Driver</Text>
          </TouchableOpacity>
          <TouchableOpacity className="flex-1 bg-surface border border-border rounded-lg py-3 items-center">
            <Text className="text-base font-bold text-foreground">💬 Message</Text>
          </TouchableOpacity>
        </View>

        {/* Cancel Trip */}
        <Pressable className="border-2 border-error rounded-lg py-3 items-center">
          <Text className="text-base font-semibold text-error">Cancel Trip</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}
