import "../env";
import { getDb } from "../db";
import { runSlackBackfill } from "../slack/backfill";

const raw = process.env.CHANNEL_IDS;
if (!raw) {
  throw new Error("missing CHANNEL_IDS env var");
}
const channelIds = raw
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (channelIds.length === 0) {
  throw new Error("CHANNEL_IDS env var is empty");
}

const db = getDb();
const failures: Array<{ channelId: string; error: string }> = [];
let totalScannedMessages = 0;
let totalCreatedEvents = 0;
let totalCreatedRequests = 0;

for (const channelId of channelIds) {
  try {
    const summary = await runSlackBackfill(db, { channelId });
    totalScannedMessages += summary.scannedMessages;
    totalCreatedEvents += summary.createdEvents;
    totalCreatedRequests += summary.createdRequests;
  } catch (error) {
    failures.push({
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(
  JSON.stringify(
    {
      channels: channelIds.length,
      failures,
      totalScannedMessages,
      totalCreatedEvents,
      totalCreatedRequests,
    },
    null,
    2
  )
);
