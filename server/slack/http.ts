import { getDb } from "../db";
import { serverEnv } from "../env";
import { handleSlackMessageEvent, handleSlackReactionEvent } from "./handlers";
import { verifySlackWebhookSignature } from "./security";
import type {
  SlackEventEnvelope,
  SlackMessageEvent,
  SlackReactionEvent,
} from "./types";

export async function handleSlackStamps(request: Request) {
  const rawBody = await request.text();
  console.log("stamphog slack", {
    received: true,
    bytes: rawBody.length,
    hasSignature: Boolean(request.headers.get("x-slack-signature")),
  });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.log("stamphog slack", { rejected: "invalid json body" });
    return new Response("invalid json body", { status: 400 });
  }

  const envelope = payload as SlackEventEnvelope;

  if (envelope.type === "url_verification" && envelope.challenge) {
    const signatureError = await verifySlackWebhookSignature(request, rawBody);
    console.log("stamphog slack", {
      handled: "url_verification",
      signatureOk: signatureError === null,
    });
    return new Response(envelope.challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const signatureError = await verifySlackWebhookSignature(request, rawBody);
  if (signatureError) {
    return signatureError;
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

  const botToken = serverEnv.slackBotToken;
  if (!botToken) {
    console.log("stamphog slack", { rejected: "missing SLACK_BOT_TOKEN" });
    return new Response("missing SLACK_BOT_TOKEN", { status: 500 });
  }

  const db = getDb();
  const eventType = envelope.event.type;
  console.log("stamphog slack", { event: eventType });

  if (eventType === "message") {
    return handleSlackMessageEvent(
      db,
      envelope.event as SlackMessageEvent,
      botToken
    );
  }

  if (eventType === "reaction_added" || eventType === "reaction_removed") {
    return handleSlackReactionEvent(
      db,
      envelope.event as SlackReactionEvent,
      botToken
    );
  }

  console.log("stamphog slack", {
    ignored: true,
    reason: "event_not_handled",
    event: eventType,
  });
  return Response.json({
    ok: true,
    ignored: true,
    reason: "event_not_handled",
  });
}
