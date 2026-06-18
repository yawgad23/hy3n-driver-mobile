// Web stub for react-native-maps - this library is native-only
// On web, we render a placeholder view instead
import React from "react";
import { View } from "react-native";

const MapView = React.forwardRef(function MapView({ style, children }, ref) {
  return React.createElement(View, { style, ref }, children);
});

MapView.displayName = "MapView";

export default MapView;

export const Marker = function Marker({ children }) {
  return null;
};

export const Polyline = function Polyline() {
  return null;
};

export const UrlTile = function UrlTile() {
  return null;
};

export const PROVIDER_DEFAULT = null;
export const PROVIDER_GOOGLE = "google";
