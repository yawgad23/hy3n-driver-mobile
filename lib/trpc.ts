import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "hy3n-backend";
import { getApiBaseUrl } from "@/constants/oauth";
import { auth } from "@/lib/firebase";
import { isCriticalDriverProcedure } from "@/lib/driver-critical-api";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

const apiUrl = `${getApiBaseUrl()}/api/trpc`;

async function authorizationHeaders() {
  // Every account-owned backend action is authorized with the current
  // Firebase identity. A client-supplied driverId is never trusted.
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authenticatedFetch(url: RequestInfo | URL, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "HY3N services are temporarily unavailable. Please try again in a few minutes."
    );
  }
  return response;
}

const transportOptions = {
  url: apiUrl,
  transformer: superjson,
  headers: authorizationHeaders,
  fetch: authenticatedFetch,
};

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      // Offer delivery and Driver lifecycle actions use their own request.
      // Background History/Finance queries can remain batched, but must never
      // delay a new offer, pickup-code verification, or trip completion.
      splitLink({
        condition: (operation) => isCriticalDriverProcedure(operation.path),
        true: httpLink(transportOptions),
        false: httpBatchLink(transportOptions),
      }),
    ],
  });
}
