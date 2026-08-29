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

export const serverEnv = Object.freeze({
  apiPort: parsePort(),
  databasePath: optionalValue("DATABASE_PATH") ?? DEFAULT_DATABASE_PATH,
  slackSigningSecret: optionalValue("SLACK_SIGNING_SECRET"),
  slackBotToken: optionalValue("SLACK_BOT_TOKEN"),
  channelIds: optionalValue("CHANNEL_IDS"),
  apiPublicUrl: optionalHttpUrl("VITE_API_URL"),
  posthogHost: optionalHttpUrl("VITE_PUBLIC_POSTHOG_HOST"),
});
