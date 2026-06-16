import { ScrollView, Text, View, TouchableOpacity, Pressable } from "react-native";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { RIDE_CATEGORIES, getFareBreakdown } from "@/constants/rides";

export default function RideDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Parse parameters from route
  const pickupLocation = (params.pickup as string) || "Pickup Location";
  const dropoffLocation = (params.dropoff as string) || "Dropoff Location";
  const categoryId = (params.category as string) || "standard";
  const distance = parseFloat((params.distance as string) || "18.4");
  const duration = parseFloat((params.duration as string) || "41");

  const category = RIDE_CATEGORIES[categoryId];
  const fareBreakdown = getFareBreakdown(categoryId, distance, duration);

  const handleConfirmBooking = () => {
    // Navigate to active trip screen
    router.push({
      pathname: "/(tabs)/index" as any,
      params: {
        pickup: pickupLocation,
        dropoff: dropoffLocation,
        category: categoryId,
      },
    });
  };

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Header */}
        <View className="mb-6">
          <Pressable onPress={() => router.back()} className="mb-4">
            <Text className="text-lg text-primary font-semibold">← Back</Text>
          </Pressable>
          <Text className="text-3xl font-bold text-foreground">Confirm Booking</Text>
        </View>

        {/* Trip Summary */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <Text className="text-sm font-semibold text-muted mb-4 uppercase">Trip Details</Text>

          {/* Pickup */}
          <View className="flex-row mb-4">
            <View className="w-8 h-8 rounded-full bg-primary items-center justify-center mr-3">
              <Text className="text-background font-bold">📍</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-muted">Pickup</Text>
              <Text className="text-base font-semibold text-foreground">{pickupLocation}</Text>
            </View>
          </View>

          {/* Dropoff */}
          <View className="flex-row">
            <View className="w-8 h-8 rounded-full bg-error items-center justify-center mr-3">
              <Text className="text-background font-bold">📍</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-muted">Dropoff</Text>
              <Text className="text-base font-semibold text-foreground">{dropoffLocation}</Text>
            </View>
          </View>
        </View>

        {/* Ride Category */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <Text className="text-sm font-semibold text-muted mb-3 uppercase">Ride Type</Text>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-lg font-bold text-foreground">{category?.name}</Text>
              <Text className="text-sm text-muted mt-1">{category?.description}</Text>
            </View>
            <View className="bg-primary rounded-lg px-4 py-2">
              <Text className="text-background font-semibold">GH₵{fareBreakdown.total.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Fare Breakdown */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <Text className="text-sm font-semibold text-muted mb-4 uppercase">Fare Breakdown</Text>

          <View className="flex-row justify-between mb-3">
            <Text className="text-base text-foreground">Base Fare</Text>
            <Text className="text-base font-semibold text-foreground">
              GH₵{fareBreakdown.baseFare.toFixed(2)}
            </Text>
          </View>

          <View className="flex-row justify-between mb-3">
            <Text className="text-base text-foreground">Distance ({distance} km)</Text>
            <Text className="text-base font-semibold text-foreground">
              GH₵{fareBreakdown.distanceFare.toFixed(2)}
            </Text>
          </View>

          <View className="flex-row justify-between mb-4">
            <Text className="text-base text-foreground">Time ({duration} min)</Text>
            <Text className="text-base font-semibold text-foreground">
              GH₵{fareBreakdown.timeFare.toFixed(2)}
            </Text>
          </View>

          <View className="border-t border-border pt-4 flex-row justify-between">
            <Text className="text-lg font-bold text-foreground">Total</Text>
            <Text className="text-2xl font-bold text-primary">
              GH₵{fareBreakdown.total.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Trip Info */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <View className="flex-row justify-between mb-3">
            <Text className="text-sm text-muted">Distance</Text>
            <Text className="text-base font-semibold text-foreground">{distance} km</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Estimated Duration</Text>
            <Text className="text-base font-semibold text-foreground">{duration} minutes</Text>
          </View>
        </View>

        {/* Confirm Button */}
        <TouchableOpacity
          onPress={handleConfirmBooking}
          className="bg-primary rounded-xl py-4 items-center mb-3 active:opacity-80"
        >
          <Text className="text-lg font-bold text-background">Confirm & Book Ride</Text>
        </TouchableOpacity>

        {/* Cancel Button */}
        <Pressable
          onPress={() => router.back()}
          className="border-2 border-border rounded-xl py-4 items-center"
        >
          <Text className="text-lg font-semibold text-foreground">Cancel</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}
