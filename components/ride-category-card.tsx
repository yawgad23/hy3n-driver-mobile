import { Pressable, Text, View } from "react-native";
import { RideCategory } from "@/constants/rides";
import { cn } from "@/lib/utils";

interface RideCategoryCardProps {
  category: RideCategory;
  fare: number;
  isSelected: boolean;
  onPress: () => void;
}

export function RideCategoryCard({
  category,
  fare,
  isSelected,
  onPress,
}: RideCategoryCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      className={cn(
        "rounded-xl p-4 border-2 mb-3",
        isSelected
          ? "bg-primary border-primary"
          : "bg-surface border-border"
      )}
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text
            className={cn(
              "text-lg font-bold mb-1",
              isSelected ? "text-background" : "text-foreground"
            )}
          >
            {category.name}
          </Text>
          <Text
            className={cn(
              "text-sm mb-2",
              isSelected ? "text-background opacity-90" : "text-muted"
            )}
          >
            {category.description}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className={cn(
              "text-2xl font-bold",
              isSelected ? "text-background" : "text-primary"
            )}
          >
            GH₵{fare.toFixed(2)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
