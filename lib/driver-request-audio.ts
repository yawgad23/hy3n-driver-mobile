import { INCOMING_TRIP_ALERT_PLAYBACK } from './incoming-trip-alert';

export const DRIVER_REQUEST_AUDIO_MODE = Object.freeze({
  playsInSilentMode: true,
  interruptionMode: 'duckOthers' as const,
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
});

export type DriverRequestAudioPlayer = {
  isLoaded: boolean;
  playing: boolean;
  muted: boolean;
  volume: number;
  loop: boolean;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
};

/** No new players, notifications, timers, background playback, or recording. */
export function createDriverRequestAudio() {
  let generation = 0;
  let lastPlayedRide: string | null = null;
  let pendingRide: string | null = null;

  return {
    async play(rideId: string, player: DriverRequestAudioPlayer, configure: (mode: typeof DRIVER_REQUEST_AUDIO_MODE) => Promise<void>) {
      if (!rideId || lastPlayedRide === rideId || pendingRide === rideId || !player.isLoaded) return false;
      const current = ++generation;
      pendingRide = rideId;
      try {
        // Expo's native default is silent-switch-sensitive. Configure playback
        // before seeking/playing rather than assuming the WAV is audible.
        await configure(DRIVER_REQUEST_AUDIO_MODE);
        if (generation !== current || !player.isLoaded) return false;
        if (player.playing) player.pause();
        player.muted = false;
        player.volume = INCOMING_TRIP_ALERT_PLAYBACK.volume;
        player.loop = INCOMING_TRIP_ALERT_PLAYBACK.loop;
        await player.seekTo(0);
        if (generation !== current || !player.isLoaded) return false;
        player.play();
        // A failed load/configuration/seek cannot consume this offer's alert.
        lastPlayedRide = rideId;
        return true;
      } catch {
        return false;
      } finally {
        if (generation === current) pendingRide = null;
      }
    },
    stop(player: DriverRequestAudioPlayer, options: { force?: boolean } = {}) {
      generation++;
      pendingRide = null;
      // Do not pause an idle player on ordinary poll/render cleanup because it
      // can disturb the shared iOS guidance session. A Driver's Accept or
      // Decline is different: Expo's `playing` property can lag native audio,
      // so force an immediate pause rather than waiting for server round-trip.
      try {
        if (options.force || player.playing) player.pause();
      } catch {
        // useAudioPlayer may already have released this shared native object.
      }
    },
  };
}
