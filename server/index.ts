import { serve } from "bun";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { getDb } from "./db";
import { serverEnv } from "./env";
import { getLeaderboard, getRecentEvents } from "./queries";
import { handleSlackStamps } from "./slack/http";
import { startSlackEventWorker } from "./slack/inbox";

export const app = new Hono();
app.use(logger());

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

if (import.meta.main) {
  const db = getDb();
  if (serverEnv.slackBotToken) {
    startSlackEventWorker(db, serverEnv.slackBotToken);
  }
  const server = serve({
    fetch: app.fetch,
    port: serverEnv.apiPort,
    hostname: "0.0.0.0",
  });
  console.log(`stamphog api listening on http://127.0.0.1:${server.port}`);
}
