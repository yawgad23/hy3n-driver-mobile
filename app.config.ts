// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const env = {
  appName: "HY3N Driver",
  appSlug: "hy3n-driver-app",
  scheme: "hy3ndriver",
  iosBundleId: "com.hy3n.driver",
  androidPackage: "com.hy3n.driver",
};
const iosGoogleMapsApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY;

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  owner: "yawgad",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  // Reanimated 4 in Expo SDK 54 requires the New Architecture. Build 43 used
  // Firebase 26 in this runtime and crashed on iOS 27, so the native Firebase
  // modules are pinned to Firebase 25 while this required architecture remains on.
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    buildNumber: "56",
    jsEngine: "jsc",
    googleServicesFile: "./firebase/GoogleService-Info.plist",
    ...(iosGoogleMapsApiKey ? { config: { googleMapsApiKey: iosGoogleMapsApiKey } } : {}),
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "UIBackgroundModes": ["location"],
        "NSLocationAlwaysAndWhenInUseUsageDescription": "Allow HY3N Driver to share your location while you are online so Riders can follow your approach and active trip.",
        "NSLocationWhenInUseUsageDescription": "Allow HY3N Driver to use your location to navigate to pickups and destinations."
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#000000",
      foregroundImage: "./assets/images/android-icon-foreground.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    googleServicesFile: "./firebase/google-services.json",
    permissions: ["POST_NOTIFICATIONS", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_LOCATION"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
    name: "HY3N Driver",
    shortName: "HY3N Driver",
    description: "HY3N Driver — Ghana's premium ride-hailing driver app",
    themeColor: "#D4AF37",
    backgroundColor: "#0A0A0A",
    lang: "en",
  },
  plugins: [
    "expo-router",
    "expo-asset",
    "expo-font",
    "expo-notifications",
    "expo-web-browser",
    "@react-native-firebase/app",
    "@react-native-firebase/auth",
    "@react-native-google-signin/google-signin",
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission: "Allow HY3N Driver to use your location to navigate to pickups and destinations.",
        locationWhenInUsePermission: "Allow HY3N Driver to use your location to navigate to pickups and destinations.",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/driver-splash-artwork.png",
        imageWidth: 320,
        resizeMode: "contain",
        backgroundColor: "#000000",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
        ios: {
          // With CocoaPods static frameworks, every used React Native Firebase
          // module must be forced to static linking on Expo SDK 54.
          useFrameworks: "static",
          forceStaticLinking: ["RNFBApp", "RNFBAuth"],
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "d19afe45-8e3d-42f9-ad5e-70b12b2c2ce9",
    },
  },
};

export default config;
