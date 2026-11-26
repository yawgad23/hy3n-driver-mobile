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

export type OwnedDriverRequestAudioPlayer = DriverRequestAudioPlayer & {
  addListener: (event: 'playbackStatusUpdate', listener: (status: { isLoaded: boolean }) => void) => { remove: () => void };
  remove: () => void;
  release: () => void;
};

// Keep the existing exported type available to Android callers.
export type AndroidDriverRequestAudioPlayer = OwnedDriverRequestAudioPlayer;

type DriverRequestAudioOptions = {
  platform?: string;
  /** Native ONLY: the controller owns and retires each request's player. */
  createPlayer?: () => OwnedDriverRequestAudioPlayer;
};

/** Request-only audio: never disable the shared session or other app sounds. */
export function createDriverRequestAudio(options: DriverRequestAudioOptions = {}) {
  const ownsNativePlayer = (options.platform === 'android' || options.platform === 'ios') && Boolean(options.createPlayer);
  let generation = 0;
  let lastPlayedRide: string | null = null;
  let pendingRide: string | null = null;
  let ownedPlayer: OwnedDriverRequestAudioPlayer | null = null;
  let ownedRide: string | null = null;
  let cancelReadiness: (() => void) | null = null;

  function silence(player: DriverRequestAudioPlayer, force: boolean) {
    // Isolate every native operation: a failed setter must never skip pause.
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

  function retireNativePlayer() {
    cancelReadiness?.();
    const player = ownedPlayer;
    ownedPlayer = null;
    ownedRide = null;
    if (!player) return;
    silence(player, true);
    // pause alone leaves native background/resume intent armed. remove()
    // unregisters this player; release() also cancels pending native seeks and
    // tears down iOS observers / Android ExoPlayer. Never release a hook player.
    try { player.remove(); } catch {}
    try { player.release(); } catch {}
  }

  function waitForNativeReadiness(player: OwnedDriverRequestAudioPlayer): Promise<boolean> {
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
        // Android's event field can precede STATE_READY; read the player itself.
        try { if (player.isLoaded) finish(true); } catch { finish(false); }
      });
      if (finished) { try { subscription.remove(); } catch {} }
      else if (player.isLoaded) finish(true);
    });
  }

  function stop(player: DriverRequestAudioPlayer, stopOptions: { force?: boolean } = {}) {
    generation++;
    pendingRide = null;
    if (ownsNativePlayer) {
      retireNativePlayer();
      // Preserve iOS's consumed-offer latch until a genuinely failed Accept
      // explicitly rearms it. Android's Home suppression remains authoritative.
      if (options.platform === 'android') lastPlayedRide = null;
      return;
    }
    silence(player, stopOptions.force === true);
  }

  return {
    async play(
      rideId: string,
      player: DriverRequestAudioPlayer,
      configure: (mode: typeof DRIVER_REQUEST_AUDIO_MODE) => Promise<void>,
      isEligible: () => boolean = () => true,
    ) {
      if (!rideId || lastPlayedRide === rideId || pendingRide === rideId || !isEligible()) return false;
      if (!ownsNativePlayer && !player.isLoaded) return false;
      const current = ++generation;
      pendingRide = rideId;
      const stillEligible = () => generation === current && isEligible();
      let started = false;
      try {
        if (ownsNativePlayer) {
          retireNativePlayer();
          ownedPlayer = options.createPlayer!();
          ownedRide = rideId;
          player = ownedPlayer;
        }
        await configure(DRIVER_REQUEST_AUDIO_MODE);
        if (!stillEligible()) return false;
        if (ownsNativePlayer && !await waitForNativeReadiness(player as OwnedDriverRequestAudioPlayer)) return false;
        if (!stillEligible() || !player.isLoaded) return false;
        if (player.playing) player.pause();
        player.muted = false;
        player.volume = INCOMING_TRIP_ALERT_PLAYBACK.volume;
        player.loop = INCOMING_TRIP_ALERT_PLAYBACK.loop;
        await player.seekTo(0);
        if (!stillEligible()) return false;
        if (ownsNativePlayer && !await waitForNativeReadiness(player as OwnedDriverRequestAudioPlayer)) return false;
        if (!stillEligible() || !player.isLoaded) return false;
        player.play();
        lastPlayedRide = rideId;
        started = true;
        return true;
      } catch {
        return false;
      } finally {
        if (generation === current) {
          pendingRide = null;
          // Failed or no-longer-eligible requests must not leave a registered
          // player that native focus/background recovery could resume later.
          if (!started) {
            if (ownsNativePlayer) retireNativePlayer();
            else silence(player, true);
          }
        }
      }
    },
    rearmAfterFailedAccept(rideId: string) {
      if (options.platform !== 'ios' || !rideId || lastPlayedRide !== rideId) return false;
      lastPlayedRide = null;
      return true;
    },
    suspend(player: DriverRequestAudioPlayer) {
      // Only an actually live/pending unanswered source can re-ring on resume.
      // Calling this after a terminal stop cannot clear an accepted iOS latch.
      const suspendedRide = ownedRide || pendingRide;
      stop(player, { force: true });
      if (suspendedRide && lastPlayedRide === suspendedRide) lastPlayedRide = null;
    },
    stop,
  };
}
