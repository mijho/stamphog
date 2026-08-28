import {
  buildReactionDedupeKey,
  buildRequestDedupeKey,
  extractQualifyingReviewUrl,
  getStampEmojiSet,
  normalizeEmoji,
} from "../../src/lib/slack-rules";
import type { AppDb } from "../db";
import {
  ingestReactionStamp,
  ingestRequestMessage,
  removeReactionStamp,
} from "../ingest";
import { fetchSlackMessageAtTimestamp, fetchSlackUserSummary } from "./client";
import type { SlackMessageEvent, SlackReactionEvent } from "./types";

function toOccurredAtMs(eventTs: string | undefined) {
  const parsed = Number(eventTs);
  return Number.isFinite(parsed) ? Math.floor(parsed * 1000) : undefined;
}

function ignored(reason: string, extra?: Record<string, unknown>) {
  console.log("stamphog slack", { ignored: true, reason, ...extra });
  return Response.json({
    ok: true,
    ignored: true,
    reason,
  });
}

export async function handleSlackMessageEvent(
  db: AppDb,
  event: SlackMessageEvent,
  botToken: string
) {
  if (event.subtype) {
    return ignored("message_subtype", { subtype: event.subtype });
  }

  // Skip thread replies — only track base (top-level) channel messages
  if (event.thread_ts && event.thread_ts !== event.ts) {
    return ignored("thread_reply", { channelId: event.channel });
  }

  const requesterId = event.user;
  const channelId = event.channel;
  const messageTs = event.ts;
  if (!(requesterId && channelId && messageTs)) {
    console.log("stamphog slack", { rejected: "missing message event fields" });
    return new Response("missing message event fields", { status: 400 });
  }

  const qualifyingUrl = extractQualifyingReviewUrl(event.text);
  if (!qualifyingUrl) {
    return ignored("missing_qualifying_review_url", { channelId });
  }

  const requester = await fetchSlackUserSummary({
    botToken,
    slackUserId: requesterId,
  });

  const result = ingestRequestMessage(db, {
    requesterId,
    requesterDisplayName: requester.displayName,
    requesterImageUrl: requester.imageUrl,
    channelId,
    messageRef: messageTs,
    occurredAt: toOccurredAtMs(event.event_ts ?? messageTs),
    prUrl: qualifyingUrl,
    dedupeKey: buildRequestDedupeKey({ channelId, messageTs }),
  });

  console.log("stamphog slack", {
    handled: "message",
    channelId,
    prUrl: qualifyingUrl,
    duplicateSkipped: result.duplicateSkipped,
  });
  return Response.json({ ok: true, duplicateSkipped: result.duplicateSkipped });
}

export async function handleSlackReactionEvent(
  db: AppDb,
  event: SlackReactionEvent,
  botToken: string
) {
  const normalizedReaction = normalizeEmoji(event.reaction ?? "");
  if (!getStampEmojiSet().has(normalizedReaction)) {
    return ignored("emoji_not_tracked", { reaction: normalizedReaction });
  }

  const giverId = event.user;
  const channelId = event.item?.channel;
  const messageTs = event.item?.ts;
  if (!(giverId && channelId && messageTs)) {
    console.log("stamphog slack", { rejected: "missing reaction event fields" });
    return new Response("missing reaction event fields", { status: 400 });
  }

  const message = await fetchSlackMessageAtTimestamp({
    botToken,
    channelId,
    messageTs,
  });

  // conversations.history only returns top-level messages.  If the returned
  // message timestamp doesn't match what we asked for, the reaction was on a
  // thread reply and we got the nearest base message instead — skip it.
  if (!message?.ts || message.ts !== messageTs) {
    return ignored("thread_reply", { channelId, reaction: normalizedReaction });
  }

  const requesterId = message.user;
  if (!requesterId) {
    console.log("stamphog slack", { rejected: "could not resolve message author" });
    return new Response("could not resolve message author", { status: 400 });
  }

  const qualifyingUrl = extractQualifyingReviewUrl(message.text);
  if (!qualifyingUrl) {
    return ignored("missing_qualifying_review_url", {
      channelId,
      reaction: normalizedReaction,
    });
  }

  const requester = await fetchSlackUserSummary({
    botToken,
    slackUserId: requesterId,
  });

  ingestRequestMessage(db, {
    requesterId,
    requesterDisplayName: requester.displayName,
    requesterImageUrl: requester.imageUrl,
    channelId,
    messageRef: messageTs,
    occurredAt: toOccurredAtMs(event.event_ts),
    prUrl: qualifyingUrl,
    dedupeKey: buildRequestDedupeKey({ channelId, messageTs }),
  });

  const dedupeKey = buildReactionDedupeKey({
    channelId,
    messageTs,
    reaction: normalizedReaction,
    giverSlackId: giverId,
  });
  const source = `slack:reaction:${normalizedReaction}`;

  if (event.type === "reaction_removed") {
    const result = removeReactionStamp(db, {
      dedupeKey,
      giverId,
      requesterId,
      reaction: normalizedReaction,
      source,
      channelId,
    });

    console.log("stamphog slack", {
      handled: "reaction_removed",
      channelId,
      reaction: normalizedReaction,
      removed: result.removed,
    });
    return Response.json({
      ok: true,
      removed: result.removed,
      strategy: result.strategy,
    });
  }

  const giver = await fetchSlackUserSummary({
    botToken,
    slackUserId: giverId,
  });

  const result = ingestReactionStamp(db, {
    giverId,
    requesterId,
    giverDisplayName: giver.displayName,
    requesterDisplayName: requester.displayName,
    giverImageUrl: giver.imageUrl,
    requesterImageUrl: requester.imageUrl,
    reaction: normalizedReaction,
    source,
    occurredAt: toOccurredAtMs(event.event_ts),
    channelId,
    prUrl: qualifyingUrl,
    dedupeKey,
  });

  console.log("stamphog slack", {
    handled: "reaction_added",
    channelId,
    reaction: normalizedReaction,
    prUrl: qualifyingUrl,
    duplicateSkipped: result.duplicateSkipped,
  });
  return Response.json({ ok: true, duplicateSkipped: result.duplicateSkipped });
}
