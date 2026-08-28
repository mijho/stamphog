import { desc, gte } from "drizzle-orm";
import type { AppDb } from "./db";
import { actors, requests, stampEvents } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEADERBOARD_LIMIT = 20;
const DEFAULT_RECENT_EVENTS_LIMIT = 23;
const MAX_RESULTS_LIMIT = 100;

interface ActorProfile {
  displayName: string;
  imageUrl?: string;
}

export interface GiverAggregate {
  actorId: string;
  displayName: string;
  imageUrl?: string;
  stampsGiven: number;
  approvalsGiven: number;
}

export interface RequesterAggregate {
  actorId: string;
  displayName: string;
  imageUrl?: string;
  requestsPosted: number;
  stampsRequested: number;
  approvalsReceived: number;
}

export interface LeaderboardResponse {
  generatedAt: number;
  windowDays: number | null;
  totals: {
    events: number;
    stamps: number;
    requests: number;
  };
  givers: GiverAggregate[];
  requesters: RequesterAggregate[];
}

export interface StampActivity {
  _id: string;
  _creationTime: number;
  type: "stamp";
  occurredAt: number;
  prUrl?: string;
  giverId: string;
  giverDisplayName: string;
  giverImageUrl?: string;
  requesterId: string;
  requesterDisplayName: string;
  requesterImageUrl?: string;
}

export interface RequestActivity {
  _id: string;
  _creationTime: number;
  type: "request";
  occurredAt: number;
  prUrl: string;
  requesterId: string;
  requesterDisplayName: string;
  requesterImageUrl?: string;
}

export type RecentActivity = StampActivity | RequestActivity;

function clampLimit(value: number | undefined, fallback: number) {
  return Math.max(
    1,
    Math.min(MAX_RESULTS_LIMIT, Math.floor(value ?? fallback))
  );
}

function sortByGivenStamps(a: GiverAggregate, b: GiverAggregate) {
  return b.stampsGiven - a.stampsGiven || b.approvalsGiven - a.approvalsGiven;
}

function sortByRequestedStamps(a: RequesterAggregate, b: RequesterAggregate) {
  return (
    b.stampsRequested - a.stampsRequested ||
    b.approvalsReceived - a.approvalsReceived ||
    b.requestsPosted - a.requestsPosted
  );
}

function getActorProfileMap(db: AppDb) {
  const actorMap = new Map<string, ActorProfile>();
  for (const actor of db.select().from(actors).all()) {
    actorMap.set(actor.actorId, {
      displayName: actor.displayName,
      imageUrl: actor.imageUrl ?? undefined,
    });
  }
  return actorMap;
}

function resolveActorProfile(
  actorMap: Map<string, ActorProfile>,
  actorId: string
): ActorProfile {
  return actorMap.get(actorId) ?? { displayName: actorId };
}

export function getLeaderboard(
  db: AppDb,
  args: { windowDays?: number; limit?: number }
): LeaderboardResponse {
  const limit = clampLimit(args.limit, DEFAULT_LEADERBOARD_LIMIT);
  const since =
    args.windowDays && args.windowDays > 0
      ? Date.now() - Math.floor(args.windowDays) * DAY_MS
      : undefined;

  const stampRows = since
    ? db
        .select()
        .from(stampEvents)
        .where(gte(stampEvents.occurredAt, since))
        .all()
    : db.select().from(stampEvents).all();
  const requestRows = since
    ? db.select().from(requests).where(gte(requests.occurredAt, since)).all()
    : db.select().from(requests).all();
  const actorMap = getActorProfileMap(db);

  const giversById = new Map<string, GiverAggregate>();
  const requestersById = new Map<string, RequesterAggregate>();

  for (const request of requestRows) {
    const profile = resolveActorProfile(actorMap, request.requesterId);
    const requester = requestersById.get(request.requesterId) ?? {
      actorId: request.requesterId,
      displayName: profile.displayName,
      imageUrl: profile.imageUrl,
      requestsPosted: 0,
      stampsRequested: 0,
      approvalsReceived: 0,
    };
    requester.requestsPosted += 1;
    requestersById.set(request.requesterId, requester);
  }

  for (const event of stampRows) {
    const giverProfile = resolveActorProfile(actorMap, event.giverId);
    const giver = giversById.get(event.giverId) ?? {
      actorId: event.giverId,
      displayName: giverProfile.displayName,
      imageUrl: giverProfile.imageUrl,
      stampsGiven: 0,
      approvalsGiven: 0,
    };
    giver.stampsGiven += event.stampCount;
    giver.approvalsGiven += 1;
    giversById.set(event.giverId, giver);

    const requesterProfile = resolveActorProfile(actorMap, event.requesterId);
    const requester = requestersById.get(event.requesterId) ?? {
      actorId: event.requesterId,
      displayName: requesterProfile.displayName,
      imageUrl: requesterProfile.imageUrl,
      requestsPosted: 0,
      stampsRequested: 0,
      approvalsReceived: 0,
    };
    requester.stampsRequested += event.stampCount;
    requester.approvalsReceived += 1;
    requestersById.set(event.requesterId, requester);
  }

  return {
    generatedAt: Date.now(),
    windowDays: args.windowDays ?? null,
    totals: {
      events: stampRows.length,
      stamps: stampRows.reduce((sum, event) => sum + event.stampCount, 0),
      requests: requestRows.length,
    },
    givers: Array.from(giversById.values())
      .sort(sortByGivenStamps)
      .slice(0, limit),
    requesters: Array.from(requestersById.values())
      .filter((requester) => requester.stampsRequested > 0)
      .sort(sortByRequestedStamps)
      .slice(0, limit),
  };
}

export function getRecentEvents(
  db: AppDb,
  args: { limit?: number }
): RecentActivity[] {
  const limit = clampLimit(args.limit, DEFAULT_RECENT_EVENTS_LIMIT);
  const actorMap = getActorProfileMap(db);
  const stamps = db
    .select()
    .from(stampEvents)
    .orderBy(desc(stampEvents.occurredAt))
    .limit(limit)
    .all();
  const requestRows = db
    .select()
    .from(requests)
    .orderBy(desc(requests.occurredAt))
    .limit(limit)
    .all();

  const stampItems: StampActivity[] = stamps.map((event) => {
    const giver = resolveActorProfile(actorMap, event.giverId);
    const requester = resolveActorProfile(actorMap, event.requesterId);
    return {
      _id: event.id,
      _creationTime: event.createdAt,
      type: "stamp",
      occurredAt: event.occurredAt,
      prUrl: event.prUrl ?? undefined,
      giverId: event.giverId,
      giverDisplayName: giver.displayName,
      giverImageUrl: giver.imageUrl,
      requesterId: event.requesterId,
      requesterDisplayName: requester.displayName,
      requesterImageUrl: requester.imageUrl,
    };
  });

  const requestItems: RequestActivity[] = requestRows.map((request) => {
    const requester = resolveActorProfile(actorMap, request.requesterId);
    return {
      _id: request.id,
      _creationTime: request.createdAt,
      type: "request",
      occurredAt: request.occurredAt,
      prUrl: request.prUrl,
      requesterId: request.requesterId,
      requesterDisplayName: requester.displayName,
      requesterImageUrl: requester.imageUrl,
    };
  });

  return [...stampItems, ...requestItems]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, limit);
}
