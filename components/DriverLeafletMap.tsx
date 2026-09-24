import React, { useMemo } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MAP_MARKER_ASSETS } from '@/components/map-marker-assets';

type MapTarget = { latitude: number; longitude: number; label: string };
type Props = {
  latitude?: number;
  longitude?: number;
  heading?: number | null;
  target?: MapTarget | null;
  etaMinutes?: number | null;
  tripStatus?: 'pickup' | 'dropoff' | null;
  dark?: boolean;
};

const safelySerialize = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/**
 * Driver navigation view: the Driver's current position is an oriented green
 * navigation arrow (not a circular emoji), with a clear target pin, route guide,
 * and ETA shown directly on the map while a trip is active.
 */
export default function DriverLeafletMap({ latitude = 5.6037, longitude = -0.187, heading = 0, target = null, etaMinutes = null, tripStatus = null, dark = false }: Props) {
  const surface = dark ? '#1f2937' : '#eef1f3';
  const mapState = useMemo(() => ({ latitude, longitude, heading: Number(heading || 0), target, etaMinutes, tripStatus }), [heading, etaMinutes, latitude, longitude, target, tripStatus]);
  const state = safelySerialize(mapState);
  const carArt = MAP_MARKER_ASSETS.car;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>html,body,#map{height:100%;margin:0;background:${surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.leaflet-control-attribution,.leaflet-control-zoom{display:none}.driver-car{width:46px;height:46px;background-image:url('${carArt}');background-size:contain;background-position:center;background-repeat:no-repeat;filter:drop-shadow(0 2px 4px #0008);transform-origin:23px 23px}.target-pin{width:26px;height:26px;border-radius:50% 50% 50% 0;background:#d4af37;border:3px solid #fff;box-shadow:0 2px 8px #0008;transform:rotate(-45deg)}.target-pin:after{content:'';display:block;width:8px;height:8px;background:#151515;border-radius:50%;margin:6px}.eta{position:fixed;z-index:900;top:86px;left:50%;transform:translateX(-50%);background:#006b3f;color:#fff;border-radius:14px;padding:9px 13px;text-align:center;box-shadow:0 4px 14px #0006;min-width:116px}.eta b{display:block;font-size:20px;line-height:22px}.eta span{font-size:11px;font-weight:800;letter-spacing:.3px}</style></head><body><div id="map"></div><div id="eta" class="eta" style="display:none"></div><script>var s=${state};var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([s.latitude,s.longitude],15);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);var car=L.divIcon({html:'<div class="driver-car" style="transform:rotate('+(Number(s.heading)||0)+'deg)"></div>',iconSize:[46,46],iconAnchor:[23,23],className:''});L.marker([s.latitude,s.longitude],{icon:car}).addTo(map);if(s.target){var targetPoint=[s.target.latitude,s.target.longitude];L.marker(targetPoint,{icon:L.divIcon({html:'<div class="target-pin"></div>',iconSize:[32,32],iconAnchor:[16,28],className:''})}).addTo(map).bindTooltip(s.target.label,{permanent:false});var fallback=function(){L.polyline([[s.latitude,s.longitude],targetPoint],{color:'#006b3f',weight:5,opacity:.9,dashArray:'12,7'}).addTo(map)};fetch('https://router.project-osrm.org/route/v1/driving/'+s.longitude+','+s.latitude+';'+targetPoint[1]+','+targetPoint[0]+'?overview=full&geometries=geojson').then(function(r){return r.json()}).then(function(data){var coords=data&&data.routes&&data.routes[0]&&data.routes[0].geometry&&data.routes[0].geometry.coordinates;if(!coords){fallback();return}L.polyline(coords.map(function(c){return[c[1],c[0]]}),{color:'#006b3f',weight:5,opacity:.92}).addTo(map)}).catch(fallback);map.fitBounds([[s.latitude,s.longitude],targetPoint],{padding:[58,42],maxZoom:15});var eta=document.getElementById('eta');eta.style.display='block';eta.innerHTML='<b>'+(s.etaMinutes||'—')+' min</b><span>'+(s.tripStatus==='dropoff'?'TO DROPOFF':'TO PICKUP')+'</span>'}</script></body></html>`;
  return <View style={{ flex: 1, backgroundColor: surface }}><WebView source={{ html }} style={{ flex: 1, backgroundColor: surface }} originWhitelist={["*"]} javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false} /></View>;
}

export type DriverLeafletMapProps = Props;
