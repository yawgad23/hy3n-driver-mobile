import React from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = { latitude?: number; longitude?: number; dark?: boolean };

/**
 * The Driver map intentionally shows only a subtle green current-location dot.
 * The larger vehicle icons belong to Riders viewing available nearby vehicles;
 * an emoji car inside a circle on the Driver's own map is distracting.
 */
export default function DriverLeafletMap({ latitude = 5.6037, longitude = -0.187, dark = false }: Props) {
  const surface = dark ? '#1f2937' : '#eef1f3';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>html,body,#map{height:100%;margin:0;background:${surface}}.leaflet-control-attribution,.leaflet-control-zoom{display:none}.driver-location{width:16px;height:16px;border-radius:50%;background:#00805f;border:3px solid #fff;box-shadow:0 1px 7px #0008}</style></head><body><div id="map"></div><script>var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${latitude},${longitude}],15);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);L.marker([${latitude},${longitude}],{icon:L.divIcon({html:'<div class="driver-location"></div>',iconSize:[22,22],iconAnchor:[11,11],className:''})}).addTo(map);</script></body></html>`;
  return <View style={{ flex: 1, backgroundColor: surface }}><WebView source={{ html }} style={{ flex: 1, backgroundColor: surface }} originWhitelist={["*"]} javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false} /></View>;
}

export type DriverLeafletMapProps = Props;
