export type DriverMapStatus = 'loading' | 'ready' | 'tiles-unavailable' | 'unavailable';

export type DriverMapCallbacks = {
  onRemount: (generation: number) => void;
  onReady: () => void;
  onProbe: (generation: number) => void;
  onStatus: (status: DriverMapStatus) => void;
};

/**
 * An iOS WKWebView can lose its content process without unmounting its React
 * Native view. Only the HTML page's handshake, not onLoadEnd, proves Leaflet
 * is actually ready. Keep recovery bounded so a network outage cannot cause
 * a reload storm or repeatedly interrupt active navigation.
 */
export class DriverMapLifecycle {
  private generation = 0;
  private visible = false;
  private ready = false;
  private pendingRecovery = false;
  private recoveries = 0;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly callbacks: DriverMapCallbacks) {}

  get currentGeneration() { return this.generation; }
  get isReady() { return this.ready; }

  private clearTimers() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.bootTimer = null;
    this.probeTimer = null;
  }

  private armBootTimer() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (!this.visible || this.disposed) return;
    const generation = this.generation;
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      if (generation === this.generation && !this.ready) this.recover(generation);
    }, 12_000);
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.clearTimers();
    if (!visible) return;
    // A new foreground/focus episode gets a fresh, but still bounded, retry
    // budget. No GPS update or onLoadEnd can replenish this allowance.
    this.recoveries = 0;
    if (this.pendingRecovery) this.recover(this.generation);
    else if (this.ready) {
      this.callbacks.onReady();
      this.probe();
    }
    else this.armBootTimer();
  }

  onLoadStart(generation: number) {
    if (this.disposed || generation !== this.generation) return;
    this.ready = false;
    this.callbacks.onStatus('loading');
    this.armBootTimer();
  }

  onReadyMessage(generation: number) {
    if (this.disposed || generation !== this.generation) return;
    this.clearTimers();
    this.ready = true;
    this.pendingRecovery = false;
    this.callbacks.onStatus('ready');
    if (this.visible) this.callbacks.onReady();
  }

  onPong(generation: number) {
    if (this.disposed || generation !== this.generation || !this.ready) return;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }

  onTileError(generation: number) {
    if (this.disposed || generation !== this.generation || !this.ready) return;
    this.callbacks.onStatus('tiles-unavailable');
  }

  onTilesRecovered(generation: number) {
    if (this.disposed || generation !== this.generation || !this.ready) return;
    this.callbacks.onStatus('ready');
  }

  onFailure(generation: number) {
    if (this.disposed || generation !== this.generation) return;
    this.ready = false;
    this.pendingRecovery = true;
    this.clearTimers();
    if (this.visible) this.recover(generation);
  }

  probe() {
    if (this.disposed || !this.visible || !this.ready || this.probeTimer) return;
    const generation = this.generation;
    this.callbacks.onProbe(generation);
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (generation === this.generation && this.visible) this.onFailure(generation);
    }, 3_000);
  }

  /**
   * WKWebView can return a JavaScript pong after iOS resumes it while its
   * compositor is still blank. A fresh inline document is the reliable
   * recovery, including after short app switches where WebKit emits no
   * content-process-termination event.
   */
  recoverFromForeground() {
    if (this.disposed || !this.visible || !this.ready) return;
    this.onFailure(this.generation);
  }

  private recover(generation: number) {
    if (this.disposed || generation !== this.generation || !this.visible) return;
    this.clearTimers();
    this.ready = false;
    if (this.recoveries >= 2) {
      this.pendingRecovery = true;
      this.callbacks.onStatus('unavailable');
      return;
    }
    this.recoveries += 1;
    this.pendingRecovery = false;
    this.generation += 1;
    this.callbacks.onStatus('loading');
    this.callbacks.onRemount(this.generation);
    this.armBootTimer();
  }

  retryManually() {
    if (this.disposed) return;
    this.recoveries = 0;
    this.pendingRecovery = true;
    if (this.visible) this.recover(this.generation);
  }

  revive() {
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.visible = false;
    this.ready = false;
    this.pendingRecovery = true;
  }
}
