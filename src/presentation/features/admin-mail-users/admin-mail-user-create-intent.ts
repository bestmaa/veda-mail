export interface MailUserIdempotencyIntent {
  readonly fingerprint: string;
  readonly key: string;
}

export const normalizeMailboxEmail = (
  input: string,
  selectedDomain: string,
): string | null => {
  const trimmed = input.trim();
  const separator = trimmed.lastIndexOf("@");
  const localPart = trimmed.slice(0, separator);
  const domainPart = trimmed.slice(separator + 1).toLocaleLowerCase();
  if (
    !selectedDomain ||
    separator < 1 ||
    localPart.includes("@") ||
    domainPart !== selectedDomain.toLocaleLowerCase()
  ) {
    return null;
  }
  return `${localPart}@${domainPart}`;
};

export const fingerprintMailboxIntent = async (
  email: string,
  displayName: string,
): Promise<string> => {
  const encoded = new TextEncoder().encode(
    JSON.stringify([email, displayName]),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

export const idempotencyIntent = (
  previous: MailUserIdempotencyIntent | null,
  fingerprint: string,
  generateKey: () => string,
): MailUserIdempotencyIntent =>
  previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: generateKey() };
