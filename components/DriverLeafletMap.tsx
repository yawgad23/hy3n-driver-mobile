import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const DEFAULT_POSITION = { latitude: 5.6037, longitude: -0.187 };

const safelySerialize = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

/**
 * The WebView source is deliberately stable while the Driver moves. Replacing
 * its HTML on every GPS update causes iOS to reload Leaflet and flash map tiles.
 * Live state is sent into the already-loaded map through injectJavaScript.
 */
function buildMapHtml(surface: string, carArt: string) {
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html,body,#map{height:100%;margin:0;background:${surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .leaflet-control-attribution,.leaflet-control-zoom{display:none}
    .driver-marker{transition:transform .85s linear!important}
    .driver-car{width:46px;height:46px;background-image:url('${carArt}');background-size:contain;background-position:center;background-repeat:no-repeat;filter:drop-shadow(0 2px 4px #0008);transform-origin:23px 23px;transition:transform .35s ease-out}
    .target-pin{width:26px;height:26px;border-radius:50% 50% 50% 0;background:#d4af37;border:3px solid #fff;box-shadow:0 2px 8px #0008;transform:rotate(-45deg)}
    .target-pin:after{content:'';display:block;width:8px;height:8px;background:#151515;border-radius:50%;margin:6px}
    .eta{position:fixed;z-index:900;top:86px;left:50%;transform:translateX(-50%);background:#006b3f;color:#fff;border-radius:14px;padding:9px 13px;text-align:center;box-shadow:0 4px 14px #0006;min-width:116px}
    .eta b{display:block;font-size:20px;line-height:22px}.eta span{font-size:11px;font-weight:800;letter-spacing:.3px}
  </style>
</head>
<body>
  <div id="map"></div><div id="eta" class="eta" style="display:none"></div>
  <script>
    (function () {
      var fallbackPosition={latitude:${DEFAULT_POSITION.latitude},longitude:${DEFAULT_POSITION.longitude},heading:0,target:null,etaMinutes:null,tripStatus:null};
      var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([fallbackPosition.latitude,fallbackPosition.longitude],15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,keepBuffer:4}).addTo(map);
      var carIcon=L.divIcon({html:'<div class="driver-car"></div>',iconSize:[46,46],iconAnchor:[23,23],className:'driver-marker'});
      var carMarker=L.marker([fallbackPosition.latitude,fallbackPosition.longitude],{icon:carIcon,keyboard:false}).addTo(map);
      var targetMarker=null;
      var routeLine=null;
      var targetKey='';
      var routeRequest=0;
      var etaElement=document.getElementById('eta');

      function numberOr(value,fallback){var parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback}
      function position(state){return [numberOr(state&&state.latitude,fallbackPosition.latitude),numberOr(state&&state.longitude,fallbackPosition.longitude)]}
      function setCarHeading(heading){
        var icon=carMarker.getElement();
        var car=icon&&icon.querySelector('.driver-car');
        if(car) car.style.transform='rotate(' + numberOr(heading,0) + 'deg)';
      }
      function clearRoute(){
        if(routeLine){map.removeLayer(routeLine);routeLine=null}
        if(targetMarker){map.removeLayer(targetMarker);targetMarker=null}
      }
      function fallbackRoute(from,target){
        routeLine=L.polyline([from,target],{color:'#006b3f',weight:5,opacity:.9,dashArray:'12,7'}).addTo(map);
      }
      function renderRoute(from,target,key){
        var request=++routeRequest;
        var fallback=function(){if(request===routeRequest&&key===targetKey){if(routeLine){map.removeLayer(routeLine)}fallbackRoute(from,target)}};
        fetch('https://router.project-osrm.org/route/v1/driving/'+from[1]+','+from[0]+';'+target[1]+','+target[0]+'?overview=full&geometries=geojson')
          .then(function(response){return response.json()})
          .then(function(data){
            if(request!==routeRequest||key!==targetKey)return;
            var coordinates=data&&data.routes&&data.routes[0]&&data.routes[0].geometry&&data.routes[0].geometry.coordinates;
            if(!coordinates){fallback();return}
            if(routeLine){map.removeLayer(routeLine)}
            routeLine=L.polyline(coordinates.map(function(point){return[point[1],point[0]]}),{color:'#006b3f',weight:5,opacity:.92}).addTo(map);
          })
          .catch(fallback);
      }
      function updateTarget(state,from){
        var target=state&&state.target;
        var key=target?String(target.latitude)+'|'+String(target.longitude)+'|'+String(target.label||''):'';
        if(key===targetKey)return;
        targetKey=key;
        clearRoute();
        if(!target)return;
        var point=[numberOr(target.latitude,from[0]),numberOr(target.longitude,from[1])];
        targetMarker=L.marker(point,{icon:L.divIcon({html:'<div class="target-pin"></div>',iconSize:[32,32],iconAnchor:[16,28],className:''}),keyboard:false}).addTo(map).bindTooltip(String(target.label||'Destination'),{permanent:false});
        renderRoute(from,point,key);
        map.fitBounds([from,point],{padding:[58,42],maxZoom:15,animate:true,duration:.45});
      }
      function updateEta(state){
        if(!state||!state.target){etaElement.style.display='none';return}
        etaElement.style.display='block';
        etaElement.innerHTML='<b>'+(state.etaMinutes||'—')+' min</b><span>'+(state.tripStatus==='dropoff'?'TO DROPOFF':'TO PICKUP')+'</span>';
      }
      window.__HY3N_UPDATE__=function(state){
        var current=position(state);
        carMarker.setLatLng(current);
        setCarHeading(state&&state.heading);
        // Smooth pan keeps the Driver centered without reloading the map tiles.
        map.panTo(current,{animate:true,duration:.75,noMoveStart:true});
        updateTarget(state,current);
        updateEta(state);
        setTimeout(function(){setCarHeading(state&&state.heading)},0);
      };
      window.__HY3N_UPDATE__(fallbackPosition);
    })();
  </script>
</body>
</html>`;
}

/**
 * Driver navigation view: keeps one Leaflet WebView mounted and smoothly moves
 * the realistic car marker as the phone reports each live GPS update.
 */
export default function DriverLeafletMap({
  latitude = DEFAULT_POSITION.latitude,
  longitude = DEFAULT_POSITION.longitude,
  heading = 0,
  target = null,
  etaMinutes = null,
  tripStatus = null,
  dark = false,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const [mapReady, setMapReady] = useState(false);
  const surface = dark ? '#1f2937' : '#eef1f3';
  const targetLatitude = target?.latitude ?? null;
  const targetLongitude = target?.longitude ?? null;
  const targetLabel = target?.label ?? null;

  const mapState = useMemo(() => ({
    latitude,
    longitude,
    heading: Number(heading || 0),
    target: targetLatitude !== null && targetLongitude !== null && targetLabel !== null
      ? { latitude: targetLatitude, longitude: targetLongitude, label: targetLabel }
      : null,
    etaMinutes,
    tripStatus,
  }), [etaMinutes, heading, latitude, longitude, targetLabel, targetLatitude, targetLongitude, tripStatus]);
  const serializedState = useMemo(() => safelySerialize(mapState), [mapState]);
  const source = useMemo(() => ({ html: buildMapHtml(surface, MAP_MARKER_ASSETS.car) }), [surface]);

  useEffect(() => {
    if (!mapReady) return;
    // The trailing expression is required by iOS WebView's injected-JS API.
    webViewRef.current?.injectJavaScript(`window.__HY3N_UPDATE__&&window.__HY3N_UPDATE__(${serializedState});true;`);
  }, [mapReady, serializedState]);

  return (
    <View style={{ flex: 1, backgroundColor: surface }}>
      <WebView
        ref={webViewRef}
        source={source}
        style={{ flex: 1, backgroundColor: surface }}
        onLoadStart={() => setMapReady(false)}
        onLoadEnd={() => setMapReady(true)}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}

export type DriverLeafletMapProps = Props;
