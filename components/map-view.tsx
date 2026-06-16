import { View, Text } from "react-native";

interface MapViewProps {
  userLat?: number;
  userLng?: number;
  destLat?: number;
  destLng?: number;
  driverLat?: number;
  driverLng?: number;
}

export function MapView({
  userLat = 5.6037,
  userLng = -0.187,
  destLat,
  destLng,
  driverLat,
  driverLng,
}: MapViewProps) {
  // For mobile, we'll use a placeholder that shows the map is ready
  // In production, integrate with react-native-maps or expo-location
  return (
    <View className="flex-1 bg-secondary items-center justify-center relative">
      {/* Map placeholder - In production, use react-native-maps */}
      <View className="absolute inset-0 bg-gradient-to-b from-secondary to-secondary/80" />

      {/* User location marker */}
      <View className="absolute w-4 h-4 bg-primary rounded-full border-2 border-white shadow-lg" style={{ top: "50%", left: "50%", marginLeft: -8, marginTop: -8 }} />

      {/* Destination marker */}
      {destLat && destLng && (
        <View className="absolute w-5 h-5 bg-error rounded-full border-2 border-white shadow-lg" style={{ top: "40%", left: "55%", marginLeft: -10, marginTop: -10 }} />
      )}

      {/* Driver marker */}
      {driverLat && driverLng && (
        <View className="absolute w-5 h-5 bg-success rounded-full border-2 border-white shadow-lg" style={{ top: "45%", left: "48%", marginLeft: -10, marginTop: -10 }} />
      )}

      {/* Map info text */}
      <Text className="text-muted text-sm absolute bottom-4">Map View - Coordinates: {userLat.toFixed(4)}, {userLng.toFixed(4)}</Text>
    </View>
  );
}
