export type FirebasePaymentUser = {
  getIdToken(forceRefresh?: boolean): Promise<string>;
};

export type DriverFeeInput = {
  driverId: string;
  driverName: string;
  momoNumber: string;
  momoNetwork: string;
  serviceType: string;
  date: string;
};

export type DriverFeeResult = {
  success?: boolean;
  status?: string;
  message?: string;
  transactionId?: string | null;
  clientReference?: string;
  commissionRecord?: unknown;
};

type TrpcEnvelope = {
  result?: { data?: { json?: DriverFeeResult } | DriverFeeResult };
  error?: { json?: { message?: string } };
};

function unwrap(payload: unknown): DriverFeeResult {
  const response = (payload && typeof payload === 'object' ? payload : {}) as TrpcEnvelope;
  const data = response.result?.data;
  if (data && typeof data === 'object' && 'json' in data) return (data as { json?: DriverFeeResult }).json || {};
  if (data && typeof data === 'object') return data as DriverFeeResult;
  throw new Error(response.error?.json?.message || 'Driver fee payment could not be started. Please try again.');
}

/** Starts a Driver fee request with a freshly refreshed Firebase ID token. */
export async function startAuthenticatedDriverFee(
  user: FirebasePaymentUser,
  input: DriverFeeInput,
  apiBaseUrl: string,
  request: typeof fetch = fetch,
): Promise<DriverFeeResult> {
  const token = await user.getIdToken(true);
  if (!token) throw new Error('Your sign-in session has expired. Please sign in again before paying.');

  const response = await request(`${apiBaseUrl.replace(/\/$/, '')}/api/trpc/commission.charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: input }),
  });
  const result = unwrap(await response.json().catch(() => null));
  if (!response.ok || !result.success) throw new Error(result.message || 'Driver fee payment could not be started. Please try again.');
  return result;
}
