const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Stub react-native-maps for ALL platforms — we use a pure RN map background instead.
// This prevents the "RNMapsAirModule could not be found" crash in Expo Go.
config.resolver = config.resolver || {};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-maps") {
    return {
      filePath: path.resolve(__dirname, "lib/react-native-maps-web-stub.js"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
