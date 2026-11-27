import { INCOMING_TRIP_ALERT_PLAYBACK } from './incoming-trip-alert';
import { createDriverRequestAudioDiagnostics, type DriverRequestAudioEvent } from './driver-request-audio-diagnostics';

export const DRIVER_REQUEST_AUDIO_MODE = Object.freeze({
  playsInSilentMode: true,
  interruptionMode: 'duckOthers' as const,
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
});

export type DriverRequestAudioPlayer = {
  id?: string | number;
  isLoaded: boolean;
  playing: boolean;
  muted: boolean;
  volume: number;
  loop: boolean;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
  /** Available in the patched iOS binary; older binaries use retirement below. */
  hy3nStopRequestAudio?: () => void;
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
  onDiagnostic?: (event: DriverRequestAudioEvent) => void;
  /** Omit in production; inject an isolated session for deterministic tests. */
  session?: DriverRequestAudioSession;
};

type RequestAudioOwner = {
  request: () => string | null;
  stop: () => void;
};

// Only live/pending request owners are retained, not eager useRef constructors.
// Local stop/suspension/failed starts remove owners immediately. The ledger is
// local memory only, bounded across all sessions, and never enters diagnostics.
const MAX_CONSUMED_REQUESTS = 128;
export type DriverRequestAudioSession = Readonly<{ stopAll: (rideId?: string) => void }>;
type RequestAudioSessionState = {
  owners: Set<RequestAudioOwner>;
  consumed: Set<string>;
  stopping: boolean;
};
const sessionStates = new WeakMap<DriverRequestAudioSession, RequestAudioSessionState>();

function consumeRequest(state: RequestAudioSessionState, rideId: string) {
  state.consumed.delete(rideId);
  state.consumed.add(rideId);
  if (state.consumed.size > MAX_CONSUMED_REQUESTS) {
    state.consumed.delete(state.consumed.values().next().value!);
  }
}

/**
 * Isolated ownership/suppression domain for tests or a deliberately isolated
 * app lifetime. Normal Home controllers must omit session to share the default.
 * No reset is exposed: creating a fresh session cannot revive the old owners.
 */
export function createDriverRequestAudioSession(): DriverRequestAudioSession {
  const state: RequestAudioSessionState = { owners: new Set(), consumed: new Set(), stopping: false };
  const session = Object.freeze({ stopAll(rideId?: string) {
    const owners = [...state.owners];
    const wasStopping = state.stopping;
    state.stopping = true;
    try {
      if (rideId) consumeRequest(state, rideId);
      // Record every sounding/pending offer before any stop diagnostics can run.
      for (const owner of owners) {
        const request = owner.request();
        if (request) consumeRequest(state, request);
      }
      for (const owner of owners) owner.stop();
    } finally {
      state.stopping = wasStopping;
    }
  } });
  sessionStates.set(session, state);
  return session;
}

const sharedRequestAudioSession = createDriverRequestAudioSession();

/**
 * Terminal Accept/assignment/active-trip/Start boundary ONLY. Invalidate all
 * live/pending request controllers, never the shared audio session. Supply the
 * rideId even if Home already locally stopped it before the RPC. Suppression
 * uses globally unique trip IDs, not user identity. Auth cleanup may omit the
 * rideId to cancel owners without clearing any previous suppression.
 */
export function stopAllDriverRequestAudio(rideId?: string) {
  sharedRequestAudioSession.stopAll(rideId);
}

