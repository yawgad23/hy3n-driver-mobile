import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useState, useCallback } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { MapView } from "@/components/map-view";
import { DestinationSearchModal } from "@/components/destination-search-modal";
import { RideBookingSheet } from "@/components/ride-booking-sheet";
import { RIDE_CATEGORIES } from "@/constants/rides";

interface Location {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export default function RiderHome() {
  const [userLocation] = useState<[number, number]>([5.6037, -0.187]);
  const [destination, setDestination] = useState<Location | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeRide, setActiveRide] = useState<any>(null);

  const savedPlaces: Location[] = [
    { name: "Home", address: "123 Main St, Accra", lat: 5.6037, lng: -0.187 },
    { name: "Work", address: "Business Hub, Osu", lat: 5.6247, lng: -0.1870 },
  ];

  const handleSelectDestination = useCallback((location: Location) => {
    setDestination(location);
    // Simulate distance/duration calculation
    setTimeout(() => {
      setDistance(18.4);
      setDuration(41);
    }, 500);
  }, []);

  const handleBook = useCallback((rideData: any) => {
    setLoading(true);
    // Simulate booking API call
    setTimeout(() => {
      setLoading(false);
      setActiveRide(rideData);
      setDestination(null);
      Alert.alert("Success", `${rideData.category} ride booked! Looking for drivers...`);
    }, 1500);
  }, []);

  const handleCancelBooking = () => {
    setDestination(null);
    setDistance(null);
    setDuration(null);
  };

  const handleCancelRide = () => {
    Alert.alert(
      "Cancel Ride",
      "Are you sure you want to cancel this ride?",
      [
        { text: "Keep Ride", style: "cancel" },
        {
          text: "Cancel Ride",
          style: "destructive",
          onPress: () => {
            setActiveRide(null);
            Alert.alert("Cancelled", "Your ride has been cancelled");
          },
        },
      ]
    );
  };

  return (
    <ScreenContainer className="p-0">
      {/* Full Screen Map */}
      <MapView
        userLat={userLocation[0]}
        userLng={userLocation[1]}
        destLat={destination?.lat}
        destLng={destination?.lng}
      />

      {/* Header - Over Map */}
      <View className="absolute top-0 left-0 right-0 z-30 pt-4 px-4 pb-4 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="w-8 h-8 rounded-full bg-primary/10 items-center justify-center">
            <Text className="text-xs font-bold text-primary">H</Text>
          </View>
          <Text className="font-bold text-sm text-foreground">HY3N</Text>
        </View>
        <TouchableOpacity className="w-10 h-10 rounded-full bg-card border border-border items-center justify-center">
          <Text className="text-lg">🔔</Text>
        </TouchableOpacity>
      </View>

      {/* Nearby Cars Indicator */}
      {!destination && !activeRide && (
        <View className="absolute top-28 left-4 z-10 bg-card/90 border border-border rounded-xl px-3 py-2">
          <View className="flex-row items-center gap-2">
            <View className="w-2 h-2 bg-success rounded-full" />
            <Text className="text-xs font-semibold text-foreground">3 cars nearby</Text>
          </View>
        </View>
      )}

      {/* Active Ride Display */}
      {activeRide && (
        <View className="absolute bottom-0 left-0 right-0 z-20 bg-card border-t border-border rounded-t-3xl p-4">
          <View className="mb-4 pb-4 border-b border-border">
            <Text className="text-xs text-muted mb-1">Ride Booked</Text>
            <Text className="text-lg font-bold text-foreground">{activeRide.category}</Text>
            <Text className="text-xs text-muted mt-1">{activeRide.destination.name}</Text>
          </View>

          <View className="flex-row gap-4 mb-4 pb-4 border-b border-border">
            <View className="flex-1">
              <Text className="text-xs text-muted mb-1">Distance</Text>
              <Text className="text-sm font-semibold text-foreground">{activeRide.distance.toFixed(1)} km</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-muted mb-1">Duration</Text>
              <Text className="text-sm font-semibold text-foreground">{activeRide.duration} min</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-muted mb-1">Fare</Text>
              <Text className="text-sm font-semibold text-primary">GH₵ {activeRide.fare.toFixed(2)}</Text>
            </View>
          </View>

          <View className="bg-surface rounded-xl p-3 mb-4">
            <Text className="text-xs text-muted mb-2">Looking for drivers...</Text>
            <View className="flex-row items-center gap-2">
              <View className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <View className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
              <View className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
            </View>
          </View>

          <TouchableOpacity
            onPress={handleCancelRide}
            className="bg-error/10 border border-error/30 rounded-xl py-3 items-center"
          >
            <Text className="text-sm font-semibold text-error">Cancel Ride</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Booking Sheet or Search Button */}
      {!activeRide && (
        <View className="absolute bottom-0 left-0 right-0 z-20">
          {destination && distance && duration ? (
            <RideBookingSheet
              destination={destination}
              distance={distance}
              duration={duration}
              onBook={handleBook}
              onCancel={handleCancelBooking}
              loading={loading}
            />
          ) : (
            <View className="bg-card border-t border-border rounded-t-3xl p-4">
              {/* Where To Button */}
              <TouchableOpacity
                onPress={() => setSearchOpen(true)}
                className="w-full bg-secondary rounded-2xl p-4 flex-row items-center gap-4 mb-4"
              >
                <View className="w-12 h-12 rounded-xl bg-primary items-center justify-center">
                  <Text className="text-lg">🔍</Text>
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-lg text-foreground">Where to?</Text>
                  <Text className="text-sm text-muted">Enter your destination</Text>
                </View>
                <Text className="text-lg">📍</Text>
              </TouchableOpacity>

              {/* Saved Places */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {savedPlaces.map((place) => (
                    <TouchableOpacity
                      key={place.name}
                      onPress={() => handleSelectDestination(place)}
                      className="flex-row items-center gap-2 px-4 py-2.5 bg-secondary rounded-xl"
                    >
                      <Text className="text-lg">{place.name === "Home" ? "🏠" : "💼"}</Text>
                      <View>
                        <Text className="text-sm font-semibold text-foreground">{place.name}</Text>
                        <Text className="text-xs text-muted">Set location</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Destination Search Modal */}
      <DestinationSearchModal
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectDestination={handleSelectDestination}
        savedPlaces={savedPlaces}
      />
    </ScreenContainer>
  );
}
