import type { Context, MiddlewareHandler } from "hono";
import { serverEnv } from "./env";

export interface ReadAuthConfig {
  identityHeader?: string;
  allowedIdentities?: string[];
  allowAnonymous?: boolean;
}

export type ReadAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

export function checkReadAuth(
  c: Context,
  config = readAuthConfigFromEnv()
): ReadAuthResult {
  const header = config.identityHeader?.trim();
  const allowed = (config.allowedIdentities ?? [])
    .map((identity) => identity.trim().toLowerCase())
    .filter(Boolean);

  if (!header || allowed.length === 0) {
    if (config.allowAnonymous !== false) {
      return { ok: true };
    }
    return { ok: false, status: 401, message: "unauthorized" };
  }

  const identity = c.req.header(header)?.trim().toLowerCase();
  if (!identity) {
    return { ok: false, status: 401, message: "unauthorized" };
  }

  if (!allowed.includes(identity)) {
    return { ok: false, status: 403, message: "forbidden" };
  }

  return { ok: true };
}

export function readAuthMiddleware(config?: ReadAuthConfig): MiddlewareHandler {
  return async (c, next) => {
    const result = checkReadAuth(c, config);
    if (!result.ok) {
      return c.text(result.message, result.status);
    }
    return next();
  };
}

export function readAuthConfigFromEnv(): ReadAuthConfig {
  return {
    identityHeader: serverEnv.readAuthIdentityHeader,
    allowedIdentities: serverEnv.readAuthAllowedIdentities,
    allowAnonymous: serverEnv.readAuthAllowAnonymous,
  };
}
