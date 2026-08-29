export interface SlackUserSummary {
  slackUserId: string;
  displayName: string;
  imageUrl?: string;
}

export interface SlackReaction {
  name?: string;
  users?: string[];
}

export interface SlackHistoryMessage {
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  user?: string;
  text?: string;
  reactions?: SlackReaction[];
}

interface SlackUserProfile {
  display_name?: string;
  display_name_normalized?: string;
  real_name?: string;
  real_name_normalized?: string;
  image_24?: string;
  image_32?: string;
  image_48?: string;
  image_72?: string;
  image_192?: string;
}

interface SlackUserInfoResponse {
  ok?: boolean;
  error?: string;
  user?: {
    id?: string;
    name?: string;
    real_name?: string;
    profile?: SlackUserProfile;
  };
}

interface SlackHistoryResponse {
  ok?: boolean;
  error?: string;
  messages?: SlackHistoryMessage[];
  response_metadata?: { next_cursor?: string };
  retry_after?: number;
}

function pickDisplayName(
  user: SlackUserInfoResponse["user"],
  fallbackId: string
) {
  const profile = user?.profile;
  return (
    profile?.display_name_normalized ||
    profile?.display_name ||
    profile?.real_name_normalized ||
    profile?.real_name ||
    user?.real_name ||
    user?.name ||
    fallbackId
  );
}

export async function fetchSlackUserSummary(args: {
  botToken: string;
  slackUserId: string;
}): Promise<SlackUserSummary> {
  const params = new URLSearchParams({ user: args.slackUserId });
  const response = await fetch(
    `https://slack.com/api/users.info?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${args.botToken}` },
    }
  );
  const body = (await response.json()) as SlackUserInfoResponse;
  if (!(response.ok && body.ok && body.user)) {
    console.log("stamphog users.info lookup failed", {
      slackUserId: args.slackUserId,
      httpOk: response.ok,
      slackOk: body.ok ?? false,
      slackError: body.error ?? "unknown_error",
    });
    return {
      slackUserId: args.slackUserId,
      displayName: args.slackUserId,
    };
  }

  const profile = body.user.profile;
  return {
    slackUserId: body.user.id ?? args.slackUserId,
    displayName: pickDisplayName(body.user, args.slackUserId),
    imageUrl:
      profile?.image_72 ||
      profile?.image_48 ||
      profile?.image_192 ||
      profile?.image_32 ||
      profile?.image_24,
  };
}

export async function fetchSlackMessageAtTimestamp(args: {
  botToken: string;
  channelId: string;
  messageTs: string;
}) {
  const params = new URLSearchParams({
    channel: args.channelId,
    latest: args.messageTs,
    inclusive: "true",
    limit: "1",
  });
  const response = await fetch(
    `https://slack.com/api/conversations.history?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${args.botToken}` },
    }
  );
  const body = (await response.json()) as SlackHistoryResponse;
  if (!(response.ok && body.ok)) {
    throw new Error(
      `slack message fetch failed: ${body.error ?? "unknown_error"}`
    );
  }
  return body.messages?.[0] ?? null;
}

export interface SlackHistoryPage {
  ok: boolean;
  error?: string;
  messages: SlackHistoryMessage[];
  nextCursor: string;
  ratelimited: boolean;
  retryAfterSeconds?: number;
}

function parseRetryAfterSeconds(
  response: Response,
  body: SlackHistoryResponse
) {
  const header = response.headers.get("retry-after");
  const fromHeader = header ? Number(header) : undefined;
  if (fromHeader !== undefined && Number.isFinite(fromHeader)) {
    return Math.max(1, Math.floor(fromHeader));
  }
  const fromBody = body.retry_after;
  if (fromBody !== undefined && Number.isFinite(fromBody)) {
    return Math.max(1, Math.ceil(fromBody));
  }
  return undefined;
}

export async function fetchSlackHistoryPage(args: {
  botToken: string;
  channelId: string;
  cursor?: string;
  oldestTs?: string;
}): Promise<SlackHistoryPage> {
  const params = new URLSearchParams({
    channel: args.channelId,
    limit: "200",
    inclusive: "true",
  });
  if (args.cursor) {
    params.set("cursor", args.cursor);
  }
  if (args.oldestTs) {
    params.set("oldest", args.oldestTs);
  }

  const response = await fetch(
    `https://slack.com/api/conversations.history?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${args.botToken}` },
    }
  );
  const body = (await response.json()) as SlackHistoryResponse;
  return {
    ok: Boolean(response.ok && body.ok),
    error: body.error,
    messages: body.messages ?? [],
    nextCursor: body.response_metadata?.next_cursor ?? "",
    ratelimited: response.status === 429 || body.error === "ratelimited",
    retryAfterSeconds: parseRetryAfterSeconds(response, body),
  };
}
