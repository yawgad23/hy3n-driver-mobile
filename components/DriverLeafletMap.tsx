import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
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

function regionFor(latitude: number, longitude: number): Region {
  return { latitude, longitude, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA };
}

/**
 * Native Apple/Google map renderer for Driver. No Leaflet WebView or external
 * tile/CDN script is required, preventing a failed browser resource from
 * turning the online Driver map into an empty background panel.
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
  const mapRef = useRef<MapView>(null);
  const position = useMemo(
    () => ({
      latitude: Number.isFinite(latitude) ? latitude : DEFAULT_POSITION.latitude,
      longitude: Number.isFinite(longitude) ? longitude : DEFAULT_POSITION.longitude,
    }),
    [latitude, longitude],
  );
  const targetIsValid = Boolean(target && Number.isFinite(target.latitude) && Number.isFinite(target.longitude));
  const route: LatLng[] = targetIsValid && target
    ? [position, { latitude: target.latitude, longitude: target.longitude }]
    : [];

  useEffect(() => {
    mapRef.current?.animateToRegion(regionFor(position.latitude, position.longitude), 450);
  }, [position.latitude, position.longitude]);

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
      >
        <Marker
          coordinate={position}
          title="You are online"
          description={driverDescription}
          pinColor="#006B3F"
          rotation={Number.isFinite(heading) ? Number(heading) : 0}
          flat
        />
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
