export type DriverTripTerminalStatus = 'completed' | 'cancelled' | null;

/** The server ride document is the only authority for a terminal UI transition. */
export function driverTripTerminalStatus(ride: unknown): DriverTripTerminalStatus {
  const status = String((ride as { status?: unknown } | null)?.status || '').trim().toLowerCase();
  if (status === 'completed' || status === 'cancelled') return status;
  return null;
}
