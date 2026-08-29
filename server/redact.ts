const SENSITIVE_KEY =
  /token|secret|authorization|rawbody|raw_body|payload|password|bearer/i;
const MAX_STRING_CHARS = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactString(value: string) {
  const length = value.length;
  if (length <= MAX_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_CHARS)}...[truncated ${length} chars]`;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[max depth]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return `[redacted array of ${value.length} items]`;
    }
    return value.map((item) => redact(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }

  return value;
}
