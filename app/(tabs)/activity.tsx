import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

interface Trip {
  id: string;
  date: string;
  time: string;
  from: string;
  to: string;
  category: string;
  fare: number;
  distance: number;
  duration: number;
  status: "completed" | "cancelled";
  rating?: number;
  driver?: string;
  payment: string;
}

const SAMPLE_TRIPS: Trip[] = [
  {
    id: "1", date: "Today", time: "10:45 AM",
    from: "Nmai Dzorm", to: "Kotoka International Airport",
    category: "Comfort", fare: 85.50, distance: 14.2, duration: 28,
    status: "completed", rating: 5, driver: "Kwame A.", payment: "Cash",
  },
  {
    id: "2", date: "Yesterday", time: "3:20 PM",
    from: "Accra Mall", to: "Osu Oxford Street",
    category: "Standard", fare: 32.00, distance: 5.8, duration: 18,
    status: "completed", rating: 4, driver: "Ama K.", payment: "MoMo",
  },
  {
    id: "3", date: "Jun 14", time: "8:10 AM",
    from: "University of Ghana", to: "Tema Station",
    category: "Kantanka", fare: 55.20, distance: 9.4, duration: 22,
    status: "completed", rating: 5, driver: "Kofi M.", payment: "Wallet",
  },
  {
    id: "4", date: "Jun 12", time: "6:30 PM",
    from: "Labadi Beach", to: "West Hills Mall",
    category: "Executive", fare: 120.00, distance: 18.5, duration: 42,
    status: "cancelled", payment: "Cash",
  },
  {
    id: "5", date: "Jun 10", time: "11:00 AM",
    from: "Achimota Mall", to: "Accra Mall",
    category: "Okada", fare: 18.80, distance: 4.2, duration: 12,
    status: "completed", rating: 4, driver: "Yaw B.", payment: "Cash",
  },
];

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "completed" | "cancelled">("all");

  const filtered = SAMPLE_TRIPS.filter((t) =>
    activeFilter === "all" ? true : t.status === activeFilter
  );

  const renderStars = (rating?: number) => {
    if (!rating) return null;
    return (
      <View style={{ flexDirection: "row", gap: 2 }}>
        {[1, 2, 3, 4, 5].map((s) => (
          <MaterialIcons key={s} name="star" size={12} color={s <= rating ? "#D4AF37" : "#2A2A2A"} />
        ))}
      </View>
    );
  };

  return (
    <ScreenContainer className="p-0">
      <View style={{ paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
        <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 24 }}>Activity</Text>
      </View>

      {/* Filter Tabs */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        {(["all", "completed", "cancelled"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setActiveFilter(f)}
            style={{
              paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
              backgroundColor: activeFilter === f ? "#D4AF37" : "#1A1A1A",
            }}
          >
            <Text style={{ color: activeFilter === f ? "#000" : "#9CA3AF", fontSize: 13, fontWeight: "600", textTransform: "capitalize" }}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {filtered.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <MaterialIcons name="directions-car" size={48} color="#2A2A2A" />
            <Text style={{ color: "#9CA3AF", marginTop: 12, fontSize: 15 }}>No trips yet</Text>
          </View>
        ) : (
          filtered.map((trip) => (
            <TouchableOpacity
              key={trip.id}
              onPress={() => setSelectedTrip(trip)}
              style={{ backgroundColor: "#111111", borderRadius: 16, padding: 16, borderWidth: 0.5, borderColor: "#2A2A2A", marginBottom: 10 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{trip.date} · {trip.time}</Text>
                  <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 14, marginTop: 2 }} numberOfLines={1}>{trip.to}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#D4AF37", fontWeight: "bold", fontSize: 16 }}>GH₵{trip.fare.toFixed(2)}</Text>
                  <View style={{ marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: trip.status === "completed" ? "rgba(0,107,63,0.15)" : "rgba(206,17,38,0.15)" }}>
                    <Text style={{ color: trip.status === "completed" ? "#006B3F" : "#CE1126", fontSize: 10, fontWeight: "600", textTransform: "capitalize" }}>
                      {trip.status}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialIcons name="directions-car" size={13} color="#9CA3AF" />
                <Text style={{ color: "#9CA3AF", fontSize: 12, flex: 1 }}>{trip.category}</Text>
                <Text style={{ color: "#4A4A4A", fontSize: 12 }}>{trip.distance.toFixed(1)} km</Text>
                {renderStars(trip.rating)}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Trip Detail Modal */}
      <Modal visible={!!selectedTrip} animationType="slide" presentationStyle="pageSheet">
        {selectedTrip && (
          <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#2A2A2A" }}>
              <TouchableOpacity onPress={() => setSelectedTrip(null)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name="close" size={18} color="#FAFAFA" />
              </TouchableOpacity>
              <Text style={{ color: "#FAFAFA", fontWeight: "bold", fontSize: 18, flex: 1 }}>Trip Details</Text>
            </View>

            <ScrollView style={{ flex: 1, padding: 16 }}>
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: selectedTrip.status === "completed" ? "rgba(0,107,63,0.15)" : "rgba(206,17,38,0.15)" }}>
                  <Text style={{ color: selectedTrip.status === "completed" ? "#006B3F" : "#CE1126", fontWeight: "600", textTransform: "capitalize" }}>
                    {selectedTrip.status}
                  </Text>
                </View>
              </View>

              {/* Route */}
              <View style={{ backgroundColor: "#111111", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ alignItems: "center", gap: 4 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#006B3F" }} />
                    <View style={{ width: 1, height: 24, backgroundColor: "#2A2A2A" }} />
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#D4AF37" }} />
                  </View>
                  <View style={{ flex: 1, gap: 16 }}>
                    <View>
                      <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Pickup</Text>
                      <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 14 }}>{selectedTrip.from}</Text>
                    </View>
                    <View>
                      <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Destination</Text>
                      <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 14 }}>{selectedTrip.to}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Stats */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {[{ label: "Distance", value: `${selectedTrip.distance.toFixed(1)} km` }, { label: "Duration", value: `${selectedTrip.duration} min` }, { label: "Category", value: selectedTrip.category }].map((stat) => (
                  <View key={stat.label} style={{ flex: 1, backgroundColor: "#111111", borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
                    <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{stat.label}</Text>
                    <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 12, marginTop: 2 }}>{stat.value}</Text>
                  </View>
                ))}
              </View>

              {/* Fare */}
              <View style={{ backgroundColor: "#111111", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 13 }}>Total Fare</Text>
                  <Text style={{ color: "#D4AF37", fontWeight: "bold", fontSize: 20 }}>GH₵{selectedTrip.fare.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 13 }}>Payment</Text>
                  <Text style={{ color: "#FAFAFA", fontSize: 13 }}>{selectedTrip.payment}</Text>
                </View>
              </View>

              {/* Driver */}
              {selectedTrip.driver && (
                <View style={{ backgroundColor: "#111111", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: "#2A2A2A" }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View>
                      <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Driver</Text>
                      <Text style={{ color: "#FAFAFA", fontWeight: "500", fontSize: 14 }}>{selectedTrip.driver}</Text>
                    </View>
                    {selectedTrip.rating && (
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: "#9CA3AF", fontSize: 11 }}>Your Rating</Text>
                        {renderStars(selectedTrip.rating)}
                      </View>
                    )}
                  </View>
                </View>
              )}

              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 24 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{selectedTrip.date}</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{selectedTrip.time}</Text>
              </View>

              {/* Actions */}
              <View style={{ gap: 10, paddingBottom: insets.bottom + 16 }}>
                {selectedTrip.status === "completed" && !selectedTrip.rating && (
                  <TouchableOpacity onPress={() => Alert.alert("Rate Trip", "Thank you for your feedback!")} style={{ backgroundColor: "#D4AF37", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
                    <Text style={{ color: "#000", fontWeight: "bold", fontSize: 15 }}>Rate this Trip</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => { setSelectedTrip(null); Alert.alert("Rebook", `Booking a new ${selectedTrip.category} ride to ${selectedTrip.to}`); }}
                  style={{ backgroundColor: "#1A1A1A", borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 0.5, borderColor: "#2A2A2A" }}
                >
                  <Text style={{ color: "#FAFAFA", fontWeight: "600", fontSize: 15 }}>Rebook this Trip</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </ScreenContainer>
  );
}
