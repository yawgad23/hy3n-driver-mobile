import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  FlatList,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
} from "react-native";
import { WebView } from "react-native-webview";
import { ScreenContainer } from "@/components/screen-container";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { RIDE_CATEGORIES, POPULAR_DESTINATIONS, PAYMENT_METHODS, calculateFare } from "@/constants/rides";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface Location {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface SavedPlace {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
}

const DEFAULT_LOCATION: [number, number] = [5.6037, -0.187]; // Accra

const MAP_HTML = (userLat: number, userLng: number, destLat?: number, destLng?: number) => `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; background: #0A0A0A; }
  .leaflet-control-zoom { display: none; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${userLat}, ${userLng}], 15);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  var userIcon = L.divIcon({
    className: '',
    html: '<div style="width:20px;height:20px;border-radius:50%;background:#006B3F;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,107,63,0.6);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
  L.marker([${userLat}, ${userLng}], { icon: userIcon }).addTo(map);

  ${destLat && destLng ? `
  var destIcon = L.divIcon({
    className: '',
    html: '<div style="width:20px;height:20px;border-radius:50%;background:#D4AF37;border:3px solid #fff;box-shadow:0 2px 8px rgba(212,175,55,0.6);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
  L.marker([${destLat}, ${destLng}], { icon: destIcon }).addTo(map);
  L.polyline([[${userLat}, ${userLng}], [${destLat}, ${destLng}]], {
    color: '#D4AF37', weight: 3, dashArray: '8 6', opacity: 0.8
  }).addTo(map);
  map.fitBounds([[${userLat}, ${userLng}], [${destLat}, ${destLng}]], { padding: [40, 40] });
  ` : ''}
</script>
</body>
</html>
`;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_LOCATION);
  const [destination, setDestination] = useState<Location | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(RIDE_CATEGORIES[0]);
  const [selectedPayment, setSelectedPayment] = useState(PAYMENT_METHODS[0]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([
    { name: "Home", address: "Set location" },
    { name: "Work", address: "Set location" },
  ]);
  const [activeRide, setActiveRide] = useState<any>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [searchHistory, setSearchHistory] = useState<Location[]>([]);

  // Load saved places and search history
  useEffect(() => {
    AsyncStorage.getItem("savedPlaces").then((v) => {
      if (v) setSavedPlaces(JSON.parse(v));
    });
    AsyncStorage.getItem("searchHistory").then((v) => {
      if (v) setSearchHistory(JSON.parse(v));
    });
  }, []);

  const distance = destination
    ? Math.sqrt(
        Math.pow((destination.lat - userLocation[0]) * 111, 2) +
          Math.pow((destination.lng - userLocation[1]) * 111 * Math.cos((userLocation[0] * Math.PI) / 180), 2)
      )
    : 0;
  const duration = Math.round(distance * 3.5 + 5);

  const fare = destination ? calculateFare(selectedCategory.id, distance, duration) : 0;

  const filteredDestinations = searchQuery
    ? POPULAR_DESTINATIONS.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.address.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : POPULAR_DESTINATIONS;

  const handleSelectDestination = async (loc: Location) => {
    setDestination(loc);
    setSearchOpen(false);
    setSearchQuery("");
    // Save to history
    const updated = [loc, ...searchHistory.filter((h) => h.name !== loc.name)].slice(0, 5);
    setSearchHistory(updated);
    await AsyncStorage.setItem("searchHistory", JSON.stringify(updated));
  };

  const handleBook = async () => {
    if (!destination) return;
    setBookingLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    setActiveRide({
      category: selectedCategory.name,
      destination,
      distance,
      duration,
      fare,
      payment: selectedPayment.name,
      status: "searching",
    });
    setBookingLoading(false);
  };

  const handleCancelRide = () => {
    Alert.alert("Cancel Ride", "Are you sure you want to cancel this ride?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Cancel",
        style: "destructive",
        onPress: () => {
          setActiveRide(null);
          setDestination(null);
        },
      },
    ]);
  };

  const handleCancelBooking = () => {
    setDestination(null);
    setSelectedCategory(RIDE_CATEGORIES[0]);
  };

  const handleQuickPlace = (place: SavedPlace) => {
    if (!place.lat || !place.lng) {
      setSearchOpen(true);
      return;
    }
    handleSelectDestination({ name: place.name, address: place.address, lat: place.lat, lng: place.lng });
  };

  const handleAddPlace = () => {
    setSearchOpen(true);
  };

  const mapHtml = MAP_HTML(
    userLocation[0],
    userLocation[1],
    destination?.lat,
    destination?.lng
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
      {/* Map - full screen */}
      <View style={{ position: "absolute", inset: 0 }}>
        {Platform.OS === "web" ? (
          <View style={{ flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center" }}>
            <MaterialIcons name="map" size={64} color="#2A2A2A" />
            <Text style={{ color: "#4A4A4A", marginTop: 8, fontSize: 12 }}>Map available on iOS/Android</Text>
          </View>
        ) : (
          <WebView
            source={{ html: mapHtml }}
            style={{ flex: 1 }}
            scrollEnabled={false}
            javaScriptEnabled
          />
        )}
      </View>

      {/* Header */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          right: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: "#D4AF37",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#000", fontWeight: "bold", fontSize: 14 }}>H</Text>
          </View>
          <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18 }}>HY3N</Text>
        </View>
        <TouchableOpacity
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "rgba(17,17,17,0.85)",
            alignItems: "center",
            justifyContent: "center",
          }}
          onPress={() => Alert.alert("Notifications", "No new notifications")}
        >
          <MaterialIcons name="notifications" size={20} color="#FAFAFA" />
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet */}
      {!activeRide && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            backgroundColor: "#111111",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 0.5,
            borderTopColor: "#2A2A2A",
            paddingBottom: insets.bottom + 8,
          }}
        >
          {destination && distance > 0 ? (
            // Booking Sheet
            <View style={{ padding: 16 }}>
              {/* Destination header */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <TouchableOpacity
                  onPress={handleCancelBooking}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "#1A1A1A",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialIcons name="arrow-back" size={18} color="#FAFAFA" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Destination</Text>
                  <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 14 }} numberOfLines={1}>
                    {destination.name}
                  </Text>
                </View>
                <View>
                  <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{distance.toFixed(1)} km</Text>
                  <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{duration} min</Text>
                </View>
              </View>

              {/* Ride Categories */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {RIDE_CATEGORIES.map((cat) => {
                    const catFare = calculateFare(cat.id, distance, duration);
                    const isSelected = selectedCategory.id === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        onPress={() => setSelectedCategory(cat)}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          backgroundColor: isSelected ? "#D4AF37" : "#1A1A1A",
                          borderWidth: 1,
                          borderColor: isSelected ? "#D4AF37" : "#2A2A2A",
                          minWidth: 100,
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: isSelected ? "#000" : "#FAFAFA", fontWeight: "700", fontSize: 13 }}>
                          {cat.name}
                        </Text>
                        <Text style={{ color: isSelected ? "#000000AA" : "#9CA3AF", fontSize: 11, marginTop: 2 }}>
                          GH₵{catFare.toFixed(2)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Fare & Payment Row */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#1A1A1A",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 12,
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Estimated Fare</Text>
                  <Text style={{ color: "#D4AF37", fontWeight: "bold", fontSize: 20 }}>
                    GH₵{fare.toFixed(2)}
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {PAYMENT_METHODS.map((pm) => {
                      const isSelected = selectedPayment.id === pm.id;
                      return (
                        <TouchableOpacity
                          key={pm.id}
                          onPress={() => setSelectedPayment(pm)}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                            backgroundColor: isSelected ? "#D4AF37" : "#2A2A2A",
                          }}
                        >
                          <Text style={{ color: isSelected ? "#000" : "#9CA3AF", fontSize: 11, fontWeight: "600" }}>
                            {pm.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              {/* Book Button */}
              <TouchableOpacity
                onPress={handleBook}
                disabled={bookingLoading}
                style={{
                  backgroundColor: "#D4AF37",
                  borderRadius: 14,
                  paddingVertical: 16,
                  alignItems: "center",
                }}
              >
                {bookingLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={{ color: "#000", fontWeight: "bold", fontSize: 16 }}>
                    Book {selectedCategory.name}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            // Where To Sheet
            <View style={{ padding: 16 }}>
              <TouchableOpacity
                onPress={() => setSearchOpen(true)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  backgroundColor: "#1A1A1A",
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 14,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: "#D4AF37",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialIcons name="search" size={22} color="#000" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 17 }}>Where to?</Text>
                  <Text style={{ color: "#9CA3AF", fontSize: 13 }}>Enter your destination</Text>
                </View>
                <MaterialIcons name="location-on" size={20} color="#9CA3AF" />
              </TouchableOpacity>

              {/* Saved Places */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {savedPlaces.map((place) => (
                    <TouchableOpacity
                      key={place.name}
                      onPress={() => handleQuickPlace(place)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        backgroundColor: "#1A1A1A",
                        borderRadius: 12,
                      }}
                    >
                      <MaterialIcons
                        name={place.name === "Home" ? "home" : "work"}
                        size={16}
                        color="#D4AF37"
                      />
                      <View>
                        <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 13 }}>{place.name}</Text>
                        <Text style={{ color: "#9CA3AF", fontSize: 10 }} numberOfLines={1}>
                          {place.address}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={handleAddPlace}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      backgroundColor: "rgba(26,26,26,0.5)",
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#2A2A2A",
                      borderStyle: "dashed",
                    }}
                  >
                    <MaterialIcons name="add" size={16} color="#9CA3AF" />
                    <Text style={{ color: "#9CA3AF", fontSize: 13 }}>Add</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Active Ride Sheet */}
      {activeRide && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            backgroundColor: "#111111",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 0.5,
            borderTopColor: "#2A2A2A",
            padding: 16,
            paddingBottom: insets.bottom + 8,
          }}
        >
          <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A", paddingBottom: 12, marginBottom: 12 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 2 }}>Ride Booked</Text>
            <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 17 }}>{activeRide.category}</Text>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {activeRide.destination.name}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A", paddingBottom: 12, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Distance</Text>
              <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 13 }}>{activeRide.distance.toFixed(1)} km</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Duration</Text>
              <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 13 }}>{activeRide.duration} min</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Fare</Text>
              <Text style={{ color: "#D4AF37", fontWeight: "bold", fontSize: 13 }}>GH₵{activeRide.fare.toFixed(2)}</Text>
            </View>
          </View>
          <View style={{ backgroundColor: "#1A1A1A", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 8 }}>Looking for drivers...</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#D4AF37" }} />
              ))}
            </View>
          </View>
          <TouchableOpacity
            onPress={handleCancelRide}
            style={{
              backgroundColor: "rgba(206,17,38,0.1)",
              borderWidth: 1,
              borderColor: "rgba(206,17,38,0.3)",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#CE1126", fontWeight: "600", fontSize: 14 }}>Cancel Ride</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Destination Search Modal */}
      <Modal visible={searchOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
          {/* Search Header */}
          <View
            style={{
              paddingTop: insets.top + 16,
              paddingHorizontal: 16,
              paddingBottom: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: "#2A2A2A",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <TouchableOpacity
                onPress={() => { setSearchOpen(false); setSearchQuery(""); }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: "#1A1A1A",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MaterialIcons name="arrow-back" size={18} color="#FAFAFA" />
              </TouchableOpacity>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#1A1A1A",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  gap: 8,
                }}
              >
                <MaterialIcons name="search" size={18} color="#9CA3AF" />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search destination..."
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                  style={{ flex: 1, color: "#FAFAFA", fontSize: 15, paddingVertical: 12 }}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery("")}>
                    <MaterialIcons name="close" size={18} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }}>
            {/* Saved Places */}
            {!searchQuery && savedPlaces.filter((p) => p.lat && p.lng).length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                  Saved Places
                </Text>
                {savedPlaces.filter((p) => p.lat && p.lng).map((place, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleSelectDestination({ name: place.name, address: place.address, lat: place.lat!, lng: place.lng! })}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(212,175,55,0.1)", alignItems: "center", justifyContent: "center" }}>
                      <MaterialIcons name={place.name === "Home" ? "home" : "work"} size={20} color="#D4AF37" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 14 }}>{place.name}</Text>
                      <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{place.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Recent Searches */}
            {!searchQuery && searchHistory.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
                    Recent Searches
                  </Text>
                  <TouchableOpacity onPress={async () => { setSearchHistory([]); await AsyncStorage.removeItem("searchHistory"); }}>
                    <Text style={{ color: "#CE1126", fontSize: 12 }}>Clear All</Text>
                  </TouchableOpacity>
                </View>
                {searchHistory.map((loc, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleSelectDestination(loc)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
                      <MaterialIcons name="access-time" size={20} color="#9CA3AF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 14 }}>{loc.name}</Text>
                      <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{loc.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Popular / Search Results */}
            <View>
              <Text style={{ color: "#9CA3AF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                {searchQuery ? "Results" : "Popular Destinations"}
              </Text>
              {filteredDestinations.length === 0 ? (
                <Text style={{ color: "#9CA3AF", fontSize: 14, textAlign: "center", marginTop: 24 }}>No results found</Text>
              ) : (
                filteredDestinations.map((loc, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleSelectDestination(loc)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
                      <MaterialIcons name="location-on" size={20} color="#9CA3AF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 14 }}>{loc.name}</Text>
                      <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{loc.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
