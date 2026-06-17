import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { sendTripReceiptEmail } from "./email";

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
});

export type AppRouter = typeof appRouter;
