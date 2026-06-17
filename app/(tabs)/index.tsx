import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
  FlatList,
  Share,
  Linking,
  Image,
} from "react-native";
import LeafletMap from "@/components/LeafletMap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/lib/auth-context";
import { firestoreDB, COLLECTIONS } from "@/lib/firebase";
import * as ExpoLocation from "expo-location";
import {
  RIDE_CATEGORIES,
  POPULAR_DESTINATIONS,
  PAYMENT_METHODS,
  PROMO_CODES,
  calculateFare,
  calculateDiscount,
  FREE_WAITING_MINUTES,
} from "@/constants/rides";
import {
  notifyDriverFound,
  notifyDriverArriving,
  notifyTripStarted,
  notifyTripCompleted,
} from "@/lib/notifications";

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");

// Brand colors
const GOLD = "#D4AF37";
const GREEN = "#006B3F";
const RED = "#CE1126";
const BG = "#0A0A0A";
const SURFACE = "#111111";
const CARD = "#1A1A1A";
const BORDER = "#2A2A2A";
const TEXT = "#FAFAFA";
const MUTED = "#9CA3AF";

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

interface ActiveRide {
  id: string;
  category: string;
  categoryId: string;
  destination: Location;
  pickup: string;
  distance: number;
  duration: number;
  fare: number;
  payment: string;
  paymentId: string;
  status: "searching" | "matched" | "driver_arriving" | "in_progress" | "completed" | "cancelled";
  scheduled?: string | null;
  splitData?: { totalPeople: number; perPersonFare: number } | null;
  driverName?: string;
  driverRating?: number;
  driverVehicle?: string;
  driverPlate?: string;
  eta?: number;
  waitingFee?: number;
  tipAmount?: number;
  finalFare?: number;
}

const DEFAULT_LOCATION: [number, number] = [5.6037, -0.187]; // Accra, Ghana

const STATUS_LABELS: Record<string, string> = {
  searching: "Searching for driver...",
  matched: "Driver Assigned",
  driver_arriving: "Driver Arriving",
  in_progress: "On Trip",
  completed: "Trip Complete!",
  cancelled: "Ride Cancelled",
};

const MOCK_DRIVERS = [
  { name: "Kwame Asante", rating: 4.9, vehicle: "Toyota Camry (White)", plate: "GR 1234-24" },
  { name: "Ama Owusu", rating: 4.8, vehicle: "Hyundai Sonata (Silver)", plate: "GR 5678-23" },
  { name: "Kofi Mensah", rating: 4.7, vehicle: "Honda Accord (Black)", plate: "GR 9012-24" },
];

