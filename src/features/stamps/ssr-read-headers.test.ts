import { afterEach, beforeEach, expect, test } from "bun:test";
import { resolveSsrReadAuthHeaders } from "./ssr-read-headers";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.READ_AUTH_IDENTITY_HEADER = "";
  process.env.READ_AUTH_ALLOWED_IDENTITIES = "";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("sends no header when read auth is unconfigured", () => {
  expect(resolveSsrReadAuthHeaders()).toEqual({});
});

test("sends a single identity for a single-value allowlist", () => {
  process.env.READ_AUTH_IDENTITY_HEADER = "x-auth-request-user";
  process.env.READ_AUTH_ALLOWED_IDENTITIES = "alice@example.com";
  expect(resolveSsrReadAuthHeaders()).toEqual({
    "x-auth-request-user": "alice@example.com",
  });
});

test("sends the first trimmed member of a multi-identity allowlist", () => {
  process.env.READ_AUTH_IDENTITY_HEADER = "x-auth-request-user";
  process.env.READ_AUTH_ALLOWED_IDENTITIES =
    "alice@example.com, bob@example.com";
  expect(resolveSsrReadAuthHeaders()).toEqual({
    "x-auth-request-user": "alice@example.com",
  });
});

test("ignores an empty allowlist value", () => {
  process.env.READ_AUTH_IDENTITY_HEADER = "x-auth-request-user";
  process.env.READ_AUTH_ALLOWED_IDENTITIES = " , ";
  expect(resolveSsrReadAuthHeaders()).toEqual({});
});
