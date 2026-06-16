import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, FlatList } from "react-native";
import { useState, useCallback } from "react";

interface Location {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface DestinationSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectDestination: (location: Location) => void;
  savedPlaces?: Location[];
}

export function DestinationSearchModal({
  visible,
  onClose,
  onSelectDestination,
  savedPlaces = [
    { name: "Home", address: "123 Main St, Accra", lat: 5.6037, lng: -0.187 },
    { name: "Work", address: "Business Hub, Osu", lat: 5.6247, lng: -0.1870 },
  ],
}: DestinationSearchModalProps) {
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Location[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Mock search results
  const mockLocations: Location[] = [
    { name: "Accra Mall", address: "Accra, Ghana", lat: 5.5897, lng: -0.2054 },
    { name: "Osu", address: "Osu, Accra", lat: 5.6247, lng: -0.1870 },
    { name: "Tema", address: "Tema, Ghana", lat: 5.6737, lng: -0.0137 },
    { name: "Kasoa", address: "Kasoa, Ghana", lat: 5.6537, lng: -0.4137 },
    { name: "East Legon", address: "East Legon, Accra", lat: 5.6337, lng: -0.1570 },
    { name: "Airport", address: "Kotoka International Airport", lat: 5.6052, lng: -0.1674 },
  ];

  const handleSearch = useCallback((text: string) => {
    setSearchText(text);
    if (text.length > 0) {
      setIsSearching(true);
      // Simulate API search delay
      setTimeout(() => {
        const results = mockLocations.filter(
          (loc) =>
            loc.name.toLowerCase().includes(text.toLowerCase()) ||
            loc.address.toLowerCase().includes(text.toLowerCase())
        );
        setSearchResults(results);
        setIsSearching(false);
      }, 300);
    } else {
      setSearchResults([]);
    }
  }, []);

  const handleSelectLocation = (location: Location) => {
    onSelectDestination(location);
    setSearchText("");
    setSearchResults([]);
    onClose();
  };

  const displayLocations = searchText.length > 0 ? searchResults : savedPlaces;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-4 py-4 border-b border-border">
          <TouchableOpacity onPress={onClose} className="p-2">
            <Text className="text-2xl">←</Text>
          </TouchableOpacity>
          <Text className="text-lg font-bold text-foreground">Where to?</Text>
        </View>

        {/* Search Input */}
        <View className="px-4 py-4 border-b border-border">
          <View className="flex-row items-center bg-secondary rounded-xl px-4 py-3 border border-border">
            <Text className="text-lg mr-2">🔍</Text>
            <TextInput
              placeholder="Search destination..."
              placeholderTextColor="#999"
              value={searchText}
              onChangeText={handleSearch}
              className="flex-1 text-foreground"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => handleSearch("")}>
                <Text className="text-lg">✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Results */}
        <FlatList
          data={displayLocations}
          keyExtractor={(item) => item.address}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleSelectLocation(item)}
              className="px-4 py-4 border-b border-border flex-row items-start gap-3"
            >
              <View className="w-10 h-10 rounded-lg bg-primary/10 items-center justify-center mt-1">
                <Text className="text-lg">📍</Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground">{item.name}</Text>
                <Text className="text-xs text-muted mt-1">{item.address}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            searchText.length > 0 ? (
              <View className="flex-1 items-center justify-center py-8">
                <Text className="text-muted">No results found</Text>
              </View>
            ) : (
              <View className="px-4 py-4">
                <Text className="text-xs font-semibold text-muted mb-3">SAVED PLACES</Text>
                {savedPlaces.map((place) => (
                  <TouchableOpacity
                    key={place.address}
                    onPress={() => handleSelectLocation(place)}
                    className="py-3 flex-row items-start gap-3 border-b border-border"
                  >
                    <View className="w-10 h-10 rounded-lg bg-primary/10 items-center justify-center">
                      <Text className="text-lg">{place.name === "Home" ? "🏠" : "💼"}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">{place.name}</Text>
                      <Text className="text-xs text-muted mt-1">{place.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )
          }
        />
      </View>
    </Modal>
  );
}
