export type DriverRequestAudioEvent = Readonly<{
  owner: number;
  generation: number;
  event: 'play-requested' | 'player-created' | 'play-started' | 'play-failed' | 'stop-requested' | 'player-retired' | 'native-operation-failed' | 'offer-rearmed';
  playerId?: string | number;
  operation?: 'pause' | 'loop' | 'muted' | 'volume' | 'remove' | 'release';
}>;

const MAX_EVENTS = 64;
let nextOwner = 0;
const recent: DriverRequestAudioEvent[] = [];

/** Local memory only: no ride/user IDs, phone numbers, locations or error payloads. */
export function createDriverRequestAudioDiagnostics(listener?: (event: DriverRequestAudioEvent) => void) {
  const owner = ++nextOwner;
  return (event: Omit<DriverRequestAudioEvent, 'owner'>) => {
    const entry = Object.freeze({ ...event, owner });
    recent.push(entry);
    if (recent.length > MAX_EVENTS) recent.shift();
    // Diagnostic consumers must never interrupt a native stop/start boundary.
    try { listener?.(entry); } catch {}
    if (entry.event === 'native-operation-failed') {
      try { console.warn('[HY3N request audio] Native operation failed', entry); } catch {}
    }
  };
}

/** A copy for a local debugger; this module never uploads or persists events. */
export function getDriverRequestAudioDiagnostics(): readonly DriverRequestAudioEvent[] {
  return recent.slice();
}
