import { SocketModeClient } from "@slack/socket-mode";
import { getDb } from "../db";
import { handleSlackMessageEvent, handleSlackReactionEvent } from "./handlers";
import type { SlackMessageEvent, SlackReactionEvent } from "./types";

interface SlackAckable {
  ack: () => Promise<void>;
}

interface MessagePayload extends SlackAckable {
  event: SlackMessageEvent;
}

interface ReactionPayload extends SlackAckable {
  event: SlackReactionEvent;
}

async function startSlackSocketMode() {
  const appToken = process.env.SLACK_APP_TOKEN?.trim();
  const botToken = process.env.SLACK_BOT_TOKEN?.trim();
  if (!appToken) {
    console.log("stamphog slack socket mode off (no SLACK_APP_TOKEN)");
    return;
  }
  if (!botToken) {
    console.log("stamphog slack socket mode off (no SLACK_BOT_TOKEN)");
    return;
  }
  if (!appToken.startsWith("xapp-")) {
    console.log(
      "stamphog slack socket mode off (SLACK_APP_TOKEN must start with xapp-)"
    );
    return;
  }

  const client = new SocketModeClient({ appToken });
  const db = getDb();

  client.on("connected", () => {
    console.log("stamphog slack socket mode connected");
  });
  client.on("error", (error) => {
    console.log("stamphog slack socket mode error", error);
  });

  client.on("message", async ({ event, ack }: MessagePayload) => {
    await ack();
    console.log("stamphog slack", { socket: true, event: "message" });
    const response = await handleSlackMessageEvent(db, event, botToken);
    console.log("stamphog slack", {
      socket: true,
      status: response.status,
      body: await response.text(),
    });
  });

  client.on("reaction_added", async ({ event, ack }: ReactionPayload) => {
    await ack();
    console.log("stamphog slack", { socket: true, event: "reaction_added" });
    const response = await handleSlackReactionEvent(db, event, botToken);
    console.log("stamphog slack", {
      socket: true,
      status: response.status,
      body: await response.text(),
    });
  });

  client.on("reaction_removed", async ({ event, ack }: ReactionPayload) => {
    await ack();
    console.log("stamphog slack", { socket: true, event: "reaction_removed" });
    const response = await handleSlackReactionEvent(db, event, botToken);
    console.log("stamphog slack", {
      socket: true,
      status: response.status,
      body: await response.text(),
    });
  });

  await client.start();
}

void startSlackSocketMode().catch((error) => {
  console.log("stamphog slack socket mode failed to start", error);
});
