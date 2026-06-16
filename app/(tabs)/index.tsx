import { ScrollView, Text, View, TextInput, TouchableOpacity, FlatList } from "react-native";
import { useState, useMemo } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { RideCategoryCard } from "@/components/ride-category-card";
import { RIDE_CATEGORIES, calculateFare } from "@/constants/rides";

export default function HomeScreen() {
  const [pickupLocation, setPickupLocation] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("standard");
  const [distance, setDistance] = useState(18.4); // Default distance in km
  const [duration, setDuration] = useState(41); // Default duration in minutes

  // Calculate fares for all categories
  const categoryFares = useMemo(() => {
    const fares: Record<string, number> = {};
    Object.keys(RIDE_CATEGORIES).forEach((categoryId) => {
      fares[categoryId] = calculateFare(categoryId, distance, duration);
    });
    return fares;
  }, [distance, duration]);

  const selectedFare = categoryFares[selectedCategory] || 0;

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Header */}
        <View className="mb-6">
          <Text className="text-3xl font-bold text-foreground">HY3N</Text>
          <Text className="text-sm text-muted mt-1">Ride with confidence</Text>
        </View>

        {/* Location Inputs */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <View className="mb-4">
            <Text className="text-xs font-semibold text-muted mb-2 uppercase">Pickup</Text>
            <TextInput
              placeholder="Enter pickup location"
              placeholderTextColor="#687076"
              value={pickupLocation}
              onChangeText={setPickupLocation}
              className="bg-background rounded-lg px-4 py-3 text-foreground border border-border"
            />
          </View>
          <View>
            <Text className="text-xs font-semibold text-muted mb-2 uppercase">Dropoff</Text>
            <TextInput
              placeholder="Enter dropoff location"
              placeholderTextColor="#687076"
              value={dropoffLocation}
              onChangeText={setDropoffLocation}
              className="bg-background rounded-lg px-4 py-3 text-foreground border border-border"
            />
          </View>
        </View>

        {/* Trip Details */}
        <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
          <View className="flex-row justify-between mb-3">
            <View>
              <Text className="text-xs text-muted mb-1">Distance</Text>
              <Text className="text-lg font-bold text-foreground">{distance} km</Text>
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">Duration</Text>
              <Text className="text-lg font-bold text-foreground">{duration} min</Text>
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">Estimated Fare</Text>
              <Text className="text-lg font-bold text-primary">GH₵{selectedFare.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Ride Categories */}
        <Text className="text-lg font-bold text-foreground mb-3">Choose Ride Type</Text>
        <View>
          {Object.values(RIDE_CATEGORIES).map((category) => (
            <RideCategoryCard
              key={category.id}
              category={category}
              fare={categoryFares[category.id] || 0}
              isSelected={selectedCategory === category.id}
              onPress={() => setSelectedCategory(category.id)}
            />
          ))}
        </View>

        {/* Book Button */}
        <TouchableOpacity
          className="bg-primary rounded-xl py-4 items-center mt-6 active:opacity-80"
        >
          <Text className="text-lg font-bold text-background">Book Ride</Text>
          <Text className="text-sm text-background opacity-80 mt-1">
            GH₵{selectedFare.toFixed(2)}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
