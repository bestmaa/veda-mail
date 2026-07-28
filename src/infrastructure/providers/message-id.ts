import "server-only";

import { randomUUID } from "node:crypto";

import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";

const MAX_MESSAGE_ID_LENGTH = 998;
const MAX_REFERENCE_BYTES = 8_192;
const MAX_REFERENCE_COUNT = 50;

export const createMessageId = (sender: string): string => {
  const domain = sender.slice(sender.lastIndexOf("@") + 1).toLowerCase();
  return `${randomUUID()}@${domain}`;
};

export const safeMessageId = (value?: string | null): string | null => {
  const candidate = value?.trim();
  return candidate &&
    candidate.length <= MAX_MESSAGE_ID_LENGTH &&
    !hasHeaderControlCharacter(candidate)
    ? candidate
    : null;
};

export const safeMessageIds = (
  values: readonly string[],
): readonly string[] => {
  const safe: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const value of values) {
    const candidate = safeMessageId(value);
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    const candidateBytes = Buffer.byteLength(candidate, "utf8");
    if (safe.length >= MAX_REFERENCE_COUNT) {
      break;
    }
    if (bytes + candidateBytes > MAX_REFERENCE_BYTES) continue;
    seen.add(key);
    safe.push(candidate);
    bytes += candidateBytes;
  }
  return safe;
};

export const safeReplyReferences = (
  values: readonly string[],
  parent: string,
): readonly string[] => {
  const safeParent = safeMessageId(parent);
  if (!safeParent) return [];
  const parentKey = safeParent.toLowerCase();
  const recent: string[] = [];
  const seen = new Set<string>([parentKey]);
  let bytes = Buffer.byteLength(safeParent, "utf8");
  for (const value of values.toReversed()) {
    const candidate = safeMessageId(value);
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    const candidateBytes = Buffer.byteLength(candidate, "utf8");
    if (
      recent.length >= MAX_REFERENCE_COUNT - 1 ||
      bytes + candidateBytes > MAX_REFERENCE_BYTES
    ) {
      continue;
    }
    seen.add(key);
    recent.push(candidate);
    bytes += candidateBytes;
  }
  return [...recent.toReversed(), safeParent];
};
