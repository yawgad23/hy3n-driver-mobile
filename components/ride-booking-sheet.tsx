import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useState } from "react";
import { RIDE_CATEGORIES } from "@/constants/rides";

interface Location {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface RideBookingSheetProps {
  destination: Location;
  distance: number;
  duration: number;
  onBook: (rideData: any) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function RideBookingSheet({
  destination,
  distance,
  duration,
  onBook,
  onCancel,
  loading = false,
}: RideBookingSheetProps) {
  const [selectedCategory, setSelectedCategory] = useState(RIDE_CATEGORIES[0]);

  const calculateFare = (category: any) => {
    const distanceFare = category.basePrice + distance * category.pricePerKm;
    const timeFare = duration * category.pricePerMin;
    const subtotal = distanceFare + timeFare;
    return Math.max(subtotal, category.minFare);
  };

  const fare = calculateFare(selectedCategory);

  const handleBook = () => {
    if (loading) return;
    
    onBook({
      category: selectedCategory.name,
      destination,
      distance,
      duration,
      fare,
      timestamp: new Date().toISOString(),
    });
  };

  return (
    <View className="bg-card border-t border-border rounded-t-3xl p-4">
      {/* Destination Info */}
      <View className="mb-4 pb-4 border-b border-border">
        <Text className="text-xs text-muted mb-1">To</Text>
        <Text className="text-sm font-semibold text-foreground">{destination.name}</Text>
        <Text className="text-xs text-muted mt-1">{destination.address}</Text>
      </View>

      {/* Trip Details */}
      <View className="flex-row gap-4 mb-4 pb-4 border-b border-border">
        <View className="flex-1">
          <Text className="text-xs text-muted mb-1">Distance</Text>
          <Text className="text-sm font-semibold text-foreground">{distance.toFixed(1)} km</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs text-muted mb-1">Duration</Text>
          <Text className="text-sm font-semibold text-foreground">{duration} min</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs text-muted mb-1">Fare</Text>
          <Text className="text-sm font-semibold text-primary">GH₵ {fare.toFixed(2)}</Text>
        </View>
      </View>

      {/* Ride Categories */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
        <View className="flex-row gap-2">
          {RIDE_CATEGORIES.map((category) => {
            const categoryFare = calculateFare(category);
            const isSelected = selectedCategory.id === category.id;
            return (
              <TouchableOpacity
                key={category.id}
                onPress={() => setSelectedCategory(category)}
                className={`rounded-xl p-3 min-w-fit border ${
                  isSelected ? "bg-primary border-primary" : "bg-surface border-border"
                }`}
              >
                <Text className={`text-xs font-semibold ${isSelected ? "text-white" : "text-foreground"}`}>
                  {category.name}
                </Text>
                <Text className={`text-xs mt-1 ${isSelected ? "text-white/80" : "text-muted"}`}>
                  GH₵ {categoryFare.toFixed(2)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Booking Details */}
      <View className="bg-surface rounded-xl p-3 mb-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-xs text-muted">Subtotal</Text>
          <Text className="text-xs text-foreground">GH₵ {fare.toFixed(2)}</Text>
        </View>
        <View className="flex-row items-center justify-between border-t border-border pt-2">
          <Text className="text-sm font-semibold text-foreground">Total</Text>
          <Text className="text-lg font-bold text-primary">GH₵ {fare.toFixed(2)}</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onCancel}
          disabled={loading}
          className="flex-1 bg-surface border border-border rounded-xl py-3 items-center"
        >
          <Text className="text-sm font-semibold text-foreground">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleBook}
          disabled={loading}
          className="flex-1 bg-primary rounded-xl py-3 items-center"
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-sm font-semibold text-white">Book {selectedCategory.name}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
