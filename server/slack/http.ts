import type { AppDb } from "../db";
import { getDb } from "../db";
import { serverEnv } from "../env";
import { enqueueSlackEvent, scheduleSlackEventProcessing } from "./inbox";
import { verifySlackWebhookSignature } from "./security";
import type { SlackEventEnvelope } from "./types";

interface SlackHttpOptions {
  signingSecret?: string;
  botToken?: string;
  db?: AppDb;
  scheduleProcessing?: typeof scheduleSlackEventProcessing;
}

export async function handleSlackStamps(
  request: Request,
  options: SlackHttpOptions = {}
) {
  const rawBody = await request.text();
  console.log("stamphog slack", {
    received: true,
    bytes: rawBody.length,
    hasSignature: Boolean(request.headers.get("x-slack-signature")),
  });

  const signatureError = await verifySlackWebhookSignature(
    request,
    rawBody,
    options.signingSecret
  );
  if (signatureError) {
    return signatureError;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.log("stamphog slack", { rejected: "invalid json body" });
    return new Response("invalid json body", { status: 400 });
  }

  const envelope = payload as SlackEventEnvelope;

  if (envelope.type === "url_verification" && envelope.challenge) {
    console.log("stamphog slack", {
      handled: "url_verification",
      signatureOk: true,
    });
    return new Response(envelope.challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (envelope.type !== "event_callback" || !envelope.event) {
    console.log("stamphog slack", {
      ignored: true,
      reason: "not_event_callback",
      type: envelope.type,
    });
    return Response.json({
      ok: true,
      ignored: true,
      reason: "not_event_callback",
    });
  }

  if (!envelope.event_id) {
    console.log("stamphog slack", { rejected: "missing event_id" });
    return new Response("missing event_id", { status: 400 });
  }

  const db = options.db ?? getDb();
  const queued = enqueueSlackEvent(db, {
    envelope,
    rawBody,
    retryNum: request.headers.get("x-slack-retry-num"),
    retryReason: request.headers.get("x-slack-retry-reason"),
  });
  const botToken = options.botToken ?? serverEnv.slackBotToken;
  if (queued.inserted && botToken) {
    (options.scheduleProcessing ?? scheduleSlackEventProcessing)(
      db,
      queued.eventId,
      botToken
    );
  }

  return Response.json({
    ok: true,
    queued: true,
    duplicateSkipped: queued.duplicateSkipped,
  });
}
