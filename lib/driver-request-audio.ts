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
      // Invalidate an in-flight configure/seek before touching the native player,
      // so its continuation cannot start the ringtone after Accept was tapped.
      generation++;
      pendingRide = null;

      // Pause first. Previously loop/mute/volume writes and the pause lived in
      // one try block: if any native property setter threw, execution skipped
      // pause entirely and the looping AVPlayer kept ringing after Accept.
      // Keep every native operation isolated so one failed setter cannot block
      // the critical stop command.
      let shouldPause = options.force === true;
      if (!shouldPause) {
        try {
          shouldPause = player.playing;
        } catch {
          // A stale/released status is not reliable; best-effort pause below.
          shouldPause = true;
        }
      }

      if (shouldPause) {
        try {
          player.pause();
        } catch {
          // Continue silencing the player even if pause itself fails.
        }
      }

      try { player.loop = false; } catch {}
      try { player.muted = true; } catch {}
      try { player.volume = 0; } catch {}
    },
  };
}
