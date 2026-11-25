/** Unknown verification must settle even if token/native/transport work ignores abort. */
export class DriverVerificationTimeoutError extends Error {
  constructor() {
    super('Document verification timed out. Please retry.');
    this.name = 'DriverVerificationTimeoutError';
  }
}

export function awaitDriverVerification<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      complete();
    };
    const cancel = () => finish(() => reject(new Error('Document verification cancelled.')));
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => finish(() => reject(new DriverVerificationTimeoutError())), 20_000);
    // Attach both handlers immediately: late resolution/rejection has no state
    // side effects and never becomes an unhandled rejection after cancellation.
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('Document verification cancelled.');
      return operation();
    }).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
