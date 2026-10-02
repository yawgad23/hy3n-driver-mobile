import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { nativeTrackingRegion } from '@/lib/native-map-camera';

type MapTarget = { latitude: number; longitude: number; label: string };
type Point = [latitude: number, longitude: number];
type Props = {
  latitude?: number;
  longitude?: number;
  heading?: number | null;
  target?: MapTarget | null;
  etaMinutes?: number | null;
  tripStatus?: 'pickup' | 'dropoff' | null;
  dark?: boolean;
};

const DARK_GOOGLE_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1f2933' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d9e2ec' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f2933' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#39424e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#222a33' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#5d6876' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#111827' }] },
];

function hasPoint(latitude: unknown, longitude: unknown): latitude is number {
  return Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude))
    && Math.abs(Number(latitude)) <= 90
    && Math.abs(Number(longitude)) <= 180
    && !(Number(latitude) === 0 && Number(longitude) === 0);
}

function pointToCoordinate([latitude, longitude]: Point) {
  return { latitude, longitude };
}

function region(point: Point): Region {
  return { latitude: point[0], longitude: point[1], latitudeDelta: 0.012, longitudeDelta: 0.012 };
}

function routeRequestKey(origin: Point, target: Point) {
  // ~110 m grid prevents a directions request for every individual GPS sample.
  return `${origin[0].toFixed(3)}:${origin[1].toFixed(3)}:${target[0].toFixed(5)}:${target[1].toFixed(5)}`;
}

async function fetchRoadLine(origin: Point, target: Point, signal: AbortSignal): Promise<Point[]> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${target[1]},${target[0]}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const body = await response.json();
  const coordinates = body?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  return coordinates
    .filter((coordinate: unknown) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate: any) => [Number(coordinate[1]), Number(coordinate[0])] as Point)
    .filter(([latitude, longitude]) => hasPoint(latitude, longitude));
}

/**
 * Native Google Maps surface for the Driver. Unlike the retired Leaflet page,
 * the map never remounts or reloads tiles when GPS or app foreground state changes.
 */
export default function NativeDriverGoogleMap({
  latitude,
  longitude,
  heading = 0,
  target = null,
  etaMinutes = null,
  tripStatus = null,
  dark = false,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const userMovedMapRef = useRef(false);
  const previousLocationRef = useRef<Point | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [roadLine, setRoadLine] = useState<Point[]>([]);
  const hasDeviceLocation = hasPoint(latitude, longitude);
  const driverPoint = hasDeviceLocation ? [Number(latitude), Number(longitude)] as Point : null;
  const targetPoint = target && hasPoint(target.latitude, target.longitude)
    ? [target.latitude, target.longitude] as Point
    : null;
  const animatedDriverCoordinate = useRef(new AnimatedRegion(region(driverPoint || [5.6037, -0.187]))).current;
  const routeKey = useMemo(() => driverPoint && targetPoint ? routeRequestKey(driverPoint, targetPoint) : null, [driverPoint, targetPoint]);

  useEffect(() => {
    if (!driverPoint) return;
    const nextRegion = region(driverPoint);
    if (!previousLocationRef.current) animatedDriverCoordinate.setValue(nextRegion);
    else animatedDriverCoordinate.timing({ ...nextRegion, duration: 2_650, useNativeDriver: false } as any).start();
    previousLocationRef.current = driverPoint;
  }, [animatedDriverCoordinate, driverPoint]);

  useEffect(() => {
    if (!routeKey || !driverPoint || !targetPoint) {
      setRoadLine([]);
      return;
    }
    const controller = new AbortController();
    fetchRoadLine(driverPoint, targetPoint, controller.signal)
      .then((points) => { if (!controller.signal.aborted) setRoadLine(points); })
      .catch(() => { if (!controller.signal.aborted) setRoadLine([]); });
    return () => controller.abort();
  }, [driverPoint, routeKey, targetPoint]);

  useEffect(() => {
    if (!mapReady || userMovedMapRef.current || !driverPoint) return;
    const nextRegion = nativeTrackingRegion(driverPoint, targetPoint, driverPoint);
    if (nextRegion) mapRef.current?.animateToRegion(nextRegion, targetPoint ? 650 : 350);
  }, [driverPoint, mapReady, targetPoint]);

  if (!driverPoint) {
    return (
      <View style={[styles.locationPending, { backgroundColor: dark ? '#1f2933' : '#eef1f3' }]}>
        <ActivityIndicator color="#006B3F" />
        <Text style={[styles.pendingTitle, { color: dark ? '#fff' : '#111' }]}>Getting your live location…</Text>
        <Text style={[styles.pendingBody, { color: dark ? '#d1d5db' : '#4b5563' }]}>Your map and ride requests will use your device location, not a fallback place.</Text>
      </View>
    );
  }

  // Do not draw a direct GPS chord when routing is unavailable: that would
  // look like a navigable road but can send a Driver the wrong way.
  const displayedRoadLine = roadLine.length > 1 ? roadLine : [];

  return (
    <View style={[styles.container, { backgroundColor: dark ? '#1f2933' : '#eef1f3' }]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        initialRegion={region(driverPoint)}
        style={StyleSheet.absoluteFill}
        customMapStyle={dark ? DARK_GOOGLE_STYLE : undefined}
        showsBuildings={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        showsScale={false}
        toolbarEnabled={false}
        onMapReady={() => setMapReady(true)}
        onPanDrag={() => { userMovedMapRef.current = true; }}
      >
        {displayedRoadLine.length > 1 && <Polyline
          coordinates={displayedRoadLine.map(pointToCoordinate)}
          strokeColor="#006B3F"
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
          zIndex={1}
        />}
        {targetPoint && <Marker
          coordinate={pointToCoordinate(targetPoint)}
          pinColor={tripStatus === 'dropoff' ? '#D4AF37' : '#006B3F'}
          title={target?.label || 'Next stop'}
          description={etaMinutes ? `${Math.max(1, Math.round(etaMinutes))} min away` : undefined}
          zIndex={3}
        />}
        <Marker.Animated
          coordinate={animatedDriverCoordinate as any}
          image={require('@/assets/images/driver-map-car-marker.png')}
          anchor={{ x: 0.5, y: 0.5 }}
          flat
          rotation={Number(heading) || 0}
          tracksViewChanges={false}
          title="Your HY3N vehicle"
          zIndex={8}
        />
      </MapView>
      {!mapReady && <View pointerEvents="none" style={styles.loadingBadge}>
        <ActivityIndicator color="#006B3F" />
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  locationPending: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  pendingTitle: { fontWeight: '700', marginTop: 12 },
  pendingBody: { textAlign: 'center', marginTop: 6 },
  loadingBadge: { position: 'absolute', top: '42%', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.92)', padding: 14, borderRadius: 14 },
});
