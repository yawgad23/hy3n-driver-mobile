import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerHubtelWebhook } from "./hubtelWebhook";
import { appRouter } from "../routers";
import { createContext } from "./context";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerHubtelWebhook(app);

  // Google Places Autocomplete proxy — keeps API key server-side
  app.get("/api/places/autocomplete", async (req, res) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 2) {
      res.json({ predictions: [] });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Maps API key not configured" });
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${apiKey}&components=country:gh&language=en&types=geocode|establishment`;
      const response = await fetch(url);
      const data = await response.json() as { status: string; predictions: any[] };
      if (data.status === "OK" || data.status === "ZERO_RESULTS") {
        res.json({ predictions: data.predictions || [] });
      } else {
        res.json({ predictions: [] });
      }
    } catch (err) {
      res.json({ predictions: [] });
    }
  });

  // Google Place Details proxy — get lat/lng for a place_id
  app.get("/api/places/details", async (req, res) => {
    const { place_id } = req.query as { place_id?: string };
    if (!place_id) { res.json({ result: null }); return; }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) { res.status(500).json({ error: "Maps API key not configured" }); return; }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&key=${apiKey}&fields=name,formatted_address,geometry`;
      const response = await fetch(url);
      const data = await response.json() as { status: string; result?: any };
      res.json({ result: data.status === "OK" ? data.result : null });
    } catch {
      res.json({ result: null });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Hubtel webhook status endpoint
  app.get("/api/hubtel/status", (_req, res) => {
    res.json({ status: "ready", webhook: "/api/hubtel/callback" });
  });

  // Admin commission dashboard (served as static HTML)
  app.get("/admin/commission", (_req, res) => {
    const path = require("path");
    res.sendFile(path.join(__dirname, "../../server/admin-commission.html"));
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
