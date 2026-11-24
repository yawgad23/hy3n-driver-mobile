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

export type AndroidDriverRequestAudioPlayer = DriverRequestAudioPlayer & {
  addListener: (event: 'playbackStatusUpdate', listener: (status: { isLoaded: boolean }) => void) => { remove: () => void };
  remove: () => void;
  release: () => void;
};

type DriverRequestAudioOptions = {
  platform?: string;
  /** Android ONLY: this controller owns and retires these per-offer players. */
  createPlayer?: () => AndroidDriverRequestAudioPlayer;
};

/** No notifications, timers, background playback, or recording. */
export function createDriverRequestAudio(options: DriverRequestAudioOptions = {}) {
  const ownsAndroidPlayer = options.platform === 'android' && Boolean(options.createPlayer);
  let generation = 0;
  let lastPlayedRide: string | null = null;
  let pendingRide: string | null = null;
  let ownedPlayer: AndroidDriverRequestAudioPlayer | null = null;
  let cancelReadiness: (() => void) | null = null;

  function silence(player: DriverRequestAudioPlayer, force: boolean) {
    // Keep every native operation isolated: a failed setter must never skip pause.
    let shouldPause = force;
    if (!shouldPause) {
      try { shouldPause = player.playing; } catch { shouldPause = true; }
    }
    if (shouldPause) {
      try { player.pause(); } catch {}
    }
    try { player.loop = false; } catch {}
    try { player.muted = true; } catch {}
    try { player.volume = 0; } catch {}
  }

  function retireAndroidPlayer() {
    cancelReadiness?.();
    const player = ownedPlayer;
    ownedPlayer = null;
    if (!player) return;
    silence(player, true);
    // expo-audio 1.1.1 Android pause() leaves isPaused armed after native
    // background/focus suspension. remove() unregisters native auto-resume;
    // release() disposes the ExoPlayer. Neither affects other audio players.
    try { player.remove(); } catch {}
    try { player.release(); } catch {}
  }

  function waitForAndroidReadiness(player: AndroidDriverRequestAudioPlayer): Promise<boolean> {
    if (player.isLoaded) return Promise.resolve(true);
    return new Promise((resolve) => {
      let subscription: { remove: () => void } | undefined;
      let finished = false;
      const finish = (ready: boolean) => {
        if (finished) return;
        finished = true;
        try { subscription?.remove(); } catch {}
        cancelReadiness = null;
        resolve(ready);
      };
      cancelReadiness = () => finish(false);
      subscription = player.addListener('playbackStatusUpdate', () => {
        try { if (player.isLoaded) finish(true); } catch { finish(false); }
      });
      // Close the subscription/readiness race without treating an Android
      // loading-change event's isLoaded field as STATE_READY.
      if (finished) { try { subscription.remove(); } catch {} }
      else if (player.isLoaded) finish(true);
    });
  }

  return {
    async play(rideId: string, player: DriverRequestAudioPlayer, configure: (mode: typeof DRIVER_REQUEST_AUDIO_MODE) => Promise<void>) {
      if (!rideId || lastPlayedRide === rideId || pendingRide === rideId) return false;
      if (!ownsAndroidPlayer && !player.isLoaded) return false;
      const current = ++generation;
      pendingRide = rideId;
      try {
        if (ownsAndroidPlayer) {
          retireAndroidPlayer();
          ownedPlayer = options.createPlayer!();
          player = ownedPlayer;
        }
        // Preserve iOS silent-mode configuration and existing seek cancellation.
        await configure(DRIVER_REQUEST_AUDIO_MODE);
        if (generation !== current) return false;
        if (ownsAndroidPlayer && !await waitForAndroidReadiness(player as AndroidDriverRequestAudioPlayer)) return false;
        if (generation !== current || !player.isLoaded) return false;
        if (player.playing) player.pause();
        player.muted = false;
        player.volume = INCOMING_TRIP_ALERT_PLAYBACK.volume;
        player.loop = INCOMING_TRIP_ALERT_PLAYBACK.loop;
        await player.seekTo(0);
        if (generation !== current) return false;
        if (ownsAndroidPlayer && !await waitForAndroidReadiness(player as AndroidDriverRequestAudioPlayer)) return false;
        if (generation !== current || !player.isLoaded) return false;
        player.play();
        // A failed load/configuration/seek cannot consume this offer's alert.
        lastPlayedRide = rideId;
        return true;
      } catch {
        if (ownsAndroidPlayer && generation === current) retireAndroidPlayer();
        return false;
      } finally {
        if (generation === current) pendingRide = null;
      }
    },
    rearmAfterFailedAccept(rideId: string) {
      // Home calls this only after failed server reconciliation for the same
      // current, eligible, unexpired iOS offer. Ordinary stops keep the latch:
      // never release/replace the hook player or restart an accepted request.
      if (options.platform !== 'ios' || !rideId || lastPlayedRide !== rideId) return false;
      lastPlayedRide = null;
      return true;
    },
    stop(player: DriverRequestAudioPlayer, stopOptions: { force?: boolean } = {}) {
      // Invalidate configure/seek/readiness before touching the native player.
      generation++;
      pendingRide = null;
      if (ownsAndroidPlayer) {
        retireAndroidPlayer();
        // Home gates accepted/active/expired offers. A genuine failed Accept
        // may explicitly re-arm that SAME still-eligible offer with a new player.
        lastPlayedRide = null;
        return;
      }
      // Default (including iOS): retain the existing hook-owned playback/UX.
      silence(player, stopOptions.force === true);
    },
  };
}