/** Request-only audio: never disable the shared session or other app sounds. */
export function createDriverRequestAudio(options: DriverRequestAudioOptions = {}) {
  const state = sessionStates.get(options.session ?? sharedRequestAudioSession);
  if (!state) throw new Error('Use a session from createDriverRequestAudioSession');
  const ownsNativePlayer = (options.platform === 'android' || options.platform === 'ios') && Boolean(options.createPlayer);
  const diagnostic = createDriverRequestAudioDiagnostics(options.onDiagnostic);
  let generation = 0;
  let lastPlayedRide: string | null = null;
  let pendingRide: string | null = null;
  let ownedPlayer: OwnedDriverRequestAudioPlayer | null = null;
  let ownedRide: string | null = null;
  let cancelReadiness: (() => void) | null = null;
  let requestRide: string | null = null;
  let borrowedRequestPlayer: DriverRequestAudioPlayer | null = null;

  function unregisterOwner() {
    state!.owners.delete(owner);
    requestRide = null;
    borrowedRequestPlayer = null;
  }

  const owner: RequestAudioOwner = {
    request: () => requestRide,
    stop: () => {
      const rideId = requestRide;
      const player = ownedPlayer || borrowedRequestPlayer;
      // Pending native work is terminally consumed too, not just played work.
      if ((options.platform === 'ios' || options.platform === 'android') && rideId) {
        lastPlayedRide = rideId;
      }
      stopRequest(player, true);
    },
  };

  function playerId(player: DriverRequestAudioPlayer | null) {
    try {
      const id = player?.id;
      if (typeof id === 'number' && Number.isFinite(id)) return id;
      if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id)) return id;
    } catch {}
    return undefined;
  }

  function nativeOperation(player: DriverRequestAudioPlayer, operation: NonNullable<DriverRequestAudioEvent['operation']>, action: () => void) {
    try { action(); } catch {
      diagnostic({ generation, event: 'native-operation-failed', operation, playerId: playerId(player) });
    }
  }

  function silence(player: DriverRequestAudioPlayer, force: boolean, alreadyTerminallyStopped = false) {
    // Isolate every native operation: a failed setter must never skip pause.
    let shouldPause = force;
    if (!shouldPause) {
      try { shouldPause = player.playing; } catch { shouldPause = true; }
    }
    if (shouldPause && !alreadyTerminallyStopped) {
      nativeOperation(player, 'pause', () => player.pause());
    }
    nativeOperation(player, 'loop', () => { player.loop = false; });
    nativeOperation(player, 'muted', () => { player.muted = true; });
    nativeOperation(player, 'volume', () => { player.volume = 0; });
  }

  function retireNativePlayer() {
    cancelReadiness?.();
    const player = ownedPlayer;
    ownedPlayer = null;
    ownedRide = null;
    unregisterOwner();
    if (!player) return;
    const id = playerId(player);
    // Native terminal disposition cancels queued loop/reset/resume work before
    // fallback retirement. Keep each operation independent on older binaries.
    let terminallyStopped = false;
    try {
      if (options.platform === 'ios' && player.hy3nStopRequestAudio) {
        player.hy3nStopRequestAudio();
        terminallyStopped = true;
      }
    } catch {
      diagnostic({ generation, event: 'native-operation-failed', playerId: id });
    }
    // Expo's ordinary iOS pause schedules shared-session deactivation, which
    // cannot see Google navigation audio. The terminal hook already paused this
    // player directly; only its absence/failure needs the ordinary-pause fallback.
    silence(player, true, terminallyStopped);
    // pause alone leaves native background/resume intent armed. remove()
    // unregisters this player; release() also cancels pending native seeks and
    // tears down iOS observers / Android ExoPlayer. Never release a hook player.
    nativeOperation(player, 'remove', () => player.remove());
    nativeOperation(player, 'release', () => player.release());
    // This records attempted native retirement, not proof of acoustic silence.
    diagnostic({ generation, event: 'player-retired', playerId: id });
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

  function stopRequest(player: DriverRequestAudioPlayer | null, force: boolean) {
    generation++;
    unregisterOwner();
    diagnostic({ generation, event: 'stop-requested', playerId: playerId(ownsNativePlayer ? ownedPlayer : player) });
    pendingRide = null;
    if (ownsNativePlayer) {
      retireNativePlayer();
      // Preserve iOS's local latch. Android retains local lifecycle restart
      // semantics, but terminal stops are protected by the shared consumed ledger.
      if (options.platform === 'android') lastPlayedRide = null;
      return;
    }
    unregisterOwner();
    if (player) silence(player, force);
  }

  function stop(player: DriverRequestAudioPlayer, stopOptions: { force?: boolean } = {}) {
    stopRequest(player, stopOptions.force === true);
  }

  return {
    async play(
      rideId: string,
      player: DriverRequestAudioPlayer,
      configure: (mode: typeof DRIVER_REQUEST_AUDIO_MODE) => Promise<void>,
      isEligible: () => boolean = () => true,
    ) {
      if (state.stopping || !rideId || state.consumed.has(rideId) ||
        lastPlayedRide === rideId || pendingRide === rideId || !isEligible()) return false;
      if (!ownsNativePlayer && !player.isLoaded) return false;
      const current = ++generation;
      let started = false;
      const stillEligible = () => generation === current && !state.consumed.has(rideId) && isEligible();
      try {
        if (ownsNativePlayer) retireNativePlayer();
        pendingRide = rideId;
        requestRide = rideId;
        borrowedRequestPlayer = ownsNativePlayer ? null : player;
        state.owners.add(owner);
        diagnostic({ generation: current, event: 'play-requested' });
        if (!stillEligible()) return false;
        if (ownsNativePlayer) {
          ownedPlayer = options.createPlayer!();
          ownedRide = rideId;
          player = ownedPlayer;
          diagnostic({ generation: current, event: 'player-created', playerId: playerId(player) });
          if (!stillEligible()) {
            // A synchronous factory/diagnostic callback can issue a terminal stop.
            // Do not orphan a player returned after that generation was cancelled.
            if (ownedPlayer === player) retireNativePlayer();
            return false;
          }
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
        diagnostic({ generation: current, event: 'play-started', playerId: playerId(player) });
        return true;
      } catch {
        diagnostic({ generation: current, event: 'play-failed', playerId: playerId(player) });
        return false;
      } finally {
        if (generation === current) {
          pendingRide = null;
          // Failed or no-longer-eligible requests must not leave a registered
          // player that native focus/background recovery could resume later.
          if (!started) {
            if (ownsNativePlayer) retireNativePlayer();
            else { unregisterOwner(); silence(player, true); }
          }
        }
      }
    },
    rearmAfterFailedAccept(rideId: string) {
      if ((options.platform !== 'ios' && options.platform !== 'android') || !rideId || state.stopping) return false;
      const globallyConsumed = state.consumed.has(rideId);
      if (lastPlayedRide !== rideId && !globallyConsumed) return false;
      // This explicit API is permission from Home: call ONLY after a fresh
      // server-confirmed unassigned failure and current offer eligibility checks.
      // It cannot revive old async work: generation cancellation is unchanged.
      state.consumed.delete(rideId);
      if (lastPlayedRide === rideId) lastPlayedRide = null;
      diagnostic({ generation, event: 'offer-rearmed' });
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