export default function HomeScreen() {
  const { user, riderProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const safeTop = insets.top > 0 ? insets.top : (Constants.statusBarHeight ?? 44);
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_LOCATION);

  // Request GPS and center map on user's real position
  useEffect(() => {
    (async () => {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
          setUserLocation([loc.coords.latitude, loc.coords.longitude]);
        }
      } catch (err) {
        // Fall back to default Accra location if GPS fails
        console.log('GPS unavailable, using default location');
      }
    })();
  }, []);
  const [destination, setDestination] = useState<Location | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(RIDE_CATEGORIES[0]);
  const [selectedPayment, setSelectedPayment] = useState(PAYMENT_METHODS[0]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([
    { name: "Home", address: "Set location" },
    { name: "Work", address: "Set location" },
  ]);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [searchHistory, setSearchHistory] = useState<Location[]>([]);

  // Schedule
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  // Split Fare
  const [splitData, setSplitData] = useState<{ totalPeople: number; perPersonFare: number } | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitCount, setSplitCount] = useState("2");

  // Promo Code
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [promoExpanded, setPromoExpanded] = useState(false);
  const [promoError, setPromoError] = useState("");

  // Rating / Tip (post-ride)
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [ratingValue, setRatingValue] = useState(5);
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [rideRated, setRideRated] = useState(false);
  const [tipAdded, setTipAdded] = useState(false);

  // In-ride chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; text: string; fromRider: boolean; time: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const QUICK_MESSAGES = [
    "I'm at the gate",
    "Almost there, 1 min",
    "Please wait for me",
    "I'm wearing a red shirt",
    "Can you call me?",
    "I'm outside now",
  ];

  useEffect(() => {
    AsyncStorage.getItem("savedPlaces").then((v) => { if (v) setSavedPlaces(JSON.parse(v)); });
    AsyncStorage.getItem("searchHistory").then((v) => { if (v) setSearchHistory(JSON.parse(v)); });
  }, []);

  // Simulate driver progression
  useEffect(() => {
    if (!activeRide || activeRide.status === "completed" || activeRide.status === "cancelled") return;
    if (activeRide.status === "searching") {
      const t = setTimeout(() => {
        const driver = MOCK_DRIVERS[Math.floor(Math.random() * MOCK_DRIVERS.length)];
        const eta = Math.floor(Math.random() * 5) + 3;
        setActiveRide(prev => prev ? {
          ...prev,
          status: "matched",
          driverName: driver.name,
          driverRating: driver.rating,
          driverVehicle: driver.vehicle,
          driverPlate: driver.plate,
          eta,
        } : null);
        notifyDriverFound(driver.name, eta);
      }, 4000);
      return () => clearTimeout(t);
    }
    if (activeRide.status === "matched") {
      const t = setTimeout(() => {
        setActiveRide(prev => prev ? { ...prev, status: "driver_arriving", eta: Math.floor(Math.random() * 3) + 1 } : null);
        if (activeRide.driverName) notifyDriverArriving(activeRide.driverName);
      }, 5000);
      return () => clearTimeout(t);
    }
    if (activeRide.status === "driver_arriving") {
      const t = setTimeout(() => {
        setActiveRide(prev => prev ? { ...prev, status: "in_progress", eta: prev.duration } : null);
        notifyTripStarted(activeRide.destination.name);
      }, 6000);
      return () => clearTimeout(t);
    }
    if (activeRide.status === "in_progress") {
      const t = setTimeout(() => {
        setActiveRide(prev => prev ? { ...prev, status: "completed", finalFare: prev.fare } : null);
        notifyTripCompleted(activeRide.fare);
      }, 8000);
      return () => clearTimeout(t);
    }
  }, [activeRide?.status]);

  const distance = destination
    ? Math.sqrt(
        Math.pow((destination.lat - userLocation[0]) * 111, 2) +
          Math.pow((destination.lng - userLocation[1]) * 111 * Math.cos((userLocation[0] * Math.PI) / 180), 2)
      )
    : 0;
  const duration = Math.round(distance * 3.5 + 5);
  const baseFare = destination ? calculateFare(selectedCategory.id, distance, duration) : 0;
  const discount = appliedPromo ? calculateDiscount(appliedPromo, baseFare) : 0;
  const finalFare = baseFare - discount;
  const perPersonFare = splitData ? finalFare / splitData.totalPeople : finalFare;

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
    const updated = [loc, ...searchHistory.filter((h) => h.name !== loc.name)].slice(0, 5);
    setSearchHistory(updated);
    await AsyncStorage.setItem("searchHistory", JSON.stringify(updated));
  };

  const handleBook = async () => {
    if (!destination) return;
    setBookingLoading(true);
    const rideId = `ride_${Date.now()}`;
    // Save ride to Firestore
    if (user) {
      try {
        await firestoreDB.create(COLLECTIONS.RIDES, {
          id: rideId,
          rider_id: user.uid,
          category: selectedCategory.name,
          pickup_address: 'Current Location',
          destination_address: destination.name,
          distance,
          duration,
          fare: perPersonFare,
          payment: selectedPayment.name,
          status: 'searching',
          scheduled_for: isScheduled ? scheduledFor : null,
          created_date: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Failed to save ride to Firestore:', err);
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
    setActiveRide({
      id: `ride_${Date.now()}`,
      category: selectedCategory.name,
      categoryId: selectedCategory.id,
      destination,
      pickup: "Current Location",
      distance,
      duration,
      fare: perPersonFare,
      payment: selectedPayment.name,
      paymentId: selectedPayment.id,
      status: "searching",
      scheduled: isScheduled ? scheduledFor : null,
      splitData: splitData,
    });
    setBookingLoading(false);
    setRideRated(false);
    setTipAdded(false);
    setTipAmount(null);
  };

  const handleCancelRide = () => {
    if (activeRide?.status === "in_progress") {
      Alert.alert("Cannot Cancel", "You cannot cancel a ride that is already in progress.");
      return;
    }
    Alert.alert("Cancel Ride", "Are you sure you want to cancel this ride?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Cancel", style: "destructive", onPress: () => {
          setActiveRide(null);
          setDestination(null);
          setSplitData(null);
          setAppliedPromo(null);
          setIsScheduled(false);
          setScheduledFor(null);
        }
      },
    ]);
  };

  const handleCancelBooking = () => {
    setDestination(null);
    setSelectedCategory(RIDE_CATEGORIES[0]);
    setAppliedPromo(null);
    setSplitData(null);
    setIsScheduled(false);
    setScheduledFor(null);
  };

  const handleQuickPlace = (place: SavedPlace) => {
    if (!place.lat || !place.lng) { setSearchOpen(true); return; }
    handleSelectDestination({ name: place.name, address: place.address, lat: place.lat, lng: place.lng });
  };

  const handleApplyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!PROMO_CODES[code]) {
      setPromoError("Invalid promo code");
      return;
    }
    setAppliedPromo(code);
    setPromoExpanded(false);
    setPromoError("");
  };

  const handleSplitConfirm = () => {
    const count = parseInt(splitCount);
    if (isNaN(count) || count < 2 || count > 6) {
      Alert.alert("Invalid", "Please enter a number between 2 and 6");
      return;
    }
    setSplitData({ totalPeople: count, perPersonFare: parseFloat((finalFare / count).toFixed(2)) });
    setShowSplitModal(false);
  };

  const handleScheduleConfirm = () => {
    if (!scheduleDate || !scheduleTime) {
      Alert.alert("Required", "Please enter both date and time");
      return;
    }
    setScheduledFor(`${scheduleDate} at ${scheduleTime}`);
    setIsScheduled(true);
    setShowScheduleModal(false);
  };

  const handleShareTrip = async () => {
    if (!activeRide) return;
    const msg = `I'm in a HY3N ride! 🚗\nPickup: ${activeRide.pickup}\nDestination: ${activeRide.destination.name}${activeRide.eta ? `\nETA: ${activeRide.eta} min` : ''}\nDriver: ${activeRide.driverName || 'Searching...'}\n\nTrack me via HY3N.`;
    try {
      await Share.share({ message: msg, title: "My HY3N Trip" });
    } catch (e) {}
  };

  const handleFinishRide = () => {
    setActiveRide(null);
    setDestination(null);
    setSplitData(null);
    setAppliedPromo(null);
    setIsScheduled(false);
    setScheduledFor(null);
  };

  const renderActiveRide = () => {
    if (!activeRide) return null;
    const isCompleted = activeRide.status === "completed";
    const isSearching = activeRide.status === "searching";
    const hasDriver = ["matched", "driver_arriving", "in_progress"].includes(activeRide.status);

    return (
      <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
        {isSearching && (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 16 }} />
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, marginBottom: 6 }}>Searching for driver...</Text>
            <Text style={{ color: MUTED, fontSize: 13 }}>This usually takes 1–5 minutes</Text>
            <View style={{ backgroundColor: CARD, borderRadius: 14, padding: 14, marginTop: 16, width: "100%", borderWidth: 0.5, borderColor: BORDER }}>
              <Row label="Destination" value={activeRide.destination.name} />
              <Row label="Distance" value={`${activeRide.distance.toFixed(1)} km · ~${activeRide.duration} min`} />
              <Row label="Fare" value={`GH₵${activeRide.fare.toFixed(2)}`} valueColor={GOLD} />
              <Row label="Payment" value={activeRide.payment} />
            </View>
            <TouchableOpacity
              onPress={handleCancelRide}
              style={{ marginTop: 16, borderWidth: 1, borderColor: `${RED}66`, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 }}
            >
              <Text style={{ color: RED, fontWeight: "600", fontSize: 14 }}>Cancel Request</Text>
            </TouchableOpacity>
          </View>
        )}

        {hasDriver && (
          <View>
            {/* ETA Banner */}
            <View style={{ backgroundColor: `${GREEN}1A`, borderWidth: 1, borderColor: `${GREEN}4D`, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" }}>
                    <MaterialIcons name="navigation" size={22} color="#fff" />
                  </View>
                  <View>
                    <Text style={{ color: GREEN, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {activeRide.status === "driver_arriving" ? "Driver Arriving" : activeRide.status === "matched" ? "Driver Assigned" : "On Trip"}
                    </Text>
                    <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 16 }}>{activeRide.driverName || "Your Driver"}</Text>
                  </View>
                </View>
                {activeRide.eta && (
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: GOLD, fontWeight: "bold", fontSize: 28 }}>{activeRide.eta}</Text>
                    <Text style={{ color: MUTED, fontSize: 11 }}>min</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Driver Card — full profile */}
            <View style={{ backgroundColor: CARD, borderRadius: 16, marginBottom: 10, borderWidth: 0.5, borderColor: BORDER, overflow: "hidden" }}>
              {/* Top: avatar + name + ETA */}
              <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}>
                {/* Avatar */}
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${GREEN}33`, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: GREEN }}>
                  <MaterialIcons name="person" size={36} color={GREEN} />
                </View>
                {/* Name + rating + vehicle */}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "800", fontSize: 17, marginBottom: 2 }}>{activeRide.driverName || "Your Driver"}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    {[1,2,3,4,5].map(i => (
                      <MaterialIcons key={i} name="star" size={13} color={i <= Math.round(activeRide.driverRating ?? 5) ? GOLD : BORDER} />
                    ))}
                    <Text style={{ color: MUTED, fontSize: 12, marginLeft: 2 }}>{activeRide.driverRating?.toFixed(1)}</Text>
                  </View>
                  <Text style={{ color: MUTED, fontSize: 12 }}>{activeRide.driverVehicle}</Text>
                </View>
                {/* Plate badge */}
                <View style={{ backgroundColor: `${GOLD}22`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: `${GOLD}55` }}>
                  <Text style={{ color: GOLD, fontWeight: "800", fontSize: 13, letterSpacing: 1 }}>{activeRide.driverPlate}</Text>
                </View>
              </View>
              {/* Divider */}
              <View style={{ height: 0.5, backgroundColor: BORDER, marginHorizontal: 14 }} />
              {/* Bottom: call + message buttons */}
              <View style={{ flexDirection: "row", padding: 12, gap: 10 }}>
                <TouchableOpacity
                  onPress={() => Alert.alert("Call Driver", `Calling ${activeRide.driverName}...`)}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 11, borderRadius: 12, backgroundColor: GREEN }}
                >
                  <MaterialIcons name="phone" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert("Message Driver", `Messaging ${activeRide.driverName}...`)}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 11, borderRadius: 12, backgroundColor: `${GOLD}22`, borderWidth: 1, borderColor: `${GOLD}55` }}
                >
                  <MaterialIcons name="chat" size={18} color={GOLD} />
                  <Text style={{ color: GOLD, fontWeight: "700", fontSize: 14 }}>Message</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Trip Route */}
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, backgroundColor: `${CARD}`, borderRadius: 14, marginBottom: 10, borderWidth: 0.5, borderColor: BORDER, borderLeftWidth: 3, borderLeftColor: GOLD }}>
              <View style={{ alignItems: "center", gap: 4, marginTop: 2 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN }} />
                <View style={{ width: 1, height: 28, backgroundColor: BORDER }} />
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD }} />
              </View>
              <View style={{ flex: 1, gap: 10 }}>
                <View>
                  <Text style={{ color: MUTED, fontSize: 10 }}>Pickup</Text>
                  <Text style={{ color: TEXT, fontSize: 13, fontWeight: "500" }}>{activeRide.pickup}</Text>
                </View>
                <View>
                  <Text style={{ color: MUTED, fontSize: 10 }}>Destination</Text>
                  <Text style={{ color: TEXT, fontSize: 13, fontWeight: "500" }}>{activeRide.destination.name}</Text>
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: GOLD, fontWeight: "bold", fontSize: 16 }}>GH₵{activeRide.fare.toFixed(2)}</Text>
                {activeRide.splitData && (
                  <Text style={{ color: GREEN, fontSize: 10 }}>÷{activeRide.splitData.totalPeople}</Text>
                )}
              </View>
            </View>

            {activeRide.splitData && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: `${GOLD}1A`, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: `${GOLD}33` }}>
                <MaterialIcons name="group" size={16} color={GOLD} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: GOLD, fontSize: 12, fontWeight: "600" }}>
                    Split with {activeRide.splitData.totalPeople - 1} friend{activeRide.splitData.totalPeople > 2 ? "s" : ""}
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 11 }}>Your share: GH₵{activeRide.splitData.perPersonFare.toFixed(2)}</Text>
                </View>
              </View>
            )}

            {/* Share Trip + SOS row */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
              <TouchableOpacity
                onPress={handleShareTrip}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, backgroundColor: CARD, borderRadius: 12, borderWidth: 0.5, borderColor: BORDER }}
              >
                <MaterialIcons name="share" size={16} color={MUTED} />
                <Text style={{ color: MUTED, fontSize: 13, fontWeight: "500" }}>Share Trip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => Alert.alert(
                  '🚨 Emergency SOS',
                  'This will immediately notify HY3N Safety team and your emergency contacts with your current location.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Send SOS', style: 'destructive', onPress: () => Alert.alert('SOS Sent', 'HY3N Safety team and your emergency contacts have been notified.') },
                  ]
                )}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: `${RED}1A`, borderRadius: 12, borderWidth: 1, borderColor: `${RED}55` }}
              >
                <MaterialIcons name="emergency" size={18} color={RED} />
                <Text style={{ color: RED, fontSize: 13, fontWeight: "700" }}>SOS</Text>
              </TouchableOpacity>
            </View>

            {/* In-ride chat button */}
            <TouchableOpacity
              onPress={() => setShowChat(true)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, backgroundColor: `${GOLD}0D`, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: `${GOLD}33` }}
            >
              <MaterialIcons name="chat-bubble-outline" size={16} color={GOLD} />
              <Text style={{ color: GOLD, fontSize: 13, fontWeight: "600" }}>Message Driver</Text>
            </TouchableOpacity>

            {activeRide.status !== "in_progress" && (
              <TouchableOpacity
                onPress={handleCancelRide}
                style={{ alignItems: "center", paddingVertical: 12 }}
              >
                <Text style={{ color: RED, fontSize: 14, fontWeight: "500" }}>Cancel Ride</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isCompleted && (
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${GREEN}1A`, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <MaterialIcons name="check-circle" size={40} color={GREEN} />
            </View>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 20, marginBottom: 4 }}>Trip Complete!</Text>
            <Text style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>Thank you for riding with HY3N</Text>

            <View style={{ backgroundColor: CARD, borderRadius: 14, padding: 14, width: "100%", marginBottom: 16, borderWidth: 0.5, borderColor: BORDER }}>
              <Row label="Base Fare" value={`GH₵${activeRide.fare.toFixed(2)}`} />
              {activeRide.waitingFee && activeRide.waitingFee > 0 && (
                <Row label="Waiting Fee" value={`+GH₵${activeRide.waitingFee.toFixed(2)}`} valueColor={RED} />
              )}
              {tipAmount && tipAmount > 0 && (
                <Row label="Tip" value={`+GH₵${tipAmount.toFixed(2)}`} valueColor={GREEN} />
              )}
              <View style={{ borderTopWidth: 0.5, borderTopColor: BORDER, marginTop: 8, paddingTop: 8 }}>
                <Row
                  label="Total"
                  value={`GH₵${(activeRide.fare + (activeRide.waitingFee || 0) + (tipAmount || 0)).toFixed(2)}`}
                  valueColor={GOLD}
                  bold
                />
              </View>
            </View>

            {!tipAdded && (
              <TouchableOpacity
                onPress={() => setShowTipModal(true)}
                style={{ width: "100%", borderWidth: 1, borderColor: `${GREEN}66`, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginBottom: 10, flexDirection: "row", justifyContent: "center", gap: 8 }}
              >
                <MaterialIcons name="attach-money" size={18} color={GREEN} />
                <Text style={{ color: GREEN, fontWeight: "600", fontSize: 14 }}>Add Tip</Text>
              </TouchableOpacity>
            )}
            {tipAdded && (
              <View style={{ width: "100%", backgroundColor: `${GREEN}1A`, borderRadius: 12, padding: 12, marginBottom: 10, alignItems: "center", borderWidth: 1, borderColor: `${GREEN}33` }}>
                <Text style={{ color: GREEN, fontWeight: "600", fontSize: 13 }}>Tip Added: GH₵{tipAmount?.toFixed(2)}</Text>
                <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>Thank you for your generosity!</Text>
              </View>
            )}

            {!rideRated && (
              <TouchableOpacity
                onPress={() => setShowRatingModal(true)}
                style={{ width: "100%", backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 10, flexDirection: "row", justifyContent: "center", gap: 8 }}
              >
                <MaterialIcons name="star" size={18} color="#000" />
                <Text style={{ color: "#000", fontWeight: "bold", fontSize: 15 }}>Rate Your Driver</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleFinishRide}
              style={{ width: "100%", alignItems: "center", paddingVertical: 12 }}
            >
              <Text style={{ color: MUTED, fontSize: 13 }}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  };

  const renderBookingSheet = () => (
    <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Destination header */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
        <TouchableOpacity
          onPress={handleCancelBooking}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: CARD, alignItems: "center", justifyContent: "center", marginRight: 10 }}
        >
          <MaterialIcons name="arrow-back" size={18} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>To</Text>
          <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 15 }} numberOfLines={1}>{destination?.name}</Text>
          <Text style={{ color: MUTED, fontSize: 11 }}>{distance.toFixed(1)} km · ~{duration} min</Text>
        </View>
      </View>

      {/* Ride Categories */}
      <Text style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", marginBottom: 8 }}>Choose Ride</Text>
      {RIDE_CATEGORIES.map((cat) => {
        const fare = calculateFare(cat.id, distance, duration);
        const isSelected = selectedCategory.id === cat.id;
        return (
          <TouchableOpacity
            key={cat.id}
            onPress={() => setSelectedCategory(cat)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 12,
              borderRadius: 14,
              marginBottom: 8,
              backgroundColor: isSelected ? `${GOLD}1A` : CARD,
              borderWidth: 1.5,
              borderColor: isSelected ? GOLD : BORDER,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: isSelected ? `${GOLD}33` : "#222", alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name={cat.icon as any} size={20} color={isSelected ? GOLD : MUTED} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 13 }}>{cat.name}</Text>
              <Text style={{ color: MUTED, fontSize: 11, marginTop: 1 }}>{cat.description}</Text>
              {cat.seats > 0 && <Text style={{ color: MUTED, fontSize: 10 }}>{cat.seats} seats</Text>}
            </View>
            <Text style={{ color: isSelected ? GOLD : TEXT, fontWeight: "bold", fontSize: 15 }}>GH₵{fare.toFixed(2)}</Text>
          </TouchableOpacity>
        );
      })}

      {/* Payment Method */}
      <Text style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", marginBottom: 8, marginTop: 4 }}>Payment Method</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        {PAYMENT_METHODS.map((pm) => {
          const isSelected = selectedPayment.id === pm.id;
          return (
            <TouchableOpacity
              key={pm.id}
              onPress={() => setSelectedPayment(pm)}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 10,
                paddingHorizontal: 4,
                borderRadius: 12,
                backgroundColor: isSelected ? `${GOLD}1A` : CARD,
                borderWidth: 1,
                borderColor: isSelected ? GOLD : BORDER,
                gap: 4,
              }}
            >
              <MaterialIcons name={pm.icon as any} size={18} color={isSelected ? GOLD : MUTED} />
              <Text style={{ color: isSelected ? GOLD : MUTED, fontSize: 11, fontWeight: "500" }}>{pm.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Trip Type */}
      <Text style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", marginBottom: 8 }}>Trip Type</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TouchableOpacity
          onPress={() => { setIsScheduled(false); setScheduledFor(null); }}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: !isScheduled ? `${GOLD}1A` : CARD, borderWidth: 1, borderColor: !isScheduled ? GOLD : BORDER }}
        >
          <MaterialIcons name="flash-on" size={16} color={!isScheduled ? GOLD : MUTED} />
          <Text style={{ color: !isScheduled ? GOLD : MUTED, fontSize: 13, fontWeight: "600" }}>Now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowScheduleModal(true)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: isScheduled ? `${GOLD}1A` : CARD, borderWidth: 1, borderColor: isScheduled ? GOLD : BORDER }}
        >
          <MaterialIcons name="event" size={16} color={isScheduled ? GOLD : MUTED} />
          <Text style={{ color: isScheduled ? GOLD : MUTED, fontSize: 13, fontWeight: "600" }}>
            {isScheduled && scheduledFor ? scheduledFor : "Schedule"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Split Fare */}
      <TouchableOpacity
        onPress={() => setShowSplitModal(true)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 12,
          borderRadius: 12,
          backgroundColor: splitData ? `${GOLD}1A` : CARD,
          borderWidth: 1,
          borderColor: splitData ? GOLD : BORDER,
          marginBottom: 10,
        }}
      >
        <MaterialIcons name="group" size={18} color={splitData ? GOLD : MUTED} />
        <View style={{ flex: 1 }}>
          {splitData ? (
            <>
              <Text style={{ color: GOLD, fontSize: 13, fontWeight: "600" }}>Split with {splitData.totalPeople - 1} friend{splitData.totalPeople > 2 ? "s" : ""}</Text>
              <Text style={{ color: MUTED, fontSize: 11 }}>GH₵{splitData.perPersonFare.toFixed(2)} each</Text>
            </>
          ) : (
            <Text style={{ color: MUTED, fontSize: 13, fontWeight: "500" }}>Split fare with friends</Text>
          )}
        </View>
        {splitData && (
          <TouchableOpacity onPress={(e) => { setSplitData(null); }}>
            <MaterialIcons name="close" size={16} color={MUTED} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Promo Code */}
      {appliedPromo ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: `${GREEN}1A`, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: `${GREEN}4D` }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialIcons name="local-offer" size={16} color={GREEN} />
            <Text style={{ color: GREEN, fontSize: 13, fontWeight: "600" }}>{appliedPromo} applied</Text>
            <Text style={{ color: GOLD, fontSize: 13, fontWeight: "bold" }}>-GH₵{discount.toFixed(2)}</Text>
          </View>
          <TouchableOpacity onPress={() => { setAppliedPromo(null); setPromoInput(""); }}>
            <MaterialIcons name="close" size={16} color={MUTED} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ marginBottom: 10 }}>
          <TouchableOpacity
            onPress={() => setPromoExpanded(!promoExpanded)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}
          >
            <MaterialIcons name="local-offer" size={16} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 13, fontWeight: "500", flex: 1 }}>Add promo code</Text>
            <MaterialIcons name={promoExpanded ? "keyboard-arrow-up" : "keyboard-arrow-down"} size={18} color={MUTED} />
          </TouchableOpacity>
          {promoExpanded && (
            <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
              <TextInput
                value={promoInput}
                onChangeText={(t) => { setPromoInput(t); setPromoError(""); }}
                placeholder="Enter code"
                placeholderTextColor="#4A4A4A"
                autoCapitalize="characters"
                style={{ flex: 1, backgroundColor: CARD, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: TEXT, fontSize: 13, borderWidth: 1, borderColor: promoError ? RED : BORDER }}
                returnKeyType="done"
                onSubmitEditing={handleApplyPromo}
              />
              <TouchableOpacity
                onPress={handleApplyPromo}
                style={{ backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: "#000", fontWeight: "bold", fontSize: 13 }}>Apply</Text>
              </TouchableOpacity>
            </View>
          )}
          {promoError ? <Text style={{ color: RED, fontSize: 11, marginTop: 4, marginLeft: 4 }}>{promoError}</Text> : null}
        </View>
      )}

      {/* Fare Summary */}
      <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: BORDER }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700", marginBottom: 4 }}>
              {splitData ? "Your Share" : "Estimated Fare"}
            </Text>
            {splitData && <Text style={{ color: MUTED, fontSize: 11 }}>Total Trip: GH₵{finalFare.toFixed(2)}</Text>}
            {discount > 0 && (
              <Text style={{ color: MUTED, fontSize: 11, textDecorationLine: "line-through" }}>GH₵{baseFare.toFixed(2)}</Text>
            )}
          </View>
          <Text style={{ color: GOLD, fontWeight: "bold", fontSize: 30 }}>GH₵{perPersonFare.toFixed(2)}</Text>
        </View>
        <Text style={{ color: MUTED, fontSize: 10, marginTop: 4 }}>Includes all taxes & fees</Text>
      </View>

      {/* Book Button */}
      <TouchableOpacity
        onPress={handleBook}
        disabled={bookingLoading || (isScheduled && !scheduledFor)}
        style={{
          backgroundColor: GREEN,
          borderRadius: 14,
          paddingVertical: 16,
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "center",
          gap: 8,
          marginBottom: 8,
          opacity: (isScheduled && !scheduledFor) ? 0.5 : 1,
        }}
      >
        {bookingLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialIcons name={isScheduled ? "event" : "navigation"} size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}>
              {isScheduled ? "Schedule Trip" : `Request HY3N · GH₵${perPersonFare.toFixed(2)}`}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );

  const renderDefaultSheet = () => (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <TouchableOpacity
        onPress={() => setSearchOpen(true)}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: CARD, borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: BORDER }}
      >
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" }}>
          <MaterialIcons name="search" size={22} color="#000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 16 }}>Wo kɔ he?</Text>
          <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>Hwɛ wo bɛkyerɛ...</Text>
        </View>
        <MaterialIcons name="location-on" size={20} color={MUTED} />
      </TouchableOpacity>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {savedPlaces.map((place, i) => {
            const iconName: any = place.name.toLowerCase() === "home" ? "home" : place.name.toLowerCase() === "work" ? "work" : "star";
            return (
              <TouchableOpacity
                key={i}
                onPress={() => handleQuickPlace(place)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, minWidth: 110 }}
              >
                <MaterialIcons name={iconName} size={16} color={GOLD} />
                <View>
                  <Text style={{ color: TEXT, fontWeight: "600", fontSize: 13 }}>{place.name}</Text>
                  <Text style={{ color: MUTED, fontSize: 10 }} numberOfLines={1}>{place.address}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => setSearchOpen(true)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: `${CARD}80`, borderRadius: 12, borderWidth: 1, borderColor: BORDER }}
          >
            <MaterialIcons name="add" size={16} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 13, fontWeight: "500" }}>Add</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  const sheetHeight = activeRide
    ? (activeRide.status === "completed" ? SCREEN_HEIGHT * 0.75 : SCREEN_HEIGHT * 0.65)
    : destination
    ? SCREEN_HEIGHT * 0.72
    : 200;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Real map using Leaflet + OpenStreetMap dark tiles — works on Expo Go, web, and production */}
      <LeafletMap
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        center={userLocation}
        zoom={14}
        userLocation={userLocation}
        destination={destination ? [destination.lat, destination.lng] : null}
        driverLocation={
          activeRide && (activeRide.status === "matched" || activeRide.status === "driver_arriving")
            ? [userLocation[0] + 0.008, userLocation[1] - 0.005]
            : null
        }
      />

      {/* Header */}
      <View style={{ position: "absolute", top: safeTop + 4, left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
        <View style={{ flexDirection: "column" }}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={{ width: 80, height: 40, resizeMode: 'contain' }}
          />
          <Text style={{ color: GOLD, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginTop: 2, opacity: 0.85 }}>
            Wo ho te sɛn{riderProfile?.full_name ? `, ${riderProfile.full_name.split(' ')[0]}` : ''}? 👋
          </Text>
        </View>
        <TouchableOpacity
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(17,17,17,0.9)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER }}
          onPress={() => Alert.alert("Notifications", "No new notifications")}
        >
          <MaterialIcons name="notifications" size={20} color={TEXT} />
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet */}
      <View style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: SURFACE,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: insets.bottom + 80,
        maxHeight: sheetHeight,
        borderTopWidth: 1,
        borderTopColor: BORDER,
        zIndex: 10,
      }}>
        {/* Drag handle */}
        <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER }} />
        </View>
        {activeRide ? renderActiveRide() : destination ? renderBookingSheet() : renderDefaultSheet()}
      </View>

      {/* Search Modal */}
      <Modal visible={searchOpen} animationType="slide" presentationStyle="fullScreen">
        <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: BORDER }}>
            <TouchableOpacity
              onPress={() => { setSearchOpen(false); setSearchQuery(""); }}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}
            >
              <MaterialIcons name="arrow-back" size={20} color={TEXT} />
            </TouchableOpacity>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Hwɛ wo bɛkyerɛ..."
              placeholderTextColor={MUTED}
              autoFocus
              style={{ flex: 1, color: TEXT, fontSize: 16, paddingVertical: 8 }}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <MaterialIcons name="close" size={20} color={MUTED} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={searchQuery ? filteredDestinations : [...(searchHistory.length > 0 ? searchHistory : []), ...POPULAR_DESTINATIONS.slice(0, 8)]}
            keyExtractor={(item, i) => `${item.name}-${i}`}
            ListHeaderComponent={
              <>
                {searchHistory.length > 0 && !searchQuery && (
                  <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
                    <Text style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600" }}>Recent</Text>
                  </View>
                )}
                {!searchQuery && (
                  <View style={{ paddingHorizontal: 16, paddingTop: searchHistory.length > 0 ? 4 : 16, paddingBottom: 8 }}>
                    <Text style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600" }}>Popular</Text>
                  </View>
                )}
              </>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => handleSelectDestination(item)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: BORDER }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="location-on" size={18} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "600", fontSize: 14 }}>{item.name}</Text>
                  <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>{item.address}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={MUTED} />
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* Schedule Modal */}
      <Modal visible={showScheduleModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: SURFACE, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, marginBottom: 4 }}>Schedule Trip</Text>
            <Text style={{ color: MUTED, fontSize: 13, marginBottom: 20 }}>Must be at least 30 minutes from now</Text>
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>Date (e.g. Jun 20, 2026)</Text>
            <TextInput
              value={scheduleDate}
              onChangeText={setScheduleDate}
              placeholder="Jun 20, 2026"
              placeholderTextColor="#4A4A4A"
              style={{ backgroundColor: CARD, borderRadius: 12, padding: 12, color: TEXT, fontSize: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 12 }}
            />
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>Time (e.g. 8:00 AM)</Text>
            <TextInput
              value={scheduleTime}
              onChangeText={setScheduleTime}
              placeholder="8:00 AM"
              placeholderTextColor="#4A4A4A"
              style={{ backgroundColor: CARD, borderRadius: 12, padding: 12, color: TEXT, fontSize: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20 }}
            />
            <TouchableOpacity
              onPress={handleScheduleConfirm}
              style={{ backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}
            >
              <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>Confirm Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowScheduleModal(false)} style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ color: MUTED, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Split Fare Modal */}
      <Modal visible={showSplitModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: SURFACE, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, marginBottom: 4 }}>Split Fare</Text>
            <Text style={{ color: MUTED, fontSize: 13, marginBottom: 20 }}>Share the cost with friends (2–6 people)</Text>
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>Number of people (including you)</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
              {[2, 3, 4, 5, 6].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setSplitCount(String(n))}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: splitCount === String(n) ? `${GOLD}1A` : CARD, borderWidth: 1, borderColor: splitCount === String(n) ? GOLD : BORDER }}
                >
                  <Text style={{ color: splitCount === String(n) ? GOLD : TEXT, fontWeight: "bold", fontSize: 16 }}>{n}</Text>
                  <Text style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>GH₵{(finalFare / n).toFixed(2)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={handleSplitConfirm}
              style={{ backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}
            >
              <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>Confirm Split</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSplitModal(false)} style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ color: MUTED, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rating Modal */}
      <Modal visible={showRatingModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: SURFACE, borderRadius: 24, padding: 24 }}>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, textAlign: "center", marginBottom: 4 }}>Rate Your Driver</Text>
            <Text style={{ color: MUTED, fontSize: 13, textAlign: "center", marginBottom: 20 }}>{activeRide?.driverName || "Your Driver"}</Text>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 24 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRatingValue(star)}>
                  <MaterialIcons name={star <= ratingValue ? "star" : "star-border"} size={40} color={GOLD} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => {
                setRideRated(true);
                setShowRatingModal(false);
                Alert.alert("Thank you!", `You rated ${activeRide?.driverName || "your driver"} ${ratingValue} stars`);
              }}
              style={{ backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}
            >
              <Text style={{ color: "#000", fontWeight: "bold", fontSize: 15 }}>Submit Rating</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowRatingModal(false)} style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ color: MUTED, fontSize: 14 }}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Tip Modal */}
      <Modal visible={showTipModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: SURFACE, borderRadius: 24, padding: 24 }}>
            <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 18, textAlign: "center", marginBottom: 4 }}>Add a Tip</Text>
            <Text style={{ color: MUTED, fontSize: 13, textAlign: "center", marginBottom: 20 }}>Show appreciation for great service</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
              {[2, 5, 10, 20].map((amt) => (
                <TouchableOpacity
                  key={amt}
                  onPress={() => setTipAmount(amt)}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: tipAmount === amt ? `${GREEN}1A` : CARD, borderWidth: 1, borderColor: tipAmount === amt ? GREEN : BORDER }}
                >
                  <Text style={{ color: tipAmount === amt ? GREEN : TEXT, fontWeight: "bold", fontSize: 15 }}>GH₵{amt}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => {
                if (!tipAmount) return;
                setTipAdded(true);
                setShowTipModal(false);
              }}
              style={{ backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginBottom: 10, opacity: tipAmount ? 1 : 0.5 }}
              disabled={!tipAmount}
            >
              <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>Add GH₵{tipAmount || 0} Tip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTipModal(false)} style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ color: MUTED, fontSize: 14 }}>No Thanks</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* In-Ride Chat Modal */}
      <Modal visible={showChat} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: BG }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 0.5, borderBottomColor: BORDER }}>
            <TouchableOpacity onPress={() => setShowChat(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="close" size={20} color={TEXT} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "bold", fontSize: 16 }}>Message Driver</Text>
              {activeRide?.driverName && <Text style={{ color: MUTED, fontSize: 12 }}>{activeRide.driverName}</Text>}
            </View>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN }} />
            <Text style={{ color: GREEN, fontSize: 12 }}>Online</Text>
          </View>

          {/* Messages */}
          <ScrollView style={{ flex: 1, padding: 16 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
            {chatMessages.length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <MaterialIcons name="chat-bubble-outline" size={40} color={BORDER} />
                <Text style={{ color: MUTED, fontSize: 13, marginTop: 8 }}>No messages yet</Text>
                <Text style={{ color: MUTED, fontSize: 12 }}>Use quick messages below to get started</Text>
              </View>
            )}
            {chatMessages.map(msg => (
              <View key={msg.id} style={{ flexDirection: "row", justifyContent: msg.fromRider ? "flex-end" : "flex-start" }}>
                <View style={{ maxWidth: "75%", backgroundColor: msg.fromRider ? GREEN : CARD, borderRadius: 16, borderBottomRightRadius: msg.fromRider ? 4 : 16, borderBottomLeftRadius: msg.fromRider ? 16 : 4, padding: 12, borderWidth: msg.fromRider ? 0 : 0.5, borderColor: BORDER }}>
                  <Text style={{ color: TEXT, fontSize: 14 }}>{msg.text}</Text>
                  <Text style={{ color: msg.fromRider ? "rgba(255,255,255,0.6)" : MUTED, fontSize: 10, marginTop: 4, textAlign: "right" }}>{msg.time}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Quick Messages */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderTopWidth: 0.5, borderTopColor: BORDER }} contentContainerStyle={{ padding: 10, gap: 8 }}>
            {QUICK_MESSAGES.map(qm => (
              <TouchableOpacity
                key={qm}
                onPress={() => {
                  const now = new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
                  setChatMessages(prev => [...prev, { id: Date.now().toString(), text: qm, fromRider: true, time: now }]);
                  // Simulate driver reply after 2s
                  setTimeout(() => {
                    const replies = ['Ok, noted!', 'On my way!', 'I can see you', 'Almost there', 'Give me 1 min'];
                    const reply = replies[Math.floor(Math.random() * replies.length)];
                    const replyTime = new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
                    setChatMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: reply, fromRider: false, time: replyTime }]);
                  }, 2000);
                }}
                style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: CARD, borderRadius: 20, borderWidth: 0.5, borderColor: BORDER }}
              >
                <Text style={{ color: TEXT, fontSize: 13 }}>{qm}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Text Input */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: 0.5, borderTopColor: BORDER }}>
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Type a message..."
              placeholderTextColor={MUTED}
              style={{ flex: 1, backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: TEXT, fontSize: 14, borderWidth: 0.5, borderColor: BORDER }}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (!chatInput.trim()) return;
                const now = new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
                setChatMessages(prev => [...prev, { id: Date.now().toString(), text: chatInput.trim(), fromRider: true, time: now }]);
                setChatInput("");
              }}
            />
            <TouchableOpacity
              onPress={() => {
                if (!chatInput.trim()) return;
                const now = new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
                setChatMessages(prev => [...prev, { id: Date.now().toString(), text: chatInput.trim(), fromRider: true, time: now }]);
                setChatInput("");
              }}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" }}
            >
              <MaterialIcons name="send" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Helper component for key-value rows
function Row({ label, value, valueColor, bold }: { label: string; value: string; valueColor?: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
      <Text style={{ color: MUTED, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: valueColor || TEXT, fontSize: 12, fontWeight: bold ? "bold" : "600", flex: 1, textAlign: "right" }} numberOfLines={1}>{value}</Text>
    </View>
  );
}
