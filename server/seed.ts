import { randomUUID } from "node:crypto";
import { faker } from "@faker-js/faker";
import { like, or } from "drizzle-orm";
import { TIMESTAMP_SOURCES } from "../src/lib/event-time";
import type { AppDb } from "./db";
import { actors, requests, stampEvents } from "./schema";

const FIXTURE_PREFIX = "fixture:v1";
const FIXTURE_DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_FAKER_SEED = 42_024;
const FIXTURE_ACTOR_COUNT = 72;
const FIXTURE_REACTIONS = ["stamp", "lgtm", "approved_stamp", "check", "done"];
const FIXTURE_CHANNELS = ["C_FIXTURE_BACKEND", "C_FIXTURE_FRONTEND"];
const FIXTURE_REQUEST_COUNT = 220;

interface FixtureActor {
  actorId: string;
  displayName: string;
  imageUrl?: string;
}

function buildFixtureActors() {
  const fixtureActors: FixtureActor[] = [];
  for (let index = 0; index < FIXTURE_ACTOR_COUNT; index++) {
    const actorNumber = (index + 1).toString().padStart(3, "0");
    fixtureActors.push({
      actorId: `fixture:actor:${actorNumber}`,
      displayName: faker.person.fullName(),
      imageUrl: faker.image.avatarGitHub(),
    });
  }
  return fixtureActors;
}

function fixtureActorAt(fixtureActors: FixtureActor[], index: number) {
  const actor = fixtureActors[index % fixtureActors.length];
  if (!actor) {
    throw new Error("missing fixture actor");
  }
  return actor;
}

function fixtureReactionAt(index: number) {
  const reaction = FIXTURE_REACTIONS[index % FIXTURE_REACTIONS.length];
  if (!reaction) {
    throw new Error("missing fixture reaction");
  }
  return reaction;
}

function fixtureChannelAt(index: number) {
  const channel = FIXTURE_CHANNELS[index % FIXTURE_CHANNELS.length];
  if (!channel) {
    throw new Error("missing fixture channel");
  }
  return channel;
}

export function resetDatabase(db: AppDb) {
  db.delete(requests).run();
  db.delete(stampEvents).run();
  db.delete(actors).run();
}

function clearFixtureDataOnly(db: AppDb) {
  db.delete(requests)
    .where(like(requests.dedupeKey, `${FIXTURE_PREFIX}%`))
    .run();
  db.delete(stampEvents)
    .where(
      or(
        like(stampEvents.dedupeKey, `${FIXTURE_PREFIX}%`),
        like(stampEvents.source, "fixture:%")
      )
    )
    .run();
  db.delete(actors).where(like(actors.actorId, "fixture:%")).run();
}

function createFixtureRequest(
  db: AppDb,
  args: {
    actors: FixtureActor[];
    requestIndex: number;
    targetRequestCount: number;
    now: number;
  }
) {
  const requester = fixtureActorAt(args.actors, args.requestIndex);
  const occurredAt =
    args.now -
    (args.targetRequestCount - args.requestIndex) * (FIXTURE_DAY_MS / 3);
  const channelId = fixtureChannelAt(args.requestIndex);
  const tsSeconds = Math.floor(occurredAt / 1000);
  const tsMicros = (args.requestIndex % 1_000_000).toString().padStart(6, "0");
  const messageRef = `${tsSeconds}.${tsMicros}`;
  const prNumber = 1200 + args.requestIndex;
  const host = args.requestIndex % 4 === 0 ? "graphite.dev" : "github.com";
  const prUrl =
    host === "github.com"
      ? `https://github.com/mijho/stamphog/pull/${prNumber}`
      : `https://app.graphite.dev/github/pr/mijho/stamphog/${prNumber}`;

  db.insert(requests)
    .values({
      id: randomUUID(),
      requesterId: requester.actorId,
      channelId,
      messageRef,
      occurredAt,
      prUrl,
      dedupeKey: `${FIXTURE_PREFIX}:request:${args.requestIndex}`,
      createdAt: occurredAt,
    })
    .run();

  return { requester, occurredAt, channelId, prUrl };
}

function createFixtureStampEvents(
  db: AppDb,
  args: {
    actors: FixtureActor[];
    requestIndex: number;
    requesterId: string;
    occurredAt: number;
    channelId: string;
    prUrl: string;
  }
) {
  if (args.requestIndex % 7 === 0) {
    return 0;
  }

  let createdEvents = 0;
  const stampsForRequest = (args.requestIndex % 5) + 1;
  for (let stampIndex = 0; stampIndex < stampsForRequest; stampIndex++) {
    let giver = fixtureActorAt(args.actors, args.requestIndex + stampIndex + 2);
    if (giver.actorId === args.requesterId) {
      giver = fixtureActorAt(args.actors, args.requestIndex + stampIndex + 3);
    }
    const reaction = fixtureReactionAt(args.requestIndex + stampIndex);

    db.insert(stampEvents)
      .values({
        id: randomUUID(),
        giverId: giver.actorId,
        requesterId: args.requesterId,
        stampCount: 1,
        occurredAt: args.occurredAt + stampIndex * 60_000,
        timestampSource: TIMESTAMP_SOURCES.slackEvent,
        ingestedAt: args.occurredAt + stampIndex * 60_000,
        source: `fixture:${reaction}`,
        channelId: args.channelId,
        prUrl: args.prUrl,
        dedupeKey: `${FIXTURE_PREFIX}:stamp:${args.requestIndex}:${stampIndex}`,
        createdAt: args.occurredAt + stampIndex * 60_000,
      })
      .run();
    createdEvents += 1;
  }

  return createdEvents;
}

export function seedTestData(db: AppDb, args: { resetExistingData?: boolean }) {
  const targetRequestCount = FIXTURE_REQUEST_COUNT;
  const now = Date.now();
  faker.seed(FIXTURE_FAKER_SEED);
  const fixtureActors = buildFixtureActors();

  if (args.resetExistingData) {
    resetDatabase(db);
  } else {
    clearFixtureDataOnly(db);
  }

  for (const actor of fixtureActors) {
    db.insert(actors)
      .values({
        actorId: actor.actorId,
        displayName: actor.displayName,
        imageUrl: actor.imageUrl,
        updatedAt: now,
      })
      .run();
  }

  let createdRequests = 0;
  let createdEvents = 0;

  for (
    let requestIndex = 0;
    requestIndex < targetRequestCount;
    requestIndex++
  ) {
    const request = createFixtureRequest(db, {
      actors: fixtureActors,
      requestIndex,
      targetRequestCount,
      now,
    });
    createdRequests += 1;

    createdEvents += createFixtureStampEvents(db, {
      actors: fixtureActors,
      requestIndex,
      requesterId: request.requester.actorId,
      occurredAt: request.occurredAt,
      channelId: request.channelId,
      prUrl: request.prUrl,
    });
  }

  return {
    fixtureVersion: FIXTURE_PREFIX,
    resetExistingData: args.resetExistingData ?? false,
    createdActors: fixtureActors.length,
    createdRequests,
    createdStampEvents: createdEvents,
  };
}
