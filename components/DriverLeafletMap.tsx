import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { MAP_MARKER_ASSETS } from '@/components/map-marker-assets';
import { buildDriverMapHtml } from '@/lib/driver-map-html';
import { DriverMapLifecycle, type DriverMapStatus } from '@/lib/driver-map-lifecycle';

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

/** A healthy GPS feed should never remount the HTML page; only a lost map does. */
export default function DriverLeafletMap({
  latitude = DEFAULT_POSITION.latitude,
  longitude = DEFAULT_POSITION.longitude,
  heading = 0,
  target = null,
  etaMinutes = null,
  tripStatus = null,
  dark = false,
}: Props) {
  const focused = useIsFocused();
  const webViewRef = useRef<WebView>(null);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<DriverMapStatus>('loading');
  const [showLoading, setShowLoading] = useState(false);
  const mapLifecycleRef = useRef<DriverMapLifecycle | null>(null);
  const foregroundRef = useRef(AppState.currentState === 'active');
  const latestStateRef = useRef('');
  // Match the average dark basemap tone so iOS does not flash a navy/blank
  // WebView surface before dark-gray map tiles are first painted.
  const surface = dark ? '#343a40' : '#eef1f3';
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
  latestStateRef.current = serializedState;

  if (!mapLifecycleRef.current) {
    mapLifecycleRef.current = new DriverMapLifecycle({
      onRemount: setGeneration,
      onReady: () => webViewRef.current?.injectJavaScript(
        `window.__HY3N_UPDATE__&&window.__HY3N_UPDATE__(${latestStateRef.current});true;`,
      ),
      onForegroundRefresh: () => webViewRef.current?.injectJavaScript(
        'window.__HY3N_FOREGROUND__&&window.__HY3N_FOREGROUND__();true;',
      ),
      onProbe: () => webViewRef.current?.injectJavaScript('window.__HY3N_HEALTH__&&window.__HY3N_HEALTH__();true;'),
      onStatus: setStatus,
    });
  }
  const lifecycle = mapLifecycleRef.current;
  const html = useMemo(
    () => ({ html: buildDriverMapHtml(surface, MAP_MARKER_ASSETS.car, generation, dark) }),
    [surface, generation, dark],
  );

  useEffect(() => {
    lifecycle.revive();
    lifecycle.setVisible(focused && foregroundRef.current);
    return () => lifecycle.setVisible(false);
  }, [focused, lifecycle]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasForeground = foregroundRef.current;
      foregroundRef.current = nextState === 'active';
      if (!foregroundRef.current) {
        lifecycle.setVisible(false);
        return;
      }
      if (!focused) return;
      lifecycle.setVisible(true);
      // Refresh Leaflet in place first. Rebuilding the inline WebView on every
      // foreground event visibly flashes the map. A remount is reserved for an
      // actual process/render failure or a missed health pong.
      if (wasForeground === false && lifecycle.isReady) {
        lifecycle.refreshFromForeground();
      }
    });
    return () => subscription.remove();
  }, [focused, lifecycle]);

  useEffect(() => () => lifecycle.dispose(), [lifecycle]);

  useEffect(() => {
    if (status !== 'loading') {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 1200);
    return () => clearTimeout(timer);
  }, [status, generation]);

  useEffect(() => {
    if (!lifecycle.isReady) return;
    webViewRef.current?.injectJavaScript(`window.__HY3N_UPDATE__&&window.__HY3N_UPDATE__(${serializedState});true;`);
  }, [serializedState, lifecycle]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width < 1 || height < 1) return;
    webViewRef.current?.injectJavaScript(
      `window.__HY3N_LAYOUT__&&window.__HY3N_LAYOUT__(${Math.round(width)},${Math.round(height)});true;`,
    );
  };

  return (
    <View onLayout={handleLayout} style={{ flex: 1, backgroundColor: surface }}>
      <WebView
        key={generation}
        ref={webViewRef}
        source={html}
        style={{ flex: 1, backgroundColor: surface }}
        onLoadStart={() => lifecycle.onLoadStart(generation)}
        onError={() => lifecycle.onFailure(generation)}
        onContentProcessDidTerminate={() => lifecycle.onFailure(generation)}
        onRenderProcessGone={() => lifecycle.onFailure(generation)}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.generation !== generation) return;
            if (message.type === 'ready') lifecycle.onReadyMessage(generation);
            else if (message.type === 'pong') lifecycle.onPong(generation);
            else if (message.type === 'init-error') lifecycle.onFailure(generation);
            else if (message.type === 'tiles-unavailable') lifecycle.onTileError(generation);
            else if (message.type === 'tiles-recovered') lifecycle.onTilesRecovered(generation);
          } catch {
            // Ignore messages from unrelated WebView scripts.
          }
        }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
      />
      {status === 'loading' && showLoading && (
        <View pointerEvents="none" style={{ position: 'absolute', top: '40%', left: 16, right: 16, alignItems: 'center' }}>
          <View style={{ backgroundColor: dark ? '#1f2937' : '#fff', padding: 14, borderRadius: 14, alignItems: 'center' }}>
            <ActivityIndicator color="#006b3f" />
            <Text style={{ color: dark ? '#fff' : '#111', marginTop: 7 }}>Restoring map…</Text>
          </View>
        </View>
      )}
      {(status === 'unavailable' || status === 'tiles-unavailable') && (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: '39%', left: 16, right: 16, alignItems: 'center' }}>
          <View style={{ backgroundColor: dark ? '#1f2937' : '#fff', padding: 16, borderRadius: 14, alignItems: 'center', maxWidth: 290 }}>
            <Text style={{ color: dark ? '#fff' : '#111', fontWeight: '700', textAlign: 'center' }}>
              {status === 'tiles-unavailable' ? 'Map tiles unavailable' : 'Map could not load'}
            </Text>
            <Text style={{ color: dark ? '#d1d5db' : '#4b5563', marginTop: 5, textAlign: 'center' }}>
              {status === 'tiles-unavailable' ? 'Check your connection and try again.' : 'Your online status is unchanged. Tap to retry the map.'}
            </Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry map" onPress={() => lifecycle.retryManually()}
              style={{ marginTop: 10, backgroundColor: '#006b3f', paddingHorizontal: 20, paddingVertical: 9, borderRadius: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Retry map</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export type DriverLeafletMapProps = Props;
