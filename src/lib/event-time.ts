export const TIMESTAMP_SOURCES = {
  slackEvent: "slack_event",
  messageTimeApproximation: "message_time_approximation",
} as const;

export type TimestampSource =
  (typeof TIMESTAMP_SOURCES)[keyof typeof TIMESTAMP_SOURCES];
