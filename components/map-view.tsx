import { View } from "react-native";
import { WebView } from "react-native-webview";

interface MapViewProps {
  userLat?: number;
  userLng?: number;
  destLat?: number;
  destLng?: number;
  driverLat?: number;
  driverLng?: number;
}

export function MapView({
  userLat = 5.6037,
  userLng = -0.187,
  destLat,
  destLng,
  driverLat,
  driverLng,
}: MapViewProps) {
  const mapHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        * { margin: 0; padding: 0; }
        html, body, #map { height: 100%; width: 100%; }
        body { background: #0a0a0a; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = L.map('map').setView([${userLat}, ${userLng}], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map);
        
        // User location marker (green)
        L.circleMarker([${userLat}, ${userLng}], {
          radius: 8,
          fillColor: '#00A651',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map);
        
        ${destLat && destLng ? `
        // Destination marker (red)
        L.marker([${destLat}, ${destLng}], {
          icon: L.icon({
            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSIjQ0UxMTI2IiBkPSJNMTIgMkM2LjQ4IDIgMiA2LjQ4IDIgMTJjMCA0LjQxIDMuMDUgOC4xNCA3IDkuNzcgMy45IDEuNzIgOC4zNiAxLjcyIDEyIDAgMy45NS0xLjYzIDctNS4zNiA3LTkuNzcgMC01LjUyLTQuNDgtMTAtMTAtMTB6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==',
            iconSize: [32, 32],
            iconAnchor: [16, 32]
          })
        }).addTo(map).bindPopup('Destination');
        ` : ''}
        
        ${driverLat && driverLng ? `
        // Driver marker (gold)
        L.marker([${driverLat}, ${driverLng}], {
          icon: L.icon({
            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSIjRDRBRjM3IiBkPSJNMTIgMkM2LjQ4IDIgMiA2LjQ4IDIgMTJjMCA0LjQxIDMuMDUgOC4xNCA3IDkuNzcgMy45IDEuNzIgOC4zNiAxLjcyIDEyIDAgMy45NS0xLjYzIDctNS4zNiA3LTkuNzcgMC01LjUyLTQuNDgtMTAtMTAtMTB6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==',
            iconSize: [32, 32],
            iconAnchor: [16, 32]
          })
        }).addTo(map).bindPopup('Driver');
        ` : ''}
      </script>
    </body>
    </html>
  `;

  return (
    <View className="flex-1">
      <WebView
        source={{ html: mapHTML }}
        style={{ flex: 1 }}
        scrollEnabled={false}
        zoomEnabled={false}
      />
    </View>
  );
}
