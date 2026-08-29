const DEFAULT_API_PORT = 8787;
const DEFAULT_DATABASE_PATH = "./data/stamphog.db";

function optionalValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parsePort() {
  const raw = optionalValue("API_PORT") ?? optionalValue("PORT");
  if (!raw) {
    return DEFAULT_API_PORT;
  }

  const port = Number(raw);
  if (!(Number.isInteger(port) && port > 0 && port <= 65_535)) {
    throw new Error(
      `API_PORT/PORT must be an integer from 1 to 65535, got ${raw}`
    );
  }
  return port;
}

function optionalHttpUrl(name: string) {
  const value = optionalValue(name);
  if (!value) {
    return undefined;
  }

  const parsed = new URL(value);
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error(`${name} must use http or https`);
  }
  return value;
}

function parseBoolean(name: string, fallback: boolean) {
  const raw = optionalValue(name);
  if (!raw) {
    return fallback;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  throw new Error(`${name} must be true or false, got ${raw}`);
}

function parseCommaSeparated(name: string) {
  return (optionalValue(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const serverEnv = Object.freeze({
  apiPort: parsePort(),
  databasePath: optionalValue("DATABASE_PATH") ?? DEFAULT_DATABASE_PATH,
  slackSigningSecret: optionalValue("SLACK_SIGNING_SECRET"),
  slackBotToken: optionalValue("SLACK_BOT_TOKEN"),
  channelIds: optionalValue("CHANNEL_IDS"),
  apiPublicUrl: optionalHttpUrl("VITE_API_URL"),
  posthogHost: optionalHttpUrl("VITE_PUBLIC_POSTHOG_HOST"),
  readAuthIdentityHeader: optionalValue("READ_AUTH_IDENTITY_HEADER"),
  readAuthAllowedIdentities: parseCommaSeparated(
    "READ_AUTH_ALLOWED_IDENTITIES"
  ),
  readAuthAllowAnonymous: parseBoolean("READ_AUTH_ALLOW_ANONYMOUS", true),
});
