import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import MapView, { Marker, Polyline, type LatLng, type Region } from 'react-native-maps';

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
const DEFAULT_DELTA = 0.035;
const DRIVER_CAR_MARKER = require('@/assets/images/driver-map-car-marker.png');

function regionFor(latitude: number, longitude: number): Region {
  return { latitude, longitude, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA };
}

/**
 * Native Apple/Google map renderer for Driver. The vehicle marker is rendered
 * as an explicit child Image rather than Marker.image: on iOS the latter can
 * silently fall back to the default green pin when a bundled asset is loaded.
 * Camera updates wait for the native map to be ready.
 */
export default function DriverLeafletMap({
  latitude,
  longitude,
  heading = 0,
  target = null,
  etaMinutes = null,
  tripStatus = null,
  dark = false,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const hasLivePosition = Number.isFinite(latitude) && Number.isFinite(longitude);
  const position = useMemo(
    () => ({
      latitude: hasLivePosition ? Number(latitude) : DEFAULT_POSITION.latitude,
      longitude: hasLivePosition ? Number(longitude) : DEFAULT_POSITION.longitude,
    }),
    [hasLivePosition, latitude, longitude],
  );
  const targetIsValid = Boolean(target && Number.isFinite(target.latitude) && Number.isFinite(target.longitude));
  const route: LatLng[] = targetIsValid && target
    ? [position, { latitude: target.latitude, longitude: target.longitude }]
    : [];

  useEffect(() => {
    if (!mapReady || !hasLivePosition) return;
    mapRef.current?.animateToRegion(regionFor(position.latitude, position.longitude), 450);
  }, [hasLivePosition, mapReady, position.latitude, position.longitude]);

  const driverDescription = targetIsValid
    ? `${etaMinutes && etaMinutes > 0 ? `${Math.max(1, Math.round(etaMinutes))} min · ` : ''}${tripStatus === 'dropoff' ? 'Navigating to drop-off' : 'Navigating to pickup'}`
    : 'Online and ready for nearby trips';

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#18232F' : '#E7EEF2' }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={regionFor(position.latitude, position.longitude)}
        mapType="standard"
        showsCompass={false}
        showsTraffic={false}
        showsBuildings={false}
        showsIndoors={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        userInterfaceStyle={dark ? 'dark' : 'light'}
        onMapReady={() => setMapReady(true)}
      >
        <Marker
          coordinate={position}
          title="You are online"
          description={driverDescription}
          anchor={{ x: 0.5, y: 0.5 }}
          rotation={Number.isFinite(heading) ? Number(heading) : 0}
          flat
          tracksViewChanges
        >
          <Image
            source={DRIVER_CAR_MARKER}
            style={{ width: 64, height: 64 }}
            resizeMode="contain"
            accessible
            accessibilityLabel="Your HY3N vehicle location"
          />
        </Marker>
        {targetIsValid && target && (
          <Marker
            coordinate={{ latitude: target.latitude, longitude: target.longitude }}
            title={target.label || (tripStatus === 'dropoff' ? 'Drop-off' : 'Pickup')}
            pinColor="#D4AF37"
          />
        )}
        {route.length === 2 && (
          <Polyline coordinates={route} strokeColor="#006B3F" strokeWidth={5} lineDashPattern={[10, 8]} />
        )}
      </MapView>
    </View>
  );
}

export type DriverLeafletMapProps = Props;
