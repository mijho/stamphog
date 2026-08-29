import { expect, test } from "bun:test";
import { redact, redactString } from "./redact";

test("redacts sensitive keys", () => {
  expect(
    redact({
      botToken: "xoxb-secret-token",
      event: {
        rawBody: '{"text":"private"}',
      },
      channelId: "C123",
    })
  ).toEqual({
    botToken: "[REDACTED]",
    event: {
      rawBody: "[REDACTED]",
    },
    channelId: "C123",
  });
});

test("redacts token/sceret variants case-insensitively", () => {
  const out = redact({
    SLACK_SIGNING_SECRET: "abc",
    Authorization: "Bearer x",
  });
  expect(out).toEqual({
    SLACK_SIGNING_SECRET: "[REDACTED]",
    Authorization: "[REDACTED]",
  });
});

test("truncates long strings", () => {
  const long = "a".repeat(500);
  expect(redactString(long)).toBe(`${"a".repeat(200)}...[truncated 500 chars]`);
  expect(redact({ text: long })).toEqual({
    text: `${"a".repeat(200)}...[truncated 500 chars]`,
  });
});

test("limits arrays and nesting depth", () => {
  const out = redact(Array.from({ length: 50 }, (_, i) => i));
  expect(out).toBe("[redacted array of 50 items]");
});

test("leaves non-sensitive primitives intact", () => {
  expect(
    redact({ received: true, bytes: 60, reaction: "white_check_mark", n: 3 })
  ).toEqual({
    received: true,
    bytes: 60,
    reaction: "white_check_mark",
    n: 3,
  });
});
