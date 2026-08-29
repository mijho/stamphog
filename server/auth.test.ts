import { expect, test } from "bun:test";
import { Hono } from "hono";
import { readAuthMiddleware } from "./auth";

function buildApp(config?: Parameters<typeof readAuthMiddleware>[0]) {
  const app = new Hono();
  app.use("/api/*", readAuthMiddleware(config));
  app.get("/api/leaderboard", (c) => c.json({ ok: true }));
  app.get("/api/events", (c) => c.json({ ok: true }));
  app.get("/slack/stamps", (c) => c.text("slack ok"));
  return app;
}

test("anonymous access is allowed by default (local development)", async () => {
  const app = buildApp();
  const res = await app.request("/api/leaderboard");
  expect(res.status).toBe(200);
});

test("anonymous access is rejected when allowAnonymous is false", async () => {
  const app = buildApp({ allowAnonymous: false });
  const [leaderboard, events] = await Promise.all([
    app.request("/api/leaderboard"),
    app.request("/api/events"),
  ]);
  expect(leaderboard.status).toBe(401);
  expect(events.status).toBe(401);
});

test("missing identity header is rejected when auth is configured", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["alice@example.com"],
  });
  const res = await app.request("/api/leaderboard");
  expect(res.status).toBe(401);
});

test("allowed identity header passes", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["alice@example.com"],
  });
  const res = await app.request("/api/leaderboard", {
    headers: { "x-auth-request-user": "alice@example.com" },
  });
  expect(res.status).toBe(200);
});

test("identity check is case-insensitive", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["ALICE@example.com"],
  });
  const res = await app.request("/api/leaderboard", {
    headers: { "x-auth-request-user": "Alice@Example.com" },
  });
  expect(res.status).toBe(200);
});

test("disallowed identity is rejected with 403", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["alice@example.com"],
  });
  const res = await app.request("/api/leaderboard", {
    headers: { "x-auth-request-user": "bob@example.com" },
  });
  expect(res.status).toBe(403);
});

test("read auth does not protect the Slack webhook", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["alice@example.com"],
  });
  const res = await app.request("/slack/stamps");
  expect(res.status).toBe(200);
});

test("multi-identity allowlist rejects the full comma-joined header", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["alice@example.com", "bob@example.com"],
  });
  const res = await app.request("/api/leaderboard", {
    headers: { "x-auth-request-user": "alice@example.com,bob@example.com" },
  });
  expect(res.status).toBe(403);
});

test("multi-identity allowlist accepts a single member as the header", async () => {
  const app = buildApp({
    identityHeader: "x-auth-request-user",
    allowedIdentities: ["alice@example.com", "bob@example.com"],
  });
  const res = await app.request("/api/leaderboard", {
    headers: { "x-auth-request-user": "bob@example.com" },
  });
  expect(res.status).toBe(200);
});
