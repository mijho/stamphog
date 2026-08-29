export function resolveSsrReadAuthHeaders(): Record<string, string> {
  const identityHeader = process.env.READ_AUTH_IDENTITY_HEADER;
  const identityValue = process.env.READ_AUTH_ALLOWED_IDENTITIES;
  if (!(identityHeader && identityValue)) {
    return {};
  }
  const member = identityValue
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!member) {
    return {};
  }
  return { [identityHeader]: member };
}
