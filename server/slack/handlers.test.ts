import { expect, test } from "bun:test";
import { createDb } from "../db";
import { getLeaderboard } from "../queries";
import { handleSlackReactionEvent } from "./handlers";

const qualifyingMessage = {
  ts: "1700000000.000",
  user: "U_REQ",
  text: "https://github.com/mijho/stamphog/pull/1",
};

function testDependencies(message = qualifyingMessage) {
  return {
    fetchMessage: async () => message,
    fetchUser: async ({ slackUserId }: { slackUserId: string }) => ({
      slackUserId,
      displayName: slackUserId,
    }),
  };
}

test("live ingestion records the request but ignores a self-stamp", async () => {
  const db = createDb(":memory:");
  const response = await handleSlackReactionEvent(
    db,
    {
      type: "reaction_added",
      user: "U_REQ",
      reaction: "white_check_mark",
      event_ts: "1700000001.000",
      item: { channel: "C1", ts: "1700000000.000" },
    },
    "xoxb-test",
    testDependencies({ ...qualifyingMessage, user: "U_REQ" })
  );

  const result = (await response.json()) as {
    ok: boolean;
    ignored: boolean;
    reason: string;
  };
  const leaderboard = getLeaderboard(db, {});
  expect(result).toEqual({ ok: true, ignored: true, reason: "self_stamp" });
  expect(leaderboard.totals.requests).toBe(1);
  expect(leaderboard.totals.stamps).toBe(0);
});

test("live ingestion records a stamp from a different reviewer", async () => {
  const db = createDb(":memory:");
  const response = await handleSlackReactionEvent(
    db,
    {
      type: "reaction_added",
      user: "U_GIVER",
      reaction: "white_check_mark",
      event_ts: "1700000001.000",
      item: { channel: "C1", ts: "1700000000.000" },
    },
    "xoxb-test",
    testDependencies()
  );

  const result = (await response.json()) as {
    ok: boolean;
    duplicateSkipped: boolean;
  };
  const leaderboard = getLeaderboard(db, {});
  expect(result).toEqual({ ok: true, duplicateSkipped: false });
  expect(leaderboard.totals.requests).toBe(1);
  expect(leaderboard.totals.stamps).toBe(1);
});

test("a Slack API failure during message lookup is surfaced, not silently ignored", async () => {
  const db = createDb(":memory:");
  await expect(
    handleSlackReactionEvent(
      db,
      {
        type: "reaction_added",
        user: "U_GIVER",
        reaction: "white_check_mark",
        event_ts: "1700000001.000",
        item: { channel: "C1", ts: "1700000000.000" },
      },
      "xoxb-test",
      {
        fetchMessage: async () => {
          throw new Error("slack message fetch failed: channel_not_found");
        },
        fetchUser: async ({ slackUserId }: { slackUserId: string }) => ({
          slackUserId,
          displayName: slackUserId,
        }),
      }
    )
  ).rejects.toThrow("slack message fetch failed");
});

test("a genuine thread reply (message not found) is ignored without error", async () => {
  const db = createDb(":memory:");
  const response = await handleSlackReactionEvent(
    db,
    {
      type: "reaction_added",
      user: "U_GIVER",
      reaction: "white_check_mark",
      event_ts: "1700000001.000",
      item: { channel: "C1", ts: "1700000000.000" },
    },
    "xoxb-test",
    {
      fetchMessage: async () => null,
      fetchUser: async ({ slackUserId }: { slackUserId: string }) => ({
        slackUserId,
        displayName: slackUserId,
      }),
    }
  );

  const result = (await response.json()) as {
    ok: boolean;
    ignored: boolean;
    reason: string;
  };
  expect(result).toEqual({ ok: true, ignored: true, reason: "thread_reply" });
});
