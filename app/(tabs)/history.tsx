import { ScrollView, Text, View, FlatList, Pressable } from "react-native";
import { ScreenContainer } from "@/components/screen-container";

interface Trip {
  id: string;
  from: string;
  to: string;
  date: string;
  fare: number;
  duration: string;
  category: string;
}

const mockTrips: Trip[] = [
  {
    id: "1",
    from: "Accra Mall",
    to: "Osu",
    date: "Today, 2:30 PM",
    fare: 87,
    duration: "18 min",
    category: "Standard",
  },
  {
    id: "2",
    from: "Airport",
    to: "Downtown",
    date: "Yesterday, 10:15 AM",
    fare: 120,
    duration: "35 min",
    category: "Comfort",
  },
  {
    id: "3",
    from: "Tema",
    to: "Accra",
    date: "Jun 14, 6:45 PM",
    fare: 95,
    duration: "42 min",
    category: "Standard",
  },
];

function TripCard({ trip }: { trip: Trip }) {
  return (
    <Pressable
      style={({ pressed }) => [
        { opacity: pressed ? 0.7 : 1 },
      ]}
      className="bg-surface rounded-xl p-4 mb-3 border border-border"
    >
      <View className="flex-row justify-between items-start mb-2">
        <View className="flex-1">
          <Text className="text-sm text-muted mb-1">{trip.date}</Text>
          <Text className="text-base font-semibold text-foreground">{trip.from}</Text>
          <Text className="text-xs text-muted mt-1">→ {trip.to}</Text>
        </View>
        <View className="items-end">
          <Text className="text-lg font-bold text-primary">GH₵{trip.fare}</Text>
          <Text className="text-xs text-muted mt-1">{trip.category}</Text>
        </View>
      </View>
      <View className="border-t border-border pt-2 mt-2">
        <Text className="text-xs text-muted">{trip.duration}</Text>
      </View>
    </Pressable>
  );
}

export default function HistoryScreen() {
  return (
    <ScreenContainer className="p-4">
      <View className="mb-4">
        <Text className="text-2xl font-bold text-foreground">Trip History</Text>
        <Text className="text-sm text-muted mt-1">Your recent rides</Text>
      </View>

      <FlatList
        data={mockTrips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TripCard trip={item} />}
        scrollEnabled={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </ScreenContainer>
  );
}
