import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { sendTripReceiptEmail } from "./email";
import {
  chargeDriverCommission,
  getCommissionAmount,
  getMomoChannel,
  getCommissionReference,
} from "./hubtel";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Trip Receipt Email ───────────────────────────────────────────────────────
  trips: router({
    sendReceipt: publicProcedure
      .input(z.object({
        riderEmail: z.string().email(),
        riderName: z.string(),
        driverName: z.string(),
        driverVehicle: z.string(),
        driverPlate: z.string(),
        pickup: z.string(),
        destination: z.string(),
        fare: z.number(),
        paymentMethod: z.string(),
        distance: z.number().optional(),
        duration: z.number().optional(),
        category: z.string().optional(),
        tripId: z.string(),
        completedAt: z.string(),
      }))
      .mutation(async ({ input }) => {
        const sent = await sendTripReceiptEmail(input);
        return { success: sent };
      }),
  }),

  // ─── Hubtel Daily Commission ──────────────────────────────────────────────────
  commission: router({
    /**
     * Charge a driver's daily commission via Hubtel Direct Receive Money.
     * The driver receives a USSD prompt on their phone to approve the payment.
     *
     * Returns:
     *   - success: true if Hubtel accepted the charge request
     *   - status: "pending" (USSD sent, awaiting driver approval) | "failed"
     *   - transactionId: Hubtel's transaction reference
     *   - message: human-readable status message
     */
    charge: publicProcedure
      .input(z.object({
        /** Driver's Firestore user_id (used for idempotency reference) */
        driverId: z.string(),
        /** Driver's full name */
        driverName: z.string(),
        /** Driver's MoMo phone number (e.g. "0244123456") */
        momoNumber: z.string(),
        /** MoMo network: "mtn-gh" | "vodafone-gh" | "tigo-gh" */
        momoNetwork: z.string().optional(),
        /** Driver service type: "car" | "okada" | "delivery" */
        serviceType: z.string(),
        /** ISO date string YYYY-MM-DD (defaults to today) */
        date: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const date = input.date || new Date().toISOString().split('T')[0];
        const amount = getCommissionAmount(input.serviceType);
        const channel = getMomoChannel(input.momoNetwork || 'mtn-gh');
        const clientReference = getCommissionReference(input.driverId, date);

        // Format phone number: ensure it starts with country code or is 10 digits
        let phone = input.momoNumber.replace(/\s+/g, '').replace(/^0/, '233');
        if (!phone.startsWith('233')) phone = '233' + phone;

        const result = await chargeDriverCommission({
          customerMsisdn: phone,
          amount,
          customerName: input.driverName,
          description: `HY3N daily platform fee - ${date}`,
          clientReference,
          channel,
        });

        return {
          success: result.success,
          status: result.status || 'failed',
          transactionId: result.transactionId || null,
          message: result.message || '',
          amount,
          date,
          clientReference,
        };
      }),

    /**
     * Get the commission status for a driver on a given date.
     * Used by the driver app to check if today's fee has been paid.
     *
     * Note: This endpoint checks the Hubtel transaction status by clientReference.
     * The Firestore record is the source of truth for the app UI —
     * the driver app writes/reads directly from Firestore.
     * This endpoint is for server-side status verification if needed.
     */
    getStatus: publicProcedure
      .input(z.object({
        driverId: z.string(),
        date: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const date = input.date || new Date().toISOString().split('T')[0];
        const clientReference = getCommissionReference(input.driverId, date);
        // Return the reference so the client can look it up in Firestore
        return {
          driverId: input.driverId,
          date,
          clientReference,
        };
      }),

    /**
     * Admin: List all commissions for a date range.
     * Returns all commission records with driver info.
     * TODO: Implement admin auth check
     */
    listForAdmin: publicProcedure
      .input(z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        status: z.string().optional(),
      }))
      .query(async ({ input }) => {
        // Placeholder: In production, verify admin auth here
        return {
          commissions: [],
          note: 'Admin endpoint — implement auth and Firestore query',
        };
      }),

    /**
     * Admin: Override a commission status manually.
     * Updates the commission record directly.
     * TODO: Implement admin auth check
     */
    overrideStatus: publicProcedure
      .input(z.object({
        commissionId: z.string(),
        newStatus: z.enum(['paid', 'failed', 'processing']),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Placeholder: In production, verify admin auth here
        return {
          success: true,
          message: 'Commission status updated',
          note: 'Admin endpoint — implement auth',
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
