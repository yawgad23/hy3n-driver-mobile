// Fee status changes only after a payment or administrator action. Keep its
// background refresh separate from the two-second offer poll so it never joins
// the critical request-delivery batch on every home-screen refresh.
export const DRIVER_FEE_STATUS_REFRESH_MS = 60_000;
