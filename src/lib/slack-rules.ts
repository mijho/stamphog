const COLON_REGEX = /:/g;
const URL_GLOBAL_REGEX = /https?:\/\/[^\s>]+/g;
const NUMERIC_ID_REGEX = /^\d+$/;

export const STAMP_EMOJIS = {
  stamp: "https://emoji.slack-edge.com/TSS5W8YQZ/stamp/51cd14b42185661a.png",
  stampstamp:
    "https://emoji.slack-edge.com/TSS5W8YQZ/stampstamp/f2d963bdeea84421.gif",
  approved_stamp:
    "https://emoji.slack-edge.com/TSS5W8YQZ/approved_stamp/f284b3ca7ed9102d.png",
  rubberstamp:
    "https://emoji.slack-edge.com/TSS5W8YQZ/rubberstamp/8a626680618714d2.jpg",
  "fixed-stamp":
    "https://emoji.slack-edge.com/TSS5W8YQZ/fixed-stamp/2e1a46a6e857572f.png",
  "kirby-stamp":
    "https://emoji.slack-edge.com/TSS5W8YQZ/kirby-stamp/b943be8edd450f97.gif",
  "party-rubber-stamp":
    "https://emoji.slack-edge.com/TSS5W8YQZ/party-rubber-stamp/cdb5acb17e69cb06.gif",
  "turbo-stamp":
    "https://emoji.slack-edge.com/TSS5W8YQZ/turbo-stamp/afefbc1daf0208c5.gif",
  "sloth-zootopia-stamp":
    "https://emoji.slack-edge.com/TSS5W8YQZ/sloth-zootopia-stamp/dbc5971f288a75d2.gif",
  "bufo-fastest-stamp-in-the-west":
    "https://emoji.slack-edge.com/TSS5W8YQZ/bufo-fastest-stamp-in-the-west/ee9f8a01348c17bd.png",
  "please-sir-i-want-some-more-stamp":
    "https://emoji.slack-edge.com/TSS5W8YQZ/please-sir-i-want-some-more-stamp/071d5a331a6bfe74.png",
  lgtm: "https://emoji.slack-edge.com/TSS5W8YQZ/lgtm/81da1795df1a294d.png",
  lgtm2: "https://emoji.slack-edge.com/TSS5W8YQZ/lgtm2/2c4f33914eae4dea.png",
  "bufo-lgtm":
    "https://emoji.slack-edge.com/TSS5W8YQZ/bufo-lgtm/e9b119582593f572.png",
  check: "https://emoji.slack-edge.com/TSS5W8YQZ/check/8a48c262aae970de.png",
  gold_check:
    "https://emoji.slack-edge.com/TSS5W8YQZ/gold_check/a28dbab34d2dba65.png",
  "cowboy-check":
    "https://emoji.slack-edge.com/TSS5W8YQZ/cowboy-check/f5ae7d6167343a4a.png",
  done: "https://emoji.slack-edge.com/TSS5W8YQZ/done/bd5b8715cb6c55b1.jpg",
  white_check_mark:
    "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2705.png",
  heavy_check_mark:
    "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2714.png",
} as const;

export function normalizeEmoji(emoji: string) {
  return emoji.replace(COLON_REGEX, "").trim().toLowerCase();
}

export function getStampEmojiSet() {
  return new Set(
    Object.keys(STAMP_EMOJIS)
      .map((emoji) => normalizeEmoji(emoji))
      .filter(Boolean)
  );
}

export function isSelfStamp(giverId: string, requesterId: string) {
  return giverId === requesterId;
}

function toNormalizedUrl(candidate: string) {
  const cleaned = candidate.replace(/[)>.,!?]+$/g, "").split("|", 1)[0] ?? "";
  try {
    return new URL(cleaned);
  } catch {
    return null;
  }
}

function isGitHubHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "github.com" || host.endsWith(".github.com");
}

function isGraphiteHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "graphite.dev" || host.endsWith(".graphite.dev");
}

function pathSegments(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

function isGitHubPullRequestPath(pathname: string) {
  const parts = pathSegments(pathname);
  return (
    parts.length >= 4 &&
    parts[2] === "pull" &&
    NUMERIC_ID_REGEX.test(parts[3] ?? "")
  );
}

function isGraphiteReviewPath(pathname: string) {
  const parts = pathSegments(pathname);
  return (
    parts.length >= 5 &&
    parts[0] === "github" &&
    parts[1] === "pr" &&
    NUMERIC_ID_REGEX.test(parts[4] ?? "")
  );
}

function isQualifyingReviewUrl(parsed: URL) {
  if (isGitHubHost(parsed.hostname)) {
    return isGitHubPullRequestPath(parsed.pathname);
  }
  if (isGraphiteHost(parsed.hostname)) {
    return isGraphiteReviewPath(parsed.pathname);
  }
  return false;
}

export function extractQualifyingReviewUrl(text: string | undefined) {
  if (!text) {
    return undefined;
  }
  const matches = text.match(URL_GLOBAL_REGEX) ?? [];
  for (const candidate of matches) {
    const parsed = toNormalizedUrl(candidate);
    if (parsed && isQualifyingReviewUrl(parsed)) {
      return parsed.toString();
    }
  }
  return undefined;
}

export function buildReactionDedupeKey(args: {
  channelId: string;
  messageTs: string;
  reaction: string;
  giverSlackId: string;
}) {
  return `slack:reaction:${args.channelId}:${args.messageTs}:${args.reaction}:${args.giverSlackId}`;
}

export function buildRequestDedupeKey(args: {
  channelId: string;
  messageTs: string;
}) {
  return `slack:request:${args.channelId}:${args.messageTs}`;
}
