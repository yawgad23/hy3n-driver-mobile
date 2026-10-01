import { LEAFLET_SCRIPT, LEAFLET_STYLES } from '@/components/vendor/leaflet-inline';

const DEFAULT_POSITION = { latitude: 5.6037, longitude: -0.187 };

/**
 * Keep the HTML stable on GPS updates. Bundling Leaflet makes initialization
 * independent of an external script CDN; only map tiles need the network.
 * The native side does not call the map ready until this page says Leaflet,
 * its map, and its update function have actually initialized.
 */
export function buildDriverMapHtml(surface: string, carArt: string, generation: number) {
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
  <style>${LEAFLET_STYLES}</style>
  <style>
    html,body,#map{height:100%;margin:0;background:${surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .leaflet-control-zoom{display:none}
    .driver-marker{transition:transform .85s linear!important}
    .driver-car{width:46px;height:46px;background-image:url('${carArt}');background-size:contain;background-position:center;background-repeat:no-repeat;filter:drop-shadow(0 2px 4px #0008);transform-origin:23px 23px;transition:transform .35s ease-out}
    .target-pin{width:26px;height:26px;border-radius:50% 50% 50% 0;background:#d4af37;border:3px solid #fff;box-shadow:0 2px 8px #0008;transform:rotate(-45deg)}
    .target-pin:after{content:'';display:block;width:8px;height:8px;background:#151515;border-radius:50%;margin:6px}
    .eta{position:fixed;z-index:900;top:86px;left:50%;transform:translateX(-50%);background:#006b3f;color:#fff;border-radius:14px;padding:9px 13px;text-align:center;box-shadow:0 4px 14px #0006;min-width:116px}
    .eta b{display:block;font-size:20px;line-height:22px}.eta span{font-size:11px;font-weight:800;letter-spacing:.3px}
    .leaflet-control-attribution{font-size:10px!important;background:#ffffffd9!important;color:#222!important}
  </style>
  <script>${LEAFLET_SCRIPT}</script>
</head>
<body>
  <div id="map"></div><div id="eta" class="eta" style="display:none"></div>
  <script>
    (function () {
      var generation=${generation};
      function notify(type){
        if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
          window.ReactNativeWebView.postMessage(JSON.stringify({type:type,generation:generation}));
        }
      }
      try {
        if(typeof L==='undefined')throw new Error('Map renderer unavailable');
        var fallbackPosition={latitude:${DEFAULT_POSITION.latitude},longitude:${DEFAULT_POSITION.longitude},heading:0,target:null,etaMinutes:null,tripStatus:null};
        var map=L.map('map',{zoomControl:false,fadeAnimation:false,zoomAnimation:false}).setView([fallbackPosition.latitude,fallbackPosition.longitude],15);
        var primaryTileUrl='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
        var fallbackTileUrl='https://tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png';
        var tiles=L.tileLayer(primaryTileUrl,{maxZoom:19,updateWhenIdle:false,keepBuffer:6,
          attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
        var tileFailures=0;
        tiles.on('tileload',function(){
          if(tileFailures>=3)notify('tiles-recovered');
          tileFailures=0;
        });
        tiles.on('tileerror',function(event){
          tileFailures++;
          if(tileFailures===3)notify('tiles-unavailable');
          var image=event&&event.tile;
          var coords=event&&event.coords;
          if(!image||!coords||image.dataset.hy3nFallback==='1')return;
          image.dataset.hy3nFallback='1';
          image.src=fallbackTileUrl
            .replace('{z}',String(coords.z))
            .replace('{x}',String(coords.x))
            .replace('{y}',String(coords.y));
        });
        setTimeout(function(){map.invalidateSize({animate:false,pan:false});},150);
        window.addEventListener('resize',function(){map.invalidateSize({animate:false,pan:false});});
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
          if(car)car.style.transform='rotate(' + numberOr(heading,0) + 'deg)';
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
          routeRequest++;
          clearRoute();
          if(!target)return;
          var point=[numberOr(target.latitude,from[0]),numberOr(target.longitude,from[1])];
          var label=document.createElement('span');
          label.textContent=String(target.label||'Destination');
          targetMarker=L.marker(point,{icon:L.divIcon({html:'<div class="target-pin"></div>',iconSize:[32,32],iconAnchor:[16,28],className:''}),keyboard:false}).addTo(map).bindTooltip(label,{permanent:false});
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
          map.panTo(current,{animate:true,duration:.75,noMoveStart:true});
          updateTarget(state,current);
          updateEta(state);
          setTimeout(function(){setCarHeading(state&&state.heading)},0);
        };
        window.__HY3N_HEALTH__=function(){
          map.invalidateSize({animate:false,pan:false});
          tiles.redraw();
          notify('pong');
        };
        window.__HY3N_UPDATE__(fallbackPosition);
        notify('ready');
      } catch(error) {
        notify('init-error');
      }
    })();
  </script>
</body>
</html>`;
}
