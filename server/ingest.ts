import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "./db";
import { actors, requests, stampEvents } from "./schema";

export interface IngestRequestArgs {
  requesterId: string;
  requesterDisplayName?: string;
  requesterImageUrl?: string;
  channelId: string;
  messageRef: string;
  occurredAt?: number;
  prUrl: string;
  dedupeKey: string;
}

export interface IngestReactionArgs {
  giverId: string;
  requesterId: string;
  giverDisplayName?: string;
  requesterDisplayName?: string;
  giverImageUrl?: string;
  requesterImageUrl?: string;
  reaction: string;
  source?: string;
  occurredAt?: number;
  channelId: string;
  prUrl?: string;
  dedupeKey: string;
}

export interface RemoveReactionArgs {
  dedupeKey: string;
  giverId: string;
  requesterId: string;
  reaction: string;
  source?: string;
  channelId: string;
}

function upsertActor(
  db: AppDb,
  args: {
    actorId: string;
    displayName?: string;
    imageUrl?: string;
  }
) {
  const existing = db
    .select()
    .from(actors)
    .where(eq(actors.actorId, args.actorId))
    .get();

  if (existing) {
    db.update(actors)
      .set({
        displayName: args.displayName ?? existing.displayName,
        imageUrl: args.imageUrl ?? existing.imageUrl,
        updatedAt: Date.now(),
      })
      .where(eq(actors.actorId, args.actorId))
      .run();
    return;
  }

  db.insert(actors)
    .values({
      actorId: args.actorId,
      displayName: args.displayName ?? args.actorId,
      imageUrl: args.imageUrl,
      updatedAt: Date.now(),
    })
    .run();
}

export function ingestRequestMessage(db: AppDb, args: IngestRequestArgs) {
  upsertActor(db, {
    actorId: args.requesterId,
    displayName: args.requesterDisplayName,
    imageUrl: args.requesterImageUrl,
  });

  const existingRequest = db
    .select()
    .from(requests)
    .where(eq(requests.dedupeKey, args.dedupeKey))
    .get();

  if (existingRequest) {
    db.update(requests)
      .set({ prUrl: args.prUrl })
      .where(eq(requests.id, existingRequest.id))
      .run();
    return { duplicateSkipped: true, requestId: existingRequest.id };
  }

  const requestId = randomUUID();
  db.insert(requests)
    .values({
      id: requestId,
      requesterId: args.requesterId,
      channelId: args.channelId,
      messageRef: args.messageRef,
      occurredAt: args.occurredAt ?? Date.now(),
      prUrl: args.prUrl,
      dedupeKey: args.dedupeKey,
      createdAt: Date.now(),
    })
    .run();

  return { duplicateSkipped: false, requestId };
}

export function ingestReactionStamp(db: AppDb, args: IngestReactionArgs) {
  upsertActor(db, {
    actorId: args.giverId,
    displayName: args.giverDisplayName,
    imageUrl: args.giverImageUrl,
  });
  upsertActor(db, {
    actorId: args.requesterId,
    displayName: args.requesterDisplayName,
    imageUrl: args.requesterImageUrl,
  });

  const existingEvent = db
    .select()
    .from(stampEvents)
    .where(eq(stampEvents.dedupeKey, args.dedupeKey))
    .get();

  if (existingEvent) {
    return { duplicateSkipped: true, eventId: existingEvent.id };
  }

  const eventId = randomUUID();
  db.insert(stampEvents)
    .values({
      id: eventId,
      giverId: args.giverId,
      requesterId: args.requesterId,
      stampCount: 1,
      occurredAt: args.occurredAt ?? Date.now(),
      source: args.source ?? `stamp:${args.reaction}`,
      channelId: args.channelId,
      prUrl: args.prUrl,
      dedupeKey: args.dedupeKey,
      createdAt: Date.now(),
    })
    .run();

  return { duplicateSkipped: false, eventId };
}

export function removeReactionStamp(db: AppDb, args: RemoveReactionArgs) {
  const exactMatches = db
    .select()
    .from(stampEvents)
    .where(eq(stampEvents.dedupeKey, args.dedupeKey))
    .all();

  if (exactMatches.length > 0) {
    for (const event of exactMatches) {
      db.delete(stampEvents).where(eq(stampEvents.id, event.id)).run();
    }
    return {
      removed: exactMatches.length,
      strategy: "by_dedupe_key" as const,
    };
  }

  const eventSource = args.source ?? `stamp:${args.reaction}`;
  const fallbackMatches = db
    .select()
    .from(stampEvents)
    .where(
      and(
        eq(stampEvents.giverId, args.giverId),
        eq(stampEvents.requesterId, args.requesterId),
        eq(stampEvents.channelId, args.channelId),
        eq(stampEvents.source, eventSource)
      )
    )
    .all();

  for (const event of fallbackMatches) {
    db.delete(stampEvents).where(eq(stampEvents.id, event.id)).run();
  }

  return {
    removed: fallbackMatches.length,
    strategy: "fallback_scan" as const,
  };
}
