import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "./env";
import { getDb } from "./db";
import { getLeaderboard, getRecentEvents } from "./queries";
import { handleSlackStamps } from "./slack/http";
import "./slack/socket";

const app = new Hono();
app.use(logger());


app.use(
  "/api/*",
  cors({
    origin: "*",
  })
);

app.get("/", (c) => c.text("stamphog api. UI is http://127.0.0.1:5173"));
app.get("/health", (c) => c.json({ ok: true }));
app.get("/slack/stamps", (c) =>
  c.text("stamphog slack endpoint is up. Slack must POST here.")
);

app.get("/api/leaderboard", (c) => {
  const windowDaysRaw = c.req.query("windowDays");
  const limitRaw = c.req.query("limit");
  const windowDays = windowDaysRaw ? Number(windowDaysRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  return c.json(
    getLeaderboard(getDb(), {
      windowDays: Number.isFinite(windowDays) ? windowDays : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
  );
});

app.get("/api/events", (c) => {
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  return c.json(
    getRecentEvents(getDb(), {
      limit: Number.isFinite(limit) ? limit : undefined,
    })
  );
});

app.post("/slack/stamps", (c) => handleSlackStamps(c.req.raw));

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
getDb();

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`stamphog api listening on http://127.0.0.1:${info.port}`);
});
