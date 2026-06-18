/**
 * Hubtel Webhook Handler
 *
 * Receives payment confirmation callbacks from Hubtel and updates commission status in Firestore.
 *
 * Hubtel sends a POST to the callback URL with:
 * {
 *   "TransactionId": "string",
 *   "Amount": number,
 *   "Status": "Success" | "Failed" | "Pending",
 *   "Message": "string",
 *   "ClientReference": "hy3n-commission-{driverId}-{date}",
 *   "Timestamp": "ISO string"
 * }
 *
 * We verify the ClientReference matches our format, then update Firestore.
 */

import { Express, Request, Response } from 'express';
import { adminFirestore, ADMIN_COLLECTIONS as COLLECTIONS } from '../firebaseAdmin';

export interface HubtelWebhookPayload {
  TransactionId?: string;
  Amount?: number;
  Status?: 'Success' | 'Failed' | 'Pending';
  Message?: string;
  ClientReference?: string;
  Timestamp?: string;
  [key: string]: any;
}

/**
 * Parse commission reference to extract driver ID and date.
 * Format: "hy3n-commission-{driverId}-{YYYY-MM-DD}"
 *
 * NOTE: This runs on the server, but uses the client-side Firebase SDK.
 * In production, you'd want to use Firebase Admin SDK for server-side operations.
 * For now, this works because the client SDK can be imported server-side.
 */
function parseCommissionReference(ref: string): { driverId: string; date: string } | null {
  const match = ref.match(/^hy3n-commission-(.+)-(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { driverId: match[1], date: match[2] };
}

/**
 * Handle Hubtel webhook callback.
 * Updates the commission record status based on Hubtel's payment result.
 */
export async function handleHubtelWebhook(req: Request, res: Response) {
  const payload = req.body as HubtelWebhookPayload;

  console.log('[Hubtel Webhook] Received:', {
    transactionId: payload.TransactionId,
    status: payload.Status,
    clientReference: payload.ClientReference,
  });

  // Validate required fields
  if (!payload.ClientReference) {
    console.warn('[Hubtel Webhook] Missing ClientReference');
    res.status(400).json({ error: 'Missing ClientReference' });
    return;
  }

  // Parse the reference
  const parsed = parseCommissionReference(payload.ClientReference);
  if (!parsed) {
    console.warn('[Hubtel Webhook] Invalid ClientReference format:', payload.ClientReference);
    res.status(400).json({ error: 'Invalid ClientReference format' });
    return;
  }

  const { driverId, date } = parsed;

  try {
    // Find the commission record in Firestore
    const records = await adminFirestore.list(COLLECTIONS.DAILY_COMMISSION, {
      driver_id: driverId,
      date,
    });

    if (!records || records.length === 0) {
      console.warn('[Hubtel Webhook] No commission record found for:', { driverId, date });
      res.status(404).json({ error: 'Commission record not found' });
      return;
    }

    const record = records[0];

    // Determine new status based on Hubtel response
    let newStatus: 'paid' | 'failed' | 'processing' = 'processing';
    if (payload.Status === 'Success') {
      newStatus = 'paid';
    } else if (payload.Status === 'Failed') {
      newStatus = 'failed';
    }

    // Update the commission record
    await adminFirestore.update(COLLECTIONS.DAILY_COMMISSION, record.id, {
      status: newStatus,
      hubtel_webhook_received_at: new Date().toISOString(),
      hubtel_transaction_id: payload.TransactionId || record.hubtel_transaction_id,
      hubtel_status: payload.Status,
      hubtel_message: payload.Message,
    });

    console.log('[Hubtel Webhook] Updated commission:', {
      driverId,
      date,
      newStatus,
      transactionId: payload.TransactionId,
    });

    res.json({
      success: true,
      message: 'Commission updated',
      status: newStatus,
    });
  } catch (err: any) {
    console.error('[Hubtel Webhook] Error updating commission:', err?.message);
    res.status(500).json({
      error: 'Failed to update commission',
      message: err?.message,
    });
  }
}

/**
 * Register the Hubtel webhook endpoint.
 */
export function registerHubtelWebhook(app: Express) {
  app.post('/api/hubtel/callback', handleHubtelWebhook);
  console.log('[Hubtel] Webhook endpoint registered at POST /api/hubtel/callback');
}
